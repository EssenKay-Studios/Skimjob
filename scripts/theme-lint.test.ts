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

  it("flags named colours as colour values", () => {
    expect(css("color: red; background: white; border: 1px solid black;")).toBe(3);
    expect(css("color: transparent; background: var(--red); animation: white-flash 1s;")).toBe(0);
    expect(violations("apps/web/src/x.tsx", 'const a = <path fill="red" style={{ backgroundColor: "white", borderTopColor: "navy" }} />;')).toBe(3);
    expect(violations("apps/web/src/x.tsx", 'const a = <path fill="none" className="red" />;')).toBe(0);
    expect(css("border-left: 2px solid red; text-decoration: underline red;")).toBe(2);
    expect(css("background-image: linear-gradient(red, blue);")).toBe(1);
    expect(violations("apps/web/src/x.tsx", 'const a = <i style={{ borderLeft: "2px solid red" }} />;')).toBe(1);
  });

  it("flags raw inline style radii, shadows and fonts in .tsx", () => {
    const tsx = (s: string) => violations("apps/web/src/x.tsx", `const a = <div style={{ ${s} }} />;`);
    expect(tsx('borderRadius: 9, boxShadow: "0 1px 2px #000", fontFamily: "Comic Sans MS"')).toBe(3);
    expect(tsx('borderTopLeftRadius: "50%", textShadow: "1px 1px var(--ink)"')).toBe(2);
    expect(tsx('borderRadius: "var(--radius-card)", boxShadow: "none", fontFamily: "var(--font-hand)", borderRadius: 0')).toBe(0);
  });

  it("ignores trailing comments in .ts and .tsx", () => {
    expect(violations("apps/web/src/x.ts", "const a = 1; // PR #156\nconst b = 2; /* #fff */")).toBe(0);
    expect(violations("apps/web/src/x.ts", 'const u = "https://x.test/#fff"; const c = "#fff"; // c')).toBe(2);
  });

  it("fails only a file above its baseline count", () => {
    expect(check({ "a.css": 2, "b.css": 1 }, { "a.css": 2 })).toHaveLength(1);
    expect(check({ "a.css": 2 }, { "a.css": 2 })).toEqual([]);
  });

  it("fails a stale baseline: a count that dropped, or a file with no violations left", () => {
    expect(check({ "a.css": 1 }, { "a.css": 2 })).toEqual(["a.css: baseline allows 2 but it now has 1. Lower the baseline: run `node scripts/theme-lint.mjs --update` and commit it."]);
    expect(check({}, { "gone.css": 2 })).toHaveLength(1);
  });
});
