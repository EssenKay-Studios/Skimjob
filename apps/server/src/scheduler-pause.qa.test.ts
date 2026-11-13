// QA (PR #172, S3a.5): the scheduler without the meeting pause (ca2d538). Only the host pauses deadlines
// now; each phase's deadline fires exactly its length after it was planned, plus any host pause it lived
// through. design §4.1, §9.3, §9.4, §15
import type { GameState } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "./auth";
import { fakeClock, type FakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import type { LobbySettings, SessionLength } from "./settings";
import { createGameStore, type GameStore } from "./store";
import { testDb } from "./testkit";
import { TIMINGS, type Timing } from "./timing";

const T0 = Date.UTC(2026, 10, 8, 9);
let db: Db;
let clock: FakeClock;
let store: GameStore;
let app: FastifyInstance;
let forcedSeed = "qa172-pause";

async function boot() {
  const inner = createGameStore(db);
  store = { ...inner, start: (gameId, config, inTx) => inner.start(gameId, { ...config, seed: forcedSeed }, inTx) };
  app = buildServer({ db, clock, store });
  await app.ready();
}
async function fresh() {
  await app.close();
  clock = fakeClock(T0);
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
  return { status: res.statusCode, body: res.json() as LobbyView, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};
async function startGame(bots: number, settings: Partial<LobbySettings>, guests = 0) {
  const host = (await post("/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await post("/games", host, { settings })).body;
  const sessions = [host];
  for (let i = 0; i < guests; i++) sessions.push((await post(`/invites/${game.inviteCode}/join`, null, { nickname: `Guest ${i}` })).session!);
  for (let i = 0; i < bots; i++) await post(`/games/${game.id}/bots`, host, { personality: i % 2 ? "greedy" : "opportunist" });
  await post(`/games/${game.id}/start`, host);
  return { id: game.id, host, sessions };
}
async function send(id: string, who: string, cmd: Record<string, unknown>) {
  const ws = await app.injectWS(`/games/${id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${who}` } });
  const replies: string[] = [];
  ws.on("message", (d) => replies.push(String(d)));
  ws.send(JSON.stringify({ cmd, id: "q" }));
  await vi.waitFor(() => expect(replies.some((r) => r.includes('"id":"q"'))).toBe(true), { interval: 1, timeout: 10_000 });
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
const deadlines = async (gameId: string): Promise<Row[]> =>
  (
    await db.query<Row>(
      "select key, (extract(epoch from due_at) * 1000)::float8 as due, paused_at is not null as paused from deadlines where game_id = $1 order by due_at, key",
      [gameId],
    )
  ).map((r) => ({ ...r, due: Math.round(Number(r.due)) }));
const load = async (id: string): Promise<GameState> => (await store.load(id))!;
const count = (s: GameState, type: string) => s.log.filter((e) => e.type === type).length;
const label = (s: GameState) => (s.pendingEmergency ? "notice" : s.phase.kind);

/** How long after it is planned each kind of row should fall due (auto-scheduled presets). */
function lengthOf(key: string, t: Timing): number {
  const kind = key.split(":")[0]!;
  const id = key.slice(kind.length + 1);
  switch (kind) {
    case "round":
      return t.roundMs;
    case "roundEarly":
      return t.lockInGraceMs;
    case "alibi":
      return t.alibiMs; // design §10
    case "result":
      return t.resultMs;
    case "closeMeeting":
      return t.meetingMs;
    case "resolveShakedown":
      return t.shakedownWindowMs;
    case "openMeeting":
      return id.startsWith("emergency-") ? t.emergencyNoticeMs : 0;
    case "scheduleMeeting":
      return 0;
    default:
      throw new Error(`unknown deadline ${key}`);
  }
}

interface Life {
  created: number;
  /** Host-pause time this row lived through. */
  paused: number;
}

/**
 * Plays an all-bot game (the host's seat takes default moves) by jumping to each next deadline.
 * With `pauseMs`, the host pauses after every step for `pauseMs(i)` and resumes. Checks that every
 * deadline fires exactly at planned + its length + the host pauses it lived through, and that no row is
 * ever paused while the game runs.
 */
async function play(sessionLength: SessionLength, call: boolean, pauseMs?: (i: number) => number) {
  await fresh();
  const t = TIMINGS[sessionLength];
  const { id, host } = await startGame(5, { sessionLength });
  const lives = new Map<string, Life>();
  const fired: string[] = [];
  const phases = new Set<string>();
  const observe = async () => {
    const rows = await deadlines(id);
    for (const r of rows) {
      expect(r.paused, `${r.key} paused while the game runs`).toBe(false);
      const life = lives.get(r.key);
      if (!life) {
        lives.set(r.key, { created: clock.now(), paused: 0 });
        expect(r.due - clock.now(), r.key).toBe(lengthOf(r.key, t));
      } else {
        expect(r.due, `${r.key} moved`).toBe(life.created + lengthOf(r.key, t) + life.paused);
      }
    }
    return rows;
  };
  for (let i = 0; i < 400; i++) {
    let s = await load(id);
    if (s.phase.kind === "ended") break;
    phases.add(label(s));
    // With `call`, the host spends an emergency in the first result window (design §9.3): a notice and an
    // emergency meeting. Without, a result window can run out (and fire `result:N`).
    if (call && s.phase.kind === "result" && s.emergencies > 0 && !s.pendingEmergency && count(s, "emergencyMeetingCalled") === 0) {
      expect(await send(id, host, { type: "callEmergency" })).toMatchObject({ ok: true });
      s = await load(id);
      phases.add(label(s));
    }
    let rows = await observe();
    if (pauseMs) {
      const p = pauseMs(i);
      expect((await post(`/games/${id}/pause`, host)).status).toBe(200);
      expect((await deadlines(id)).every((r) => r.paused)).toBe(true);
      clock.advance(p);
      expect(await app.scheduler.tick()).toBe(0);
      expect(label(await load(id))).toBe(label(s));
      expect((await post(`/games/${id}/resume`, host)).status).toBe(200);
      for (const r of rows) lives.get(r.key)!.paused += p;
      rows = await observe();
    }
    expect(rows.length, `no deadline in ${JSON.stringify(s.phase)}`).toBeGreaterThan(0);
    const next = rows[0]!;
    // One ms early: nothing fires.
    clock.advance(Math.max(0, next.due - 1 - clock.now()));
    if (next.due > clock.now()) expect(await app.scheduler.tick()).toBe(0);
    clock.advance(Math.max(0, next.due - clock.now()));
    const due = rows.filter((d) => d.due <= clock.now()).map((d) => d.key);
    const sent = await app.scheduler.tick();
    expect(sent).toBeGreaterThan(0);
    for (const k of due.slice(0, sent)) {
      const life = lives.get(k)!;
      expect(clock.now(), `${k} fired off time`).toBe(life.created + lengthOf(k, t) + life.paused);
      fired.push(k);
    }
  }
  const end = await load(id);
  expect(end.phase.kind).toBe("ended");
  expect(await deadlines(id)).toEqual([]);
  expect(app.live.botRefusals.filter((r) => r.gameId === id)).toEqual([]);
  expect(new Set(fired).size).toBe(fired.length);
  return { log: end.log, fired, phases };
}

describe("no meeting pause any more: only the host stops deadlines (ca2d538; design §4.1, §9.3)", () => {
  for (const sessionLength of ["15m", "1h", "3h"] as SessionLength[]) {
    it(`${sessionLength}, bots: every deadline fires exactly its length after it is planned; a host pause at every step shifts each by the pauses it lived through, with the same log`, { timeout: 300_000 }, async () => {
      const phases = new Set<string>();
      let kinds = new Set<string>();
      for (const [seed, call] of [["a", false], ["b", true]] as const) {
        forcedSeed = `qa172-${sessionLength}-${seed}`;
        const plain = await play(sessionLength, call);
        // Pauses of uneven lengths, some longer than any phase.
        const paused = await play(sessionLength, call, (i) => [1, 7_000, 3 * 3600_000, 59_999][i % 4]!);
        expect(paused.fired).toEqual(plain.fired);
        expect(paused.log).toEqual(plain.log);
        for (const p of plain.phases) phases.add(p);
        kinds = new Set([...kinds, ...plain.fired.map((k) => (k.startsWith("openMeeting:emergency") ? "notice" : k.split(":")[0]!))]);
      }
      for (const p of ["planning", "alibi", "result", "notice", "meeting"]) expect(phases.has(p), p).toBe(true);
      for (const k of ["round", "alibi", "result", "notice", "closeMeeting"]) expect(kinds.has(k), k).toBe(true);
      console.log(`QA ${sessionLength}: phases ${[...phases].join(",")}; deadlines fired ${[...kinds].join(",")}`);
    });
  }
});

describe("rows planned while the host has paused (design §15, §9.3)", () => {
  it("an emergency called during a pause: its notice keeps its full length and opens exactly that long after the resume", { timeout: 60_000 }, async () => {
    await fresh();
    const t = TIMINGS["1h"];
    const { id, host } = await startGame(0, { sessionLength: "1h" }, 2);
    clock.advance(t.roundMs);
    expect(await app.scheduler.tick()).toBe(1);
    clock.advance(t.alibiMs); // design §10: the alibi window comes first
    expect(await app.scheduler.tick()).toBe(1);
    expect((await load(id)).phase).toEqual({ kind: "result", round: 1 });
    clock.advance(10_000);
    expect((await post(`/games/${id}/pause`, host)).status).toBe(200);
    clock.advance(5_000);
    expect((await send(id, host, { type: "callEmergency" })).ok).toBe(true);
    const meetingId = (await load(id)).pendingEmergency!.meetingId;
    // The result row goes; the notice is planned already paused.
    expect((await deadlines(id)).map((r) => [r.key, r.paused])).toEqual([[`openMeeting:${meetingId}`, true]]);
    clock.advance(10 * t.emergencyNoticeMs);
    expect(await app.scheduler.tick()).toBe(0);
    expect((await post(`/games/${id}/resume`, host)).status).toBe(200);
    expect(await deadlines(id)).toEqual([{ key: `openMeeting:${meetingId}`, due: clock.now() + t.emergencyNoticeMs, paused: false }]);
    clock.advance(t.emergencyNoticeMs - 1);
    expect(await app.scheduler.tick()).toBe(0);
    clock.advance(1);
    expect(await app.scheduler.tick()).toBe(1);
    expect((await load(id)).phase).toEqual({ kind: "meeting", meetingId });
    // The meeting's own clock runs; nothing else is left to stop.
    expect(await deadlines(id)).toEqual([{ key: `closeMeeting:${meetingId}`, due: clock.now() + t.meetingMs, paused: false }]);
    clock.advance(t.meetingMs);
    expect(await app.scheduler.tick()).toBe(1);
    expect((await load(id)).phase).toEqual({ kind: "planning", round: 2 });
    expect(await deadlines(id)).toEqual([{ key: "round:2", due: clock.now() + t.roundMs, paused: false }]);
  });

  it("the crew locking in during a pause: roundEarly is planned paused and keeps the whole grace; the round keeps what it had left", { timeout: 60_000 }, async () => {
    await fresh();
    const t = TIMINGS["15m"];
    const { id, sessions } = await startGame(0, { sessionLength: "15m" }, 2);
    const host = sessions[0]!;
    clock.advance(30_000);
    expect((await post(`/games/${id}/pause`, host)).status).toBe(200);
    clock.advance(1000);
    for (const who of sessions) expect(await send(id, who, { type: "submitMove", move: { room: "lobby", duffel: 1, pocket: 0 } })).toMatchObject({ ok: true });
    expect((await deadlines(id)).map((r) => [r.key, r.paused]).sort()).toEqual([
      ["round:1", true],
      ["roundEarly:1", true],
    ]);
    clock.advance(t.roundMs);
    expect(await app.scheduler.tick()).toBe(0);
    expect((await post(`/games/${id}/resume`, host)).status).toBe(200);
    const rows = new Map((await deadlines(id)).map((r) => [r.key, r]));
    expect(rows.get("roundEarly:1")).toEqual({ key: "roundEarly:1", due: clock.now() + t.lockInGraceMs, paused: false });
    expect(rows.get("round:1")).toEqual({ key: "round:1", due: clock.now() + t.roundMs - 30_000, paused: false });
    clock.advance(t.lockInGraceMs - 1);
    expect(await app.scheduler.tick()).toBe(0);
    clock.advance(1);
    expect(await app.scheduler.tick()).toBe(1);
    expect((await load(id)).phase).toEqual({ kind: "alibi", round: 1 });
    expect(await deadlines(id)).toEqual([{ key: "alibi:1", due: clock.now() + t.alibiMs, paused: false }]);
  });
});
