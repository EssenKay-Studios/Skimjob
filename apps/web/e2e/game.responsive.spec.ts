import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// The live game screen (M2-6) at every launch viewport (decisions.md
// 2026-11-01 "Web-first launch; responsive everywhere"): no horizontal
// overflow and every target at least 44 px, with the move panel open and a
// room picked (slider and the Security watch picker showing).

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function smallTargets(page: Page) {
  await settle(page);
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [role=button]")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim()} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );
}

const overflow = (page: Page) =>
  page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, viewport: window.innerWidth }));

for (const viewport of VIEWPORTS) {
  for (const touch of [false, true]) {
    test(`game screen at ${viewport.width}x${viewport.height}${touch ? " touch" : ""}: no overflow, targets ≥44px`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
      const page = await ctx.newPage();
      // One-week preset: the first round lasts long enough to look around.
      const game = await startGame(page.request, { bots: 5, sessionLength: "1w" });
      await page.goto(`/game/${game.id}`);
      await expect(page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
      await page.locator('.room-tile[data-room="Security"]').click();
      await expect(page.getByRole("group", { name: "Room to watch" })).toBeVisible();
      await page.getByRole("button", { name: /Case file/ }).click();

      const o = await overflow(page);
      expect(o.scroll).toBeLessThanOrEqual(o.client);
      expect(o.viewport).toBe(viewport.width);
      expect(await smallTargets(page)).toEqual([]);

      await page.locator('.room-tile[data-room="Vault"]').click();
      await expect(page.locator("#split")).toBeVisible();
      const o2 = await overflow(page);
      expect(o2.scroll).toBeLessThanOrEqual(o2.client);
      expect(await smallTargets(page)).toEqual([]);
      await ctx.close();
    });
  }
}
