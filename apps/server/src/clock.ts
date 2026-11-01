// The server owns wall time (the engine has none). Everything that needs "now"
// takes a Clock, so scheduler tests can run on a fake one. docs/m2-plan.md §1
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface FakeClock extends Clock {
  /** Moves time forward by `ms`. */
  advance(ms: number): void;
}

export function fakeClock(start = 0): FakeClock {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      if (!(ms >= 0)) throw new Error("a fake clock only moves forward");
      t += ms;
    },
  };
}
