import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// The role cards and rulebook (design §11, §12, §20), the round cap and
// the Wanted meter (design §5.4) in a real game, and the lobby's role-list
// setting (design §11.3). Numbers are never asserted: the balance pass tunes them
// in packages/content. SHOTS_DIR=… saves the gallery sections per viewport.
const SHOTS = process.env.SHOTS_DIR;

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("gallery extension sections fit every viewport @shop", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  test.setTimeout(120_000);
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 1400 });
    await page.goto("/dev/gallery");
    await expect(page.getByRole("heading", { name: "Rulebook sheet", level: 3 })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (!SHOTS) continue;
    mkdirSync(SHOTS, { recursive: true });
    for (const id of ["ext-role-card", "ext-rulebook", "ext-notells", "ext-end-fail"]) {
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

test("a real game shows the round cap and the Wanted meter @shop", async ({ page }) => {
  test.setTimeout(90_000);
  const game = await startGame(page.request, { bots: 4 });
  await page.goto(`/game/${game.id}`);
  // design §6.2: 12 rounds at most.
  await expect(page.locator(".hud__kicker")).toContainText(/^Round 1 of 12$/);
  // design §5.4: Wanted is public from the start.
  await expect(page.getByRole("meter", { name: /^Wanted \d of 3$/ })).toBeVisible();
});

test("lobby: the role list persists, and there is no deck, deal or role picker (design §11.3, §16) @lobby", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  await page.goto("/");
  await page.getByRole("button", { name: "Plan a heist" }).click();
  await page.getByLabel("Your name in this game").fill("Mara");
  await page.getByRole("button", { name: "Open the lobby" }).click();
  await expect(page).toHaveURL(/\/lobby\//);
  const group = (name: string) => page.getByRole("group", { name, exact: true });
  await group("Session length").getByRole("button", { name: "1 hour" }).click();

  // design §11.3: every player gets a role by the standard deal; the host only picks what the crew is told.
  await expect(group("Deck")).toHaveCount(0);
  await expect(group("Deal")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pick roles one by one" })).toHaveCount(0);
  await group("Role list").getByRole("button", { name: "Possible" }).click();
  await expect(group("Role list").getByRole("button", { name: "Possible" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(group("Role list").getByRole("button", { name: "Possible" })).toHaveAttribute("aria-pressed", "true");
  // The 15-minute length keeps the host's role list.
  await group("Session length").getByRole("button", { name: "15 min" }).click();
  await expect(group("Session length").getByRole("button", { name: "15 min" })).toHaveAttribute("aria-pressed", "true");
  await expect(group("Role list").getByRole("button", { name: "Possible" })).toHaveAttribute("aria-pressed", "true");
});
