// Scheduler and elastic timing. docs/m2-plan.md M2-4; design §4.1, §11.1, §11.3
import { BANK_JOB } from "@skimjob/content";
import type { GameState, VoteVisibility } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "./auth";
import { fakeClock, type FakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import { createScheduler, planDeadlines } from "./scheduler";
import { buildServer } from "./server";
import type { LobbySettings } from "./settings";
import { createGameStore, type GameStore } from "./store";
import { testDb } from "./testkit";
import { tickFor, TICK_MS, TIMINGS } from "./timing";

const QUICK = TIMINGS["15m"];

let db: Db;
let clock: FakeClock;
let store: GameStore;
let app: FastifyInstance;

/** A server on the shared database, as a fresh process would build it (its own store and cache). */
async function boot() {
  store = createGameStore(db);
  app = buildServer({ db, clock, store });
  await app.ready();
}
beforeAll(async () => {
  db = await testDb();
  clock = fakeClock(Date.UTC(2026, 10, 1));
  await boot();
}, 30_000);
// Each test's game stops here, so another test's ticks (and boots) only see its own.
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

/**
 * Host (an absent human: default moves, no votes) plus `bots` bots, started.
 * With `guests`, absent humans instead: no bot can call an emergency at random.
 */
async function startGame(bots: number, settings: Partial<LobbySettings>, guests = 0) {
  const host = (await post("/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await post("/games", host, { settings })).body;
  for (let i = 0; i < guests; i++) await post(`/invites/${game.inviteCode}/join`, null, { nickname: `Guest ${i}` });
  for (let i = 0; i < bots; i++) await post(`/games/${game.id}/bots`, host, { personality: i % 2 ? "greedy" : "opportunist" });
  await post(`/games/${game.id}/start`, host);
  return { id: game.id, host };
}

interface DeadlineRow {
  key: string;
  due: number;
  paused: boolean;
}
const deadlines = async (gameId: string) =>
  (
    await db.query<{ key: string; due: number; paused: boolean }>(
      "select key, (extract(epoch from due_at) * 1000)::float8 as due, paused_at is not null as paused from deadlines where game_id = $1 order by key",
      [gameId],
    )
  ).map((r): DeadlineRow => ({ ...r, due: Math.round(r.due) }));
const load = async (id: string) => (await store.load(id))!;
const count = (s: GameState, type: string, pick: (e: Record<string, unknown>) => boolean = () => true) =>
  s.log.filter((e) => e.type === type && pick(e as unknown as Record<string, unknown>)).length;

/** Jumps the clock to the next unpaused deadline and ticks. */
async function step(gameId: string) {
  const next = (await deadlines(gameId)).filter((d) => !d.paused).sort((a, b) => a.due - b.due)[0];
  if (!next) throw new Error("no deadline pending");
  clock.advance(Math.max(0, next.due - clock.now()));
  return app.scheduler.tick();
}

describe("presets (design §17)", () => {
  it("the scheduler tick shrinks with TIME_SCALE (dev and E2E), never below 100 ms", () => {
    expect(tickFor(1)).toBe(TICK_MS);
    expect(tickFor(0.1)).toBe(100);
    expect(tickFor(0.5)).toBe(500);
    expect(tickFor(0.01)).toBe(100);
  });

  it("the round deadline is the session length ÷ the round cap (design §17.1), with §17.3's grace", () => {
    const rounds = (k: keyof typeof TIMINGS) => (BANK_JOB.roundCap * TIMINGS[k].roundMs) / 60_000;
    expect([rounds("15m"), rounds("1h"), rounds("3h"), rounds("1d") / 60, rounds("3d") / 60, rounds("1w") / 60]).toEqual([15, 60, 180, 24, 72, 168]);
    expect([TIMINGS["1h"].roundMs, TIMINGS["3h"].roundMs, TIMINGS["1d"].roundMs, TIMINGS["3d"].roundMs, TIMINGS["1w"].roundMs].map((ms) => ms / 60_000)).toEqual([5, 15, 120, 360, 840]);
    expect(["1h", "3h", "1d", "3d", "1w"].map((k) => TIMINGS[k as keyof typeof TIMINGS].lockInGraceMs / 1000)).toEqual([10, 30, 120, 300, 300]);
    // §9.4, §17.1: 3 hours or less, meetings open automatically; window lengths in the table's ranges.
    expect([TIMINGS["15m"], TIMINGS["1h"], TIMINGS["3h"]].every((t) => t.autoMeetings)).toBe(true);
    expect(TIMINGS["1h"].meetingMs).toBe(3 * 60_000);
    expect(TIMINGS["3h"].meetingMs).toBe(5 * 60_000);
    for (const k of ["1d", "3d", "1w"] as const) expect(TIMINGS[k].autoMeetings).toBe(false);
  });
});

describe("all-bot games on a fake clock (M2-4 acceptance)", () => {
  for (const voteVisibility of ["hiddenThenRevealed", "open", "secret"] as VoteVisibility[]) {
    it(`a 15-min game finishes in ${voteVisibility} mode; deadlines never move without the host, rounds take the session ÷ the round cap, the shakedown window runs in full`, { timeout: 60_000 }, async () => {
      const { id } = await startGame(5, { sessionLength: "15m", voteVisibility });
      const started = clock.now();
      const seen = new Map<string, number>();
      for (let i = 0; i < 300 && (await load(id)).phase.kind !== "ended"; i++) {
        for (const d of await deadlines(id)) {
          if (!seen.has(d.key)) {
            seen.set(d.key, d.due);
            if (d.key.startsWith("round:")) expect(d.due - clock.now()).toBe(QUICK.roundMs); // design §17.1
            if (d.key.startsWith("result:")) expect(d.due - clock.now()).toBe(QUICK.resultMs); // design §9.3
            if (d.key.startsWith("closeMeeting:")) expect(d.due - clock.now()).toBe(QUICK.meetingMs);
            // STATUS: the shakedown window always runs its full server-set length. design §9.6
            if (d.key.startsWith("resolveShakedown:")) expect(d.due - clock.now()).toBe(QUICK.shakedownWindowMs);
          }
          // A row's due time is fixed when it is made: no meeting runs under a round or result window
          // (design §4.1, §9.3), and only the host pauses a game.
          expect(d.paused).toBe(false);
          expect(d.due).toBe(seen.get(d.key));
        }
        await step(id);
      }
      const end = await load(id);
      expect(end.phase.kind).toBe("ended");
      // design §9.1: a game that took a third of the bank held a regular meeting.
      if (end.thirds > 0) expect(count(end, "meetingOpened")).toBeGreaterThan(0);
      expect(await deadlines(id)).toEqual([]);
      expect(app.live.botRefusals.filter((r) => r.gameId === id)).toEqual([]);
      for (let r = 1; r <= BANK_JOB.roundCap; r++) if (end.resolvedRound >= r) expect(count(end, "roundResolved", (e) => e.round === r)).toBe(1);
      expect(clock.now() - started).toBeGreaterThanOrEqual(end.resolvedRound * QUICK.roundMs);
    });
  }
});

describe("restarts (M2-4 acceptance)", () => {
  it("killing and rebuilding the server mid-round keeps the deadline: it fires once, on time", { timeout: 60_000 }, async () => {
    const { id } = await startGame(0, { sessionLength: "15m" }, 2);
    const [round1] = await deadlines(id);
    expect(round1).toMatchObject({ key: "round:1", paused: false });
    clock.advance(QUICK.roundMs / 2);
    await app.close();
    await boot(); // onReady: bots settle, deadlines reconciled
    expect(await deadlines(id)).toEqual([round1]);
    clock.advance(QUICK.roundMs / 2 - 1);
    expect(await app.scheduler.tick()).toBe(0);
    clock.advance(1);
    expect(await app.scheduler.tick()).toBe(1);
    const s = await load(id);
    expect(count(s, "roundResolved")).toBe(1);
    // design §9.3: the round opens the result window, whose deadline then starts round 2.
    expect(s.phase).toEqual({ kind: "result", round: 1 });
    expect(await deadlines(id)).toEqual([{ key: "result:1", due: clock.now() + QUICK.resultMs, paused: false }]);
    clock.advance(QUICK.resultMs);
    expect(await app.scheduler.tick()).toBe(1);
    expect((await load(id)).phase).toEqual({ kind: "planning", round: 2 });
    expect(await deadlines(id)).toEqual([{ key: "round:2", due: clock.now() + QUICK.roundMs, paused: false }]);
  });

  it("a crash after a deadline was stored but before its row was cleaned up: no double, no skip", { timeout: 60_000 }, async () => {
    const { id } = await startGame(0, { sessionLength: "15m" }, 2);
    clock.advance(QUICK.roundMs);
    await app.scheduler.tick();
    // As if the process died between storing round 1's events and reconciling.
    await db.query("delete from deadlines where game_id = $1", [id]);
    await db.query("insert into deadlines (game_id, key, due_at, command) values ($1, 'round:1', to_timestamp($2::float8 / 1000), $3::json)", [
      id,
      clock.now() - 1,
      JSON.stringify({ type: "advance", deadline: { kind: "round", round: 1 } }),
    ]);
    await app.close();
    await boot();
    expect(await deadlines(id)).toEqual([{ key: "result:1", due: clock.now() + QUICK.resultMs, paused: false }]);
    expect(await app.scheduler.tick()).toBe(0);
    expect(count(await load(id), "roundResolved")).toBe(1);
  });
});

describe("failures (PR #22 review)", () => {
  it("a server failure keeps the deadline and retries it with backoff; it fires once it works", { timeout: 60_000 }, async () => {
    const { id } = await startGame(0, { sessionLength: "15m" }, 2);
    let failures = 2;
    const sched = createScheduler({
      db,
      clock,
      log: app.log,
      system: async (gameId, command) => {
        if (failures-- > 0) throw new Error("database went away");
        return app.live.system(gameId, command);
      },
      resync: (gameId) => app.live.settle(gameId),
    });
    clock.advance(QUICK.roundMs);
    expect(await sched.tick()).toBe(0); // fails: kept, retry in 1 s
    expect((await deadlines(id)).map((d) => d.key)).toEqual(["round:1"]);
    expect(await sched.tick()).toBe(0); // backing off
    clock.advance(1000);
    expect(await sched.tick()).toBe(0); // fails again: retry in 2 s
    clock.advance(1999);
    expect(await sched.tick()).toBe(0);
    clock.advance(1);
    expect(await sched.tick()).toBe(1);
    const s = await load(id);
    expect(count(s, "roundResolved")).toBe(1);
    expect(await deadlines(id)).toEqual([{ key: "result:1", due: clock.now() + QUICK.resultMs, paused: false }]);
  });

  it("a refused (stale) deadline is dropped and the game's real next deadline is planned", { timeout: 60_000 }, async () => {
    const { id } = await startGame(0, { sessionLength: "15m" }, 2);
    clock.advance(QUICK.roundMs);
    await app.scheduler.tick();
    // As if reconcile failed after round 1 resolved: the fired row is left and nothing is planned.
    await db.query("delete from deadlines where game_id = $1", [id]);
    await db.query("insert into deadlines (game_id, key, due_at, command) values ($1, 'round:1', to_timestamp($2::float8 / 1000), $3::json)", [
      id,
      clock.now(),
      JSON.stringify({ type: "advance", deadline: { kind: "round", round: 1 } }),
    ]);
    expect(await app.scheduler.tick()).toBe(0);
    expect(count(await load(id), "roundResolved")).toBe(1);
    expect(await deadlines(id)).toEqual([{ key: "result:1", due: clock.now() + QUICK.resultMs, paused: false }]);
  });
});

describe("the emergency's notice and the result window (design §9.3)", () => {
  it("refused while the round runs; called in the result window, it opens after its notice and the next round starts as it closes", { timeout: 60_000 }, async () => {
    const { id, host } = await startGame(0, { sessionLength: "15m" }, 2);
    const ws = await app.injectWS(`/games/${id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${host}` } });
    const replies: string[] = [];
    ws.on("message", (d) => replies.push(String(d)));
    let n = 0;
    // The reply goes out before the change's deadlines are stored; a no-op queues behind them on the game lock.
    const send = async (cmd: Record<string, unknown>) => {
      const msgId = `c${++n}`;
      ws.send(JSON.stringify({ cmd, id: msgId }));
      ws.send(JSON.stringify({ id: `${msgId}-b` }));
      await vi.waitFor(() => expect(replies.some((r) => r.includes(`"id":"${msgId}-b"`))).toBe(true), { interval: 1, timeout: 5000 });
      return JSON.parse(replies.find((r) => r.includes(`"id":"${msgId}"`))!) as Record<string, unknown>;
    };
    expect(await send({ type: "callEmergency" })).toMatchObject({ rejected: true });
    clock.advance(QUICK.roundMs);
    expect(await app.scheduler.tick()).toBe(1);
    expect((await load(id)).phase).toEqual({ kind: "result", round: 1 });
    expect(await send({ type: "callEmergency" })).toMatchObject({ ok: true });
    const meetingId = (await load(id)).pendingEmergency!.meetingId;
    expect(await deadlines(id)).toEqual([{ key: `openMeeting:${meetingId}`, due: clock.now() + QUICK.emergencyNoticeMs, paused: false }]);
    clock.advance(QUICK.emergencyNoticeMs);
    expect(await app.scheduler.tick()).toBe(1);
    expect((await load(id)).phase).toEqual({ kind: "meeting", meetingId });
    expect(await deadlines(id)).toEqual([{ key: `closeMeeting:${meetingId}`, due: clock.now() + QUICK.meetingMs, paused: false }]);
    clock.advance(QUICK.meetingMs - 1);
    expect(await app.scheduler.tick()).toBe(0);
    clock.advance(1);
    expect(await app.scheduler.tick()).toBe(1);
    expect((await load(id)).phase).toEqual({ kind: "planning", round: 2 });
    expect(await deadlines(id)).toEqual([{ key: "round:2", due: clock.now() + QUICK.roundMs, paused: false }]);
    ws.close();
  });
});

describe("planDeadlines", () => {
  it("an ended game has none", async () => {
    const { id } = await startGame(1, { sessionLength: "15m" });
    const s = await load(id);
    expect(planDeadlines({ ...s, phase: { kind: "ended", outcome: { kind: "success" } as never } }, QUICK, 0)).toEqual([]);
  });

  it("group-scheduled games open a due meeting at the locked ISO slot (never before it is due); auto ones at once", async () => {
    const { id } = await startGame(1, { sessionLength: "1d" });
    const s = await load(id);
    const at = Date.UTC(2026, 10, 3, 18);
    const waiting: GameState = { ...s, phase: { kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" }, pendingEmergency: null, scheduledMeeting: { meetingId: "meeting-1", slot: new Date(at).toISOString() } };
    const open = (t: typeof QUICK, now: number) => planDeadlines(waiting, t, now).find((d) => d.key === "openMeeting:meeting-1")!.dueAt;
    expect(open(TIMINGS["1d"], at - 5000)).toBe(at);
    expect(open(TIMINGS["1d"], at + 5000)).toBe(at + 5000);
    expect(open(TIMINGS["15m"], at - 5000)).toBe(at - 5000);
    // A slot that isn't a time ("meeting-1", as auto presets name it) opens as soon as the meeting is due.
    expect(planDeadlines({ ...waiting, scheduledMeeting: { meetingId: "meeting-1", slot: "meeting-1" } }, TIMINGS["1d"], 7)[0]!.dueAt).toBe(7);
    // Nobody locked a slot: the server picks one meetingLeadMs ahead, at once. design §9.4
    expect(planDeadlines({ ...waiting, scheduledMeeting: null }, TIMINGS["1d"], 0)).toEqual([
      { key: "scheduleMeeting:meeting-1", command: { type: "scheduleMeeting", meetingId: "meeting-1", slot: new Date(TIMINGS["1d"].meetingLeadMs).toISOString() }, dueAt: 0 },
    ]);
  });
});
