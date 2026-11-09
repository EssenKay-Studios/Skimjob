// The move panel's room picker, for specs: the rooms are toggle buttons while no room is picked, and
// "Change" brings them back once one is (the bank board picks a room too). Specs that play whole games
// pass a short `timeout`, so a room closed by a raid or a Lockdown fails the pick at once instead of waiting.
import { expect, type Locator, type Page } from "@playwright/test";

/** The coin buttons of one bag: the duffel's or the pocket's. */
export const bagCoins = (page: Page, bag: "duffel" | "pocket") => page.locator(`[data-bag=${bag}] .coin-btn`);

const rooms = (page: Page) => page.getByRole("group", { name: "Rooms", exact: true });

async function showRooms(page: Page, timeout: number): Promise<void> {
  const change = page.getByRole("button", { name: "Change", exact: true });
  if (await change.isVisible()) await change.click({ timeout });
}

export async function pickRoom(page: Page, name: string, timeout = 30_000): Promise<void> {
  await showRooms(page, timeout);
  await rooms(page).getByRole("button", { name, exact: true }).click({ timeout });
  await expect(page.locator(".move__room-name")).toHaveText(name, { timeout });
}

/** Picks the first open room that isn't the current one and can lock in at once (not Security, which needs a room to watch). */
export async function pickOtherRoom(page: Page, timeout = 30_000): Promise<void> {
  await showRooms(page, timeout);
  await rooms(page).locator('button:enabled:not([aria-pressed="true"]):not([data-room="Security"])').first().click({ timeout });
}

/** A mouse drag from the centre of `from` to the centre of `to`, in steps (a press that travels, as a finger would). */
export async function dragTo(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("dragTo: both ends must be on screen");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}
