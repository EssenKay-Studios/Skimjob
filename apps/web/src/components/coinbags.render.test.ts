// Render checks for the coins and the two bags. design §3.2, §5.2; docs/ui-style.md
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoinBags } from "./CoinBags";

const bags = (duffel: number, pocket: number, limit = 3) =>
  renderToStaticMarkup(createElement(CoinBags, { limit, grab: duffel + pocket, bags: { duffel, pocket }, onGrab: () => {}, onMove: () => {} }));

describe("the coins and bags (design §3.2)", () => {
  it("shows one coin button per limit to grab, with the grabbed ones pressed", () => {
    const out = bags(1, 1);
    expect(out.match(/aria-label="Coin \d, grabbed"/g)).toHaveLength(2);
    expect(out).toContain('aria-label="Coin 3, left"');
  });

  it("puts each grabbed coin in a bag as a button that moves it to the other one (a tap, never only a drag)", () => {
    const out = bags(2, 1);
    expect(out.match(/Tap to move it to your pocket/g)).toHaveLength(2);
    expect(out.match(/Tap to move it to the duffel/g)).toHaveLength(1);
    expect(out).toContain('data-bag="duffel"');
    expect(out).toContain('data-bag="pocket"');
  });

  it("says so when a bag is empty", () => {
    expect(bags(2, 0)).toContain("Tap or drag a coin here");
  });
});
