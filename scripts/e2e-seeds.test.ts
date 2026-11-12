import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../apps/web/e2e/", import.meta.url);
const specs = readdirSync(dir).filter((f) => f.endsWith(".spec.ts"));

describe("e2e specs seed every game", () => {
  it("never post /start with an empty body (startGame seeds by default)", () => {
    const bad = specs.filter((f) => /\/start`,\s*\{\s*data:\s*\{\s*\}/.test(readFileSync(new URL(f, dir), "utf8")));
    expect(bad).toEqual([]);
  });
  it("never leave a sleep unexplained", () => {
    const bad = specs.flatMap((f) => readFileSync(new URL(f, dir), "utf8").split("\n").filter((l) => /waitForTimeout\(/.test(l) && !/\/\/ sleep:/.test(l)).map((l) => `${f}: ${l.trim()}`));
    expect(bad).toEqual([]);
  });
});
