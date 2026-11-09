// QA: adversarial tests for the live game channel and server bots.
// docs/m2-plan.md M2-3; design §17.2, §17.3
import { viewFor, type Command, type GameState, type PlayerView } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import { MAX_MESSAGE_BYTES, MAX_QUEUED_MESSAGES, type ServerMessage } from "./live";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import { createGameStore } from "./store";
import { testDb } from "./testkit";
import { BANK_JOB } from "@skimjob/content";

const quick = { interval: 1, timeout: 5000 };
const clock = fakeClock(Date.UTC(2026, 10, 1));

let db: Db;
let app: FastifyInstance;
const boot = async () => {
  const a = buildServer({ db, clock, store: createGameStore(db) });
  await a.ready();
  return a;
};
beforeAll(async () => {
  db = await testDb();
  app = await boot();
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
async function startGame(people: number, bots: number) {
  const host = (await call("/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await call("/games", host, {})).body;
  const sessions = [host];
  for (let i = 1; i < people; i++) sessions.push((await call(`/invites/${game.inviteCode}/join`, null, { nickname: `G${i}` })).session!);
  for (let i = 0; i < bots; i++) await call(`/games/${game.id}/bots`, host, { personality: (["opportunist", "greedy", "honest", "cautious"] as const)[i % 4] });
  await call(`/games/${game.id}/start`, host);
  const humans: Human[] = [];
  for (const who of sessions) {
    const res = await app.inject({ method: "GET", url: `/games/${game.id}`, cookies: { [SESSION_COOKIE]: who } });
    humans.push({ who, player: (res.json() as LobbyView).seats.find((s) => s.you)!.playerId! });
  }
  return { id: game.id, humans };
}

class Client {
  readonly raw: string[] = [];
  closed: number | null = null;
  private n = 0;
  ws!: WebSocket;
  constructor(readonly player: string) {}
  static async open(gameId: string, h: Human) {
    const c = new Client(h.player);
    const onInit = (ws: WebSocket) => {
      ws.on("message", (data) => c.raw.push(String(data)));
      ws.on("close", (code) => (c.closed = code));
    };
    c.ws = await app.injectWS(`/games/${gameId}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${h.who}` } }, { onInit });
    // The first view, then the chat history (M2-8a), then presence (owner decision, 2 Nov).
    await vi.waitFor(() => expect(c.messages.some((m) => "presence" in m)).toBe(true), quick);
    expect(c.views()).toHaveLength(1);
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
  async barrier(): Promise<number> {
    await this.sendRaw({});
    return this.raw.length;
  }
}

const loadVia = async (id: string) => (await createGameStore(db).load(id))!;

function nextDeadline(state: GameState): Command[] {
  const phase = state.phase;
  if (phase.kind === "meeting") return [{ type: "advance", deadline: { kind: "closeMeeting", meetingId: phase.meetingId } }];
  if (phase.kind === "shakedownPending") return [{ type: "advance", deadline: { kind: "resolveShakedown", meetingId: phase.meetingId } }];
  if (state.pendingEmergency) {
    return [{ type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency.meetingId } }];
  }
  if (phase.kind === "planning") return [{ type: "advance", deadline: { kind: "round", round: phase.round } }];
  // design §9.3: the result window closes when nobody called an emergency.
  if (phase.kind === "result") return [{ type: "advance", deadline: { kind: "result", round: phase.round } }];
  if (phase.kind === "awaitingMeeting") {
    const schedule: Command[] = state.scheduledMeeting ? [] : [{ type: "scheduleMeeting", meetingId: phase.meetingId, slot: `server-${phase.meetingId}` }];
    return [...schedule, { type: "advance", deadline: { kind: "openMeeting", meetingId: phase.meetingId } }];
  }
  return [];
}
const runDeadlines = async (id: string, state: GameState) => {
  for (const command of nextDeadline(state)) await app.live.system(id, command as Parameters<typeof app.live.system>[1]);
};
/** On to the next round's planning: the result window (and any meeting) passes. design §9.3 */
const toPlanning = async (id: string) => {
  for (let s = await loadVia(id); s.phase.kind !== "planning" && s.phase.kind !== "ended"; s = await loadVia(id)) await runDeadlines(id, s);
};

describe("QA: who may connect", () => {
  it("a cookie for another game's seat, a forged cookie and a non-cookie token all get no socket", async () => {
    const g1 = await startGame(2, 1);
    const g2 = await startGame(2, 1);
    const hdr = (v: string) => ({ headers: { cookie: `${SESSION_COOKIE}=${v}` } });
    await expect(app.injectWS(`/games/${g2.id}/ws`, hdr(g1.humans[1]!.who))).rejects.toThrow(/404/);
    await expect(app.injectWS(`/games/${g1.id}/ws`, hdr("forged-token"))).rejects.toThrow(/401/);
    await expect(app.injectWS(`/games/${g1.id}/ws`, { headers: { authorization: `Bearer ${g1.humans[0]!.who}` } })).rejects.toThrow(/401/);
    // The right cookie still works, and the seat is the session's.
    const c = await Client.open(g1.id, g1.humans[1]!);
    expect(c.lastView().me.id).toBe(g1.humans[1]!.player);
    c.ws.close();
  });

  it("an expired session is refused (401); a fresh one for the same game works", async () => {
    const { id, humans } = await startGame(2, 1);
    clock.advance(31 * 24 * 3600 * 1000); // past the 30-day session
    await expect(app.injectWS(`/games/${id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${humans[0]!.who}` } })).rejects.toThrow(/401/);
    const g = await startGame(2, 1);
    (await Client.open(g.id, g.humans[0]!)).ws.close();
  });
});

