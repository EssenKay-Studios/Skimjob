// Elastic timing: what each session-length preset means in wall time. These
// are the server's numbers (the engine has no clock), all in one place.
// design §4.1, §11.1; docs/m2-plan.md M2-4
import type { SessionLength } from "./settings";

export interface Timing {
  /** Planning time per round (9 rounds a game), from the moment the round starts. */
  readonly roundMs: number;
  /** The alibi window after each round resolves, before the next round's planning. design §5.4 */
  readonly alibiMs: number;
  /** A vote window (regular or emergency meeting). */
  readonly meetingMs: number;
  /** An emergency meeting's notice period, from the call to the window opening. */
  readonly emergencyNoticeMs: number;
  /**
   * The Muscle's shakedown window. Always runs its full length, cancel or not:
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
}

const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;

/**
 * design §4.1 table. "quick" is for playtests and tests: 9 × (45 s round +
 * 15 s alibis) plus three 2-minute meetings is 15 minutes.
 */
export const TIMINGS: { readonly [K in SessionLength]: Timing } = {
  quick: { roundMs: 45 * S, alibiMs: 15 * S, meetingMs: 2 * MIN, emergencyNoticeMs: 20 * S, shakedownWindowMs: 15 * S, autoMeetings: true, meetingLeadMs: 0 },
  "1h": { roundMs: 5 * MIN, alibiMs: 30 * S, meetingMs: 3 * MIN, emergencyNoticeMs: 1 * MIN, shakedownWindowMs: 30 * S, autoMeetings: true, meetingLeadMs: 0 },
  "3h": { roundMs: 17 * MIN, alibiMs: 1 * MIN, meetingMs: 5 * MIN, emergencyNoticeMs: 5 * MIN, shakedownWindowMs: 1 * MIN, autoMeetings: true, meetingLeadMs: 0 },
  "1d": { roundMs: 2.25 * H, alibiMs: 15 * MIN, meetingMs: 10 * MIN, emergencyNoticeMs: 30 * MIN, shakedownWindowMs: 5 * MIN, autoMeetings: false, meetingLeadMs: 1 * H },
  "3d": { roundMs: 7.5 * H, alibiMs: 20 * MIN, meetingMs: 20 * MIN, emergencyNoticeMs: 1 * H, shakedownWindowMs: 10 * MIN, autoMeetings: false, meetingLeadMs: 2 * H },
  "1w": { roundMs: 17 * H, alibiMs: 1 * H, meetingMs: 20 * MIN, emergencyNoticeMs: 2 * H, shakedownWindowMs: 10 * MIN, autoMeetings: false, meetingLeadMs: 2 * H },
};

/** `t` with every wall time multiplied by `k` (TIME_SCALE, config.ts): fast dev and E2E games. */
export function scaleTiming(t: Timing, k: number): Timing {
  if (k === 1) return t;
  const ms = (x: number) => Math.max(1, Math.round(x * k));
  return {
    ...t,
    roundMs: ms(t.roundMs),
    alibiMs: ms(t.alibiMs),
    meetingMs: ms(t.meetingMs),
    emergencyNoticeMs: ms(t.emergencyNoticeMs),
    shakedownWindowMs: ms(t.shakedownWindowMs),
    meetingLeadMs: t.meetingLeadMs === 0 ? 0 : ms(t.meetingLeadMs),
  };
}

/** How often the scheduler looks for due deadlines (main.ts). */
export const TICK_MS = 1000;
