import { LESSONS } from "@skimjob/content";
import { expect, test, type Page } from "@playwright/test";
import { showsAfterCards } from "./meetingCards";
import { grabAll, pickRoom } from "./move";
import { openPanel, startGame, settle } from "./setupGame";

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
    await settle(page);
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

test("the game menu's Rulebook entry closes the menu and opens This game @teaching", async ({ page }) => {
  const game = await startGame(page.request, { bots: 3, nickname: "Reader", tips: true });
  await page.goto(`/game/${game.id}`);
  await page.getByRole("button", { name: "Menu" }).click();
  const entry = page.getByRole("dialog", { name: "Game menu" }).getByRole("button", { name: "Rulebook" });
  expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await entry.click();
  await expect(page.getByRole("dialog", { name: "This game" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Game menu" })).toBeHidden();
});

// A live game, no fixed waits: the human locks in a Vault grab (three noisy coins), the bots lock in
// themselves, and round 1 resolves after the lock-in grace; whichever lesson that lights is due then.
const LESSON_TITLE = new RegExp(`^(${Object.values(LESSONS).map((l) => l.title).join("|")})$`);
const lessonDialog = (page: Page) => page.getByRole("dialog", { name: LESSON_TITLE });

async function playRound1(page: Page, opts: { tips: boolean }) {
  // The 3-hour preset: rounds stay open long enough that the lock-in, not the clock, resolves round 1.
  const game = await startGame(page.request, { bots: 3, nickname: "Tipster", sessionLength: "3h", tips: opts.tips });
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "This round");
  await pickRoom(page, "Vault");
  await grabAll(page);
  await page.getByRole("button", { name: "Lock it in" }).click();
  return game;
}
const resolved = (page: Page) => expect(page.locator(".hud__kicker")).toContainText(/Round ([2-9]|1[0-2]) of 12/, { timeout: 120_000 });

test("with Tips on a lesson opens in a live game, Got it keeps it away after a reload @teaching", async ({ page }) => {
  test.setTimeout(240_000);
  await playRound1(page, { tips: true });
  const dialog = lessonDialog(page);
  // One sheet at a time (§20.6): a lesson waits behind a meeting's result card until it is closed.
  await showsAfterCards(page, dialog, 120_000);
  const title = (await dialog.getByRole("heading").textContent())!;
  const id = Object.entries(LESSONS).find(([, l]) => l.title === title)![0];
  await dialog.getByRole("button", { name: "Got it" }).click();
  await page.reload();
  await resolved(page);
  await expect(page.getByRole("button", { name: "Menu" })).toBeVisible(); // /api/me has answered
  await expect(page.getByRole("dialog", { name: title, exact: true })).toHaveCount(0);
  const me = (await (await page.request.get("/api/me")).json()).user as { id: string };
  expect(await page.evaluate((k) => localStorage.getItem(k), `skimjob.lessons.${me.id}`)).toContain(id);
});

test("with Tips off no lesson opens once round 1 has resolved @teaching", async ({ page }) => {
  test.setTimeout(240_000);
  await playRound1(page, { tips: false });
  await resolved(page); // the events a lesson needs are in the ledger now
  await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
  await expect(lessonDialog(page)).toHaveCount(0);
});

test("Turn tips off closes the live pop-up and saves Tips off @teaching", async ({ page }) => {
  test.setTimeout(240_000);
  await playRound1(page, { tips: true });
  const dialog = lessonDialog(page);
  // One sheet at a time (§20.6): a lesson waits behind a meeting's result card until it is closed.
  await showsAfterCards(page, dialog, 120_000);
  await dialog.getByRole("button", { name: "Turn tips off" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await (await page.request.get("/api/me")).json()).user.tips).toBe(false);
});
