// Seeded RNG. design §17.2 ("Deterministic"), CLAUDE.md "Engine rules"
import { describe, expect, it } from "vitest";
import { nextUint32, pick, randomInt, seedRng, shuffle } from "./rng";
import type { RngState } from "./types";

function draws(rng: RngState, count: number): number[] {
  const out: number[] = [];
  let state = rng;
  for (let i = 0; i < count; i++) {
    const d = nextUint32(state);
    out.push(d.value);
    state = d.rng;
  }
  return out;
}

describe("seeded RNG — design §17.2", () => {
  it("golden values: sfc32 seeded by cyrb128 (changing these breaks old logs)", () => {
    // Cross-checked against the reference JS implementation of sfc32/cyrb128.
    const rng = seedRng("skimjob");
    expect(rng.words).toEqual([1589528425, 3538325204, 1437622727, 808111518]);
    expect(draws(rng, 5)).toEqual([1640997851, 99498801, 2750082311, 4207829896, 419115506]);
  });

  it("same seed, same sequence; different seed, different sequence", () => {
    expect(draws(seedRng("a"), 20)).toEqual(draws(seedRng("a"), 20));
    expect(draws(seedRng("a"), 20)).not.toEqual(draws(seedRng("b"), 20));
  });

  it("is pure: drawing never mutates the input state", () => {
    const rng = seedRng("pure");
    const before = [...rng.words];
    nextUint32(rng);
    randomInt(rng, 7);
    shuffle(rng, [1, 2, 3, 4]);
    expect(rng.words).toEqual(before);
  });

  it("state is four unsigned 32-bit integers that survive JSON", () => {
    let rng = seedRng("");
    for (let i = 0; i < 1000; i++) {
      rng = nextUint32(rng).rng;
      expect(rng.words).toHaveLength(4);
      for (const w of rng.words) expect(Number.isInteger(w) && w >= 0 && w < 2 ** 32).toBe(true);
    }
    const copy = JSON.parse(JSON.stringify(rng)) as RngState;
    expect(draws(copy, 10)).toEqual(draws(rng, 10));
  });

  it("rejects a state that isn't four words (e.g. before rngSeeded)", () => {
    expect(() => nextUint32({ words: [] })).toThrow();
    expect(() => nextUint32({ words: [1, 2, 3] })).toThrow();
  });

  it("randomInt stays in range and is roughly uniform", () => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    let rng = seedRng("uniform");
    for (let i = 0; i < 70_000; i++) {
      const d = randomInt(rng, 7);
      rng = d.rng;
      counts[d.value]!++;
    }
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500);
    expect(randomInt(rng, 1).value).toBe(0);
    expect(() => randomInt(rng, 0)).toThrow();
    expect(() => randomInt(rng, 2.5)).toThrow();
  });

  it("shuffle returns a permutation and leaves the input alone", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    const out = shuffle(seedRng("shuffle"), items).value;
    expect([...out].sort()).toEqual(items);
    expect(items).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("pick returns a list element and rejects an empty list", () => {
    expect(["x", "y", "z"]).toContain(pick(seedRng("p"), ["x", "y", "z"]).value);
    expect(() => pick(seedRng("p"), [])).toThrow();
  });
});
