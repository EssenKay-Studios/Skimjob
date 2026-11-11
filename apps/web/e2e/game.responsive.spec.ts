import { expect, test, type Page } from "@playwright/test";
import { callEmergency, closePanel, openPanel, startGame } from "./setupGame";
import { pickRoom, pileCoins } from "./move";

// The live game screen (M2-6) at every launch viewport (decisions.md
// 2026-11-01 "Web-first launch; responsive everywhere"): no horizontal
// overflow and every target at least 44 px, with the move panel open and a
// room picked (slider and the Security watch picker showing), and the bank
// board (M2-9) picking a room.

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
    test(`game screen at ${viewport.width}x${viewport.height}${touch ? " touch" : ""}: no overflow, targets ≥44px @move`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
      const page = await ctx.newPage();
      // One-week preset: the first round lasts long enough to look around.
      const game = await startGame(page.request, { bots: 5, sessionLength: "1w" });
      await page.goto(`/game/${game.id}`);
      await openPanel(page, "This round");
      await expect(page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
      await pickRoom(page, "Security");
      await expect(page.getByRole("group", { name: "Room to watch" })).toBeVisible();

      const o = await overflow(page);
      expect(o.scroll).toBeLessThanOrEqual(o.client);
      expect(o.viewport).toBe(viewport.width);
      expect(await smallTargets(page)).toEqual([]);

      await pickRoom(page, "Vault");
      // The coins and the two bags (every role may pocket).
      await expect(page.locator("[data-pile=duffel]")).toBeVisible();
      await expect(page.locator("[data-pile=pocket]")).toBeVisible();
      const o2 = await overflow(page);
      expect(o2.scroll).toBeLessThanOrEqual(o2.client);
      expect(await smallTargets(page)).toEqual([]);
      // A coin picked up (#232): it lifts and drop places show in the Grab row and the Pocket, still fitting.
      await pileCoins(page, "duffel").first().click();
      await expect(page.getByRole("button", { name: "Drop the coin in your pocket" })).toBeVisible();
      const held = await overflow(page);
      expect(held.scroll).toBeLessThanOrEqual(held.client);
      expect(await smallTargets(page)).toEqual([]);
      await pileCoins(page, "duffel").first().click(); // put it down again

      // M2-9: the bank board is the main board; tapping a room picks it in the move panel.
      await closePanel(page); // below 1024 px the sheet covers the board
      const board = page.getByRole("region", { name: "The bank" });
      const bank = await board.locator(".bank__svg").boundingBox();
      expect(bank!.x).toBeGreaterThanOrEqual(0);
      expect(bank!.x + bank!.width).toBeLessThanOrEqual(viewport.width);
      await board.locator(".bank-room[data-room=office]").click();
      await openPanel(page, "This round");
      await expect(page.locator(".move__room-name")).toHaveText("Office");
      const o3 = await overflow(page);
      expect(o3.scroll).toBeLessThanOrEqual(o3.client);
      expect(await smallTargets(page)).toEqual([]);

      // R4b: the role card's Claim role list open.
      await page.locator(".role-card").getByRole("button", { name: "Claim role" }).click();
      await expect(page.locator(".role-card").getByRole("group", { name: "Role to claim" })).toBeVisible();
      const o4 = await overflow(page);
      expect(o4.scroll).toBeLessThanOrEqual(o4.client);
      expect(await smallTargets(page)).toEqual([]);

      // The shell's other panels (side tabs from 1024 px, sheets below), each fitting the screen.
      for (const name of ["Crew", "Case", "Notes", "Chat"] as const) {
        await openPanel(page, name);
        const o5 = await overflow(page);
        expect(o5.scroll, `${name} panel: overflow`).toBeLessThanOrEqual(o5.client);
        expect(await smallTargets(page), `${name} panel: small targets`).toEqual([]);
      }

      // From 1024 px the top bar's content sits in the shell's column: the logo and the status strip share a left edge, and the bar ends where the strip does.
      if (viewport.width >= 1024) {
        // The link's box hangs 6 px into the margin so the drawn logo, its first child, lines up with the gutter.
        const home = (await page.locator(".topbar__home > :first-child").first().boundingBox())!;
        const strip = (await page.locator(".shell__status").boundingBox())!;
        expect(Math.abs(home.x - strip.x), "logo and status strip share a left edge").toBeLessThanOrEqual(1);
        const last = (await page.locator(".topbar > :last-child").boundingBox())!;
        expect(Math.abs(last.x + last.width - (strip.x + strip.width)), "the top bar ends at the strip's right edge").toBeLessThanOrEqual(1);
      }
      await ctx.close();
    });
  }
}

// M2-7: the meetings panel (1-week preset: the slot planner and the sealed
// vote), the vote dialog and the result card at every launch width.
for (const viewport of VIEWPORTS) {
  for (const touch of [false, true]) {
    test(`meetings at ${viewport.width}x${viewport.height}${touch ? " touch" : ""}: planner, vote dialog, results @meeting`, async ({ browser }) => {
      test.setTimeout(90_000);
      const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
      const page = await ctx.newPage();
      const check = async (where: string) => {
        const o = await overflow(page);
        expect(o.scroll, `${where}: overflow`).toBeLessThanOrEqual(o.client);
        expect(o.viewport).toBe(viewport.width);
        expect(await smallTargets(page), `${where}: small targets`).toEqual([]);
      };

      // Three people, no bots: the slot planner is for people.
      const other = await browser.newContext();
      const third = await browser.newContext();
      const week = await startGame(page.request, { bots: 0, guests: [other.request, third.request], sessionLength: "1w" });
      await page.goto(`/game/${week.id}`);
      await openPanel(page, "This round");
      const panel = page.getByRole("region", { name: "Crew meetings" });
      await expect(panel.getByLabel("Propose a time")).toBeVisible();
      await panel.getByText("Can't make the meeting?").click();
      await expect(panel.getByRole("group", { name: "Sealed vote" })).toBeVisible();
      await check("planner");
      await other.close();
      await third.close();

      // A fresh game in the 1-hour preset: call an emergency, vote in the dialog, see the results.
      const hour = await startGame(page.request, { bots: 5, sessionLength: "1h", voteVisibility: "open" });
      await page.goto(`/game/${hour.id}`);
      await openPanel(page, "This round"); // below 1024 px the vote dialog opens over this sheet
      // design §9.3: the crew shares one emergency, and a bot may spend it in round 1's result window (about 1 game in 20);
      // its meeting opens the same dialog, so only call it while it's still ours to call.
      const dialog = page.getByRole("dialog", { name: "Who's skimming?" });
      const call = page.getByRole("button", { name: "Call an emergency meeting", disabled: false });
      await expect(call.or(dialog)).toBeVisible({ timeout: 60_000 });
      if (await call.isVisible()) await callEmergency(page);
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await dialog.getByRole("group", { name: "Your vote" }).getByRole("button", { name: "Skip" }).click();
      await dialog.getByRole("button", { name: "Cast vote" }).click();
      await expect(dialog.getByRole("button", { name: "Vote cast" })).toBeVisible();
      await check("vote dialog");
      await dialog.getByRole("button", { name: "Back to the board" }).click();
      await check("meeting on");
      await expect(page.getByRole("button", { name: "Back to the bank" })).toBeVisible({ timeout: 40_000 });
      await check("results");
      await ctx.close();
    });
  }
}
