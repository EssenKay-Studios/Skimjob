// Live game channel and server bots. docs/m2-plan.md M2-3; design §17.2, §17.3
import { createBot, PERSONALITIES, type PersonalityId } from "@skimjob/bots";
import { canSee, viewFor, type Command, type GameState, type PlayerCommand, type PlayerView } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import { CLOSE_SIGNED_OUT, CLOSE_TOO_MANY, MAX_QUEUED_MESSAGES, originAllowed, parseClientMessage, type ServerMessage } from "./live";
import { playerIdFor } from "./lobby";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import type { LobbySettings } from "./settings";
import { createGameStore, type GameStore } from "./store";
import { testDb } from "./testkit";

// Socket messages arrive within a tick or two: poll fast.
const quick = { interval: 1, timeout: 5000 };

let db: Db;
let app: FastifyInstance;
let store: GameStore;
const clock = fakeClock(Date.UTC(2026, 10, 1));
beforeAll(async () => {
  db = await testDb();
  store = createGameStore(db);
  app = buildServer({ db, clock, store });
  await app.ready();
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

const call = async (url: string, who: string | null, payload: Record<string, unknown> = {}) => {
  const res = await app.inject({ method: "POST", url, payload, cookies: who ? { [SESSION_COOKIE]: who } : {} });
  return { body: res.json() as LobbyView, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};

interface Human {
  readonly who: string;
  readonly player: string;
}
/** A started game with `people` signed-in seats (host first) and `bots` bot seats after them. */
async function startGame(people: number, bots: number, settings: Partial<LobbySettings> = {}, start = true, personality: PersonalityId = "opportunist") {
  const host = (await call("/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await call("/games", host, { settings })).body;
  const sessions = [host];
  for (let i = 1; i < people; i++) sessions.push((await call(`/invites/${game.inviteCode}/join`, null, { nickname: `Guest ${i}` })).session!);
  for (let i = 0; i < bots; i++) await call(`/games/${game.id}/bots`, host, { personality });
  if (!start) return { id: game.id, humans: sessions.map((who) => ({ who, player: "" })) };
  await call(`/games/${game.id}/start`, host);
  const humans: Human[] = [];
  for (const who of sessions) {
    const res = await app.inject({ method: "GET", url: `/games/${game.id}`, cookies: { [SESSION_COOKIE]: who } });
    humans.push({ who, player: (res.json() as LobbyView).seats.find((s) => s.you)!.playerId! });
  }
  return { id: game.id, humans };
}

/** The kinds of a socket's first three messages. */
const firstKinds = (messages: readonly ServerMessage[]) =>
  messages.slice(0, 3).map((m) => ["view", "chatHistory", "presence", "chat", "dmNotice"].find((k) => k in m) ?? JSON.stringify(m));

/** A test socket that keeps every message it got, raw. */
class Client {
  readonly raw: string[] = [];
  closed: number | null = null;
  private n = 0;
  ws!: WebSocket;
  constructor(readonly player: string) {}
  static async open(gameId: string, h: Human) {
    const c = new Client(h.player);
    // Listen from the start: the first view can come right after the upgrade.
    const onInit = (ws: WebSocket) => {
      ws.on("message", (data) => c.raw.push(String(data)));
      ws.on("close", (code) => (c.closed = code));
    };
    c.ws = await app.injectWS(`/games/${gameId}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${h.who}` } }, { onInit });
    // The first view, then the chat history (M2-8a), then presence (owner decision, 2 Nov), and nothing before.
    await vi.waitFor(() => expect(c.messages.some((m) => "presence" in m)).toBe(true), quick);
    expect(c.views()).toHaveLength(1);
    expect(firstKinds(c.messages)).toEqual(["view", "chatHistory", "presence"]);
    return c;
  }
  get messages(): ServerMessage[] {
    return this.raw.map((t) => JSON.parse(t) as ServerMessage);
  }
  views(): PlayerView[] {
    return this.messages.flatMap((m) => ("view" in m ? [m.view] : []));
  }
  lastView(): PlayerView {
    return this.views().at(-1)!;
  }
  /** Sends a raw message and waits for the reply that echoes its id. */
  async sendRaw(msg: Record<string, unknown>): Promise<ServerMessage> {
    const id = `m${++this.n}`;
    this.ws.send(JSON.stringify({ ...msg, id }));
    let reply: ServerMessage | undefined;
    await vi.waitFor(() => {
      reply = this.messages.find((m) => "id" in m && m.id === id);
      expect(reply).toBeDefined();
    }, quick);
    return reply!;
  }
  send(cmd: unknown) {
    return this.sendRaw({ cmd });
  }
  /**
   * Waits until every message the server queued for this socket so far has
   * arrived: the reply to a no-op goes through the game's lock, after any
   * push from earlier commands.
   */
  async barrier(): Promise<number> {
    await this.sendRaw({});
    return this.raw.length;
  }
}

const load = async (id: string) => (await store.load(id))!;

describe("connecting (GET /games/:id/ws)", () => {
  it("refuses the upgrade when signed out, not seated, or the game hasn't started", async () => {
    const { id } = await startGame(2, 1);
    await expect(app.injectWS(`/games/${id}/ws`)).rejects.toThrow(/401/);
    const stranger = (await call("/auth/guest", null, { nickname: "Stranger" })).session!;
    await expect(app.injectWS(`/games/${id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${stranger}` } })).rejects.toThrow(/404/);
    await expect(app.injectWS(`/games/not-a-game/ws`, { headers: { cookie: `${SESSION_COOKIE}=${stranger}` } })).rejects.toThrow(/404/);
    const lobby = await startGame(2, 0, {}, false);
    await expect(app.injectWS(`/games/${lobby.id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${lobby.humans[0]!.who}` } })).rejects.toThrow(/404/);
  });

  it("refuses a browser from another origin (403); its own host, a listed origin or no Origin is fine", async () => {
    const { id, humans } = await startGame(2, 0);
    const cookie = `${SESSION_COOKIE}=${humans[0]!.who}`;
    await expect(app.injectWS(`/games/${id}/ws`, { headers: { cookie, host: "localhost:3000", origin: "https://evil.example" } })).rejects.toThrow(/403/);
    const ws = await app.injectWS(`/games/${id}/ws`, { headers: { cookie, host: "localhost:3000", origin: "http://localhost:3000" } });
    ws.close();
    expect(originAllowed(undefined, "localhost:3000", [])).toBe(true);
    expect(originAllowed("http://localhost:5173", "localhost:3000", ["http://localhost:5173"])).toBe(true);
    expect(originAllowed("http://localhost:5173", "localhost:3000", [])).toBe(false);
    expect(originAllowed("null", "localhost:3000", [])).toBe(false);
  });

  it("signing out closes that session's sockets (4401), not other people's", async () => {
    const { id, humans } = await startGame(2, 0);
    const a = await Client.open(id, humans[0]!);
    const b = await Client.open(id, humans[1]!);
    await app.inject({ method: "POST", url: "/auth/logout", cookies: { [SESSION_COOKIE]: humans[0]!.who } });
    await vi.waitFor(() => expect(a.closed).toBe(CLOSE_SIGNED_OUT), quick);
    expect(b.closed).toBeNull();
    await expect(app.injectWS(`/games/${id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${humans[0]!.who}` } })).rejects.toThrow(/401/);
    b.ws.close();
  });

  it("sends the seat its own view on connect, and nothing server-only", async () => {
    const { id, humans } = await startGame(2, 1);
    const c = await Client.open(id, humans[1]!);
    const state = await load(id);
    expect(c.lastView()).toEqual(viewFor(state, humans[1]!.player));
    expect(c.raw[0]).not.toContain(state.config.seed);
    expect(c.raw[0]).not.toMatch(/"idx"/);
    c.ws.close();
  });
});

