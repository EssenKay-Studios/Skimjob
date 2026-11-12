import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openPanel, settle, startGame } from "./setupGame";

// The black market sheet (design §12, mockup 5a): on /dev/gallery's local game,
// buy with a target picker that never offers yourself (§11.1), the last-round
// warning before paying, one perk a round, and the nameless notices (§18); at
// the five launch widths; then a real purchase in a real game.
// SHOTS_DIR=… saves screenshots per width.
const SHOTS = process.env.SHOTS_DIR;
const WIDTHS = [360, 390, 768, 1024, 1280];

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const smallTargets = (page: Page, sel: string) =>
  page.evaluate(
    (s) =>
      [...document.querySelectorAll<HTMLElement>(`${s} button`)]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
        .map(({ el, r }) => `${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim()} ${Math.round(r.width)}x${Math.round(r.height)}`),
    sel,
  );

test.describe("gallery black market", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

  test("buy with a target, never yourself; one perk a round; the last round warns before paying @shop", async ({ page }) => {
    await page.goto("/dev/gallery");
    const mid = page.getByRole("group", { name: "Round 2" });
    // design §12, §18: round 1's purchase, logged without a name.
    await expect(mid.locator(".market__sale")).toHaveText(["🛒 Someone bought Soft shoes (2 coins). R1"]);
    await expect(mid.getByText("1 perk a round")).toBeVisible();
    await expect(mid.locator(".market__stash .num")).toHaveText("6"); // 5, plus round 1's share

    // Each price is announced, not only drawn.
    await expect(mid.getByRole("img", { name: /^\d coins?$/ })).toHaveText(["1", "2", "3"]);
    await mid.getByRole("button", { name: "Buy Plant evidence" }).click();
    const players = mid.getByRole("group", { name: "Player" });
    await expect(players.getByRole("button")).toHaveText(["Ava", "Ben", "Cleo"]); // never Sam (you), design §11.1
    const pay = mid.getByRole("button", { name: "Pay 3 coins" });
    await expect(pay).toBeDisabled();
    await players.getByRole("button", { name: "Ben" }).click();
    await expect(pay).toBeDisabled();
    await mid.getByRole("group", { name: "Room" }).getByRole("button", { name: "Vault" }).click();
    // Not the last round: no warning.
    await expect(mid.locator(".perk__warn")).toHaveCount(0);
    await pay.click();
    await expect(mid.getByRole("status")).toContainText("You bought Plant evidence this round");
    await expect(mid.locator(".market__stash .num")).toHaveText("3");
    for (const name of ["Buy Tail", "Buy Soft shoes", "Buy Plant evidence"]) await expect(mid.getByRole("button", { name })).toBeDisabled();

    // design §12: bought in the last round, a "next round" perk does nothing; it says so before you pay.
    const last = page.getByRole("group", { name: "The last round" });
    await last.getByRole("button", { name: "Buy Soft shoes" }).click();
    await expect(last.locator(".perk__warn")).toHaveText(/last round: Soft shoes works next round, so it would do nothing/);
    await last.getByRole("button", { name: "Buy Plant evidence" }).click();
    await expect(last.locator(".perk__warn")).toHaveCount(0);
  });

  for (const width of WIDTHS) {
    test(`at ${width}px the sheet fits, its targets are ≥44px, no hover needed @shop`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dev/gallery");
      const section = page.locator('section[aria-labelledby="g-market"]');
      await section.scrollIntoViewIfNeeded();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await section.getByRole("button", { name: "Black market", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: /^Black market/ });
      await expect(sheet).toBeVisible();
      await sheet.getByRole("button", { name: "Buy Tail" }).click();
      await expect(sheet.getByRole("group", { name: "Room" })).toBeVisible();
      expect(await smallTargets(page, "dialog.bsheet[open]")).toEqual([]);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      const box = await sheet.locator(".bsheet__sheet").boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/market-sheet-${width}.png` });
      }
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    });
  }
});

test("a real game: buy a perk; the crew hears of it with no name as the round resolves @shop", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  test.setTimeout(240_000);
  const game = await startGame(page.request, { bots: 2, sessionLength: "1h" });
  await page.goto(`/game/${game.id}`);
  const sheet = page.getByRole("dialog", { name: /^Black market/ });
  // Perks are paid from the stash (design §12): wait for a round that starts with a coin in it.
  for (let round = 1; ; round++) {
    expect(round, "a stash to pay from by round 5").toBeLessThan(6);
    await expect(page.getByRole("heading", { name: `Round ${round} · Pick your room`, level: 2 })).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Black market", exact: true }).click();
    if ((await sheet.locator(".market__stash .num").textContent()) !== "0") break;
    await page.keyboard.press("Escape");
  }
  // Tier 1 costs one coin; it is always the first card.
  const first = sheet.locator(".perk").first();
  const name = (await first.locator(".perk__name").textContent())!;
  await first.getByRole("button", { name: `Buy ${name}` }).click();
  for (const group of ["Player", "Room"]) {
    const g = first.getByRole("group", { name: group });
    if (await g.count()) await g.getByRole("button").first().click();
  }
  await first.getByRole("button", { name: "Pay 1 coin" }).click();
  await expect(sheet.getByRole("status")).toContainText(`You bought ${name} this round`);
  await page.keyboard.press("Escape");
  // Held until the round resolves, then public and nameless.
  await openPanel(page, "Case");
  await expect(page.getByRole("region", { name: "Case board" })).toContainText(`Someone bought ${name}`, { timeout: 90_000 });
});
