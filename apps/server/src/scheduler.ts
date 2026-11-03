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
//   deadlines (the round, the alibi window, an emergency's notice) stop: `paused_at` is set,
//   and when the meeting is over their due time moves on by the pause.
// - Hidden police moments (`police:<n>`, extension.md "Police activity") run
//   on game time: they also stop while the act's meeting waits to open, and
//   they never appear in `timers`, so clients can't see or time them.
// - A host pause (M2-13, `games.paused_at`) stops every row, police moments
//   and `roundEarly` included; on resume each moves on by its own pause. A row
//   a meeting had already paused keeps its earlier `paused_at`, so it still
//   moves on by the whole stop. The host's extend moves the current phase's
//   rows on (`extendKeys`), never a police moment: game time runs on through
//   the extra planning time, as through any round.
// - `tick` (every TICK_MS in main.ts) sends due deadlines, oldest first,
//   through `live.system`, so bots act and views go out as for any change.
//   Games run side by side: a game whose send is slow (or still running from
//   the last tick) never holds up another's deadlines.
// - The engine refuses a deadline that isn't pending (rounds are named), so
//   even a stale row can't resolve anything twice. A refused row is dropped
//   and the game re-planned; any other failure keeps the row for a retry.
import { lockedIn, type Deadline, type GameState, type SystemCommand } from "@skimjob/engine";
import type { FastifyBaseLogger } from "fastify";
import type { Clock } from "./clock";
import type { Db } from "./db";
import { SystemRefused } from "./live";
import type { SessionLength } from "./settings";
import { scaleTiming, TIMINGS, type Timing } from "./timing";

export interface PlannedDeadline {
  /** Unique per game and never reused once fired, e.g. `round:3`, `openMeeting:act-1`. */
  readonly key: string;
  readonly command: SystemCommand;
  /** When it falls due, if it is new now (an existing row keeps its own). */
  readonly dueAt: number;
  /** Stops while a meeting is open (design §4.1: rounds are paused during a vote). */
  readonly pausable: boolean;
  /**
   * Runs on game time (police moments): stops too while the act's meeting
   * waits to open, and is hidden from clients. extension.md "Police activity"
   */
  readonly gameTime?: true;
}

/** A vote window, or the Muscle's window after one, is open. design §4.1 */
export const meetingOpen = (s: GameState) => s.phase.kind === "meeting" || s.phase.kind === "shakedownPending";

/** Game time is frozen: a meeting is open or the act's meeting waits to open. extension.md "Police activity" */
export const gameTimeFrozen = (s: GameState) => meetingOpen(s) || s.phase.kind === "awaitingMeeting";

/** Police moments' deadline keys. They are never sent to clients. extension.md "Police activity" (no leak) */
export const POLICE_KEY_PREFIX = "police:";
export const isHiddenDeadline = (key: string) => key.startsWith(POLICE_KEY_PREFIX);

const advance = (deadline: Deadline): SystemCommand => ({ type: "advance", deadline });

/**
 * The deadlines the host's extend moves on (M2-13, design §15): the round being
 * planned (with its early end, set once everyone locked in), the alibi window
 * or the open vote window. None in other phases. Never a police moment.
 */
export function extendKeys(s: GameState): readonly string[] {
  switch (s.phase.kind) {
    case "planning":
      return [`round:${s.phase.round}`, `roundEarly:${s.phase.round}`];
    case "alibis":
      return [`alibis:${s.phase.round}`];
    case "meeting":
      return [`closeMeeting:${s.phase.meetingId}`];
    default:
      return [];
  }
}

/** Every seat has locked in a move for the round being planned (public: `moveLocked`, design §5.1). */
export const allLockedIn = (s: GameState): boolean => s.playerOrder.length > 0 && lockedIn(s).length === s.playerOrder.length;

/** Strict ISO 8601 with a zone (Date.parse alone reads "act-1" as a date in 2001). */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
/** A slot's time in ms, or NaN if it isn't an ISO time (the engine's slots are opaque labels). */
export const slotTime = (slot: string) => (ISO_TIME.test(slot) ? Date.parse(slot) : NaN);

type Rule = (s: GameState, t: Timing, now: number) => readonly PlannedDeadline[];

/**
 * One rule per deadline kind; the mapped type makes a new engine `Deadline`
 * kind fail typecheck until it has a rule here.
 */