describe("commands from a socket", () => {
  it("a forged player acts as the sender (design §17.2, STATUS 'M2 (server)')", async () => {
    const { id, humans } = await startGame(2, 1);
    const [a, b] = humans as [Human, Human];
    const c = await Client.open(id, a);
    const reply = await c.send({ type: "submitMove", player: b.player, move: { room: "lobby", pocket: 0 } });
    expect(reply).toEqual({ ok: true, id: "m1" });
    const state = await load(id);
    expect(state.moves[a.player]).toEqual({ room: "lobby", pocket: 0 });
    expect(state.moves[b.player]).toBeUndefined();
    expect(parseClientMessage(JSON.stringify({ cmd: { type: "callEmergency", player: "p2" } }), "p1")).toEqual({
      ok: true,
      command: { type: "callEmergency", player: "p1" },
    });
    c.ws.close();
  });

  it("refuses system commands, unknown commands and bad messages, and keeps the socket open", async () => {
    const { id, humans } = await startGame(2, 1);
    const c = await Client.open(id, humans[0]!);
    const before = await load(id);
    for (const cmd of [
      { type: "advance", deadline: { kind: "round", round: 1 } },
      { type: "scheduleMeeting", act: 1, slot: "now" },
      { type: "toString" },
      { type: "__proto__" },
      "submitMove",
      null,
    ]) {
      expect(await c.send(cmd)).toMatchObject({ rejected: true });
    }
    c.ws.send("not json");
    c.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    await vi.waitFor(() => expect(c.messages.filter((m) => "rejected" in m && !("id" in m))).toHaveLength(2), quick);
    expect(await load(id)).toBe(before); // nothing ran
    expect((await c.send({ type: "submitMove", move: { room: "lobby", pocket: 0 } }))).toMatchObject({ ok: true });
    c.ws.close();
  });

  it("replies in order, and a refusal goes only to the sender", async () => {
    const { id, humans } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    const b = await Client.open(id, humans[1]!);
    // a's first move is public (moveLocked, owner decision 2 Nov); the changes after it are hidden.
    expect(await a.send({ type: "submitMove", move: { room: "lobby", pocket: 0 } })).toMatchObject({ ok: true });
    const seen = await b.barrier();
    a.ws.send(JSON.stringify({ id: 1, cmd: { type: "submitMove", move: { room: "nowhere", pocket: 0 } } }));
    a.ws.send(JSON.stringify({ id: 2, cmd: { type: "submitMove", move: { room: "lobby", pocket: 0 } } }));
    await vi.waitFor(() => expect(a.messages.filter((m) => "id" in m && typeof m.id === "number")).toHaveLength(2), quick);
    const replies = a.messages.filter((m) => "id" in m && typeof m.id === "number");
    expect(replies[0]).toMatchObject({ id: 1, rejected: true, reason: expect.any(String) });
    expect(replies[1]).toEqual({ id: 2, ok: true });
    // b got nothing but its own barrier reply: not the refusal, and no push (a move is private).
    expect(await b.barrier()).toBe(seen + 1);
    a.ws.close();
    b.ws.close();
  });
});

