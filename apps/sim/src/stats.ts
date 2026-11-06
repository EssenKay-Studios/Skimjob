// Confidence intervals for the simulator's rates. design §17.4 (the targets
// are rates; a rate from a few hundred games is only good to a few points).
//
// Wilson score interval: unlike the plain "p ± z·√(p(1−p)/n)" it stays inside
// 0..1 and behaves at rates near 0 or 1 and at small n. `successes` may be
// fractional (joint winners share one win), which the formula takes as is.

/** z for a two-sided 95% interval. */
const Z95 = 1.959963984540054;

export interface Interval {
  /** Successes ÷ trials, or null with no trials. */
  readonly rate: number | null;
  readonly lo: number | null;
  readonly hi: number | null;
  /** (hi − lo) ÷ 2; null with no trials. */
  readonly halfWidth: number | null;
  readonly successes: number;
  readonly trials: number;
}

export function wilson(successes: number, trials: number, z: number = Z95): Interval {
  if (trials <= 0) return { rate: null, lo: null, hi: null, halfWidth: null, successes, trials };
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denom;
  const lo = Math.max(0, centre - margin);
  const hi = Math.min(1, centre + margin);
  return { rate: p, lo, hi, halfWidth: (hi - lo) / 2, successes, trials };
}

/** A target band, both ends inclusive; `lo` 0 or `hi` 1 for a one-sided target. */
export interface Band {
  readonly lo: number;
  readonly hi: number;
}

export type Verdict = "pass" | "fail" | "n/a";

export interface CheckResult {
  readonly verdict: Verdict;
  /**
   * True when the whole 95% interval agrees with the verdict (inside the band
   * for a pass, outside it for a fail). False: the estimate is within noise
   * of a bound, so more games could flip it.
   */
  readonly sure: boolean;
}

/** PASS/FAIL on the point estimate, and whether the interval backs it up. */
export function checkBand(iv: Pick<Interval, "rate" | "lo" | "hi">, band: Band): CheckResult {
  if (iv.rate === null || iv.lo === null || iv.hi === null) return { verdict: "n/a", sure: false };
  const inside = iv.rate >= band.lo && iv.rate <= band.hi;
  if (inside) return { verdict: "pass", sure: iv.lo >= band.lo && iv.hi <= band.hi };
  return { verdict: "fail", sure: iv.hi < band.lo || iv.lo > band.hi };
}