export const DEADLINE_RULES: { readonly [K in Deadline["kind"] | "scheduleMeeting"]: Rule } = {
  // The round being planned; also while an emergency meeting interrupts it (paused). design §5, §4.1
  // Once every seat has locked in, `roundEarly:<n>` resolves it `lockInGraceMs` later (owner decision,
  // 2 Nov): set once, so a change during the grace doesn't restart it; whichever row falls due first
  // resolves the round, and the other one is dropped with it. design §4.1, §5.1
  round: (s, t, now) => {
    const round = s.phase.kind === "planning" ? s.phase.round : meetingOpen(s) && s.round > s.resolvedRound ? s.round : 0;
    if (round === 0) return [];
    const command = advance({ kind: "round", round });
    const out: PlannedDeadline[] = [{ key: `round:${round}`, command, dueAt: now + t.roundMs, pausable: true }];
    if (allLockedIn(s)) out.push({ key: `roundEarly:${round}`, command, dueAt: now + t.lockInGraceMs, pausable: true });
    return out;
  },
  // The alibi window after a round resolves; paused if an emergency interrupts it. design §5.4
  alibis: (s, t, now) => {
    const round = s.phase.kind === "alibis" ? s.phase.round : meetingOpen(s) && s.alibisOpen ? s.resolvedRound : 0;
    return round > 0 ? [{ key: `alibis:${round}`, command: advance({ kind: "alibis", round }), dueAt: now + t.alibiMs, pausable: true }] : [];
  },
  // Nobody locked a slot by the act deadline (its last round resolving): the server picks one. design §11.1
  // Auto-scheduled presets open it at once whatever the slot, so they name it `act-<n>` (the end of the
  // act; no wall time in the log, so a retried deadline can't change the game); others pick a time.
  scheduleMeeting: (s, t, now) =>
    s.phase.kind === "awaitingMeeting" && !s.scheduledMeeting
      ? [
          {
            key: `scheduleMeeting:act-${s.phase.act}`,
            command: { type: "scheduleMeeting", act: s.phase.act, slot: t.autoMeetings ? `act-${s.phase.act}` : new Date(now + t.meetingLeadMs).toISOString() },
            dueAt: now,
            pausable: false,
          },
        ]
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
  // The next hidden police moment, `gapPermille` thousandths of a round length (planning plus alibi
  // window) after the last one, in game time. Set once when the moment is drawn. extension.md "Police activity"
  policeMoment: (s, t, now) => {
    if (!s.police) return [];
    const { moment, gapPermille } = s.police;
    const dueAt = now + Math.round((gapPermille * (t.roundMs + t.alibiMs)) / 1000);
    return [{ key: `${POLICE_KEY_PREFIX}${moment}`, command: advance({ kind: "policeMoment", moment }), dueAt, pausable: true, gameTime: true }];
  },
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
  /**
   * Moves the current phase's deadlines (`extendKeys`) on by the preset's
   * `extendMs`. Call inside the game's lock, then `reconcile`. Returns the ms
   * added, or null if nothing in this phase can be extended.
   */
  extend(gameId: string, state: GameState): Promise<number | null>;
  /** Forgets the game's cached timing and timers (its session length or rows changed outside `reconcile`). */
  forget(gameId: string): void;
  start(intervalMs: number): void;
  stop(): void;
  /**
   * The game's deadlines as clients may see them (the HUD countdown): every
   * one comes from public state, so none says anything hidden. Oldest first.
   */
  timers(gameId: string): Promise<readonly Timer[]>;
}

/** A deadline for the client: due time in epoch ms; `pausedAt` is set while a meeting pauses it. */
export interface Timer {
  readonly key: string;
  readonly dueAt: number;
  readonly pausedAt: number | null;
}

/** Deadlines sent per game per tick at most (a few fall due together at an act's end). */
const MAX_PER_TICK = 100;
/** Longest wait before retrying a deadline whose send failed (1 s, 2 s, 4 s … up to this). */
export const MAX_BACKOFF_MS = 60_000;

interface Row {
  key: string;
  paused: boolean;
  due: number;
  paused_ms: number | null;
}