describe("presence (owner decision, 2 Nov)", () => {
  const presences = (c: Client) => c.messages.flatMap((m) => ("presence" in m ? [m.presence] : []));
  it("each person's seat shows online now or last seen, pushed as seats come and go; bots aren't listed; never in the log", async () => {
    const { id, humans } = await startGame(2, 1);
    const [ha, hb] = humans as [Human, Human];
    const logBefore = (await load(id)).log.length;
    const t0 = clock.now();
    const a = await Client.open(id, ha);
    expect(presences(a).at(-1)).toEqual({ [ha.player]: { online: true, lastSeen: t0 }, [hb.player]: { online: false, lastSeen: null } });
    clock.advance(5000);
    const b = await Client.open(id, hb);
    await vi.waitFor(() => expect(presences(a).at(-1)?.[hb.player]).toEqual({ online: true, lastSeen: t0 + 5000 }), quick);
    expect(presences(b).at(-1)).toEqual({ [ha.player]: { online: true, lastSeen: t0 }, [hb.player]: { online: true, lastSeen: t0 + 5000 } });
    // A second tab for a changes nothing for b's seat; closing one of two tabs keeps a online.
    // (terminate: an injected socket's close handshake never reaches the server.)
    const a2 = await Client.open(id, ha);
    a2.ws.terminate();
    clock.advance(60_000);
    b.ws.terminate();
    await vi.waitFor(() => expect(presences(a).at(-1)?.[hb.player]).toEqual({ online: false, lastSeen: t0 + 65_000 }), quick);
    expect(presences(a).at(-1)?.[ha.player]?.online).toBe(true);
    // Kept for restarts; only human seats; nothing in the engine log.
    const rows = await db.query<{ player_id: string; seen: number | null }>(
      "select player_id, (extract(epoch from last_seen_at) * 1000)::float8 as seen from seats where game_id = $1 order by seat_no",
      [id],
    );
    expect(rows.map((r) => [r.player_id, r.seen === null ? null : Math.round(Number(r.seen))])).toEqual([
      [ha.player, expect.any(Number)],
      [hb.player, t0 + 65_000],
      [expect.any(String), null],
    ]);
    expect((await load(id)).log.length).toBe(logBefore);
    a.ws.close();
  });
});

