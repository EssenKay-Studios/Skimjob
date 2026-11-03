// QA (PR #22, M2-4): scheduler attacks on a fake clock. design §4.1, §5.4, §11.1, §11.3, §16.1
import { DECKS, ROLES } from "@skimjob/content";
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

/** The Standard deck with every Wildcard and Lone wolf toggled off: no Mole, so no police moments (was saboteur "off"). */
const TEAM_ROLES = DECKS.standard.filter((r) => ROLES[r]?.tag === "teamPlayer");

const T0 = Date.UTC(2026, 10, 2, 9);
let db: Db;
let clock: FakeClock;
let store: GameStore;
let app: FastifyInstance;
/** Seed forced on the next started game (so two runs can be compared); Duel when it has 2 seats. */
let forcedSeed = "qa-sched-1";
let duelForTwo = false;

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
      inner.start(gameId, { ...config, seed: forcedSeed, ...(duelForTwo && config.players.length === 2 ? { duel: true, roles: TEAM_ROLES } : {}) }, inTx),
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
  duelForTwo = false;
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

/** The phase a kill can land in (the brief's list). */
const label = (s: GameState) =>
  s.pendingEmergency && !meetingOpen(s) ? "notice" : s.phase.kind === "alibis" && s.config.duel && s.phase.round % 3 === 0 ? "checkpoint" : s.phase.kind;

interface Run {
  log: GameState["log"];
  /** `<ms since start> <key>` of every deadline sent, in order. */
  fired: string[];
  phases: Set<string>;
}

/**
 * Plays a game to its end by jumping to each next deadline. `restart` kills and
 * rebuilds the server before that step; `act` lets the host do something first.
 */
async function play(
  bots: number,
  settings: Partial<LobbySettings>,
  opts: { guests?: number; restart?: (s: GameState, i: number) => boolean; act?: (s: GameState, i: number, id: string, host: string) => Promise<void> } = {},
): Promise<Run> {
  await fresh();
  const { id, host } = await startGame(bots, settings, opts.guests ?? 0);
  const fired: string[] = [];
  const phases = new Set<string>();
  for (let i = 0; i < 400; i++) {
    let s = await load(id);
    if (s.phase.kind === "ended") break;
    phases.add(label(s));
    if (opts.restart?.(s, i)) {
      await app.close();
      await boot();
    }
    if (opts.act) {
      await opts.act(s, i, id, host);
      s = await load(id);
      if (label(s) !== [...phases].at(-1)) {
        phases.add(label(s));
        if (opts.restart?.(s, i)) {
          await app.close();
          await boot();
        }
      }
    }
    if (s.phase.kind === "ended") break;
    const rows = (await deadlines(id)).filter((d) => !d.paused);
    expect(rows.length, `no deadline pending in ${JSON.stringify(s.phase)}`).toBeGreaterThan(0);
    clock.advance(Math.max(0, rows[0]!.due - clock.now()));
    const due = rows.filter((d) => d.due <= clock.now()).map((d) => `${clock.now() - T0} ${d.key}`);
    const sent = await app.scheduler.tick();
    expect(sent).toBeGreaterThan(0);
    fired.push(...due.slice(0, sent));
  }
  const end = await load(id);
  expect(end.phase.kind).toBe("ended");
  expect(await deadlines(id)).toEqual([]);
  expect(app.live.botRefusals.filter((r) => r.gameId === id)).toEqual([]);
  // No double: every key sent once; rounds resolved once each.
  const keys = fired.map((f) => f.split(" ")[1]);
  expect(new Set(keys).size).toBe(keys.length);
  for (let r = 1; r <= end.resolvedRound; r++) expect(count(end, "roundResolved", (e) => e.round === r)).toBe(1);
  return { log: end.log, fired, phases };
}

const PRESETS: SessionLength[] = ["quick", "1h", "3h", "1d", "3d", "1w"];

describe("every preset finishes all-bot games (design §4.1)", () => {
  for (const sessionLength of PRESETS) {
    it(`${sessionLength}: all three vote modes and Duel`, { timeout: 240_000 }, async () => {
      for (const voteVisibility of ["hiddenThenRevealed", "open", "secret"] as VoteVisibility[]) {
        forcedSeed = `qa-${sessionLength}-${voteVisibility}`;
        const r = await play(5, { sessionLength, voteVisibility });
        expect(r.log.some((e) => e.type === "meetingOpened")).toBe(true);
      }
      duelForTwo = true;
      forcedSeed = `qa-${sessionLength}-duel`;
      const duel = await play(1, { sessionLength, roles: TEAM_ROLES });
      expect(duel.phases.has("checkpoint")).toBe(true);
      expect(duel.log.some((e) => e.type === "meetingOpened")).toBe(false);
    });
  }
});

