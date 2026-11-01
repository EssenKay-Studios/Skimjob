// Scheduler: turns the game state into wall-clock deadlines and sends each one
// to the engine when it falls due. design §4.1, §11.1; docs/m2-plan.md M2-4
//
// - After every change (inside the game's lock) `reconcile` works out which
//   deadlines the state calls for (`planDeadlines`, one rule per deadline
//   kind) and makes the `deadlines` table match: new ones are inserted with
//   their due time, ones the game has moved past are deleted, and the rest
//   keep the due time they were given. So a restart changes nothing, and a
//   fired deadline is gone once its change is stored.
// - While a meeting (or the Muscle's window after it) is open, pausable
//   deadlines (the round, an emergency's notice) stop: `paused_at` is set,
//   and when the meeting is over their due time moves on by the pause.
// - `tick` (every TICK_MS in main.ts) sends due deadlines, oldest first,
//   through `live.system`, so bots act and views go out as for any change.
// - The engine refuses a deadline that isn't pending (rounds are named), so
//   even a stale row can't resolve anything twice.
import type { Deadline, GameState, SystemCommand } from "@skimjob/engine";
import type { FastifyBaseLogger } from "fastify";
import type { Clock } from "./clock";
import type { Db } from "./db";
import type { SessionLength } from "./settings";
import { TIMINGS, type Timing } from "./timing";

export interface PlannedDeadline {
  /** Unique per game and never reused once fired, e.g. `round:3`, `openMeeting:act-1`. */
  readonly key: string;
  readonly command: SystemCommand;
  /** When it falls due, if it is new now (an existing row keeps its own). */
  readonly dueAt: number;
  /** Stops while a meeting is open (design §4.1: rounds are paused during a vote). */
  readonly pausable: boolean;
}

/** A vote window, or the Muscle's window after one, is open. design §4.1 */
export const meetingOpen = (s: GameState) => s.phase.kind === "meeting" || s.phase.kind === "shakedownPending";

const advance = (deadline: Deadline): SystemCommand => ({ type: "advance", deadline });

/** Strict ISO 8601 with a zone (Date.parse alone reads "act-1" as a date in 2001). */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
/** A slot's time in ms, or NaN if it isn't an ISO time (the engine's slots are opaque labels). */
export const slotTime = (slot: string) => (ISO_TIME.test(slot) ? Date.parse(slot) : NaN);

type Rule = (s: GameState, t: Timing, now: number) => readonly PlannedDeadline[];

/**
 * One rule per deadline kind; the mapped type makes a new engine `Deadline`
 * kind fail typecheck until it has a rule here.
 *
 * TODO(PR #21): the alibi phase adds `Deadline` kind "alibis". Its entry:
 *   alibis: (s, t, now) => s.phase.kind === "alibis"
 *     ? [{ key: `alibis:${s.phase.round}`, command: advance({ kind: "alibis", round: s.phase.round }), dueAt: now + t.alibiMs, pausable: true }]
 *     : [],
 * plus `alibiMs` in each TIMINGS preset (and an alibi-phase round kept paused in `round` below).
 */
export const DEADLINE_RULES: { readonly [K in Deadline["kind"] | "scheduleMeeting"]: Rule } = {
  // The round being planned; also while an emergency meeting interrupts it (paused). design §5, §4.1
  round: (s, t, now) => {
    const round = s.phase.kind === "planning" ? s.phase.round : meetingOpen(s) && s.round > s.resolvedRound ? s.round : 0;
    return round > 0 ? [{ key: `round:${round}`, command: advance({ kind: "round", round }), dueAt: now + t.roundMs, pausable: true }] : [];
  },
  // Nobody locked a slot by the act deadline (its last round resolving): the server picks one. design §11.1
  scheduleMeeting: (s, t, now) =>
    s.phase.kind === "awaitingMeeting" && !s.scheduledMeeting
      ? [{ key: `scheduleMeeting:act-${s.phase.act}`, command: { type: "scheduleMeeting", act: s.phase.act, slot: new Date(now + t.meetingLeadMs).toISOString() }, dueAt: now, pausable: false }]
      : [],
  // An emergency after its notice; the act's meeting at its slot, once its last round has resolved and
  // no other meeting is open (so it is sent again after one closes). design §11.1
  openMeeting: (s, t, now) => {
    const out: PlannedDeadline[] = [];
    if (s.pendingEmergency) {
      const meetingId = s.pendingEmergency.meetingId;
      out.push({ key: `openMeeting:${meetingId}`, command: advance({ kind: "openMeeting", meetingId }), dueAt: now + t.emergencyNoticeMs, pausable: true });
    }
    if (s.phase.kind === "awaitingMeeting" && s.scheduledMeeting) {
      const { meetingId, slot } = s.scheduledMeeting;
      const at = slotTime(slot);
      const dueAt = t.autoMeetings || !Number.isFinite(at) ? now : Math.max(now, at);
      out.push({ key: `openMeeting:${meetingId}`, command: advance({ kind: "openMeeting", meetingId }), dueAt, pausable: false });
    }
    return out;
  },
  closeMeeting: (s, t, now) =>
    s.phase.kind === "meeting"
      ? [{ key: `closeMeeting:${s.phase.meetingId}`, command: advance({ kind: "closeMeeting", meetingId: s.phase.meetingId }), dueAt: now + t.meetingMs, pausable: false }]
      : [],
  // Always the full window: it is set once, here, and a cancel doesn't touch it. design §8, §11.3
  resolveShakedown: (s, t, now) =>
    s.phase.kind === "shakedownPending"
      ? [{ key: `resolveShakedown:${s.phase.meetingId}`, command: advance({ kind: "resolveShakedown", meetingId: s.phase.meetingId }), dueAt: now + t.shakedownWindowMs, pausable: false }]
      : [],
};

