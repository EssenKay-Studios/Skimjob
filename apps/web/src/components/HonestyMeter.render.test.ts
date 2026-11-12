import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BANK_JOB } from "@skimjob/content";
import { HonestyMeter } from "./HonestyMeter";

const line = BANK_JOB.honestyLine;
const html = (reached: number, taken: number) => renderToStaticMarkup(createElement(HonestyMeter, { reached, taken, line }));

// design §7.5: honesty is a meter against the line, live and public.
describe("honesty meter", () => {
  it("reads full before any coin is taken", () => {
    const out = html(0, 0);
    expect(out).toContain('aria-valuenow="100"');
    expect(out).toContain("width:100%");
    expect(out).not.toContain("is-sunk");
  });

  it("fills to reached over taken and draws the line from content", () => {
    const out = html(9, 12);
    expect(out).toContain('aria-valuenow="75"');
    expect(out).toContain("width:75%");
    expect(out).toContain(`left:${line * 100}%`);
    expect(out).toContain("line ⅔");
  });

  it("is sunk below the line and fine exactly on it", () => {
    expect(html(7, 12)).toContain("is-sunk");
    expect(html(8, 12)).not.toContain("is-sunk");
  });

  it("follows the counts when coins are returned", () => {
    expect(html(6, 12)).toContain('aria-valuenow="50"');
    expect(html(6, 9)).toContain('aria-valuenow="67"');
  });
});
