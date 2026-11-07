import { describe, expect, it } from "vitest";
import { check, violations } from "./theme-lint.mjs";

// CLAUDE.md "UI rules": colours, fonts, shadows and radii come from theme.css tokens.
const css = (decls: string) => violations("apps/web/src/components/x.css", `.x { ${decls} }`);

describe("theme-token lint", () => {
  it("accepts tokens, 0, none, inherit and comments", () => {
    expect(css("border-radius: var(--radius-card); box-shadow: var(--shadow-card), none; text-shadow: 0; font: inherit; font-family: var(--font-hand);")).toBe(0);
    expect(css("color: var(--ink); background: url(#grad) var(--paper); border-radius: 0 var(--radius-tab);")).toBe(0);
    expect(violations("apps/web/src/x.css", "/* #fff rgb(0 0 0) */ .x { color: var(--ink); }")).toBe(0);
  });

  it("flags raw colours, fonts, shadows and radii", () => {
    expect(css("color: #fff;")).toBe(1);
    expect(css("--fill: #2a23201f;")).toBe(1);
    expect(css("background: linear-gradient(red, rgb(0 0 0 / 50%));")).toBe(1);
    expect(css("font-family: Menlo, monospace;")).toBe(1);
    expect(css("font: 600 11px/1.3 ui-monospace;")).toBe(1);
    expect(css("border-radius: 10px; border-top-left-radius: 50%; box-shadow: 0 1px 2px var(--ink); text-shadow: 1px 1px var(--ink);")).toBe(4);
  });

  it("flags raw colours in .ts and .tsx but not in comments", () => {
    expect(violations("apps/web/src/x.tsx", '// "#fff"\n/** rgb(1 2 3) */\nconst a = <path fill="#2a2320" stroke="#fff" />;')).toBe(2);
    expect(violations("apps/web/src/x.tsx", 'const issue = "see #1"; const u = "url(#grad)";')).toBe(0);
  });

  it("fails only a file above its baseline count", () => {
    expect(check({ "a.css": 2, "b.css": 1 }, { "a.css": 2 })).toHaveLength(1);
    expect(check({ "a.css": 1 }, { "a.css": 2 })).toEqual([]);
  });
});