describe("QA: hostile messages", () => {
  it("odd shapes are refused with the id echoed, and the socket stays usable", async () => {
    const { id, humans } = await startGame(2, 1);
    const c = await Client.open(id, humans[0]!);
    const before = await loadVia(id);
    for (const msg of [
      { cmd: {} },
      { cmd: { type: 42 } },
      { cmd: { type: "submitMove" } }, // known type, missing fields: the engine refuses
      { cmd: { type: "submitMove", move: { room: "lobby", pocket: -5 } } },
      { cmd: { type: "submitMove", move: { room: "lobby", duffel: 0, pocket: 1e308 } } },
      { cmd: { type: "constructor" } },
      { cmd: { type: "hasOwnProperty" } },
      { cmd: [] },
      { notCmd: true },
    ]) {
      expect(await c.sendRaw(msg)).toMatchObject({ rejected: true, reason: expect.any(String) });
    }
    // Non-scalar / too-long ids are dropped, not echoed.
    c.ws.send(JSON.stringify({ id: { x: 1 }, cmd: null }));
    c.ws.send(JSON.stringify({ id: "x".repeat(65), cmd: null }));
    c.ws.send("[1,2]");
    c.ws.send("null");
    await vi.waitFor(() => expect(c.messages.filter((m) => "rejected" in m && !("id" in m))).toHaveLength(4), quick);
    expect((await loadVia(id)).log.length).toBe(before.log.length);
    expect(await c.send({ type: "submitMove", move: { room: "lobby", duffel: 1, pocket: 0 } })).toMatchObject({ ok: true });
    c.ws.close();
  });

  it("a message of exactly the limit is read; one byte over closes the socket with 1009 and changes nothing", async () => {
    const { id, humans } = await startGame(2, 1);
    const c = await Client.open(id, humans[0]!);
    const at = (n: number) => {
      const base = JSON.stringify({ id: "big", pad: "", cmd: { type: "submitMove", move: { room: "lobby", duffel: 1, pocket: 0 } } });
      return base.replace('"pad":""', `"pad":"${"x".repeat(n - base.length)}"`);
    };
    expect(at(MAX_MESSAGE_BYTES).length).toBe(MAX_MESSAGE_BYTES);
    c.ws.send(at(MAX_MESSAGE_BYTES));
    await vi.waitFor(() => expect(c.messages.find((m) => "id" in m && m.id === "big")).toEqual({ ok: true, id: "big" }), quick);
    const before = (await loadVia(id)).log.length;
    const d = await Client.open(id, humans[1]!);
    d.ws.send(at(MAX_MESSAGE_BYTES + 1));
    await vi.waitFor(() => expect(d.closed).toBe(1009), quick);
    expect((await loadVia(id)).log.length).toBe(before);
    // The other socket is unaffected.
    expect(await c.barrier()).toBeGreaterThan(0);
    c.ws.close();
  });
});

