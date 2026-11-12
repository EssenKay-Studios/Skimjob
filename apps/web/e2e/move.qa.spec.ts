// QA (PR #201, S4.2; #232): the move panel by keyboard alone (pick a coin up,
// drop it), the coins conserved through taps and drags, and no R6 words. design §3.2, §20.1
import { expect, test, type Page } from "@playwright/test";
import { openPanel, startGame } from "./setupGame";
import { dragTo, pickRoom, pileCoins, tapMove } from "./move";

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

// QA (#232): the edges of tap to pick. design §3.2 steps 2-3
test("a 1-coin room, a tap on a coin in another pile, a held coin let go on a room change, and the split kept after a reload @move", async ({ page }) => {
  const game = await startGame(page.request, { bots: 3, sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "This round");

  // The Lobby's 1 coin: nothing left in the room, and the held coin can only go to the other bag.
  await pickRoom(page, "Lobby");
  await expect.poll(() => count(page)).toEqual({ room: 0, duffel: 1, pocket: 0 });
  await pileCoins(page, "duffel").first().click();
  await expect(page.getByText("Tap the Pocket to drop it.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Drop the coin in/ })).toHaveCount(1);
  await page.locator("[data-pile=room] .coin-bags__label").click(); // the room takes no coin back at 1
  await expect.poll(() => count(page)).toEqual({ room: 0, duffel: 1, pocket: 0 });
  await page.getByRole("button", { name: "Drop the coin in your pocket" }).click();
  await expect.poll(() => count(page)).toEqual({ room: 0, duffel: 0, pocket: 1 });

  // The Vault keeps the 1-coin grab (2 left in the room). A held room coin dropped by a tap on a pocket coin.
  await pickRoom(page, "Vault");
  await expect.poll(() => count(page)).toEqual({ room: 2, duffel: 0, pocket: 1 });
  await pileCoins(page, "room").first().click();
  await pileCoins(page, "pocket").first().click();
  await expect.poll(() => count(page)).toEqual({ room: 1, duffel: 0, pocket: 2 });
  await expect(page.locator('.coin-btn[aria-pressed="true"]')).toHaveCount(0);
  // A tap on the held coin puts it down.
  const coin = pileCoins(page, "pocket").last();
  await coin.click();
  await expect(coin).toHaveAttribute("aria-pressed", "true");
  await coin.click();
  await expect(page.locator('.coin-btn[aria-pressed="true"]')).toHaveCount(0);

  // A coin held when the room changes is let go: nothing lifted in the new room, and a bag tap moves nothing.
  await pileCoins(page, "pocket").first().click();
  await pickRoom(page, "Office");
  await expect(page.locator('.coin-btn[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByText("Tap a coin to pick it up, or drag it.")).toBeVisible();
  const before = await count(page);
  await page.locator("[data-pile=duffel] .bag__name").click();
  expect(await count(page)).toEqual(before);

  // Put one back in the room, lock in, reload: the bags come back as locked in.
  await tapMove(page, "pocket", "room");
  const locked = await count(page);
  expect(locked.room).toBe(1);
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page.locator(".move__status")).toHaveText(/Locked in: Office/);
  await page.reload();
  await openPanel(page, "This round");
  await expect.poll(() => count(page)).toEqual(locked);
});
