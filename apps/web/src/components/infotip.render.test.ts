import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// design §15.6, CLAUDE.md "UI rules": the InfoTip's styles use theme.css tokens only, keep a
// 44 px target and switch their motion off under reduced motion.
describe("InfoTip styles", () => {
  const css = readFileSync(new URL("./infotip.css", import.meta.url), "utf8");
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("take radii and shadows from theme.css tokens", () => {
    for (const m of code.matchAll(/(border-radius|box-shadow):\s*([^;]+);/g)) expect(m[2], m[0]).toMatch(/^(var\(--[\w-]+\)|0|none)$/);
  });

  it("use no raw colours or fonts", () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    for (const m of code.matchAll(/font:\s*([^;]+);/g)) expect(m[1], m[0]).toContain("var(--font-");
  });

  it("keep the button and the close button 44 px", () => {
    expect(code.match(/width: 44px;\s*height: 44px;/g)).toHaveLength(2);
  });

  it("stop the animation and the transition under reduced motion", () => {
    const reduced = code.slice(code.indexOf("prefers-reduced-motion"));
    expect(reduced).toMatch(/popover-open[^}]*animation: none/);
    expect(reduced).toMatch(/infotip__i[^}]*transition: none/);
  });
});
