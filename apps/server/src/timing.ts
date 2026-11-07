// Elastic timing: what each session-length preset means in wall time. These
// are the server's numbers (the engine has no clock), all in one place.
// design §17; docs/m2-plan.md M2-4
import { BANK_JOB } from "@skimjob/content";
import type { SessionLength } from "./settings";

export interface Timing {
  /** Planning time per round, from the moment the round starts: the session length ÷ the round cap. design §17.1 */
  readonly roundMs: number;
  /**
   * Once the whole crew has locked in a move, the round resolves this long
   * after the last lock-in (or at its deadline, if that comes first), so the
   * last player can still change. A change during it doesn't restart it.
   * design §17.3 (owner, 6 Nov) [tunable].
   */
  readonly lockInGraceMs: number;
  /** The alibi window after each round resolves, before the next round's planning. design §5.4 */
  readonly alibiMs: number;
  /** A vote window (regular or emergency meeting). */
  readonly meetingMs: number;
  /** An emergency meeting's notice period, from the call to the window opening. */
  readonly emergencyNoticeMs: number;
  /**
   * The shakedown window (the Shield's). Always runs its full length, cancel or not:
   * ending early would show that someone cancelled (STATUS, PR #12 review).
   */
  readonly shakedownWindowMs: number;
  /**
   * Auto-scheduled meetings open as soon as the act's last round resolves,
   * whatever slot was locked. Group-scheduled ones open at the locked slot
   * (an ISO time) or, if nobody locked one, `meetingLeadMs` after the act's
   * last round resolves (the server picks the slot then).
   */
  readonly autoMeetings: boolean;
  readonly meetingLeadMs: number;
  /**
   * How much the host's "extend" adds to the current round's planning, alibi
   * window or meeting, each time (M2-13, design §15). Provisional numbers.
   */
  readonly extendMs: number;
}

const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;

/** design §17.1: the server divides the host's session length by the round cap (§6.2) to get the round deadline. */
const round = (session: number): number => session / BANK_JOB.roundCap;

/** design §17.1 table and §17.3 grace. "15m" is for playtests and tests. */
export const TIMINGS: { readonly [K in SessionLength]: Timing } = {
  "15m": { roundMs: round(15 * MIN), lockInGraceMs: 5 * S, alibiMs: 15 * S, meetingMs: 2 * MIN, emergencyNoticeMs: 20 * S, shakedownWindowMs: 15 * S, autoMeetings: true, meetingLeadMs: 0, extendMs: 20 * S },
  "1h": { roundMs: round(1 * H), lockInGraceMs: 10 * S, alibiMs: 30 * S, meetingMs: 3 * MIN, emergencyNoticeMs: 1 * MIN, shakedownWindowMs: 30 * S, autoMeetings: true, meetingLeadMs: 0, extendMs: 2 * MIN },
  "3h": { roundMs: round(3 * H), lockInGraceMs: 30 * S, alibiMs: 1 * MIN, meetingMs: 5 * MIN, emergencyNoticeMs: 5 * MIN, shakedownWindowMs: 1 * MIN, autoMeetings: true, meetingLeadMs: 0, extendMs: 5 * MIN },
  "1d": { roundMs: round(24 * H), lockInGraceMs: 2 * MIN, alibiMs: 15 * MIN, meetingMs: 10 * MIN, emergencyNoticeMs: 30 * MIN, shakedownWindowMs: 5 * MIN, autoMeetings: false, meetingLeadMs: 1 * H, extendMs: 30 * MIN },
  "3d": { roundMs: round(72 * H), lockInGraceMs: 5 * MIN, alibiMs: 20 * MIN, meetingMs: 20 * MIN, emergencyNoticeMs: 1 * H, shakedownWindowMs: 10 * MIN, autoMeetings: false, meetingLeadMs: 2 * H, extendMs: 1 * H },
  "1w": { roundMs: round(168 * H), lockInGraceMs: 5 * MIN, alibiMs: 1 * H, meetingMs: 20 * MIN, emergencyNoticeMs: 2 * H, shakedownWindowMs: 10 * MIN, autoMeetings: false, meetingLeadMs: 2 * H, extendMs: 2 * H },
};

/** `t` with every wall time multiplied by `k` (TIME_SCALE, config.ts): fast dev and E2E games. */
export function scaleTiming(t: Timing, k: number): Timing {
  if (k === 1) return t;
  const ms = (x: number) => Math.max(1, Math.round(x * k));
  return {
    ...t,
    roundMs: ms(t.roundMs),
    lockInGraceMs: ms(t.lockInGraceMs),
    alibiMs: ms(t.alibiMs),
    meetingMs: ms(t.meetingMs),
    emergencyNoticeMs: ms(t.emergencyNoticeMs),
    shakedownWindowMs: ms(t.shakedownWindowMs),
    meetingLeadMs: t.meetingLeadMs === 0 ? 0 : ms(t.meetingLeadMs),
    extendMs: ms(t.extendMs),
  };
}

/** How often the scheduler looks for due deadlines (main.ts). */
export const TICK_MS = 1000;

/**
 * The tick for a TIME_SCALE (dev and E2E only; always 1 in production): it
 * shrinks with the deadlines, down to 100 ms, so a scaled-down alibi window
 * isn't swallowed by a whole-second tick.
 */
export const tickFor = (timeScale: number): number => Math.max(100, Math.round(TICK_MS * Math.min(1, timeScale)));
