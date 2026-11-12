import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Issue #283: e2e specs never depend on chance or fixed sleeps.
const dir = "apps/web/e2e";
const specs = readdirSync(dir).filter((f) => f.endsWith(".spec.ts")).map((f) => [f, readFileSync(`${dir}/${f}`, "utf8")] as const);
const lines = (bad: (l: string) => boolean) => specs.flatMap(([f, src]) => src.split("\n").flatMap((l, i) => (bad(l) ? [`${f}:${i + 1}`] : [])));

describe("e2e stability", () => {
  it("starts every game with a seed", () => {
    expect(lines((l) => /\/start`(\)|, \{ data: \{\} \})/.test(l))).toEqual([]);
  });

  it("sleeps only with a reason", () => {
    expect(lines((l) => l.includes("waitForTimeout") && !l.includes("// sleep kept:"))).toEqual([]);
  });
});
