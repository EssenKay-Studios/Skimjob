// #232: the move's coins with a finger: tap a coin to pick it up, tap a bag to
// drop it; drag it into either bag; and the room's last coin can be taken (the
// grab is 1 coin up to the room's limit). design §3.2 steps 2-3, §15.6
import { expect, test, type Page } from "@playwright/test";
import { openPanel, startGame } from "./setupGame";
import { pickRoom, pileCoins, touchDragTo } from "./move";

test.use({ hasTouch: true });

const count = async (page: Page) => ({
  room: await pileCoins(page, "room").count(),
  duffel: await pileCoins(page, "duffel").count(),
  pocket: await pileCoins(page, "pocket").count(),
});

test("touch: tap to pick a coin and tap a bag to drop it, drag into either bag, and take the room's last coin @move", async ({ page }) => {
  const game = await startGame(page.request, { bots: 3, sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "This round");
  await pickRoom(page, "Office");
  await expect.poll(() => count(page)).toEqual({ room: 0, duffel: 2, pocket: 0 });

  // A tap lifts the coin (and nothing moves yet); a tap on the Grab row leaves it in the room.
  const coin = pileCoins(page, "duffel").first();
  await coin.tap();
  await expect(coin).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Tap the Pocket to drop it, or the Grab row to leave it.")).toBeVisible();
  await expect.poll(() => count(page)).toEqual({ room: 0, duffel: 2, pocket: 0 });
  await page.locator("[data-pile=room] .coin-bags__label").tap();
  await expect.poll(() => count(page)).toEqual({ room: 1, duffel: 1, pocket: 0 });

  // At 1 coin the room takes none back (at least 1 coin, design §3.2 step 2): no drop place there, and a tap on it does nothing.
  await pileCoins(page, "duffel").first().tap();
  await expect(page.getByRole("button", { name: "Drop the coin in the room" })).toHaveCount(0);
  await page.locator("[data-pile=room] .coin-bags__label").tap();
  await expect.poll(() => count(page)).toEqual({ room: 1, duffel: 1, pocket: 0 });

  // The room's last coin: a tap picks it up, a tap on the Pocket drops it there. The grab is the room's limit again.
  await pileCoins(page, "room").first().tap();
  await expect(page.getByText("Tap the Duffel or the Pocket to drop it.")).toBeVisible();
  await page.locator("[data-pile=pocket] .bag__name").tap();
  await expect.poll(() => count(page)).toEqual({ room: 0, duffel: 1, pocket: 1 });
  await expect(page.locator('.coin-btn[aria-pressed="true"]')).toHaveCount(0);

  // A finger drag into either bag.
  await touchDragTo(page, pileCoins(page, "pocket").first(), page.locator("[data-pile=duffel]"));
  await expect.poll(() => count(page)).toEqual({ room: 0, duffel: 2, pocket: 0 });
  await touchDragTo(page, pileCoins(page, "duffel").first(), page.locator("[data-pile=pocket]"));
  await expect.poll(() => count(page)).toEqual({ room: 0, duffel: 1, pocket: 1 });

  // Lock in with a click: a synthetic tap right after the scripted touch drag can be read as a double tap (no click).
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page.locator(".move__status")).toHaveText(/Locked in: Office, pocket 1\./);
});
