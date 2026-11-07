import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// design §15.6, CLAUDE.md "UI rules": the shell's styles use theme.css tokens only.
describe("game shell and bottom sheet styles", () => {
  const css = readFileSync(new URL("./shell.css", import.meta.url), "utf8");

  it("take radii and shadows from theme.css tokens", () => {
    for (const m of css.matchAll(/(border-radius|box-shadow):\s*([^;]+);/g)) expect(m[2], m[0]).toMatch(/^(var\(--[\w-]+\)|0|none)$/);
  });

  it("use no raw colours", () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
