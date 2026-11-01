// Scheduler and elastic timing. docs/m2-plan.md M2-4; design §4.1, §11.1, §11.3
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

const QUICK = TIMINGS.quick;

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

describe("presets (design §4.1)", () => {
  it("the scheduler tick shrinks with TIME_SCALE (dev and E2E), never below 100 ms", () => {
    expect(tickFor(1)).toBe(TICK_MS);
    expect(tickFor(0.1)).toBe(100);
    expect(tickFor(0.5)).toBe(500);
    expect(tickFor(0.01)).toBe(100);
  });

  it("spread 9 rounds and 3 meetings over about the chosen length; Quick is about 15 minutes", () => {
    const total = (k: keyof typeof TIMINGS) => (9 * (TIMINGS[k].roundMs + TIMINGS[k].alibiMs) + 3 * TIMINGS[k].meetingMs) / 60_000;
    expect(total("quick")).toBe(15);
    expect(total("1h")).toBeGreaterThan(50);
    expect(total("1h")).toBeLessThanOrEqual(60);
    expect(total("3h")).toBeGreaterThan(160);
    expect(total("3h")).toBeLessThanOrEqual(180);
    expect(total("1d") / 60).toBeLessThanOrEqual(24);
    expect(total("3d") / 60).toBeLessThanOrEqual(72 + 1);
    expect(total("1w") / 60).toBeLessThanOrEqual(7 * 24);
    // §4.1: under 3 hours meetings are auto-scheduled; window lengths in the table's ranges.
    expect([TIMINGS.quick, TIMINGS["1h"], TIMINGS["3h"]].every((t) => t.autoMeetings)).toBe(true);
    expect(TIMINGS["1h"].meetingMs).toBe(3 * 60_000);
    expect(TIMINGS["3h"].meetingMs).toBe(5 * 60_000);
    for (const k of ["1d", "3d", "1w"] as const) expect(TIMINGS[k].autoMeetings).toBe(false);
  });
});

describe("all-bot games on a fake clock (M2-4 acceptance)", () => {
  for (const voteVisibility of ["hiddenThenRevealed", "open", "secret"] as VoteVisibility[]) {
    it(`a Quick game finishes in ${voteVisibility} mode; deadlines move only by pauses, rounds take 45 s and alibis 15 s, the Muscle window runs in full`, { timeout: 60_000 }, async () => {
      const { id } = await startGame(5, { sessionLength: "quick", voteVisibility });
      const started = clock.now();
      const seen = new Map<string, number>();
      const pausedSince = new Map<string, number>();
      for (let i = 0; i < 300 && (await load(id)).phase.kind !== "ended"; i++) {
        for (const d of await deadlines(id)) {
          if (!seen.has(d.key)) {
            seen.set(d.key, d.due);
            if (d.key.startsWith("round:") && !d.paused) expect(d.due - clock.now()).toBe(QUICK.roundMs); // design §4.1
            if (d.key.startsWith("alibis:") && !d.paused) expect(d.due - clock.now()).toBe(QUICK.alibiMs); // design §5.4
            if (d.key.startsWith("closeMeeting:")) expect(d.due - clock.now()).toBe(QUICK.meetingMs);
            // STATUS: the Muscle's window always runs its full server-set length. design §11.3
            if (d.key.startsWith("resolveShakedown:")) expect(d.due - clock.now()).toBe(QUICK.shakedownWindowMs);
          }
          // A row's due time is fixed when it is made; only a pause (a bot's emergency meeting) moves it on, by the pause.
          if (d.paused && !pausedSince.has(d.key)) pausedSince.set(d.key, clock.now());
          if (!d.paused && pausedSince.has(d.key)) {
            seen.set(d.key, seen.get(d.key)! + clock.now() - pausedSince.get(d.key)!);
            pausedSince.delete(d.key);
          }
          expect(d.due).toBe(seen.get(d.key));
        }
        await step(id);
      }
      const end = await load(id);
      expect(end.phase.kind).toBe("ended");
      expect(count(end, "meetingOpened")).toBeGreaterThan(0);
      expect(await deadlines(id)).toEqual([]);
      expect(app.live.botRefusals.filter((r) => r.gameId === id)).toEqual([]);
      for (let r = 1; r <= 9; r++) if (end.resolvedRound >= r) expect(count(end, "roundResolved", (e) => e.round === r)).toBe(1);
      expect(clock.now() - started).toBeGreaterThanOrEqual(end.resolvedRound * QUICK.roundMs);
    });
  }
});

describe("restarts (M2-4 acceptance)", () => {
  it("killing and rebuilding the server mid-round keeps the deadline: it fires once, on time", { timeout: 60_000 }, async () => {
    const { id } = await startGame(0, { sessionLength: "quick" }, 2);
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
    expect(s.phase).toEqual({ kind: "alibis", round: 1 });
    expect(await deadlines(id)).toEqual([{ key: "alibis:1", due: clock.now() + QUICK.alibiMs, paused: false }]);
    // design §5.4: the alibi deadline then starts round 2.
    clock.advance(QUICK.alibiMs);
    expect(await app.scheduler.tick()).toBe(1);
    expect((await load(id)).phase).toEqual({ kind: "planning", round: 2 });
    expect(await deadlines(id)).toEqual([{ key: "round:2", due: clock.now() + QUICK.roundMs, paused: false }]);
  });

  it("a crash after a deadline was stored but before its row was cleaned up: no double, no skip", { timeout: 60_000 }, async () => {
    const { id } = await startGame(0, { sessionLength: "quick" }, 2);
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
    expect(await deadlines(id)).toEqual([{ key: "alibis:1", due: clock.now() + QUICK.alibiMs, paused: false }]);
    expect(await app.scheduler.tick()).toBe(0);
    expect(count(await load(id), "roundResolved")).toBe(1);
  });
});

