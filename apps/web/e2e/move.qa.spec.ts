// QA (PR #201, S4.2): the move panel's tap alternative by keyboard alone, the
// coins conserved through taps and drags, and no R6 words. design §3.2, §20.1
import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";
import { bagCoins, dragTo, pickRoom } from "./move";

/** Tabs forward until `match` holds for the focused element (at most `max` presses). */
async function tabTo(
  page: Page,
  match: (el: {
    label: string;
    bag: string | null;
    pressed: string | null;
  }) => boolean,
  max = 80,
): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const el = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return {
        label: a?.getAttribute("aria-label") ?? a?.textContent ?? "",
        bag: a?.closest("[data-bag]")?.getAttribute("data-bag") ?? null,
        pressed: a?.getAttribute("aria-pressed") ?? null,
      };
    });
    if (match(el)) return;
  }
  throw new Error("tabTo: never reached the target");
}

const count = async (page: Page) => ({
  duffel: await bagCoins(page, "duffel").count(),
  pocket: await bagCoins(page, "pocket").count(),
});

test("the grab and the split work by keyboard alone, and taps and drags keep every coin @move", async ({
  page,
}) => {
  const game = await startGame(page.request, { bots: 5, sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  await expect(
    page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 }),
  ).toBeVisible();

  // The room by keyboard: Tab to the Vault button, Enter.
  await page.locator("body").focus();
  await tabTo(page, (el) => el.label.trim() === "Vault" && el.pressed !== null);
  await page.keyboard.press("Enter");
  await expect(page.locator(".move__room-name")).toHaveText("Vault");
  expect(await count(page)).toEqual({ duffel: 3, pocket: 0 });

  // Grab 2 of 3 by keyboard (Enter on the 2nd grabbed coin keeps 2... the 3rd keeps 2).
  await tabTo(page, (el) => el.label === "Coin 3, grabbed");
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("group", { name: "Coins to grab" })
      .locator('[aria-pressed="true"]'),
  ).toHaveCount(2);
  expect(await count(page)).toEqual({ duffel: 2, pocket: 0 });

  // A duffel coin into the pocket with Enter, then one back with Space.
  await tabTo(page, (el) => el.bag === "duffel" && el.label.startsWith("Coin"));
  await page.keyboard.press("Enter");
  await expect(bagCoins(page, "pocket")).toHaveCount(1);
  expect(await count(page)).toEqual({ duffel: 1, pocket: 1 });
  await page.locator("[data-bag=pocket] .coin-btn").first().focus();
  await page.keyboard.press("Space");
  expect(await count(page)).toEqual({ duffel: 2, pocket: 0 });

  // Drags: into the pocket, a drop on the same bag, a drop outside both bags; never a coin lost or made.
  await dragTo(
    page,
    bagCoins(page, "duffel").first(),
    page.locator("[data-bag=pocket]"),
  );
  await expect(bagCoins(page, "pocket")).toHaveCount(1);
  await dragTo(
    page,
    bagCoins(page, "pocket").first(),
    page.locator("[data-bag=pocket]"),
  );
  await dragTo(
    page,
    bagCoins(page, "duffel").first(),
    page.locator(".move__room-name"),
  );
  expect(await count(page)).toEqual({ duffel: 1, pocket: 1 });
  // A grab raised again keeps the pocket and fills the duffel.
  await page.getByRole("button", { name: "Coin 3, left" }).click();
  expect(await count(page)).toEqual({ duffel: 2, pocket: 1 });

  // Lock it in by keyboard; the status line agrees with the bags.
  await page.getByRole("button", { name: "Lock it in" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".move__status")).toHaveText(
    /Locked in: Vault, pocket 1\./,
  );

  // No R6 money words on the move panel.
  await expect(page.locator(".move")).not.toContainText(/\bloot\b|\bhaul\b/i);
});
