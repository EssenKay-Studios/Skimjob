import { expect, test } from "@playwright/test";
import { settle, startGame } from "./setupGame";

// QA for #233, design §15.6: the game menu's Rulebook entry, by keyboard and at every launch width.

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

test("keyboard: Enter on Rulebook opens This game alone, Esc closes it and focus goes back to Menu @teaching", async ({ page }) => {
  const game = await startGame(page.request, { bots: 3, nickname: "Keys", tips: true });
  await page.goto(`/game/${game.id}`);
  const menu = page.getByRole("button", { name: "Menu" });
  await menu.focus();
  await page.keyboard.press("Enter");
  const entry = page.getByRole("dialog", { name: "Game menu" }).getByRole("button", { name: "Rulebook" });
  await entry.focus();
  await page.keyboard.press("Enter");
  const rules = page.getByRole("dialog", { name: "This game" });
  await expect(rules).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(rules).toBeHidden();
  await expect(menu).toBeFocused();
  // Reopens: the menu and the rulebook state reset cleanly.
  await menu.click();
  await page.getByRole("dialog", { name: "Game menu" }).getByRole("button", { name: "Rulebook" }).click();
  await rules.locator(".rulebook__head").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const vp of VIEWPORTS) {
  test(`the Rulebook entry and This game fit a ${vp.width} px screen @teaching`, async ({ page }) => {
    await page.setViewportSize(vp);
    const game = await startGame(page.request, { bots: 3, nickname: "Wide", tips: true });
    await page.goto(`/game/${game.id}`);
    await page.getByRole("button", { name: "Menu" }).click();
    const menu = page.getByRole("dialog", { name: "Game menu" });
    await settle(page);
    const entry = menu.getByRole("button", { name: "Rulebook" });
    expect(await entry.evaluate((el) => (el as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44);
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/menu-${vp.width}.png` });
    await entry.click();
    const rules = page.getByRole("dialog", { name: "This game" });
    await expect(rules).toBeVisible();
    await settle(page);
    const box = (await rules.locator(".dialog__sheet").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/menu-rulebook-${vp.width}.png` });
  });
}

test.describe("touch", () => {
  test.use({ hasTouch: true });
  test("a tap on Rulebook opens This game @teaching", async ({ page }) => {
    const game = await startGame(page.request, { bots: 3, nickname: "Thumb", tips: true });
    await page.goto(`/game/${game.id}`);
    await page.getByRole("button", { name: "Menu" }).tap();
    await page.getByRole("dialog", { name: "Game menu" }).getByRole("button", { name: "Rulebook" }).tap();
    await expect(page.getByRole("dialog", { name: "This game" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });
});