describe("connect order (review of #44)", () => {
  it("a socket gets its first view, then chat history, then presence, even while others chat and come and go", async () => {
    const { id, humans } = await startGame(3, 0);
    const [ha, hb, hc] = humans as [Human, Human, Human];
    const a = await Client.open(id, ha);
    for (let i = 0; i < 8; i++) {
      clock.advance(10_000); // past the chat rate limit
      // Open b raw (no waiting) while a chats and c's tab opens and drops: chat and presence fly meanwhile.
      const b = new Client(hb.player);
      const onInit = (ws: WebSocket) => ws.on("message", (data) => b.raw.push(String(data)));
      const opening = app.injectWS(`/games/${id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${hb.who}` } }, { onInit });
      const chats = [a.sendRaw({ chat: { text: `hi ${i}` } }), a.sendRaw({ chat: { text: `again ${i}` } })];
      const c = await Client.open(id, hc);
      c.ws.terminate();
      b.ws = await opening;
      for (const reply of await Promise.all(chats)) expect(reply).toMatchObject({ ok: true });
      await vi.waitFor(() => expect(b.messages.some((m) => "presence" in m)).toBe(true), quick);
      expect(firstKinds(b.messages)).toEqual(["view", "chatHistory", "presence"]);
      // Every chat line reached b once: in its history or live after it, never both.
      await b.barrier();
      const history = b.messages.flatMap((m) => ("chatHistory" in m ? m.chatHistory.messages.map((x) => x.id) : []));
      const live = b.messages.flatMap((m) => ("chat" in m ? [m.chat.id] : []));
      const all = [...history, ...live];
      expect(new Set(all).size).toBe(all.length);
      expect(all).toHaveLength(2 * (i + 1));
      b.ws.terminate();
    }
    a.ws.close();
  });
});

describe("flooding", () => {
  it(`a socket with more than ${MAX_QUEUED_MESSAGES} messages waiting is closed (1008); others carry on`, async () => {
    const { id, humans } = await startGame(2, 0);
    const a = await Client.open(id, humans[0]!);
    const b = await Client.open(id, humans[1]!);
    for (let i = 0; i < MAX_QUEUED_MESSAGES * 3; i++) a.ws.send(JSON.stringify({ id: i, cmd: { type: "submitMove", move: { room: "lobby", pocket: i % 2 } } }));
    await vi.waitFor(() => expect(a.closed).toBe(CLOSE_TOO_MANY), quick);
    expect(await b.send({ type: "submitMove", move: { room: "lobby", pocket: 0 } })).toMatchObject({ ok: true });
    b.ws.close();
  });
});