describe("QA: flooding and many sockets", () => {
  // N is the most a socket may have waiting (more closes it: live.test.ts "flooding"). With bots seated
  // too, since a bot now acts only on its own view changes (QA bug on PR #20, fixed).
  it("a full queue of commands sent at once all get replies, in order; a hidden-only flood sends the other seat nothing", async () => {
    const { id, humans } = await startGame(2, 2);
    const a = await Client.open(id, humans[0]!);
    const b = await Client.open(id, humans[1]!);
    const N = MAX_QUEUED_MESSAGES;
    // Pocket 0; alternate two rooms that need no watch target, so "last wins" shows.
    const rooms = (await loadVia(id)).rooms.filter((r) => r !== "security").slice(0, 2);
    // a's first lock-in is public (moveLocked, owner decision 2 Nov); only the changes after it are hidden.
    expect(await a.send({ type: "submitMove", move: { room: rooms[1], duffel: BANK_JOB.rooms[rooms[1]!]?.coins ?? 0, pocket: 0 } })).toMatchObject({ ok: true });
    const seen = await b.barrier();
    for (let i = 0; i < N; i++) {
      const cmd = i % 3 === 2 ? { type: "bogus" } : { type: "submitMove", player: humans[1]!.player, move: { room: rooms[i % 2], duffel: BANK_JOB.rooms[rooms[i % 2]!]?.coins ?? 0, pocket: 0 } };
      a.ws.send(JSON.stringify({ id: i, cmd }));
    }
    await vi.waitFor(() => expect(a.messages.filter((m) => "id" in m && typeof m.id === "number")).toHaveLength(N), { interval: 5, timeout: 20_000 });
    const replies = a.messages.filter((m) => "id" in m && typeof m.id === "number") as { id: number }[];
    expect(replies.map((r) => r.id)).toEqual([...Array(N).keys()]);
    replies.forEach((r, i) => expect("ok" in r).toBe(i % 3 !== 2));
    const state = await loadVia(id);
    const lastAccepted = [...Array(N).keys()].filter((i) => i % 3 !== 2).at(-1)!;
    expect(state.moves[humans[0]!.player]).toEqual({ room: rooms[lastAccepted % 2], duffel: BANK_JOB.rooms[rooms[lastAccepted % 2]!]?.coins, pocket: 0 }); // last accepted move wins
    expect(state.moves[humans[1]!.player]).toBeUndefined();
    expect(await b.barrier()).toBe(seen + 1);
    expect(a.lastView()).toEqual(viewFor(state, humans[0]!.player));
    a.ws.close();
    b.ws.close();
  }, 30_000);

  it("two sockets for one seat both get every change and end on the same view; closing one leaves the other live", async () => {
    const { id, humans } = await startGame(2, 2);
    const t1 = await Client.open(id, humans[0]!);
    const t2 = await Client.open(id, humans[0]!);
    expect(t1.lastView()).toEqual(t2.lastView());
    // A private change made from tab 1 reaches tab 2 (same seat), with no reply on tab 2.
    expect(await t1.send({ type: "submitMove", move: { room: "lobby", duffel: 1, pocket: 0 } })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(t2.views().length).toBeGreaterThanOrEqual(2), quick);
    expect(t2.messages.filter((m) => !("view" in m) && !("chatHistory" in m) && !("plan" in m) && !("presence" in m))).toHaveLength(0);
    // A deadline: both tabs move on together.
    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
    await toPlanning(id);
    await t1.barrier();
    await t2.barrier();
    const want = viewFor(await loadVia(id), humans[0]!.player);
    expect(t1.lastView()).toEqual(want);
    expect(t2.lastView()).toEqual(want);
    t1.ws.close();
    await vi.waitFor(() => expect(t1.closed).not.toBeNull(), quick);
    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 2 } });
    await toPlanning(id);
    await t2.barrier();
    expect(t2.lastView()).toEqual(viewFor(await loadVia(id), humans[0]!.player));
    t2.ws.close();
  });

  it("reconnecting mid-round gets the current view, including its own hidden move", async () => {
    const { id, humans } = await startGame(2, 1);
    const c = await Client.open(id, humans[0]!);
    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
    await toPlanning(id);
    await c.send({ type: "submitMove", move: { room: "lobby", duffel: 0, pocket: 1 } });
    c.ws.close();
    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 2 } }); // changes while away
    await toPlanning(id);
    const again = await Client.open(id, humans[0]!);
    const state = await loadVia(id);
    expect(state.phase).toMatchObject({ kind: "planning", round: 3 });
    expect(again.lastView()).toEqual(viewFor(state, humans[0]!.player));
    again.ws.close();
  });
});

