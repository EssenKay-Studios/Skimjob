// QA (PR #44): early round end (`roundEarly:<n>` after `lockInGraceMs`) and
// server-only presence. Owner decisions, 2 Nov. design §4.1, §5.1, §11, §13
import { BANK_JOB } from "@skimjob/content";
import { viewFor, type GameState } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { fakeClock, type FakeClock } from "./clock";
import type { Db } from "./db";
import type { Presence, ServerMessage } from "./live";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import type { LobbySettings } from "./settings";
import { createGameStore, type GameStore } from "./store";
import { testDb } from "./testkit";
import { TIMINGS } from "./timing";

const T0 = Date.UTC(2026, 10, 2, 9);
const quick = { interval: 1, timeout: 5000 };
let db: Db;
let clock: FakeClock;
let store: GameStore;
let app: FastifyInstance;
let forcedSeed = "qa-lockin-1";

async function boot() {
  const inner = createGameStore(db);
  store = { ...inner, start: (gameId, config, inTx) => inner.start(gameId, { ...config, seed: forcedSeed }, inTx) };
  app = buildServer({ db, clock, store });
  await app.ready();
}
async function fresh() {
  clock = fakeClock(T0);
  await app.close();
  await boot();
}
beforeAll(async () => {
  db = await testDb();
  clock = fakeClock(T0);
  await boot();
}, 30_000);
afterEach(async () => {
  await db.query("delete from deadlines");
  await db.query("update games set status = 'ended' where status = 'running'");
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const post = async (url: string, who: string | null, payload: Record<string, unknown> = {}) => {
  const res = await app.inject({ method: "POST", url, payload, cookies: who ? { [SESSION_COOKIE]: who } : {} });
  return { body: res.json() as LobbyView, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};
interface Human {
  readonly who: string;
  readonly player: string;
}
/** `people` signed-in seats (host first), then `bots` bot seats. */
async function startGame(people: number, bots: number, settings: Partial<LobbySettings> = { sessionLength: "15m", eventsEnabled: false }) {
  const host = (await post("/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await post("/games", host, { settings })).body;
  const sessions = [host];
  for (let i = 1; i < people; i++) sessions.push((await post(`/invites/${game.inviteCode}/join`, null, { nickname: `Guest ${i}` })).session!);
  for (let i = 0; i < bots; i++) await post(`/games/${game.id}/bots`, host, { personality: i % 2 ? "greedy" : "opportunist" });
  await post(`/games/${game.id}/start`, host);
  const humans: Human[] = [];
  for (const who of sessions) {
    const res = await app.inject({ method: "GET", url: `/games/${game.id}`, cookies: { [SESSION_COOKIE]: who } });
    humans.push({ who, player: (res.json() as LobbyView).seats.find((s) => s.you)!.playerId! });
  }
  return { id: game.id, humans };
}
async function send(id: string, who: string, cmd: Record<string, unknown>) {
  const ws = await app.injectWS(`/games/${id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${who}` } });
  const replies: string[] = [];
  ws.on("message", (d) => replies.push(String(d)));
  ws.send(JSON.stringify({ cmd, id: "q" }));
  await vi.waitFor(() => expect(replies.some((r) => r.includes('"id":"q"'))).toBe(true), { interval: 1, timeout: 10_000 });
  // The reply goes out before the change's deadlines are stored; a no-op queues behind them on the game lock.
  ws.send(JSON.stringify({ id: "barrier" }));
  await vi.waitFor(() => expect(replies.some((r) => r.includes('"id":"barrier"'))).toBe(true), { interval: 1, timeout: 10_000 });
  ws.terminate();
  return JSON.parse(replies.find((r) => r.includes('"id":"q"'))!) as { ok?: true; rejected?: true; reason?: string };
}
interface Row {
  key: string;
  due: number;
  paused: boolean;
}
const deadlines = async (gameId: string): Promise<Row[]> =>
  (
    await db.query<Row>(
      "select key, (extract(epoch from due_at) * 1000)::float8 as due, paused_at is not null as paused from deadlines where game_id = $1 order by due_at, key",
      [gameId],
    )
  ).map((r) => ({ ...r, due: Math.round(r.due) }));
const rowOf = async (id: string, key: string) => (await deadlines(id)).find((r) => r.key === key);
const load = async (id: string) => (await store.load(id))!;
const count = (s: GameState, type: string, pick: (e: Record<string, unknown>) => boolean = () => true) =>
  s.log.filter((e) => e.type === type && pick(e as unknown as Record<string, unknown>)).length;
const moveFor = (s: GameState, player: string, k = 0) => {
  const room = k ? viewFor(s, player).rooms.find((r) => r !== "lobby" && r !== "security")! : "lobby";
  return { type: "submitMove", move: { room, duffel: BANK_JOB.rooms[room]?.coins ?? 0, pocket: 0 } };
};

const t = TIMINGS["15m"];

describe("early end with 3 and 12 seats (design §4.1)", () => {
  for (const [people, bots] of [
    [2, 1],
    [3, 0],
    [1, 11],
    [3, 9],
  ] as const) {
    it(`${people} people + ${bots} bots: roundEarly only once every seat has locked in; resolves once at the grace`, { timeout: 60_000 }, async () => {
      await fresh();
      const { id, humans } = await startGame(people, bots);
      let s = await load(id);
      expect(s.playerOrder).toHaveLength(people + bots);
      for (const [i, h] of humans.entries()) {
        expect(await rowOf(id, "roundEarly:1"), `before person ${i}`).toBeUndefined();
        clock.advance(1000);
        expect(await send(id, h.who, moveFor(s, h.player))).toMatchObject({ ok: true });
      }
      const lastLock = clock.now();
      expect(await rowOf(id, "roundEarly:1")).toEqual({ key: "roundEarly:1", due: lastLock + t.lockInGraceMs, paused: false });
      expect(await rowOf(id, "round:1")).toEqual({ key: "round:1", due: T0 + t.roundMs, paused: false });
      clock.advance(t.lockInGraceMs - 1);
      expect(await app.scheduler.tick()).toBe(0);
      clock.advance(1);
      expect(await app.scheduler.tick()).toBe(1);
      s = await load(id);
      expect(s.phase).toEqual({ kind: "alibis", round: 1 });
      expect(count(s, "roundResolved")).toBe(1);
      expect(count(s, "defaultMoveAssigned")).toBe(0);
      expect((await deadlines(id)).map((d) => d.key)).toEqual(["alibis:1"]);
    });
  }

  it("12 seats, one person never moves: no early row; the round runs its full length and only that seat gets a default", { timeout: 60_000 }, async () => {
    await fresh();
    const { id, humans } = await startGame(2, 10);
    const s = await load(id);
    expect(await send(id, humans[0]!.who, moveFor(s, humans[0]!.player))).toMatchObject({ ok: true });
    expect(await rowOf(id, "roundEarly:1")).toBeUndefined();
    clock.advance(t.roundMs);
    expect(await app.scheduler.tick()).toBe(1);
    const end = await load(id);
    expect(count(end, "defaultMoveAssigned")).toBe(1);
    expect(count(end, "defaultMoveAssigned", (e) => e.player === humans[1]!.player)).toBe(1);
  });
});

describe("grace not restarted by changes (design §4.1)", () => {
  it("many changes in the grace, from every person, never move roundEarly; the last change counts", { timeout: 60_000 }, async () => {
    await fresh();
    const { id, humans } = await startGame(3, 0);
    const s = await load(id);
    for (const h of humans) expect(await send(id, h.who, moveFor(s, h.player))).toMatchObject({ ok: true });
    const early = await rowOf(id, "roundEarly:1");
    for (let k = 0; k < 4; k++) {
      clock.advance(1000);
      for (const h of humans) expect(await send(id, h.who, moveFor(s, h.player, (k + 1) % 2))).toMatchObject({ ok: true });
      expect(await rowOf(id, "roundEarly:1")).toEqual(early);
    }
    clock.advance(early!.due - clock.now());
    expect(await app.scheduler.tick()).toBe(1);
    const end = await load(id);
    expect(count(end, "moveLocked")).toBe(3);
    for (const h of humans) expect(end.log.filter((e) => e.type === "moveSubmitted" && e.player === h.player).at(-1)).toMatchObject({ move: { room: "lobby" } });
  });
});

describe("restart mid-grace: no double, no skip", () => {
  it("killing the server mid-grace keeps roundEarly's due time; it fires once after the restart", { timeout: 60_000 }, async () => {
    await fresh();
    const { id, humans } = await startGame(1, 2);
    const s = await load(id);
    expect(await send(id, humans[0]!.who, moveFor(s, humans[0]!.player))).toMatchObject({ ok: true });
    const before = await deadlines(id);
    clock.advance(t.lockInGraceMs / 2);
    await app.close();
    await boot();
    expect(await app.scheduler.tick()).toBe(0);
    expect(await deadlines(id)).toEqual(before);
    clock.advance(t.lockInGraceMs / 2);
    expect(await app.scheduler.tick()).toBe(1);
    // Restart again right after it fired: nothing more to send for round 1.
    await app.close();
    await boot();
    clock.advance(t.roundMs);
    await app.scheduler.tick();
    const end = await load(id);
    expect(count(end, "roundResolved", (e) => e.round === 1)).toBe(1);
    expect(count(end, "defaultMoveAssigned")).toBe(0);
  });

  it("server down past both roundEarly and round: the round resolves once, the stale row is dropped", { timeout: 60_000 }, async () => {
    await fresh();
    const { id, humans } = await startGame(1, 2);
    const s = await load(id);
    expect(await send(id, humans[0]!.who, moveFor(s, humans[0]!.player))).toMatchObject({ ok: true });
    await app.close();
    clock.advance(t.roundMs + 1000);
    await boot();
    await app.scheduler.tick();
    const end = await load(id);
    expect(count(end, "roundResolved", (e) => e.round === 1)).toBe(1);
    expect((await deadlines(id)).some((d) => d.key.startsWith("round"))).toBe(false);
  });

  it("same seed + same commands with and without a mid-grace restart = identical log", { timeout: 60_000 }, async () => {
    const once = async (restart: boolean) => {
      forcedSeed = "qa-lockin-det";
      await fresh();
      const { id, humans } = await startGame(1, 3);
      const s = await load(id);
      clock.advance(3000);
      expect(await send(id, humans[0]!.who, moveFor(s, humans[0]!.player))).toMatchObject({ ok: true });
      clock.advance(2000);
      if (restart) {
        await app.close();
        await boot();
      }
      expect(await send(id, humans[0]!.who, moveFor(s, humans[0]!.player, 1))).toMatchObject({ ok: true });
      clock.advance(t.lockInGraceMs);
      expect(await app.scheduler.tick()).toBe(1);
      return (await load(id)).log;
    };
    expect(await once(true)).toEqual(await once(false));
  });
});

describe("no meeting opens during the grace (design §9.3)", () => {
  it("an emergency call while the crew is locked in is refused; the round resolves once at the grace's end", { timeout: 60_000 }, async () => {
    forcedSeed = "qa-lockin-emerg";
    await fresh();
    const { id, humans } = await startGame(4, 2, { sessionLength: "1h" });
    for (const h of humans) expect(await send(id, h.who, moveFor(await load(id), h.player))).toMatchObject({ ok: true });
    const early = (await rowOf(id, "roundEarly:1"))!;
    expect(early).toBeDefined();
    expect(await send(id, humans[0]!.who, { type: "callEmergency" })).toMatchObject({ rejected: true });
    expect((await load(id)).pendingEmergency).toBeNull();
    clock.advance(early.due - clock.now());
    expect(await app.scheduler.tick()).toBeGreaterThanOrEqual(1);
    const s = await load(id);
    expect(count(s, "roundResolved", (e) => e.round === 1)).toBe(1);
    expect(count(s, "defaultMoveAssigned")).toBe(0);
  });
});

// ---------------------------------------------------------------- presence

class Client {
  readonly raw: string[] = [];
  private n = 0;
  ws!: WebSocket;
  static async open(gameId: string, h: Human) {
    const c = new Client();
    const onInit = (ws: WebSocket) => ws.on("message", (data) => c.raw.push(String(data)));
    c.ws = await app.injectWS(`/games/${gameId}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${h.who}` } }, { onInit });
    await vi.waitFor(() => expect(c.presences().length).toBeGreaterThan(0), quick);
    return c;
  }
  get messages(): ServerMessage[] {
    return this.raw.map((m) => JSON.parse(m) as ServerMessage);
  }
  presences(): Presence[] {
    return this.messages.flatMap((m) => ("presence" in m ? [m.presence] : []));
  }
  last(): Presence {
    return this.presences().at(-1)!;
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
}

describe("presence (server only; owner decision, 2 Nov)", () => {
  it("bots are never listed, even after they act; only human seats appear", async () => {
    await fresh();
    const { id, humans } = await startGame(2, 4);
    const a = await Client.open(id, humans[0]!);
    expect(Object.keys(a.last()).sort()).toEqual(humans.map((h) => h.player).sort());
    // Bots act on a public change (a lock-in, a proposal); presence still lists people only.
    await a.sendRaw({ cmd: { type: "proposeMeeting", slot: "tue-19:00" } });
    await a.sendRaw({});
    for (const p of a.presences()) expect(Object.keys(p).sort()).toEqual(humans.map((h) => h.player).sort());
    const s = await load(id);
    expect(s.log.some((e) => (e.type as string).toLowerCase().includes("presence"))).toBe(false);
    a.ws.terminate();
  });

  it("multi-tab: two sockets for one seat, one closes → still online; the second closes → offline", async () => {
    await fresh();
    const { id, humans } = await startGame(2, 1);
    const [ha, hb] = humans as [Human, Human];
    const b = await Client.open(id, hb);
    const a1 = await Client.open(id, ha);
    const a2 = await Client.open(id, ha);
    await vi.waitFor(() => expect(b.last()[ha.player]?.online).toBe(true), quick);
    a1.ws.terminate();
    clock.advance(1000);
    // Give the server time to handle the close, then check through a barrier.
    await new Promise((r) => setTimeout(r, 50));
    await b.sendRaw({});
    expect(b.last()[ha.player]?.online).toBe(true);
    expect(a2.last()[ha.player]?.online).toBe(true);
    a2.ws.terminate();
    await vi.waitFor(() => expect(b.last()[ha.player]?.online).toBe(false), quick);
    expect(b.last()[ha.player]?.lastSeen).toBe(clock.now());
    b.ws.terminate();
  });

  it("spoofing: a client can't set presence (its own or another seat's) by any message", async () => {
    await fresh();
    const { id, humans } = await startGame(2, 1);
    const [ha, hb] = humans as [Human, Human];
    const a = await Client.open(id, ha);
    const before = a.last();
    expect(before[hb.player]).toEqual({ online: false, lastSeen: null });
    const fake = { [hb.player]: { online: true, lastSeen: 1 }, [ha.player]: { online: false, lastSeen: 0 } };
    const attempts: Record<string, unknown>[] = [
      { presence: fake },
      { cmd: { type: "presence", presence: fake } },
      { cmd: { type: "setPresence", player: hb.player, online: true } },
      { cmd: { type: "submitMove", move: { room: "lobby", duffel: 1, pocket: 0 }, presence: fake } },
      { chat: { text: "hi" }, presence: fake },
    ];
    for (const msg of attempts) await a.sendRaw(msg);
    await a.sendRaw({});
    // No presence frame other than the real one; b still offline and never seen; nothing stored.
    for (const p of a.presences()) {
      expect(p[hb.player]).toEqual({ online: false, lastSeen: null });
      expect(p[ha.player]?.online).toBe(true);
    }
    const rows = await db.query<{ player_id: string; seen: number | null }>("select player_id, last_seen_at as seen from seats where game_id = $1 and player_id = $2", [
      id,
      hb.player,
    ]);
    expect(rows[0]?.seen ?? null).toBeNull();
    const s = await load(id);
    expect(JSON.stringify(s.log)).not.toContain("presence");
    a.ws.terminate();
  });
});