describe("pushing views", () => {
  it("pushes a fresh view to every seat a public change touches, and nothing for a hidden one", async () => {
    const { id, humans } = await startGame(2, 0);
    const a = await Client.open(id, humans[0]!);
    const b = await Client.open(id, humans[1]!);
    const tab2 = await Client.open(id, humans[1]!); // same seat, second tab

    // Hidden: a sealed vote is private (design §11.2). a's view changes; b's doesn't, so b gets nothing.
    let seen = await b.barrier();
    expect((await a.send({ type: "sealVote", vote: { kind: "skip" } }))).toMatchObject({ ok: true });
    await a.barrier();
    expect(a.lastView()).toEqual(viewFor(await load(id), humans[0]!.player));
    expect(await b.barrier()).toBe(seen + 1);

    // Public: a meeting proposal (design §11.1) reaches both of b's tabs, which get no reply.
    seen = await b.barrier();
    expect((await a.send({ type: "proposeMeeting", slot: "2026-11-02T19:00Z" }))).toMatchObject({ ok: true });
    await b.barrier();
    expect(b.views()).toHaveLength(2);
    expect(b.lastView().proposals).toHaveLength(1);
    await vi.waitFor(() => expect(tab2.views()).toHaveLength(2), quick);
    expect(tab2.messages.filter((m) => !("view" in m) && !("chatHistory" in m) && !("presence" in m))).toHaveLength(0);
    for (const c of [a, b, tab2]) c.ws.close();
  });

  it("a bot acts only when its own view changed: a flood of hidden moves makes no bot act and pushes nothing (design §17.3)", async () => {
    // A Random bot calls an emergency on 5% of the calls it gets (noise 1), so 100 extra calls
    // would almost surely show. Pick a game where its emergency is still unused (it may call one at the start).
    let game = await startGame(2, 1, {}, true, "random");
    for (let tries = 0; (await load(game.id)).pendingEmergency !== null; tries++) {
      expect(tries).toBeLessThan(10);
      game = await startGame(2, 1, {}, true, "random");
    }
    const { id, humans } = game;
    const a = await Client.open(id, humans[0]!);
    const b = await Client.open(id, humans[1]!);
    // Pocket 0 (an Inside Man can't pocket) in two rooms that need no watch target.
    const rooms = (await load(id)).rooms.filter((r) => r !== "security").slice(0, 2);
    // The first lock-in is public (moveLocked, owner decision 2 Nov); every change after it is hidden.
    expect(await a.send({ type: "submitMove", move: { room: rooms[1], pocket: 0 } })).toMatchObject({ ok: true });
    const seen = await b.barrier();
    const before = (await load(id)).log.length;
    for (let i = 0; i < 100; i++) expect(await a.send({ type: "submitMove", move: { room: rooms[i % 2], pocket: 0 } })).toMatchObject({ ok: true });
    const after = await load(id);
    expect(after.log.slice(before).map((e) => e.type)).toEqual(Array(100).fill("moveSubmitted"));
    expect(await b.barrier()).toBe(seen + 1);
    a.ws.close();
    b.ws.close();
  }, 15_000); // heavy: slow under a full parallel run (QA, PR #31)

  it("a person's public lock-in makes no bot act (bots don't use lock-in marks; owner decision 2 Nov)", async () => {
    // Random bots call an emergency on 5% of the views they act on, so acting on every lock-in would show.
    for (let g = 0; g < 5; g++) {
      const { id, humans } = await startGame(1, 3, {}, true, "random");
      const a = await Client.open(id, humans[0]!);
      const before = await load(id);
      const seen = await db.query<{ bot_seen: string }>("select bot_seen from seats where game_id = $1 and bot_seen is not null order by seat_no", [id]);
      const room = before.rooms.find((r) => r !== "security")!;
      expect(await a.send({ type: "submitMove", move: { room, pocket: 0 } })).toMatchObject({ ok: true });
      const after = await load(id);
      expect(after.log.slice(before.log.length).map((e) => e.type)).toEqual(["moveLocked", "moveSubmitted"]);
      expect(await db.query("select bot_seen from seats where game_id = $1 and bot_seen is not null order by seat_no", [id])).toEqual(seen);
      a.ws.close();
    }
  }, 30_000);

  it("bots of running games act when the server boots (a crash may have cut a settle short)", async () => {
    const host = (await call("/auth/guest", null, { nickname: "Host" })).session!;
    const game = (await call("/games", host, {})).body;
    for (let i = 0; i < 2; i++) await call(`/games/${game.id}/bots`, host, {});
    const seats = (await call(`/games/${game.id}/bots`, host, {})).body.seats;
    const other = createGameStore(db); // start behind the live channel's back: no settle
    const { gameConfig } = await import("./lobby");
    const config = gameConfig({ ...(game.settings as LobbySettings) }, seats.map((x) => ({ nickname: x.nickname, bot_personality: x.bot })), "boot-seed");
    await other.start(game.id, config, async (tx) => {
      for (const [i, seat] of seats.entries()) await tx.query("update seats set player_id = $3 where game_id = $1 and seat_no = $2", [game.id, seat.seat, playerIdFor(i)]);
    });
    const bots = config.players.filter((p) => p.isBot).map((p) => p.id);
    expect(Object.keys((await other.load(game.id))!.moves)).toEqual([]);
    const booted = buildServer({ db, clock: fakeClock(Date.UTC(2026, 10, 1)), store: other });
    await booted.ready();
    const state = (await other.load(game.id))!;
    for (const p of bots) expect(state.moves[p]).toBeDefined();
    await booted.close();
  });

  it("bot seats act after the start, before anyone connects (design §17.3)", async () => {
    const { id, humans } = await startGame(1, 3);
    const state = await load(id);
    const bots = state.playerOrder.filter((p) => p !== humans[0]!.player);
    expect(bots).toHaveLength(3);
    for (const p of bots) expect(state.moves[p]).toBeDefined();
    expect(state.moves[humans[0]!.player]).toBeUndefined();
    expect(app.live.botRefusals).toEqual([]);
  });

  it("a deadline runs through live.system, the bots act and views go out; a refused one throws", async () => {
    const { id, humans } = await startGame(1, 2);
    const c = await Client.open(id, humans[0]!);
    await expect(app.live.system(id, { type: "advance", deadline: { kind: "round", round: 2 } })).rejects.toThrow(/refused/);
    const resolved = await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
    expect(resolved.phase).toMatchObject({ kind: "alibis", round: 1 }); // design §5.4
    const after = await app.live.system(id, { type: "advance", deadline: { kind: "alibis", round: 1 } });
    expect(after.phase).toMatchObject({ kind: "planning", round: 2 });
    for (const p of after.playerOrder.filter((x) => x !== humans[0]!.player)) expect(after.moves[p]).toBeDefined();
    await c.barrier();
    expect(c.lastView()).toEqual(viewFor(await load(id), humans[0]!.player));
    c.ws.close();
  });
});

