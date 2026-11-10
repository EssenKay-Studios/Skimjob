import { mkdirSync } from "node:fs";
import { LESSONS } from "@skimjob/content";
import { expect, test, type Page } from "@playwright/test";
import { pickRoom } from "./move";
import { openPanel, startGame } from "./setupGame";

// QA for S4.6 (design §15.6, §20.6): the teaching pop-ups in a real bot game, at every launch width.
// A dismissed lesson never comes back (not even after a reload), with its text from content, 44 px buttons,
// focus in and back, no animation under reduced motion; Tips off (from the pop-up or the game menu)
// is saved and nothing shows after. SHOTS_DIR=… saves every pop-up and the menu.

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];
const SHOTS = process.env.SHOTS_DIR;
const TITLES = Object.values(LESSONS).map((l) => l.title);
const lessonDialog = (page: Page) => page.locator("dialog[open]").filter({ has: page.locator("#teaching-h") });
const over = (page: Page) => page.getByRole("list", { name: "Final ranking" });

const slug = (t: string) => t.replace(/\W+/g, "-").replace(/-$/, "").toLowerCase();

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png` });
}

/** Waits for the next pop-up (or the end); returns its title, or null at the end. */
async function nextLesson(page: Page, timeout = 120_000): Promise<string | null> {
  const end = Date.now() + timeout;
  const card = page.getByRole("button", { name: "Back to the bank" });
  while (Date.now() < end) {
    if (await card.isVisible()) await card.click(); // a meeting's result card holds the pop-up back until closed (§20.6)
    // A non-waiting read: the pop-up can step aside (a vote window, the game's end) between two checks (§20.6).
    const [title] = await lessonDialog(page).locator("#teaching-h").allTextContents();
    if (title) return title.trim();
    if (await over(page).isVisible()) return null;
    await page.waitForTimeout(200);
  }
  return null;
}

async function fits(page: Page, width: number) {
  const dialog = lessonDialog(page);
  const box = (await dialog.locator(".dialog__sheet").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  for (const name of ["Got it", "Turn tips off"]) {
    const btn = dialog.getByRole("button", { name });
    expect(await btn.evaluate((el) => (el as HTMLElement).offsetHeight), name).toBeGreaterThanOrEqual(44);
    expect(await btn.evaluate((el) => (el as HTMLElement).offsetWidth), name).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const vp of VIEWPORTS) {
  test(`in a live game at ${vp.width} px a pop-up once dismissed never returns, its text is from content, and it fits @teaching`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize(vp);
    const game = await startGame(page.request, { bots: 3, nickname: "Learner", tips: true });
    await page.goto(`/game/${game.id}`);
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await menu.click();
    const menuDialog = page.getByRole("dialog", { name: "Game menu" });
    await expect(menuDialog.getByRole("group", { name: "Tips" }).getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(700);
    await shot(page, "menu");
    for (const name of ["On", "Off", "Close"]) expect(await menuDialog.getByRole("button", { name }).evaluate((el) => (el as HTMLElement).offsetHeight), name).toBeGreaterThanOrEqual(44);
    await menuDialog.getByRole("button", { name: "Close" }).click();
    await expect(menu).toBeFocused();

    const shown: string[] = [];
    const dismissed: string[] = [];
    let reloaded = false;
    for (let title = await nextLesson(page); title; title = await nextLesson(page)) {
      expect(TITLES, title).toContain(title);
      expect(dismissed, `"${title}" came back after Got it`).not.toContain(title);
      shown.push(title);
      const lesson = Object.values(LESSONS).find((l) => l.title === title)!;
      const dialog = lessonDialog(page);
      const gotIt = dialog.getByRole("button", { name: "Got it" });
      // One sheet at a time (§20.6): while a meeting's vote window is open the pop-up steps aside, and it comes back
      // with focus on Got it when the window closes. So wait for the moment it is the only open sheet.
      const vote = page.locator("dialog[open][aria-labelledby=vote-h]");
      if (await vote.count()) {
        await expect(lessonDialog(page)).toHaveCount(0); // stepped aside for the vote window
        await shot(page, `under-vote-${slug(title)}`);
      }
      await expect(async () => {
        // A meeting's result card keeps the pop-up stepped aside until the player closes it (§20.6).
        const card = page.getByRole("button", { name: "Back to the bank" });
        if (await card.isVisible()) await card.click();
        await expect(vote).toHaveCount(0, { timeout: 1000 }); // the panel sheets of the shell may stay open beneath the pop-up
        await expect(dialog.locator("#teaching-h")).toHaveText(title, { timeout: 1000 });
        for (const line of [lesson.happened, lesson.means, lesson.canDo]) await expect(dialog.getByText(line, { exact: true })).toBeVisible({ timeout: 1000 });
        await expect(gotIt).toBeFocused({ timeout: 1000 });
      }).toPass({ timeout: 90_000 });
      await page.waitForTimeout(700); // the entrance spring settles
      await fits(page, vp.width);
      await shot(page, `lesson-${slug(title)}`);
      // The title at the moment of the click is the one marked seen (an open pop-up can switch lessons: QA #217 finding).
      // If it steps aside first (a vote window, the game's end), go back to waiting for it, as a player would.
      const [now] = await lessonDialog(page).locator("#teaching-h").allTextContents();
      if (!now || !(await gotIt.click({ timeout: 5000 }).then(() => true, () => false))) {
        await expect(lessonDialog(page)).toHaveCount(0);
        continue;
      }
      dismissed.push(now.trim());
      // Seen for good: after a reload it doesn't come back.
      if (!reloaded) {
        reloaded = true;
        await expect(page.locator("#teaching-h").filter({ hasText: dismissed.at(-1)! })).toHaveCount(0);
        await page.reload();
        await expect(page.locator(".hud__kicker")).toBeVisible();
      }
    }
    expect(shown.length).toBeGreaterThan(0);
  });
}

test("under reduced motion a live pop-up does not spring in @teaching", async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const game = await startGame(page.request, { bots: 3, nickname: "Still", tips: true });
  await page.goto(`/game/${game.id}`);
  expect(await nextLesson(page)).not.toBeNull();
  const sheet = lessonDialog(page).locator(".dialog__sheet");
  expect(await sheet.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

test("Turn tips off in a pop-up is saved: no pop-up after, Off in the menu after a reload @teaching", async ({ page }) => {
  test.setTimeout(180_000);
  const game = await startGame(page.request, { bots: 3, nickname: "Done", tips: true });
  await page.goto(`/game/${game.id}`);
  expect(await nextLesson(page)).not.toBeNull();
  await lessonDialog(page).getByRole("button", { name: "Turn tips off" }).click();
  await expect(lessonDialog(page)).toHaveCount(0);
  await expect.poll(async () => (await (await page.request.get("/api/me")).json()).user.tips).toBe(false);
  await page.reload();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Game menu" }).getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("dialog", { name: "Game menu" }).getByRole("button", { name: "Close" }).click();
  // Three rounds and more at this clock: still nothing.
  const end = Date.now() + 15_000;
  while (Date.now() < end && !(await over(page).isVisible())) {
    await expect(lessonDialog(page)).toHaveCount(0);
    await page.waitForTimeout(250);
  }
});

test("Tips off from the game menu holds across a reload and no pop-up opens @teaching", async ({ page }) => {
  test.setTimeout(180_000);
  const game = await startGame(page.request, { bots: 3, nickname: "Switcher", tips: true });
  await page.goto(`/game/${game.id}`);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Game menu" });
  await menu.getByRole("button", { name: "Off" }).click();
  await expect(menu.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  await menu.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(menu.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  expect((await (await page.request.get("/api/me")).json()).user.tips).toBe(false);
  await menu.getByRole("button", { name: "Close" }).click();
  const end = Date.now() + 20_000;
  while (Date.now() < end && !(await over(page).isVisible())) {
    await expect(lessonDialog(page)).toHaveCount(0);
    await page.waitForTimeout(250);
  }
});

test("a pop-up that opens over a move in progress leaves the move as it was @teaching", async ({ page }) => {
  test.setTimeout(180_000);
  const game = await startGame(page.request, { bots: 3, nickname: "Mover", tips: true });
  // Hold /api/me so the due pop-up only opens once the player is mid-move.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.goto(`/game/${game.id}`);
  expect(await nextLesson(page)).not.toBeNull(); // a lesson is due now (left unseen)
  await page.route("**/api/me", async (route) => {
    await held;
    await route.continue();
  });
  await page.reload();
  await expect(page.locator(".hud__kicker")).toBeVisible();
  await openPanel(page, "This round");
  await pickRoom(page, "Lobby");
  await expect(lessonDialog(page)).toHaveCount(0);
  release();
  const title = await nextLesson(page, 10_000);
  if (title) {
    await lessonDialog(page).getByRole("button", { name: "Got it" }).click();
    await expect(page.locator(".move__room-name")).toHaveText("Lobby");
  }
});

