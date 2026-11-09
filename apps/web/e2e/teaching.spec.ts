import { LESSONS } from "@skimjob/content";
import { expect, test } from "@playwright/test";
import { startGame } from "./setupGame";

// S4.6, design §15.6, §20.6: the teaching pop-ups and the game menu's Tips
// setting. The pop-ups on /dev/gallery (which lessons are due is unit-tested in
// game/teaching.test.ts); the menu in a live game, against the real Tips setting.

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

test("a pop-up shows the three parts from content, takes focus and gives it back @teaching", async ({ page }) => {
  await page.goto("/dev/gallery");
  const opener = page.getByRole("button", { name: LESSONS.raid.title, exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: LESSONS.raid.title });
  await expect(dialog).toBeVisible();
  for (const head of ["What just happened", "What it means", "What you can do"]) await expect(dialog.getByText(head, { exact: true })).toBeVisible();
  for (const line of [LESSONS.raid.happened, LESSONS.raid.means, LESSONS.raid.canDo]) await expect(dialog.getByText(line)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Got it" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("Got it closes it, and every lesson opens with its own title @teaching", async ({ page }) => {
  await page.goto("/dev/gallery");
  for (const lesson of Object.values(LESSONS)) {
    await page.getByRole("button", { name: lesson.title, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: lesson.title });
    await expect(dialog.getByText(lesson.means)).toBeVisible();
    await dialog.getByRole("button", { name: "Got it" }).click();
    await expect(dialog).toBeHidden();
  }
});

for (const vp of VIEWPORTS) {
  test(`the pop-up fits a ${vp.width} px screen with 44 px buttons @teaching`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto("/dev/gallery");
    await page.getByRole("button", { name: LESSONS.missing.title, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: LESSONS.missing.title });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(700); // the entrance spring settles
    const sheet = dialog.locator(".dialog__sheet");
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
    for (const name of ["Got it", "Turn tips off"]) {
      const btn = dialog.getByRole("button", { name });
      expect(await btn.evaluate((el) => (el as HTMLElement).offsetHeight), name).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/teaching-${vp.width}.png` });
  });
}

test("the pop-up does not animate under reduced motion @teaching", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dev/gallery");
  await page.getByRole("button", { name: LESSONS.bell.title, exact: true }).click();
  const sheet = page.getByRole("dialog", { name: LESSONS.bell.title }).locator(".dialog__sheet");
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

test("the game menu holds the Tips setting, on by default, and Off is saved @teaching", async ({ page }) => {
  const game = await startGame(page.request, { bots: 3, nickname: "Tipster", tips: true });
  await page.goto(`/game/${game.id}`);
  const menu = page.getByRole("button", { name: "Menu" });
  await menu.click();
  const dialog = page.getByRole("dialog", { name: "Game menu" });
  const tips = dialog.getByRole("group", { name: "Tips" });
  await expect(tips.getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
  await tips.getByRole("button", { name: "Off" }).click();
  await expect(tips.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  expect((await (await page.request.get("/api/me")).json()).user.tips).toBe(false);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();
});

test("with Tips off no pop-up opens in a live game @teaching", async ({ page }) => {
  const game = await startGame(page.request, { bots: 3, nickname: "Quiet" });
  await page.goto(`/game/${game.id}`);
  await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
  await page.waitForTimeout(10_000); // a couple of rounds at this clock
  await expect(page.getByRole("dialog", { name: /Raid!|One star|shakedown|Power cut|missing|bell rang/i })).toHaveCount(0);
});