/** The deadline that would pass next, as the stand-in scheduler in runBotGame picks it (M2-4 does this for real). */
function nextDeadline(state: GameState): Command[] {
  const phase = state.phase;
  if (phase.kind === "meeting") return [{ type: "advance", deadline: { kind: "closeMeeting", meetingId: phase.meetingId } }];
  if (phase.kind === "shakedownPending") return [{ type: "advance", deadline: { kind: "resolveShakedown", meetingId: phase.meetingId } }];
  if (state.pendingEmergency && (phase.kind === "planning" || phase.kind === "alibis" || phase.kind === "awaitingMeeting")) {
    return [{ type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency.meetingId } }];
  }
  if (phase.kind === "planning") return [{ type: "advance", deadline: { kind: "round", round: phase.round } }];
  // design §5.4: the round's alibi window closes before the next round's planning.
  if (phase.kind === "alibis") return [{ type: "advance", deadline: { kind: "alibis", round: phase.round } }];
  if (phase.kind === "awaitingMeeting") {
    const schedule: Command[] = state.scheduledMeeting ? [] : [{ type: "scheduleMeeting", act: phase.act, slot: `server-act-${phase.act}` }];
    return [...schedule, { type: "advance", deadline: { kind: "openMeeting", meetingId: state.scheduledMeeting?.meetingId ?? `act-${phase.act}` } }];
  }
  return [];
}