describe("QA: mixed games", () => {
  it("humans idle all game (defaults): bots are never refused, never hit the pass limit, the game ends and idle sockets get the reveal", async () => {
    const warn = vi.spyOn(app.log, "warn");
    const refusals = app.live.botRefusals.length;
    const { id, humans } = await startGame(2, 4);
    const clients = await Promise.all(humans.map((h) => Client.open(id, h)));
    let steps = 0;
    for (let s = await loadVia(id); s.phase.kind !== "ended"; s = await loadVia(id)) {
      expect(++steps).toBeLessThan(200);
      const before = s.log.length;
      await runDeadlines(id, s);
      // Bots settle after each change: a few events per bot, not 20 passes of churn.
      expect((await loadVia(id)).log.length - before).toBeLessThan(400);
    }
    expect(app.live.botRefusals.slice(refusals)).toEqual([]);
    expect(warn.mock.calls.filter((c) => JSON.stringify(c).includes("pass limit"))).toEqual([]);
    const final = await loadVia(id);
    for (const c of clients) {
      await c.barrier();
      expect(c.lastView()).toEqual(viewFor(final, c.player));
      expect(c.lastView().reveal).not.toBeNull();
      c.ws.close();
    }
    // After the end, commands are refused and bots do nothing.
    const late = await Client.open(id, humans[0]!);
    expect(await late.send({ type: "submitMove", move: { room: "lobby", duffel: 1, pocket: 0 } })).toMatchObject({ rejected: true });
    await app.live.settle(id);
    expect((await loadVia(id)).log.length).toBe(final.log.length);
    late.ws.close();
    warn.mockRestore();
  }, 60_000);

  it("a server restart mid-game reloads from the DB: sockets reconnect, bots are rebuilt and keep playing to the end", async () => {
    const { id, humans } = await startGame(1, 3);
    const c = await Client.open(id, humans[0]!);
    for (let r = 1; r <= 2; r++) {
      await app.live.system(id, { type: "advance", deadline: { kind: "round", round: r } });
      await toPlanning(id);
    }
    await c.send({ type: "submitMove", move: { room: "lobby", duffel: 1, pocket: 0 } });
    const mid = await loadVia(id);
    await app.close(); // restart
    await vi.waitFor(() => expect(c.closed).not.toBeNull(), quick);
    app = await boot();
    const refusals = app.live.botRefusals.length;
    const again = await Client.open(id, humans[0]!);
    expect(again.lastView()).toEqual(viewFor(mid, humans[0]!.player));
    let steps = 0;
    let botMoved = false; // rebuilt bots still move
    for (let s = await loadVia(id); s.phase.kind !== "ended"; s = await loadVia(id)) {
      expect(++steps).toBeLessThan(200);
      await runDeadlines(id, s);
      const now = await loadVia(id);
      if (now.phase.kind === "planning") botMoved ||= now.playerOrder.some((p) => p !== humans[0]!.player && now.moves[p] !== undefined);
    }
    expect(botMoved).toBe(true);
    expect(app.live.botRefusals.slice(refusals)).toEqual([]);
    await again.barrier();
    expect(again.lastView().reveal).not.toBeNull();
    again.ws.close();
  }, 60_000);
});