describe("kill/restart at every step = an uninterrupted run (same seed)", () => {
  // The host calls an emergency in round 2's planning, so a notice, a meeting and (with luck) a Muscle window are hit.
  const emergencyAt = async (s: GameState, _i: number, id: string, host: string) => {
    if (s.phase.kind === "planning" && s.phase.round === 2 && !s.pendingEmergency && count(s, "emergencyMeetingCalled") === 0) {
      expect(await send(id, host, { type: "callEmergency" })).toMatchObject({ ok: true });
    }
  };
  // Absent humans (default moves) here; the bots' version is below.
  for (const sessionLength of ["quick", "1d"] as SessionLength[]) {
    it(`${sessionLength}, 3 absent humans: identical deadlines and log`, { timeout: 240_000 }, async () => {
      forcedSeed = `qa-restart-${sessionLength}`;
      const a = await play(0, { sessionLength }, { guests: 2, act: emergencyAt });
      const b = await play(0, { sessionLength }, { guests: 2, act: emergencyAt, restart: () => true });
      expect(b.fired).toEqual(a.fired);
      expect(b.log).toEqual(a.log);
      for (const p of ["planning", "alibis", "notice", "meeting"]) expect(b.phases.has(p), p).toBe(true);
      if (sessionLength === "1d") expect(b.phases.has("awaitingMeeting")).toBe(true);
    });
  }
  // PR #22 review: a bot's decision comes from (game seed, seat, the view it acts on) and the last view it acted
  // on is stored, so a restart can't change what the bots do.
  it("bots, quick: restarting before every step gives the same deadlines and log as an uninterrupted run", { timeout: 240_000 }, async () => {
    forcedSeed = "qa-restart-bots-identical";
    const a = await play(5, { sessionLength: "quick" }, { act: emergencyAt });
    const b = await play(5, { sessionLength: "quick" }, { act: emergencyAt, restart: () => true });
    expect(b.fired).toEqual(a.fired);
    expect(b.log).toEqual(a.log);
  });
  // With bots: restart before every step; play() checks no double, no skip, no refusals, every deadline drained.
  it("bots, quick and Duel 1w: restarting at every phase still ends cleanly", { timeout: 240_000 }, async () => {
    forcedSeed = "qa-restart-bots";
    const phases = new Set<string>();
    for (const seed of ["s1", "s2", "s3"]) {
      forcedSeed = `qa-restart-bots-${seed}`;
      for (const p of (await play(5, { sessionLength: "quick" }, { act: emergencyAt, restart: () => true })).phases) phases.add(p);
    }
    duelForTwo = true;
    for (const p of (await play(1, { sessionLength: "1w", roles: TEAM_ROLES }, { restart: () => true })).phases) phases.add(p);
    for (const p of ["planning", "alibis", "notice", "meeting", "checkpoint"]) expect(phases.has(p), p).toBe(true);
    console.log("QA restart phases covered:", [...phases].join(","));
  });
});

describe("clock jumps (laptop sleep)", () => {
  it("jumping hours fires each due deadline once, in order; a paused round doesn't fire under an emergency it overtook", { timeout: 60_000 }, async () => {
    await fresh();
    forcedSeed = "qa-jump";
    const t = TIMINGS["1h"];
    const { id, host } = await startGame(0, { sessionLength: "1h" }, 2);
    clock.advance(60_000);
    expect((await send(id, host, { type: "callEmergency" })).ok).toBe(true);
    const meetingId = (await load(id)).pendingEmergency!.meetingId;
    // Both the notice and round 1 are long overdue after the jump.
    clock.advance(5 * 3600_000);
    expect(await app.scheduler.tick()).toBe(1);
    let s = await load(id);
    expect(s.phase).toEqual({ kind: "meeting", meetingId });
    expect(count(s, "roundResolved")).toBe(0);
    const rows = await deadlines(id);
    expect(rows).toEqual([
      expect.objectContaining({ key: "round:1", paused: true }),
      { key: `closeMeeting:${meetingId}`, due: clock.now() + t.meetingMs, paused: false },
    ]);
    // Another long sleep: the meeting closes once, then round 1 (already overdue when the meeting opened) fires once, after it.
    clock.advance(10 * 3600_000);
    expect(await app.scheduler.tick()).toBe(2);
    s = await load(id);
    expect(count(s, "meetingClosed", (e) => e.meetingId === meetingId)).toBe(1);
    expect(count(s, "meetingOpened", (e) => e.meetingId === meetingId)).toBe(1);
    expect(count(s, "roundResolved")).toBe(1);
    const order = s.log.map((e) => e.type).filter((x) => ["meetingOpened", "meetingClosed", "roundResolved"].includes(x));
    expect(order).toEqual(["meetingOpened", "meetingClosed", "roundResolved"]);
    expect(await deadlines(id)).toEqual([{ key: "alibis:1", due: clock.now() + t.alibiMs, paused: false }]);
  });

  it("a week-long sleep in a 1-week game sends only round 1; the next deadline is planned from the wake-up", { timeout: 60_000 }, async () => {
    await fresh();
    const { id } = await startGame(0, { sessionLength: "1w" }, 2);
    clock.advance(7 * 24 * 3600_000);
    expect(await app.scheduler.tick()).toBe(1);
    expect(await app.scheduler.tick()).toBe(0);
    expect((await load(id)).phase).toEqual({ kind: "alibis", round: 1 });
    expect(await deadlines(id)).toEqual([{ key: "alibis:1", due: clock.now() + TIMINGS["1w"].alibiMs, paused: false }]);
  });
});

