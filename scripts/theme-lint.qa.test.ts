import { describe, expect, it } from "vitest";
import { check, violations } from "./theme-lint.mjs";

// QA #161: edge cases of the theme-token lint (CLAUDE.md "UI rules": colours, fonts, shadows and radii
// come from theme.css tokens).
const css = (decls: string) => violations("apps/web/src/screens/qa.css", `.qa { ${decls} }`);
const tsx = (src: string) => violations("apps/web/src/screens/Qa.tsx", src);

describe("theme-token lint, QA edge cases", () => {
  it("accepts token shorthands, mixed keywords and tokens, and every radius longhand as a token", () => {
    expect(css("font: 600 1rem/1.2 var(--font-hand);")).toBe(0);
    expect(css("box-shadow: var(--shadow-card), var(--shadow-lift);")).toBe(0);
    expect(css("border-radius: 0 0 var(--radius-tab) var(--radius-tab); border-bottom-right-radius: var(--radius-card);")).toBe(0);
    expect(css("text-shadow: none; box-shadow: initial; border-radius: unset;")).toBe(0);
    expect(css("fill: url(#hatch); stroke: var(--ink);")).toBe(0);
  });

  it("counts one violation per declaration, however many raw values it holds", () => {
    expect(css("border-radius: 10px 12px 9px 11px;")).toBe(1);
    expect(css("border-radius: var(--radius-card) 4px;")).toBe(1);
    expect(css("border-bottom-right-radius: 4px; box-shadow: var(--shadow-card), 0 0 2px var(--ink);")).toBe(2);
    expect(css("background: #fff linear-gradient(#000, #111);")).toBe(1);
  });

  it("flags every colour function, upper-case hex and alpha hex, in CSS and in TS", () => {
    for (const v of ["#ABC", "#2a23201f", "rgba(0,0,0,.5)", "hsla(1 2% 3%)", "hwb(1 2% 3%)", "lab(1 2 3)", "lch(1 2 3)", "oklab(1 2 3)", "oklch(1 2 3)"]) {
      expect(css(`color: ${v};`), v).toBe(1);
      expect(tsx(`const c = "${v}";`), v).toBe(1);
    }
  });

  it("flags font stacks that are not a --font-* token", () => {
    expect(css("font-family: var(--ink);")).toBe(1);
    expect(css("font-family: var(--font-hand), sans-serif;")).toBe(1);
    expect(css("font: 12px Menlo;")).toBe(1);
  });

  it("skips comment lines and trailing comments in TS but not colours before the comment", () => {
    expect(tsx("// #fff\n * rgb(1 2 3)\n/* #000 */\nconst a = 1;")).toBe(0);
    expect(tsx('const a = "#fff"; // #000')).toBe(1);
  });

  // QA #190: named colours, inline style props and trailing comments.
  it("flags named colours in any case and inside shadows, but not colour keywords, tokens or url fragments", () => {
    expect(css("color: RED; box-shadow: 0 0 2px white;")).toBe(2);
    expect(css("color: currentColor; fill: transparent; stroke: url(#red); background: var(--white);")).toBe(0);
    expect(tsx('<stop stopColor="white" />; <path fill="currentColor" stroke="url(#red)" />')).toBe(1);
    expect(tsx('const a = <i style={{ color: "var(--red)", outlineColor: "Navy" }} />;')).toBe(1);
  });

  it("checks inline style props in .ts too and treats tokens and zero as clean", () => {
    const ts = (s: string) => violations("apps/web/src/screens/qa.ts", `export const s = { ${s} };`);
    expect(ts('font: "600 1rem/1.2 var(--font-hand)", borderRadius: "0", textShadow: "none", fontFamily: "inherit"')).toBe(0);
    expect(ts('fontFamily: "var(--font-hand), sans-serif"')).toBe(1);
    expect(ts("borderRadius: `${r}px`")).toBe(1);
    expect(ts('borderBottomRightRadius: 4, boxShadow: "0 0 2px red"')).toBe(2);
  });

  it("ignores colours in block and trailing comments but keeps those in the code before them", () => {
    expect(tsx('/* fill="red"\n   #fff */\nconst a = 1; // fill="red" #000')).toBe(0);
    expect(tsx('const a = <path fill="red" />; // fill="blue" #000')).toBe(1);
    expect(tsx('const u = "http://x.test/#abc"; // #fff')).toBe(1);
  });

  it("fails a new file at its first violation and names the file and the allowance", () => {
    expect(check({ "apps/web/src/screens/new.css": 1 }, {})).toEqual([
      "apps/web/src/screens/new.css: 1 raw colour/font/shadow/radius value(s), allowed 0. Use a theme.css token (add one there if none fits).",
    ]);
    expect(check({ "a.css": 3 }, { "a.css": 3 })).toEqual([]);
    expect(check({ "a.css": 4 }, { "a.css": 3 })).toHaveLength(1);
  });

  // QA #168: the stale-baseline check names the file, its allowance and its real count (0 when it is clean).
  it("reports an over-count and a stale entry together, and a cleaned-up file as now 0", () => {
    expect(check({ "a.css": 4 }, { "a.css": 3, "b.css": 2, "gone.css": 1 })).toEqual([
      "a.css: 4 raw colour/font/shadow/radius value(s), allowed 3. Use a theme.css token (add one there if none fits).",
      "b.css: baseline allows 2 but it now has 0. Lower the baseline: run `node scripts/theme-lint.mjs --update` and commit it.",
      "gone.css: baseline allows 1 but it now has 0. Lower the baseline: run `node scripts/theme-lint.mjs --update` and commit it.",
    ]);
    expect(check({ "a.css": 1 }, { "a.css": 0 })).toHaveLength(1);
  });
});