/** Every deadline the state calls for. An ended game has none. */
export function planDeadlines(s: GameState, t: Timing, now: number): PlannedDeadline[] {
  if (s.phase.kind === "ended") return [];
  return Object.values(DEADLINE_RULES).flatMap((rule) => rule(s, t, now));
}

export interface Scheduler {
  /** Makes the game's `deadlines` rows match its state. Call inside the game's lock, after every change. */
  reconcile(gameId: string, state: GameState): Promise<void>;
  /** Sends every due deadline (oldest first). Returns how many were sent. */
  tick(): Promise<number>;
  start(intervalMs: number): void;
  stop(): void;
}

/** Deadlines sent per tick at most (a few fall due together at an act's end). */
const MAX_PER_TICK = 100;

interface Row {
  key: string;
  paused: boolean;
}

export function createScheduler(deps: {
  readonly db: Db;
  readonly clock: Clock;
  readonly log: FastifyBaseLogger;
  readonly system: (gameId: string, command: SystemCommand) => Promise<unknown>;
}): Scheduler {
  const { db, clock, log } = deps;
  const timings = new Map<string, Timing>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  const timingOf = async (gameId: string): Promise<Timing> => {
    const known = timings.get(gameId);
    if (known) return known;
    const [row] = await db.query<{ length: SessionLength | null }>("select settings->>'sessionLength' as length from games where id = $1", [gameId]);
    const timing = TIMINGS[row?.length ?? "1h"] ?? TIMINGS["1h"];
    timings.set(gameId, timing);
    return timing;
  };

  const scheduler: Scheduler = {
    async reconcile(gameId, state) {
      const now = clock.now();
      const planned = new Map(planDeadlines(state, await timingOf(gameId), now).map((d) => [d.key, d]));
      if (state.phase.kind === "ended") timings.delete(gameId);
      const paused = meetingOpen(state);
      await db.transaction(async (tx) => {
        const rows = await tx.query<Row>("select key, paused_at is not null as paused from deadlines where game_id = $1", [gameId]);
        const have = new Set(rows.map((r) => r.key));
        for (const row of rows) {
          const want = planned.get(row.key);
          if (!want) {
            await tx.query("delete from deadlines where game_id = $1 and key = $2", [gameId, row.key]);
          } else if (want.pausable && paused && !row.paused) {
            await tx.query("update deadlines set paused_at = to_timestamp($3::float8 / 1000) where game_id = $1 and key = $2", [gameId, row.key, now]);
          } else if (!paused && row.paused) {
            await tx.query(
              "update deadlines set due_at = due_at + (to_timestamp($3::float8 / 1000) - paused_at), paused_at = null where game_id = $1 and key = $2",
              [gameId, row.key, now],
            );
          }
        }
        for (const d of planned.values()) {
          if (have.has(d.key)) continue;
          await tx.query(
            "insert into deadlines (game_id, key, due_at, command, paused_at) values ($1, $2, to_timestamp($3::float8 / 1000), $4::json, $5)",
            [gameId, d.key, d.dueAt, JSON.stringify(d.command), d.pausable && paused ? new Date(now).toISOString() : null],
          );
        }
      });
    },

    async tick() {
      if (ticking) return 0;
      ticking = true;
      let sent = 0;
      try {
        for (let i = 0; i < MAX_PER_TICK; i++) {
          const [row] = await db.query<{ game_id: string; key: string; command: SystemCommand }>(
            `select game_id, key, command from deadlines
             where paused_at is null and due_at <= to_timestamp($1::float8 / 1000)
             order by due_at, game_id, key limit 1`,
            [clock.now()],
          );
          if (!row) break;
          try {
            await deps.system(row.game_id, row.command);
            sent++;
          } catch (err) {
            // Not pending any more (or the game is gone): drop it, or it would be retried forever.
            log.error({ err, gameId: row.game_id, key: row.key }, "deadline refused; dropped");
            await db.query("delete from deadlines where game_id = $1 and key = $2", [row.game_id, row.key]);
          }
        }
      } catch (err) {
        log.error({ err }, "scheduler tick failed");
      } finally {
        ticking = false;
      }
      return sent;
    },

    start(intervalMs) {
      if (timer || !(intervalMs > 0)) return;
      timer = setInterval(() => void scheduler.tick(), intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
  return scheduler;
}