describe("humans before a deadline (design §5)", () => {
  it("a move sent before the deadline is used; with others still to lock in the round runs its full length; after it, moves are refused", { timeout: 60_000 }, async () => {
    await fresh();
    const { id, host } = await startGame(0, { sessionLength: "quick" }, 2);
    const [round1] = await deadlines(id);
    const room = viewFor(await load(id), (await load(id)).playerOrder[0]!).rooms[0];
    clock.advance(QUICK_MS - 1);
    const r = await send(id, host, { type: "submitMove", move: { room, pocket: 0 } });
    expect(r).toMatchObject({ ok: true });
    expect(await deadlines(id)).toEqual([round1]);
    expect(await app.scheduler.tick()).toBe(0);
    clock.advance(1);
    expect(await app.scheduler.tick()).toBe(1);
    const s = await load(id);
    const hostId = s.playerOrder[0];
    expect(count(s, "moveSubmitted", (e) => e.player === hostId && e.round === 1)).toBe(1);
    expect(count(s, "defaultMoveAssigned", (e) => e.player === hostId)).toBe(0);
    expect(count(s, "defaultMoveAssigned")).toBe(2);
    expect((await send(id, host, { type: "submitMove", move: { room, pocket: 0 } })).rejected).toBe(true);
  });
});
const byDue = async (id: string) => (await deadlines(id)).sort((a, b) => a.due - b.due);

describe("early round end once the whole crew has locked in (owner decision, 2 Nov; design §4.1, §5.1)", () => {
  it("the round resolves lockInGraceMs after the last lock-in; a change during the grace doesn't restart it; alibis stay timed", { timeout: 60_000 }, async () => {
    await fresh();
    const { id, host } = await startGame(2, { sessionLength: "quick" });
    const t = TIMINGS.quick;
    let s = await load(id);
    const hostId = s.playerOrder[0]!;
    // The bots locked in at the start; the host hasn't, so only the full-length round is planned.
    expect(s.playerOrder.slice(1).every((p) => Object.hasOwn(s.moves, p))).toBe(true);
    const [round1] = await deadlines(id);
    expect((await deadlines(id)).map((d) => d.key)).toEqual(["round:1"]);
    clock.advance(10_000);
    const room = viewFor(s, hostId).rooms.find((r) => r !== "security")!;
    expect(await send(id, host, { type: "submitMove", move: { room, pocket: 0 } })).toMatchObject({ ok: true });
    const early = { key: "roundEarly:1", due: clock.now() + t.lockInGraceMs, paused: false };
    expect(await byDue(id)).toEqual([early, round1]);
    // A change during the grace: still the same due time.
    clock.advance(t.lockInGraceMs - 1000);
    expect(await send(id, host, { type: "submitMove", move: { room: "lobby", pocket: 0 } })).toMatchObject({ ok: true });
    expect(await byDue(id)).toEqual([early, round1]);
    expect(await app.scheduler.tick()).toBe(0);
    clock.advance(1000);
    expect(await app.scheduler.tick()).toBe(1);
    s = await load(id);
    expect(s.phase).toEqual({ kind: "alibis", round: 1 });
    // The change made in the grace counts: the host's last move, and no new lock-in for it.
    const mine = s.log.filter((e) => e.type === "moveSubmitted" && e.player === hostId);
    expect(mine.at(-1)).toMatchObject({ move: { room: "lobby", pocket: 0 } });
    expect(count(s, "moveLocked", (e) => e.player === hostId)).toBe(1);
    expect(count(s, "roundResolved")).toBe(1);
    expect(count(s, "defaultMoveAssigned")).toBe(0);
    // Both round rows are gone with the round; the alibi window runs its full length.
    expect(await deadlines(id)).toEqual([{ key: "alibis:1", due: clock.now() + t.alibiMs, paused: false }]);
  });

  it("the grace scales with TIME_SCALE and never outlasts the round", () => {
    for (const [k, t] of Object.entries(TIMINGS)) {
      expect(t.lockInGraceMs, k).toBeGreaterThan(0);
      expect(t.lockInGraceMs, k).toBeLessThan(t.roundMs / 4);
    }
    expect(scaleTiming(TIMINGS.quick, 0.1).lockInGraceMs).toBe(TIMINGS.quick.lockInGraceMs / 10);
  });
});