const sortTimers = (ts: Timer[]) => ts.sort((a, b) => a.dueAt - b.dueAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/**
 * What `system` answers when, under the game's lock, the deadline turned out not
 * to be due any more: the host paused the game (or a meeting paused the row), it
 * was extended, or it's gone. Nothing was applied; the row stays as it is. M2-13
 */
export const DEADLINE_SKIPPED = "deadline-skipped" as const;

export function createScheduler(deps: {
  readonly db: Db;
  readonly clock: Clock;
  readonly log: FastifyBaseLogger;
  /**
   * Sends deadline `key`'s system command (`live.system`), which first re-checks under the
   * game's lock that the row is still due and nothing is paused (else `DEADLINE_SKIPPED`);
   * throws `SystemRefused` when the engine refuses it.
   */
  readonly system: (gameId: string, command: SystemCommand, key: string) => Promise<unknown>;
  /** Re-runs the game's after-change step (`live.settle`), so `reconcile` re-plans its deadlines. */
  readonly resync: (gameId: string) => Promise<unknown>;
  /** TIME_SCALE (config.ts): multiplies every preset's wall times. Default 1. */
  readonly timeScale?: number;
}): Scheduler {
  const { db, clock, log } = deps;
  const timings = new Map<string, Timing>();
  let timer: ReturnType<typeof setInterval> | null = null;
  /** Games whose deadlines are being sent now: a later tick skips them, not the others. */
  const busy = new Set<string>();
  /** Deadlines whose send failed (not refused): retried from `at`. Memory only; a restart retries at once. */
  const retries = new Map<string, { failures: number; at: number }>();
  /** Each game's deadlines as of its last reconcile (memory only; read from the table after a restart). */
  const known = new Map<string, readonly Timer[]>();

  const timingOf = async (gameId: string): Promise<Timing> => {
    const known = timings.get(gameId);
    if (known) return known;
    const [row] = await db.query<{ length: SessionLength | null }>("select settings->>'sessionLength' as length from games where id = $1", [gameId]);
    const timing = scaleTiming(TIMINGS[row?.length ?? "1h"] ?? TIMINGS["1h"], deps.timeScale ?? 1);
    timings.set(gameId, timing);
    return timing;
  };

  /** Sends the game's due deadlines one by one (oldest first), re-reading after each: one may drop another. */
  const tickGame = async (gameId: string): Promise<number> => {
    if (busy.has(gameId)) return 0;
    busy.add(gameId);
    let sent = 0;
    try {
      for (let i = 0; i < MAX_PER_TICK; i++) {
        const now = clock.now();
        const rows = await db.query<{ game_id: string; key: string; command: SystemCommand }>(
          `select game_id, key, command from deadlines
           where game_id = $1 and paused_at is null and due_at <= to_timestamp($2::float8 / 1000)
           order by due_at, key limit $3`,
          [gameId, now, MAX_PER_TICK],
        );
        const row = rows.find((r) => (retries.get(`${gameId} ${r.key}`)?.at ?? 0) <= now);
        if (!row) break;
        const id = `${gameId} ${row.key}`;
        try {
          // The select ran outside the game's lock: a pause or an extend may have come in since.
          if ((await deps.system(gameId, row.command, row.key)) === DEADLINE_SKIPPED) {
            retries.delete(id);
            break;
          }
          retries.delete(id);
          sent++;
        } catch (err) {
          if (err instanceof SystemRefused) {
            // Stale or duplicate (the game moved on, e.g. a reconcile after it failed): drop it and
            // re-plan from the state, so the game's real next deadline exists.
            retries.delete(id);
            log.warn({ err, gameId, key: row.key }, "deadline refused; dropped");
            await db.query("delete from deadlines where game_id = $1 and key = $2", [gameId, row.key]);
            known.delete(gameId);
            await deps.resync(gameId).catch((e: unknown) => log.error({ err: e, gameId }, "re-planning deadlines failed"));
          } else {
            // A server failure (database, bots): keep the row and try again later, backing off.
            const failures = (retries.get(id)?.failures ?? 0) + 1;
            retries.set(id, { failures, at: now + Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (failures - 1)) });
            log.error({ err, gameId, key: row.key, failures }, "deadline failed; will retry");
          }
        }
      }
    } catch (err) {
      log.error({ err, gameId }, "scheduler tick failed");
    } finally {
      busy.delete(gameId);
    }
    return sent;
  };

  const scheduler: Scheduler = {
    async reconcile(gameId, state) {
      const now = clock.now();
      const planned = new Map(planDeadlines(state, await timingOf(gameId), now).map((d) => [d.key, d]));
      if (state.phase.kind === "ended") timings.delete(gameId);
      const paused = meetingOpen(state);
      const frozen = gameTimeFrozen(state);
      const timers = await db.transaction(async (tx) => {
        // The host's pause stops every row, whatever its kind. M2-13
        const [game] = await tx.query<{ paused: boolean }>("select paused_at is not null as paused from games where id = $1", [gameId]);
        const hostPaused = game?.paused === true;
        const pausedFor = (d: PlannedDeadline | undefined) => hostPaused || (d !== undefined && d.pausable && (d.gameTime ? frozen : paused));
        const rows = await tx.query<Row>(
          `select key, paused_at is not null as paused, (extract(epoch from due_at) * 1000)::float8 as due,
             (extract(epoch from paused_at) * 1000)::float8 as paused_ms
           from deadlines where game_id = $1`,
          [gameId],
        );
        const have = new Set(rows.map((r) => r.key));
        // What the rows will be, for `timers` (so a view push needs no query of its own).
        const after: Timer[] = [];
        for (const row of rows) {
          const want = planned.get(row.key);
          const dueAt = Math.round(Number(row.due));
          const pausedAt = row.paused_ms === null ? null : Math.round(Number(row.paused_ms));
          if (!want) {
            await tx.query("delete from deadlines where game_id = $1 and key = $2", [gameId, row.key]);
          } else if (pausedFor(want) && !row.paused) {
            await tx.query("update deadlines set paused_at = to_timestamp($3::float8 / 1000) where game_id = $1 and key = $2", [gameId, row.key, now]);
            after.push({ key: row.key, dueAt, pausedAt: now });
          } else if (!pausedFor(want) && row.paused) {
            await tx.query(
              "update deadlines set due_at = due_at + (to_timestamp($3::float8 / 1000) - paused_at), paused_at = null where game_id = $1 and key = $2",
              [gameId, row.key, now],
            );
            after.push({ key: row.key, dueAt: dueAt + (now - (pausedAt ?? now)), pausedAt: null });
          } else {
            after.push({ key: row.key, dueAt, pausedAt });
          }
        }
        for (const d of planned.values()) {
          if (have.has(d.key)) continue;
          const pausedAt = pausedFor(d) ? now : null;
          await tx.query(
            "insert into deadlines (game_id, key, due_at, command, paused_at) values ($1, $2, to_timestamp($3::float8 / 1000), $4::json, $5)",
            [gameId, d.key, d.dueAt, JSON.stringify(d.command), pausedAt === null ? null : new Date(now).toISOString()],
          );
          after.push({ key: d.key, dueAt: d.dueAt, pausedAt });
        }
        return after;
      });
      if (state.phase.kind === "ended") known.delete(gameId);
      else known.set(gameId, sortTimers(timers.filter((x) => !isHiddenDeadline(x.key))));
    },

    async tick() {
      let games: string[];
      try {
        const due = await db.query<{ game_id: string }>(
          "select distinct game_id from deadlines where paused_at is null and due_at <= to_timestamp($1::float8 / 1000)",
          [clock.now()],
        );
        games = due.map((r) => r.game_id).filter((g) => !busy.has(g));
      } catch (err) {
        log.error({ err }, "scheduler tick failed");
        return 0;
      }
      const sent = await Promise.all(games.map((g) => tickGame(g)));
      return sent.reduce((a, b) => a + b, 0);
    },

    async extend(gameId, state) {
      const keys = extendKeys(state);
      if (keys.length === 0) return null;
      const ms = (await timingOf(gameId)).extendMs;
      const rows = await db.query<{ key: string }>(
        "update deadlines set due_at = due_at + ($3::float8 / 1000) * interval '1 second' where game_id = $1 and key = any($2::text[]) returning key",
        [gameId, keys, ms],
      );
      if (rows.length === 0) return null;
      known.delete(gameId);
      return ms;
    },

    forget(gameId) {
      timings.delete(gameId);
      known.delete(gameId);
    },

    async timers(gameId) {
      const cached = known.get(gameId);
      if (cached) return cached;
      const rows = await db.query<{ key: string; due: number; paused: number | null }>(
        `select key, (extract(epoch from due_at) * 1000)::float8 as due, (extract(epoch from paused_at) * 1000)::float8 as paused
         from deadlines where game_id = $1 order by due_at, key`,
        [gameId],
      );
      return sortTimers(rows.filter((r) => !isHiddenDeadline(r.key)).map((r) => ({ key: r.key, dueAt: Math.round(Number(r.due)), pausedAt: r.paused === null ? null : Math.round(Number(r.paused)) })));
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