describe("failures (PR #22 review)", () => {
  it("a server failure keeps the deadline and retries it with backoff; it fires once it works", { timeout: 60_000 }, async () => {
    const { id } = await startGame(0, { sessionLength: "quick" }, 2);
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
    expect(await deadlines(id)).toEqual([{ key: "alibis:1", due: clock.now() + QUICK.alibiMs, paused: false }]);
  });

  it("a refused (stale) deadline is dropped and the game's real next deadline is planned", { timeout: 60_000 }, async () => {
    const { id } = await startGame(0, { sessionLength: "quick" }, 2);
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
    expect(await deadlines(id)).toEqual([{ key: "alibis:1", due: clock.now() + QUICK.alibiMs, paused: false }]);
  });
});

describe("pausing (design §4.1, §11.1)", () => {
  it("an emergency opens after its notice; the round is paused while it is open and resumes with the time it had left", { timeout: 60_000 }, async () => {
    const { id, host } = await startGame(0, { sessionLength: "quick" }, 2);
    const [round1] = await deadlines(id);
    clock.advance(10_000);
    const ws = await app.injectWS(`/games/${id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${host}` } });
    const replies: string[] = [];
    ws.on("message", (d) => replies.push(String(d)));
    ws.send(JSON.stringify({ cmd: { type: "callEmergency" }, id: "e" }));
    await vi.waitFor(() => expect(replies.some((r) => r.includes('"id":"e"'))).toBe(true), { interval: 1, timeout: 5000 });
    ws.close();
    const meetingId = (await load(id)).pendingEmergency!.meetingId;
    expect(await deadlines(id)).toEqual([{ key: `openMeeting:${meetingId}`, due: clock.now() + QUICK.emergencyNoticeMs, paused: false }, round1]);

    clock.advance(QUICK.emergencyNoticeMs);
    await app.scheduler.tick();
    expect((await load(id)).phase).toEqual({ kind: "meeting", meetingId });
    const left = round1!.due - clock.now();
    expect(await deadlines(id)).toEqual([
      { key: `closeMeeting:${meetingId}`, due: clock.now() + QUICK.meetingMs, paused: false },
      { ...round1, paused: true },
    ]);
    // The round deadline passes while the meeting is open: nothing resolves mid-vote.
    clock.advance(QUICK.meetingMs - 1);
    expect(await app.scheduler.tick()).toBe(0);
    clock.advance(1);
    await app.scheduler.tick();
    expect((await load(id)).phase).toEqual({ kind: "planning", round: 1 });
    expect(await deadlines(id)).toEqual([{ key: "round:1", due: clock.now() + left, paused: false }]);
  });
});

describe("planDeadlines", () => {
  it("an ended game has none", async () => {
    const { id } = await startGame(1, { sessionLength: "quick" });
    const s = await load(id);
    expect(planDeadlines({ ...s, phase: { kind: "ended", outcome: { kind: "success" } as never } }, QUICK, 0)).toEqual([]);
  });

  it("group-scheduled games open the act's meeting at the locked ISO slot (never before the act's end); auto ones at once", async () => {
    const { id } = await startGame(1, { sessionLength: "1d" });
    const s = await load(id);
    const at = Date.UTC(2026, 10, 3, 18);
    const waiting: GameState = { ...s, phase: { kind: "awaitingMeeting", act: 1 }, pendingEmergency: null, scheduledMeeting: { meetingId: "act-1", act: 1, slot: new Date(at).toISOString() } };
    const open = (t: typeof QUICK, now: number) => planDeadlines(waiting, t, now).find((d) => d.key === "openMeeting:act-1")!.dueAt;
    expect(open(TIMINGS["1d"], at - 5000)).toBe(at);
    expect(open(TIMINGS["1d"], at + 5000)).toBe(at + 5000);
    expect(open(TIMINGS.quick, at - 5000)).toBe(at - 5000);
    // A slot that isn't a time ("act-1", as bots propose) opens as soon as the act's last round has resolved.
    expect(planDeadlines({ ...waiting, scheduledMeeting: { meetingId: "act-1", act: 1, slot: "act-1" } }, TIMINGS["1d"], 7)[0]!.dueAt).toBe(7);
    // Nobody locked a slot: the server picks one meetingLeadMs ahead, at once. design §11.1
    expect(planDeadlines({ ...waiting, scheduledMeeting: null }, TIMINGS["1d"], 0)).toEqual([
      { key: "scheduleMeeting:act-1", command: { type: "scheduleMeeting", act: 1, slot: new Date(TIMINGS["1d"].meetingLeadMs).toISOString() }, dueAt: 0, pausable: false },
    ]);
  });
});
