// The move panel's room picker, for specs: the rooms are toggle buttons while no room is picked, and
// "Change" brings them back once one is (the bank board picks a room too). Specs that play whole games
// pass a short `timeout`, so a room closed by a raid or a Lockdown fails the pick at once instead of waiting.
import { expect, type Locator, type Page } from "@playwright/test";

type Pile = "room" | "duffel" | "pocket";

/** The coins of one pile: those still in the room (the Grab row), the duffel's or the pocket's. */
export const pileCoins = (page: Page, pile: Pile) => page.locator(`[data-pile=${pile}] .coin-btn[aria-pressed]`);

/** Tap to pick: tap the first coin of `from` (it lifts), then tap `to`'s name, off its coins, to drop it there. */
export async function tapMove(page: Page, from: Pile, to: Pile, timeout = 30_000): Promise<void> {
  await pileCoins(page, from).first().click({ timeout });
  await page.locator(`[data-pile=${to}]`).locator(to === "room" ? ".coin-bags__label" : ".bag__name").click({ timeout });
}

/** A fresh move holds nothing: tap every coin left in the Grab row into the duffel (Lock it in needs one in a bag). */
export async function grabAll(page: Page, timeout = 30_000): Promise<void> {
  while ((await pileCoins(page, "room").count()) > 0) await tapMove(page, "room", "duffel", timeout);
}

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

/** The same drag with a finger: touch events in steps (Chromium, through the DevTools protocol; needs `hasTouch`). */
export async function touchDragTo(page: Page, from: Locator, to: Locator): Promise<void> {
  await from.scrollIntoViewIfNeeded(); // a finger starts on a coin it can see
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("touchDragTo: both ends must be on screen");
  const cdp = await page.context().newCDPSession(page);
  const [ax, ay, bx, by] = [a.x + a.width / 2, a.y + a.height / 2, b.x + b.width / 2, b.y + b.height / 2];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: ax, y: ay }] });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: ax + ((bx - ax) * i) / 8, y: ay + ((by - ay) * i) / 8 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
