// Render checks for the Grab row and the two bags. design §3.2, §5.2; docs/ui-style.md
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoinBags } from "./CoinBags";

const bags = (duffel: number, pocket: number, limit = 3) => renderToStaticMarkup(createElement(CoinBags, { limit, bags: { duffel, pocket }, onBags: () => {} }));

describe("the coins and bags (design §3.2)", () => {
  it("shows the room's coins not yet grabbed in the Grab row, and an empty place for each one grabbed", () => {
    const out = bags(1, 0);
    expect(out.match(/aria-label="Coin \d in the room"/g)).toHaveLength(2);
    expect(out.match(/class="coin-place"/g)).toHaveLength(1);
    expect(bags(2, 1)).not.toContain("in the room");
  });

  it("puts each grabbed coin in its bag as a button to pick it up (a tap, never only a drag), none picked up yet", () => {
    const out = bags(2, 1);
    expect(out.match(/aria-label="Coin \d in the duffel"/g)).toHaveLength(2);
    expect(out.match(/aria-label="Coin \d in your pocket"/g)).toHaveLength(1);
    expect(out).not.toContain('aria-pressed="true"');
    expect(out).not.toContain("Drop the coin");
    for (const pile of ["room", "duffel", "pocket"]) expect(out).toContain(`data-pile="${pile}"`);
    expect(out).toContain("Tap a coin to pick it up, or drag it.");
  });

  it("says so when a bag is empty", () => {
    expect(bags(2, 0)).toContain("Tap or drag a coin here");
  });
});
