import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BANK_JOB } from "@skimjob/content";
import { HonestyMeter } from "./HonestyMeter";

const html = (reached: number, taken: number, line = BANK_JOB.honestyLine) => renderToStaticMarkup(createElement(HonestyMeter, { reached, taken, line }));

// design §7.5: the meter's boundaries; the sunk state must match the engine's rule (honesty >= line succeeds, §8.1/§8.4).
describe("honesty meter edges (QA)", () => {
  it("exactly two-thirds is on the line, not sunk", () => {
    const out = html(2, 3);
    expect(out).toContain('aria-valuenow="67"');
    expect(out).not.toContain("is-sunk");
  });

  it("just under the line is sunk even when the rounded percent reads 67", () => {
    const out = html(133, 200); // 66.5% rounds to 67, still below ⅔
    expect(out).toContain('aria-valuenow="67"');
    expect(out).toContain("is-sunk");
  });

  it("nothing reached of coins taken reads empty and sunk", () => {
    const out = html(0, 5);
    expect(out).toContain('aria-valuenow="0"');
    expect(out).toContain("width:0%");
    expect(out).toContain("is-sunk");
  });

  it("all taken coins reached reads full", () => {
    const out = html(40, 40);
    expect(out).toContain('aria-valuenow="100"');
    expect(out).not.toContain("is-sunk");
  });

  it("draws any line from its prop, not a hard-coded two-thirds", () => {
    const out = html(11, 20, 0.5);
    expect(out).toContain("left:50%");
    expect(out).toContain("line 50%");
    expect(out).not.toContain("is-sunk");
    expect(html(9, 20, 0.5)).toContain("is-sunk");
  });

  it("names itself and carries the honesty InfoTip and value text", () => {
    const out = html(9, 12);
    expect(out).toContain('role="meter"');
    expect(out).toContain('aria-label="Honesty"');
    expect(out).toContain("75% of what is taken reached the duffel; the line is ⅔");
    expect(out).toMatch(/info|tip/i);
  });
});