const QUICK_MS = TIMINGS.quick.roundMs;

describe("emergency during an open alibi window (design §5.4)", () => {
  it("the alibi deadline keeps running through the notice, pauses while the meeting is open, then keeps its time left", { timeout: 60_000 }, async () => {
    await fresh();
    const t = TIMINGS["1h"];
    const { id, host } = await startGame(0, { sessionLength: "1h" }, 2);
    clock.advance(t.roundMs);
    await app.scheduler.tick();
    expect((await load(id)).phase).toEqual({ kind: "alibis", round: 1 });
    const [alibis] = await deadlines(id);
    clock.advance(5_000);
    expect((await send(id, host, { type: "callEmergency" })).ok).toBe(true);
    const meetingId = (await load(id)).pendingEmergency!.meetingId;
    // 1h: notice (60 s) is longer than the alibi window left (25 s): the window closes first, round 2 starts under the notice.
    clock.advance(alibis!.due - clock.now());
    expect(await app.scheduler.tick()).toBe(1);
    expect((await load(id)).phase).toEqual({ kind: "planning", round: 2 });
    const round2Due = clock.now() + t.roundMs;
    clock.advance(t.emergencyNoticeMs - 25_000);
    expect(await app.scheduler.tick()).toBe(1);
    expect((await load(id)).phase).toEqual({ kind: "meeting", meetingId });
    const left = round2Due - clock.now();
    clock.advance(t.meetingMs);
    expect(await app.scheduler.tick()).toBe(1);
    expect(await deadlines(id)).toEqual([{ key: "round:2", due: clock.now() + left, paused: false }]);
  });

});

describe("restart matrix after the fix (30c9f9e): bots, 10+ seeds, Duel included", () => {
  const emergencyAt = async (s: GameState, _i: number, id: string, host: string) => {
    if (s.phase.kind === "planning" && s.phase.round === 2 && !s.pendingEmergency && count(s, "emergencyMeetingCalled") === 0) {
      expect(await send(id, host, { type: "callEmergency" })).toMatchObject({ ok: true });
    }
  };
  for (let k = 0; k < 10; k++) {
    const sessionLength = PRESETS[k % PRESETS.length]!;
    const voteVisibility = (["hiddenThenRevealed", "open", "secret"] as VoteVisibility[])[k % 3]!;
    it(`seed ${k}: ${sessionLength}, ${voteVisibility}, 6 seats and Duel — restart at every step = uninterrupted`, { timeout: 240_000 }, async () => {
      forcedSeed = `qa-matrix-${k}`;
      const opts = { act: emergencyAt };
      const a = await play(5, { sessionLength, voteVisibility }, opts);
      const b = await play(5, { sessionLength, voteVisibility }, { ...opts, restart: () => true });
      expect(b.fired).toEqual(a.fired);
      expect(b.log).toEqual(a.log);
      duelForTwo = true;
      forcedSeed = `qa-matrix-duel-${k}`;
      const da = await play(1, { sessionLength, roles: TEAM_ROLES });
      const db2 = await play(1, { sessionLength, roles: TEAM_ROLES }, { restart: () => true });
      expect(db2.phases.has("checkpoint")).toBe(true);
      expect(db2.fired).toEqual(da.fired);
      expect(db2.log).toEqual(da.log);
    });
  }
});

describe("transient database errors on a deadline (30c9f9e retry/backoff)", () => {
  /** Plays to the end, ticking every second when nothing is sent (backoff), arming `fault` once at step `at`. */
  async function playWithFault(fault: RegExp | null, at: number) {
    await fresh();
    forcedSeed = "qa-fault";
    const { id } = await startGame(5, { sessionLength: "quick" });
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
    expect(faults).toEqual([]); // the fault really fired
    for (let r = 1; r <= end.resolvedRound; r++) expect(count(end, "roundResolved", (e) => e.round === r)).toBe(1);
    return end.log;
  }
  it("a failed event write, deadline reconcile or bot bookkeeping is retried: the game finishes with the same log", { timeout: 240_000 }, async () => {
    const clean = await playWithFault(null, 0);
    for (const [fault, at] of [
      [/insert into game_events/i, 3],
      [/insert into deadlines/i, 5],
      [/delete from deadlines/i, 7],
      [/update seats set bot_seen/i, 9],
      [/select game_id, key, command from deadlines/i, 4],
    ] as const) {
      const log = await playWithFault(fault, at);
      expect(log, String(fault)).toEqual(clean);
    }
  });
});
