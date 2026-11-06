// QA (PR #130, C2c): the fault-retry scenario of scheduler.qa WITH the Mole dealt, so hidden police moments run. design §11.1, extension.md "Police activity"
import { viewFor, type GameState, type VoteVisibility } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "./auth";
import { fakeClock, type FakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import { meetingOpen } from "./scheduler";
import { buildServer } from "./server";
import type { LobbySettings, SessionLength } from "./settings";
import { createGameStore, type GameStore } from "./store";
import { testDb } from "./testkit";
import { scaleTiming, TIMINGS } from "./timing";

const T0 = Date.UTC(2026, 10, 2, 9);
let db: Db;
let clock: FakeClock;
let store: GameStore;
let app: FastifyInstance;
/** Seed forced on the next started game (so two runs can be compared). */
let forcedSeed = "qa-sched-1";

/** Queries matching one of these fail once each (a transient database error), then the pattern is spent. */
let faults: RegExp[] = [];
const faulty = <Q extends { query: Db["query"] }>(q: Q): Q => ({
  ...q,
  query: (async (sql: string, params?: readonly unknown[]) => {
    const k = faults.findIndex((f) => f.test(sql));
    if (k >= 0) {
      faults.splice(k, 1);
      throw new Error(`QA: injected database error on ${sql.slice(0, 40)}`);
    }
    return q.query(sql, params);
  }) as Db["query"],
});
const faultyDb = (): Db => ({ ...faulty(db), transaction: (fn) => db.transaction((tx) => fn(faulty(tx))), close: () => db.close() });

async function boot() {
  const sdb = faultyDb();
  const inner = createGameStore(sdb);
  store = {
    ...inner,
    start: (gameId, config, inTx) =>
      inner.start(gameId, { ...config, seed: forcedSeed }, inTx),
  };
  app = buildServer({ db: sdb, clock, store });
  await app.ready();
}
/** A new fake clock at T0 and a server built on it. */
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
  faults = [];
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const post = async (url: string, who: string | null, payload: Record<string, unknown> = {}) => {
  const res = await app.inject({ method: "POST", url, payload, cookies: who ? { [SESSION_COOKIE]: who } : {} });
  return { body: res.json() as LobbyView, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};
async function startGame(bots: number, settings: Partial<LobbySettings>, guests = 0) {
  const host = (await post("/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await post("/games", host, { settings })).body;
  for (let i = 0; i < guests; i++) await post(`/invites/${game.inviteCode}/join`, null, { nickname: `Guest ${i}` });
  for (let i = 0; i < bots; i++) await post(`/games/${game.id}/bots`, host, { personality: i % 2 ? "greedy" : "opportunist" });
  await post(`/games/${game.id}/start`, host);
  return { id: game.id, host };
}
/** Sends one command as `who` over the game socket; resolves to the reply. */
async function send(id: string, who: string, cmd: Record<string, unknown>) {
  const ws = await app.injectWS(`/games/${id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${who}` } });
  const replies: string[] = [];
  ws.on("message", (d) => replies.push(String(d)));
  ws.send(JSON.stringify({ cmd, id: "q" }));
  await vi.waitFor(() => expect(replies.some((r) => r.includes('"id":"q"'))).toBe(true), { interval: 1, timeout: 10_000 });
  // The reply goes out before the change's deadlines are stored; a no-op queues behind them on the game lock.
  ws.send(JSON.stringify({ id: "barrier" }));
  await vi.waitFor(() => expect(replies.some((r) => r.includes('"id":"barrier"'))).toBe(true), { interval: 1, timeout: 10_000 });
  ws.close();
  return JSON.parse(replies.find((r) => r.includes('"id":"q"'))!) as { ok?: true; rejected?: true; reason?: string };
}

interface Row {
  key: string;
  due: number;
  paused: boolean;
}
const deadlines = async (gameId: string) =>
  (
    await db.query<Row>(
      "select key, (extract(epoch from due_at) * 1000)::float8 as due, paused_at is not null as paused from deadlines where game_id = $1 order by due_at, key",
      [gameId],
    )
  ).map((r) => ({ ...r, due: Math.round(r.due) }));
const load = async (id: string) => (await store.load(id))!;
const count = (s: GameState, type: string, pick: (e: Record<string, unknown>) => boolean = () => true) =>
  s.log.filter((e) => e.type === type && pick(e as unknown as Record<string, unknown>)).length;


describe("transient database errors with the Mole dealt (police moments on game time)", () => {
  /** Same loop as scheduler.qa's playWithFault, but the default deck (Standard, the Mole as the 5p Lone wolf). */
  async function playWithFault(fault: RegExp | null, at: number, roles?: string[]) {
    await fresh();
    forcedSeed = "qa-fault";
    const { id } = await startGame(5, { sessionLength: "quick", ...(roles ? { roles } : {}) } as Partial<LobbySettings>);
    let idle = 0;
    for (let i = 0; i < 2000; i++) {
      if ((await load(id)).phase.kind === "ended") break;
      if (i === at && fault) faults.push(fault);
      const rows = (await deadlines(id)).filter((d) => !d.paused);
      if (rows.length > 0 && rows[0]!.due > clock.now()) clock.advance(rows[0]!.due - clock.now());
      if ((await app.scheduler.tick()) === 0) {
        idle++;
        expect(idle, "game stalled").toBeLessThan(200);
        clock.advance(1000);
      } else idle = 0;
    }
    const end = await load(id);
    expect(end.phase.kind).toBe("ended");
    expect(await deadlines(id)).toEqual([]);
    expect(faults).toEqual([]);
    for (let r = 1; r <= end.resolvedRound; r++) expect(count(end, "roundResolved", (e) => e.round === r)).toBe(1);
    // Police moments: numbered 1, 2, 3… with no gap or repeat; every activity has exactly one cause.
    const moments = end.log.filter((e) => e.type === "policeScheduled").map((e) => (e as unknown as { moment: number }).moment);
    moments.forEach((m, k) => expect(m, `moment ${k}`).toBe(moments[0]! + k));
    expect(count(end, "policeActivity")).toBe(count(end, "policeCause"));
    return end;
  }
  // The builder dropped the Mole from scheduler.qa's fault test because the logs differ. They do, and
  // rightly: a retried write delays later rounds by the backoff's real seconds while an already-set
  // police moment keeps its game-time due, so it can land on the other side of an alibi close.
  // What must hold with the Mole: no stall, no lost or doubled police moment or round, nothing left over.
  it("with the Mole: every retried fault still finishes cleanly, police moments contiguous; deadline-row faults keep the same log", { timeout: 300_000 }, async () => {
    const clean = await playWithFault(null, 0);
    expect(count(clean, "policeScheduled")).toBeGreaterThan(1);
    expect(Object.values(clean.players).some((p) => p.role === "mole")).toBe(true);
    for (const [fault, at, same] of [
      [/insert into game_events/i, 3, false],
      [/insert into deadlines/i, 5, true],
      [/delete from deadlines/i, 7, true],
      [/update seats set bot_seen/i, 9, true],
      [/select game_id, key, command from deadlines/i, 4, false],
    ] as const) {
      const end = await playWithFault(fault, at);
      expect(count(end, "policeScheduled"), String(fault)).toBeGreaterThan(1);
      if (same) expect(end.log, String(fault)).toEqual(clean.log);
    }
  });
});
