// QA (PR #201, S4.2; #232): the move panel by keyboard alone (pick a coin up,
// drop it), the coins conserved through taps and drags, and no R6 words. design §3.2, §20.1
import { expect, test, type Page } from "@playwright/test";
import { openPanel, startGame } from "./setupGame";
import { dragTo, pickRoom, pileCoins } from "./move";

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
        bag: a?.closest("[data-pile]")?.getAttribute("data-pile") ?? null,
        pressed: a?.getAttribute("aria-pressed") ?? null,
      };
    });
    if (match(el)) return;
  }
  throw new Error("tabTo: never reached the target");
}

const count = async (page: Page) => ({
  room: await pileCoins(page, "room").count(),
  duffel: await pileCoins(page, "duffel").count(),
  pocket: await pileCoins(page, "pocket").count(),
});

test("the grab and the split work by keyboard alone, and taps and drags keep every coin @move", async ({
  page,
}) => {
  const game = await startGame(page.request, { bots: 5, sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "This round"); // below 1024 px the move panel is in this sheet
  await expect(
    page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 }),
  ).toBeVisible();

  // The room by keyboard: Tab to the Vault button, Enter.
  await page.locator("body").focus();
  await tabTo(page, (el) => el.label.trim() === "Vault" && el.pressed !== null);
  await page.keyboard.press("Enter");
  await expect(page.locator(".move__room-name")).toHaveText("Vault");
  expect(await count(page)).toEqual({ room: 0, duffel: 3, pocket: 0 });

  // Grab 2 of 3 by keyboard: Enter picks a duffel coin up (it lifts), Space on the Grab row's drop place leaves it in the room.
  await tabTo(page, (el) => el.bag === "duffel" && el.label.startsWith("Coin"));
  await page.keyboard.press("Enter");
  await expect(pileCoins(page, "duffel").first()).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Drop the coin in the room" }).focus();
  await page.keyboard.press("Space");
  expect(await count(page)).toEqual({ room: 1, duffel: 2, pocket: 0 });

  // Esc puts a picked-up coin down again (and doesn't close the sheet).
  await pileCoins(page, "duffel").first().focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.locator('.coin-btn[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();

  // The room's coin into the pocket, by keyboard: Enter on it, Tab on to the pocket's drop place, Enter.
  await pileCoins(page, "room").first().focus();
  await page.keyboard.press("Enter");
  await tabTo(page, (el) => el.label === "Drop the coin in your pocket");
  await page.keyboard.press("Enter");
  expect(await count(page)).toEqual({ room: 0, duffel: 2, pocket: 1 });

  // Drags: into the room, a drop on the same bag, a drop outside every pile, out of the room; never a coin lost or made.
  await dragTo(page, pileCoins(page, "duffel").first(), page.locator("[data-pile=room]"));
  expect(await count(page)).toEqual({ room: 1, duffel: 1, pocket: 1 });
  await dragTo(page, pileCoins(page, "pocket").first(), page.locator("[data-pile=pocket]"));
  await dragTo(page, pileCoins(page, "duffel").first(), page.locator(".move__room-name"));
  expect(await count(page)).toEqual({ room: 1, duffel: 1, pocket: 1 });
  await dragTo(page, pileCoins(page, "room").first(), page.locator("[data-pile=duffel]"));
  expect(await count(page)).toEqual({ room: 0, duffel: 2, pocket: 1 });

  // Lock it in by keyboard; the status line agrees with the bags.
  await page.getByRole("button", { name: "Lock it in" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".move__status")).toHaveText(
    /Locked in: Vault, pocket 1\./,
  );

  // No R6 money words on the move panel.
  await expect(page.locator(".move")).not.toContainText(/\bloot\b|\bhaul\b/i);
});
