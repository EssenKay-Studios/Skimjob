import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// The chat (M2-8b) at every launch viewport (decisions.md 2026-11-01 "Web-first
// launch; responsive everywhere"): a side panel from 1024 px, a sheet behind a
// button below (full screen on phones). No horizontal overflow and every target
// at least 44 px with long messages, a DM tab, the DM picker and the evidence
// picker showing. SHOTS_DIR=… saves screenshots.
const SHOTS = process.env.SHOTS_DIR;

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

async function noOverflow(page: Page, width: number) {
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, viewport: window.innerWidth }));
  expect(o.scroll).toBeLessThanOrEqual(o.client);
  expect(o.viewport).toBe(width);
  // The panel itself never scrolls sideways either.
  const inner = await page.locator(".chat").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(inner).toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/chat-${name}-${page.viewportSize()!.width}.png` });
}

for (const viewport of VIEWPORTS) {
  for (const touch of [false, true]) {
    test(`chat at ${viewport.width}x${viewport.height}${touch ? " touch" : ""}: no overflow, targets ≥44px @chat`, async ({ browser }) => {
      test.setTimeout(90_000);
      const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
      const page = await ctx.newPage();
      const guestCtx = await browser.newContext({ viewport });
      const guest = await guestCtx.newPage();
      const game = await startGame(page.request, { bots: 3, guests: [guest.request], sessionLength: "1w" });
      await page.goto(`/game/${game.id}`);
      await expect(page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();

      const wide = viewport.width >= 1024;
      const fab = page.locator(".chat-fab");
      if (wide) await expect(fab).toHaveCount(0);
      else {
        await expect(fab).toBeVisible();
        await expect(page.getByRole("region", { name: "Chat" })).toBeHidden();
        expect(await smallTargets(page)).toEqual([]);
        await fab.click();
      }
      const chat = page.getByRole("region", { name: "Chat" });
      await expect(chat).toBeVisible();
      if (viewport.width <= 560) {
        // Phones: full screen (inside the safe-area padding).
        const box = (await chat.boundingBox())!;
        expect(box.width).toBeGreaterThan(viewport.width - 24);
        expect(box.height).toBeGreaterThan(viewport.height - 24);
      }

      // Long words, long lines and a DM thread.
      const long = `${"Supercalifragilistic".repeat(8)} and a normal sentence that has to wrap onto a few lines in a narrow panel.`;
      await page.locator(".chat__input").fill(long);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.locator(".chat-msg__text").first()).toContainText("Supercalifragilistic");
      await page.getByRole("button", { name: "DM", exact: true }).click();
      await expect(page.getByRole("group", { name: "Message a player privately" })).toBeVisible();
      await noOverflow(page, viewport.width);
      expect(await smallTargets(page)).toEqual([]);
      await page.getByRole("group", { name: "Message a player privately" }).getByRole("button").first().click();
      await page.locator(".chat__input").fill("A private word with a VeryLongUnbrokenNameOfAPlanThatGoesOnAndOnAndOnAndOnAndOnForever");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.getByRole("button", { name: "Share evidence" }).click();
      await expect(page.getByRole("group", { name: "Share a case-file entry" })).toBeVisible();
      await noOverflow(page, viewport.width);
      expect(await smallTargets(page)).toEqual([]);
      await shot(page, touch ? "touch" : "open");

      if (!wide) {
        await page.getByRole("button", { name: "Close chat" }).click();
        await expect(chat).toBeHidden();
        await expect(fab).toBeFocused();
      }
      await ctx.close();
      await guestCtx.close();
    });
  }
}
