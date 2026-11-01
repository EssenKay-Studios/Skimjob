import { describe, expect, it } from "vitest";
import { framePaths, hashSeed, rngFrom } from "./sketch";

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

// ui-style §4: every frame uses a deterministic seed, so it looks the same on every render.
describe("framePaths", () => {
  it("is deterministic for the same size and seed", () => {
    const a = framePaths(320, 180, "landing");
    const b = framePaths(320, 180, "landing", {});
    expect(b).toEqual(a);
    // Fresh computation (not just the cache): a new option object with the same values.
    expect(framePaths(320, 180, "landing", { radius: 12, wobble: 1.1, stroke: 1.8 })).toEqual(a);
  });

  it("differs between seeds and sizes", () => {
    expect(framePaths(320, 180, "a").ink).not.toBe(framePaths(320, 180, "b").ink);
    expect(framePaths(320, 180, "a").body).not.toBe(framePaths(321, 180, "a").body);
  });

  it("keeps the outline inside the box, with no NaN", () => {
    for (const [w, h] of [
      [40, 40],
      [140, 46],
      [1120, 640],
      [8, 8],
    ] as const) {
      for (const seed of ["x", 1, "button/primary"]) {
        const p = framePaths(w, h, seed, { radius: 24 });
        for (const d of [p.body, p.ink, p.ghost]) {
          expect(d).not.toMatch(/NaN|Infinity/);
          const ns = numbers(d);
          const xs = ns.filter((_, i) => i % 2 === 0);
          const ys = ns.filter((_, i) => i % 2 === 1);
          expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1);
          expect(Math.max(...xs)).toBeLessThanOrEqual(Math.max(8, w) + 1);
          expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1);
          expect(Math.max(...ys)).toBeLessThanOrEqual(Math.max(8, h) + 1);
        }
      }
    }
  });

  it("draws the ink as two closed rings (outer and inner edge)", () => {
    const { ink, body } = framePaths(200, 100, 7);
    expect(ink.match(/M/g)).toHaveLength(2);
    expect(body.match(/M/g)).toHaveLength(1);
  });
});

describe("rngFrom", () => {
  it("repeats for a seed and stays in [0, 1)", () => {
    const a = rngFrom("s");
    const b = rngFrom("s");
    const xs = Array.from({ length: 200 }, () => a());
    expect(Array.from({ length: 200 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(hashSeed("s")).toBe(hashSeed("s"));
    expect(hashSeed(1)).toBe(hashSeed("1"));
  });
});
