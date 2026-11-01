// Live game channel and server bots. docs/m2-plan.md M2-3; design §17.2, §17.3
import { createBot, PERSONALITIES } from "@skimjob/bots";
import { canSee, viewFor, type Command, type GameState, type PlayerCommand, type PlayerView } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import { parseClientMessage, type ServerMessage } from "./live";
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
beforeAll(async () => {
  db = await testDb();
  store = createGameStore(db);
  app = buildServer({ db, clock: fakeClock(Date.UTC(2026, 10, 1)), store });
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
async function startGame(people: number, bots: number, settings: Partial<LobbySettings> = {}, start = true) {
  const host = (await call("/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await call("/games", host, { settings })).body;
  const sessions = [host];
  for (let i = 1; i < people; i++) sessions.push((await call(`/invites/${game.inviteCode}/join`, null, { nickname: `Guest ${i}` })).session!);
  for (let i = 0; i < bots; i++) await call(`/games/${game.id}/bots`, host, { personality: "opportunist" });
  if (!start) return { id: game.id, humans: sessions.map((who) => ({ who, player: "" })) };
  await call(`/games/${game.id}/start`, host);
  const humans: Human[] = [];
  for (const who of sessions) {
    const res = await app.inject({ method: "GET", url: `/games/${game.id}`, cookies: { [SESSION_COOKIE]: who } });
    humans.push({ who, player: (res.json() as LobbyView).seats.find((s) => s.you)!.playerId! });
  }
  return { id: game.id, humans };
}

/** A test socket that keeps every message it got, raw. */
class Client {
  readonly raw: string[] = [];
  private n = 0;
  ws!: WebSocket;
  constructor(readonly player: string) {}
  static async open(gameId: string, h: Human) {
    const c = new Client(h.player);
    // Listen from the start: the first view can come right after the upgrade.
    const onInit = (ws: WebSocket) => ws.on("message", (data) => c.raw.push(String(data)));
    c.ws = await app.injectWS(`/games/${gameId}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${h.who}` } }, { onInit });
    await vi.waitFor(() => expect(c.views().length).toBe(1), quick);
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
    const seen = await b.barrier();
    a.ws.send(JSON.stringify({ id: 1, cmd: { type: "submitMove", move: { room: "nowhere", pocket: 0 } } }));
    a.ws.send(JSON.stringify({ id: 2, cmd: { type: "submitMove", move: { room: "lobby", pocket: 0 } } }));
    await vi.waitFor(() => expect(a.messages.filter((m) => "id" in m)).toHaveLength(2), quick);
    const replies = a.messages.filter((m) => "id" in m);
    expect(replies[0]).toMatchObject({ id: 1, rejected: true, reason: expect.any(String) });
    expect(replies[1]).toEqual({ id: 2, ok: true });
    // b got nothing but its own barrier reply: not the refusal, and no push (a move is private).
    expect(await b.barrier()).toBe(seen + 1);
    a.ws.close();
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
    expect(tab2.messages.filter((m) => !("view" in m))).toHaveLength(0);
    for (const c of [a, b, tab2]) c.ws.close();
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
    const after = await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
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
  if (state.pendingEmergency && (phase.kind === "planning" || phase.kind === "awaitingMeeting")) {
    return [{ type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency.meetingId } }];
  }
  if (phase.kind === "planning") return [{ type: "advance", deadline: { kind: "round", round: phase.round } }];
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
      const { id, humans } = await startGame(3, 4, { voteVisibility, mole: "on", eventsEnabled: true });
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
          } else {
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
