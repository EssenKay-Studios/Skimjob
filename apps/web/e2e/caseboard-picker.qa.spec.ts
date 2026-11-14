import { expect as baseExpect, test, type Browser } from "@playwright/test";
import { openPanel, startGame } from "./setupGame";

const expect = baseExpect.configure({ timeout: 15_000 });

// QA (#245, PR #311): the case board's one-row round picker (design §15.4).
// In a live game it follows each new round until the player picks an older round or All;
// on /dev/gallery a mouse scrolls it with Shift+wheel, the next round peeks past the
// latest, and screenshots at the five widths go to test-results as evidence.

const WIDTHS = [360, 390, 768, 1024, 1280];

async function gallery(browser: Browser, width: number, touch: boolean) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch && width < 1024 });
  const page = await ctx.newPage();
  await page.goto("/dev/gallery");
  const section = page.locator('section[aria-labelledby="g-caseboard"]');
  await section.scrollIntoViewIfNeeded();
  return { ctx, page, section, board: section.getByRole("region", { name: "Case board" }).first() };
}

test("in a live game the picker follows each new round, until an older round or All is picked @caseboard", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one live game, on the laptop layout (the case board stays in the side panel)");
  test.setTimeout(300_000);
  // 1-hour preset: 30 s rounds; the host never moves (default moves), a bot plays.
  const game = await startGame(page.request, { bots: 2, sessionLength: "1h" });
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "Case");
  const picker = page.getByRole("region", { name: "Case board" }).locator(".cb__picker");
  const pressed = picker.locator('button[aria-pressed="true"]');
  const latest = picker.locator(".cb__rbtn[data-latest]");
  const wait = { timeout: 90_000 };
  // The alibi pop-up opens after each round; close it before tapping the board.
  const tap = async (name: string) => {
    const popup = page.locator("dialog[open]");
    while (await popup.count()) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
    await picker.getByRole("button", { name, exact: true }).click();
  };

  // Before round 1 resolves: nothing picked, no latest tag.
  await expect(pressed).toHaveCount(0);
  await expect(latest).toHaveCount(0);

  // Round 1 resolves: picked and tagged. Round 2: the picker moves to it.
  await expect(latest).toHaveText("1 latest", wait);
  await expect(pressed).toHaveText("1 latest");
  await expect(latest).toHaveText("2 latest", wait);
  await expect(pressed).toHaveText("2 latest");

  // An older round stays picked when round 3 resolves; the tag moves on.
  await tap("1");
  await expect(pressed).toHaveText("1");
  await expect(latest).toHaveText("3 latest", wait);
  await expect(pressed).toHaveText("1");

  // All stays picked through round 4.
  await tap("All");
  await expect(pressed).toHaveText("All");
  await expect(latest).toHaveText("4 latest", wait);
  await expect(pressed).toHaveText("All");
  await expect(pressed).toHaveCount(1);
});

for (const width of WIDTHS) {
  test(`${width}px: one row, the next round peeks past the latest; screenshots @caseboard`, async ({ browser }, info) => {
    test.skip(info.project.name !== "mobile", "viewports are set per test");
    const { ctx, page, board } = await gallery(browser, width, true);
    const row = board.locator(".cb__rounds");
    const latest = row.getByRole("button", { name: "4 latest" });
    const next = row.getByRole("button", { name: "5", exact: true });
    const box = (await row.boundingBox())!;
    await expect.poll(async () => (await latest.boundingBox())!.x + (await latest.boundingBox())!.width).toBeLessThanOrEqual(box.x + box.width);
    // The round after the latest is partly in the row (it shows the row scrolls) unless every round fits.
    const fits = await row.evaluate((el) => el.scrollWidth <= el.clientWidth);
    if (!fits) {
      const n = (await next.boundingBox())!;
      expect(n.x, "next round starts inside the row").toBeLessThan(box.x + box.width);
    }
    // The tag sits inside its button, not cut off by the row.
    const tag = (await latest.locator(".cb__latest").boundingBox())!;
    expect(tag.y + tag.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    await board.locator(".cb__picker").screenshot({ path: info.outputPath(`picker-${width}.png`) });
    await board.screenshot({ path: info.outputPath(`board-latest-${width}.png`) });
    await row.getByRole("button", { name: "2", exact: true }).click();
    await board.screenshot({ path: info.outputPath(`board-r2-${width}.png`) });
    await board.getByRole("button", { name: "All", exact: true }).click();
    await board.screenshot({ path: info.outputPath(`board-all-${width}.png`) });
    await page.locator('section[aria-labelledby="g-lead-kinds"]').screenshot({ path: info.outputPath(`gallery-kinds-${width}.png`) });
    await ctx.close();
  });
}

test("a mouse scrolls the round row with Shift+wheel and the page doesn't scroll sideways @caseboard", async ({ browser }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  const { ctx, page, board } = await gallery(browser, 360, false);
  const row = board.locator(".cb__rounds");
  await row.evaluate((el) => (el.scrollLeft = 0));
  await row.hover();
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 300);
  await page.keyboard.up("Shift");
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  // All stays put while the rounds scroll.
  const all = board.getByRole("button", { name: "All", exact: true });
  expect((await all.boundingBox())!.x).toBeLessThan((await row.boundingBox())!.x);
  await ctx.close();
});
