import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BANK_JOB } from "@skimjob/content";
import { AlarmBell, bellBulbs, bellLabel, WantedStars } from "./Bell";

const { bulbs, bustStars } = BANK_JOB.alarm;
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

// design §5.1, §5.2: a bell has the content's bulbs; rings light them, your grab previews the next ones.
describe("alarm bell", () => {
  it("has the bulbs from content, lit from olive up to red", () => {
    expect(bellBulbs(bulbs, 0)).toEqual(Array(bulbs).fill("off"));
    expect(bellBulbs(4, 4)).toEqual(["l1", "l2", "l3", "l4"]);
    expect(bellBulbs(4, 2)).toEqual(["l1", "l2", "off", "off"]);
    // The ramp spreads over a tuned bulb count and always ends on the last colour.
    expect(bellBulbs(6, 6).at(-1)).toBe("l4");
    expect(bellBulbs(2, 2)).toEqual(["l2", "l4"]);
  });

  it("previews the bulbs your grab would add after the lit ones, never past the last bulb", () => {
    expect(bellBulbs(4, 1, 2)).toEqual(["l1", "pv", "pv", "off"]);
    expect(bellBulbs(4, 3, 3)).toEqual(["l1", "l2", "l3", "pv"]);
    expect(bellLabel({ bulbs: 4, lit: 3, preview: 3 })).toBe("Bell: 3 of 4 lit, your grab adds 1");
  });

  it("shows '?' on every bulb of a hidden bell, whatever is lit", () => {
    expect(bellBulbs(4, 3, 1, true)).toEqual(["q", "q", "q", "q"]);
    const out = html(createElement(AlarmBell, { bulbs, lit: 0, hidden: true }));
    expect(out).toContain('aria-label="Bell: hidden"');
    expect(out).toContain(">?<");
    expect(out.match(/bulb--q/g)).toHaveLength(bulbs);
  });

  it("renders lit, preview, empty and narrow states with a spoken name", () => {
    const lit = html(createElement(AlarmBell, { bulbs, lit: 2 }));
    expect(lit).toContain(`aria-label="Bell: 2 of ${bulbs} lit"`);
    expect(lit.match(/bulb--l\d/g)).toHaveLength(2);
    expect(lit.match(/<i /g)).toHaveLength(bulbs);
    const preview = html(createElement(AlarmBell, { bulbs, lit: 1, preview: 2 }));
    expect(preview.match(/bulb--pv/g)).toHaveLength(2);
    expect(preview).toContain("your grab adds 2");
    expect(html(createElement(AlarmBell, { bulbs, lit: 0 }))).not.toMatch(/bulb--(l\d|pv|q)/);
    expect(html(createElement(AlarmBell, { bulbs, lit: 0, size: "xs" }))).toContain("bell bell--xs");
  });
});

// design §5.4: one star per raid; the bust line comes from content.
describe("Wanted stars", () => {
  it.each(Array.from({ length: bustStars + 1 }, (_, n) => n))("shows %d of the bust line lit", (n) => {
    const out = html(createElement(WantedStars, { stars: n, max: bustStars }));
    expect(out).toContain(`aria-label="Wanted ${n} of ${bustStars}"`);
    expect(out.match(/<svg/g)).toHaveLength(bustStars);
    expect(out.match(/is-on/g) ?? []).toHaveLength(n);
  });
});

describe("game kit styles", () => {
  const css = readFileSync(new URL("./game-kit.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const bell = readFileSync(new URL("./bell.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("keep the bulbs' colour spring off under reduced motion", () => {
    expect(bell.slice(bell.indexOf("prefers-reduced-motion"))).toMatch(/\.bulb \{\s*transition: none/);
  });

  it("carry no R6 meter bar", () => {
    expect(css).not.toMatch(/\.meter|\.g-meter/);
  });
});
