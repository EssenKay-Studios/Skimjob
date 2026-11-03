import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// R6b, the extension UI (docs/extension.md): the perk shop, the Heat
// breakdown and the gap box in a real game, and the lobby's deck, deal and
// role-list settings. Numbers are never asserted: the balance pass tunes them
// in packages/content. SHOTS_DIR=… saves the gallery sections per viewport.
const SHOTS = process.env.SHOTS_DIR;

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("gallery shop: earn tokens, buy a perk privately, use it once this round", async ({ page }) => {
  await page.goto("/dev/gallery");
  const demo = page.getByTestId("shop-demo");
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.getByText("only you see this")).toBeVisible();

  await demo.getByRole("button", { name: "Shop", exact: true }).click();
  const shop = page.getByRole("dialog", { name: "The shop" });
  const buyPeek = shop.getByRole("button", { name: /^Buy Peek for \d+$/ });
  await expect(buyPeek).toBeDisabled(); // no tokens yet
  const cost = Number((await buyPeek.getAttribute("aria-label"))!.match(/\d+$/)![0]);
  await shop.getByRole("button", { name: "Close" }).click();

  for (let i = 0; i < cost; i++) await demo.getByRole("button", { name: "Earn a token" }).click();
  await demo.getByRole("button", { name: "Shop", exact: true }).click();
  await expect(buyPeek).toBeEnabled();
  await buyPeek.click();
  await expect(shop.getByText("You own one.")).toBeVisible();
  await shop.getByRole("button", { name: "Close" }).click();

  // Use it: pick someone, peek; then the one-per-round note.
  const uses = demo.getByLabel("Use a perk");
  await uses.getByRole("group", { name: "Player to peek at" }).getByRole("button").first().click();
  await uses.getByRole("button", { name: "Peek", exact: true }).click();
  await expect(uses.getByText("You've used a perk this round.")).toBeVisible();
  await demo.getByRole("button", { name: "Next round" }).click();
  await expect(uses).toHaveCount(0); // nothing owned, nothing used this round
});

test("gallery extension sections fit every viewport", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  test.setTimeout(120_000);
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 1400 });
    await page.goto("/dev/gallery");
    await expect(page.getByRole("heading", { name: "Heat breakdown", level: 3 })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (!SHOTS) continue;
    mkdirSync(SHOTS, { recursive: true });
    for (const id of ["ext-role-card", "ext-rulebook", "ext-shop", "ext-target", "ext-heat", "ext-gap", "ext-notells", "ext-deck", "ext-end-fail"]) {
      // Viewport shots: Chromium paints tall element shots of this long page blank.
      const box = await page.locator(`section[aria-labelledby="g-${id}"]`).evaluate((el) => {
        el.scrollIntoView({ block: "start" });
        const r = el.getBoundingClientRect();
        return { x: r.x, y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, window.innerHeight - Math.max(0, r.y)) };
      });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/r6b-${id}-${width}.png`, clip: box });
    }
    await page.getByRole("button", { name: "Rulebook", exact: true }).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/r6b-rulebook-${width}.png` });
    await page.keyboard.press("Escape");
  }
});

test("a real game shows the target bar, the Heat breakdown and the gap box", async ({ page }) => {
  test.setTimeout(90_000);
  const game = await startGame(page.request, { bots: 4 });
  await page.goto(`/game/${game.id}`);
  await expect(page.locator(".hud__kicker")).toContainText(/Round 1 of 9 · Meeting 1 after round 3/);
  await expect(page.locator(".target-bar")).toContainText(/needed by the next meeting/);

  // Round 1 ends: its Heat lines and the gap box; posting an alibi counts in it.
  const heat = page.getByRole("region", { name: "Heat breakdown" });
  await expect(heat).toContainText("Heat, round 1", { timeout: 30_000 });
  const gap = page.getByRole("region", { name: /^Round 1 gap$/ });
  await expect(gap).toBeVisible();
  await page.getByRole("group", { name: "Alibi room" }).getByRole("button", { name: "Lobby" }).click();
  await page.getByRole("button", { name: "Post alibi" }).click();
  await expect(gap).toContainText(/[1-9] of 5 alibis in/);
  await expect(gap).toContainText(/Alibis say/);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/r6b-game-gap-${page.viewportSize()!.width}.png`, fullPage: true });
  }
});

test("lobby: deck, per-role picks, deal and role list persist; Quick locks Starter", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  await page.goto("/");
  await page.getByRole("button", { name: "Plan a heist" }).click();
  await page.getByLabel("Your name in this game").fill("Mara");
  await page.getByRole("button", { name: "Open the lobby" }).click();
  await expect(page).toHaveURL(/\/lobby\//);
  const group = (name: string) => page.getByRole("group", { name, exact: true });
  await group("Session length").getByRole("button", { name: "1 hour" }).click();

  await group("Deck").getByRole("button", { name: "Everything" }).click();
  await page.getByRole("button", { name: "Pick roles one by one" }).click();
  const first = page.locator(".deck-roles__chips").getByRole("button", { pressed: true }).first();
  const firstName = (await first.textContent())!;
  await first.click();
  await expect(page.locator(".deck-roles .seg__head")).toContainText("(your pick)");
  await group("Deal").getByRole("button", { name: "Truly random" }).click();
  await group("Role list").getByRole("button", { name: "Possible" }).click();
  await expect(group("Role list").getByRole("button", { name: "Possible" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(group("Deck").getByRole("button", { name: "Everything" })).toHaveAttribute("aria-pressed", "true");
  await expect(group("Deal").getByRole("button", { name: "Truly random" })).toHaveAttribute("aria-pressed", "true");
  await expect(group("Role list").getByRole("button", { name: "Possible" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Pick roles one by one" }).click();
  await expect(page.locator(".deck-roles__chips").getByRole("button", { name: firstName, exact: true })).toHaveAttribute("aria-pressed", "false");

  // Starter only turns event cards off: the per-role picks stay (tokens and the shop too).
  await group("Deck").getByRole("button", { name: "Starter" }).click();
  await expect(group("Deck").getByRole("button", { name: "Starter" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".deck-roles__chips").getByRole("button").first()).toBeVisible(); // the open picker stays
  await expect(page.getByText("Off with the Starter deck")).toBeVisible();

  // Quick: Starter, read-only, with the note.
  await group("Deck").getByRole("button", { name: "Standard" }).click();
  await group("Session length").getByRole("button", { name: "Quick 15 min" }).click();
  await expect(page.getByText("Quick games play the Starter deck")).toBeVisible();
  await expect(group("Deck").getByRole("button")).toHaveCount(0);
  await expect(group("Deck")).toContainText("Starter");
  await expect(page.getByRole("button", { name: "Pick roles one by one" })).toHaveCount(0);
  await expect(page.getByText("Off in Quick games")).toBeVisible();
});
