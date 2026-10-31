// Seeded PRNG for the engine. design §17.2, CLAUDE.md "Deterministic"
//
// Algorithm: sfc32 (Chris Doty-Humphrey's Small Fast Counting generator,
// 128-bit state, passes PractRand), seeded by hashing the seed string with
// cyrb128. Implemented here rather than taken as a dependency
// (docs/decisions.md). All functions are pure: they take an RngState and
// return the next one, so the state can be stored in GameState, serialised
// into the event log and compared.
//
// Changing anything here changes every game's draws, so old logs would no
// longer replay the same way. The golden-value test pins the output.
import type { RngState } from "./types";

/** Number of outputs discarded after seeding, to mix the hashed seed. */
const WARMUP = 12;

/** cyrb128: hash a string into four 32-bit words. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** One sfc32 step. Words are stored as unsigned 32-bit integers. */
export function nextUint32(rng: RngState): { readonly value: number; readonly rng: RngState } {
  const [a0, b0, c0, d0] = rng.words;
  if (rng.words.length !== 4 || a0 === undefined || b0 === undefined || c0 === undefined || d0 === undefined) {
    throw new Error("RngState must have exactly 4 words");
  }
  const t = (((a0 + b0) | 0) + d0) | 0;
  const d = (d0 + 1) | 0;
  const a = b0 ^ (b0 >>> 9);
  const b = (c0 + (c0 << 3)) | 0;
  const c = (((c0 << 21) | (c0 >>> 11)) + t) | 0;
  return { value: t >>> 0, rng: { words: [a >>> 0, b >>> 0, c >>> 0, d >>> 0] } };
}

/** The RNG state for a seed string. Same seed, same state. */
export function seedRng(seed: string): RngState {
  let rng: RngState = { words: cyrb128(seed) };
  for (let i = 0; i < WARMUP; i++) rng = nextUint32(rng).rng;
  return rng;
}

const TWO_32 = 0x1_0000_0000;

/** A uniform integer in [0, n), without modulo bias. */
export function randomInt(rng: RngState, n: number): { readonly value: number; readonly rng: RngState } {
  if (!Number.isInteger(n) || n < 1 || n > TWO_32) throw new Error(`randomInt: bad range ${n}`);
  const limit = TWO_32 - (TWO_32 % n);
  let state = rng;
  for (;;) {
    const draw = nextUint32(state);
    state = draw.rng;
    if (draw.value < limit) return { value: draw.value % n, rng: state };
  }
}

/** A uniformly random element of a non-empty list. */
export function pick<T>(rng: RngState, items: readonly T[]): { readonly value: T; readonly rng: RngState } {
  if (items.length === 0) throw new Error("pick: empty list");
  const { value: i, rng: next } = randomInt(rng, items.length);
  return { value: items[i] as T, rng: next };
}

/** A shuffled copy of `items` (Fisher–Yates). */
export function shuffle<T>(rng: RngState, items: readonly T[]): { readonly value: T[]; readonly rng: RngState } {
  const out = items.slice();
  let state = rng;
  for (let i = out.length - 1; i > 0; i--) {
    const draw = randomInt(state, i + 1);
    state = draw.rng;
    const j = draw.value;
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return { value: out, rng: state };
}