describe("acceptance: a full game over sockets (docs/m2-plan.md M2-3)", () => {
  it.each(["hiddenThenRevealed", "open", "secret"] as const)(
    "%s votes: each socket only ever gets what canSee allows it; nobody's commands are refused",
    async (voteVisibility) => {
      const refusalsBefore = app.live.botRefusals.length;
      const { id, humans } = await startGame(3, 4, { voteVisibility, eventsEnabled: true });
      const clients = await Promise.all(humans.map((h) => Client.open(id, h)));
      // People are played by bot logic in the test, over their sockets, always forging another seat's id.
      const agents = humans.map((h, i) => createBot({ player: h.player, personality: PERSONALITIES[(["greedy", "honest", "cautious"] as const)[i]!], seed: `human/${i}` }));
      const refused: { player: string; command: PlayerCommand; reply: ServerMessage }[] = [];

      let steps = 0;
      for (; (await load(id)).phase.kind !== "ended"; steps++) {
        expect(steps).toBeLessThan(200);
        for (const [i, c] of clients.entries()) {
          await c.barrier();
          const view = c.lastView();
          expect(view).toEqual(viewFor(await load(id), c.player)); // pushes keep each seat current
          for (const command of agents[i]!.act(view)) {
            if ((await load(id)).phase.kind === "ended") break;
            const forged = humans[(i + 1) % humans.length]!.player;
            const reply = await c.send({ ...command, player: forged });
            if (!("ok" in reply)) refused.push({ player: c.player, command, reply });
          }
        }
        const state = await load(id);
        for (const command of nextDeadline(state)) {
          if (command.type === "scheduleMeeting") await app.live.system(id, command);
          else await app.live.system(id, command as Extract<Command, { type: "advance" }>);
        }
      }

      const final = await load(id);
      expect(refused).toEqual([]);
      expect(app.live.botRefusals.slice(refusalsBefore)).toEqual([]);
      const seed = final.config.seed;
      for (const c of clients) {
        await c.barrier();
        expect(c.lastView()).toEqual(viewFor(final, c.player));
        expect(c.lastView().reveal).not.toBeNull();
        for (const text of c.raw) {
          expect(text).not.toMatch(/"idx"/);
          const msg = JSON.parse(text) as ServerMessage;
          if ("view" in msg) {
            const v = msg.view;
            expect(v.me.id).toBe(c.player);
            for (const { event } of v.ledger) expect(event.visibility.kind).toBe("public");
            for (const { event } of [...v.ledger, ...v.caseFile]) expect(canSee(event.visibility, c.player, false)).toBe(true);
            for (const { event } of v.reveal?.log ?? []) expect(canSee(event.visibility, c.player, true)).toBe(true);
            if (v.reveal === null) expect(text).not.toContain(seed); // the seed is reveal-only (rngSeeded)
          } else if ("presence" in msg) {
            // Human seats only, never in the engine log (owner decision, 2 Nov).
            for (const p of Object.values(msg.presence)) expect(Object.keys(p).sort()).toEqual(["lastSeen", "online"]);
          } else if (!("chatHistory" in msg)) {
            expect(Object.keys(msg).sort()).toEqual("ok" in msg ? ["id", "ok"] : ["id", "reason", "rejected"]);
          }
        }
        c.ws.close();
      }
      // Hidden information and meetings really were in play, so the checks above had something to catch.
      expect(final.log.some((e) => e.visibility.kind !== "public")).toBe(true);
      expect(final.log.some((e) => e.type === "meetingClosed")).toBe(true);
    },
    60_000,
  );
});
