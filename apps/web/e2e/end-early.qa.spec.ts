import { expect, test, type Page } from "@playwright/test";
import { closePanel, openPanel, startGame } from "./setupGame";

// QA, #239 End game early (design §6.2, §16): at 360, 390, 768, 1024 and 1280 px, by touch
// (narrow) and mouse (wide). The host's controls sit in the Menu and nowhere in "This round";
// the first tap only arms; the confirm ends it for everyone: the ended screen, no reveal, no
// sideways scroll, ≥ 44 px targets; the guest's Menu never offers it.

test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

const fits = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function expectTarget(p: Page, name: string, width: number) {
  const box = (await p.getByRole("button", { name, exact: true }).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
}

for (const width of [360, 390, 768, 1024, 1280]) {
  const touch = width < 1024;
  test(`End game early at ${width}px (${touch ? "touch" : "mouse"}): host only, arms first, then everyone sees the end @host`, async ({ browser }, info) => {
    test.setTimeout(90_000);
    const ctx = { viewport: { width, height: 800 }, hasTouch: touch };
    const hostCtx = await browser.newContext(ctx);
    const guestCtx = await browser.newContext(ctx);
    const page = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const errors: string[] = [];
    for (const p of [page, guest]) p.on("pageerror", (e) => errors.push(e.message));
    const press = (p: Page, name: string) => (touch ? p.getByRole("button", { name, exact: true }).tap() : p.getByRole("button", { name, exact: true }).click());
    const game = await startGame(page.request, { bots: 1, guests: [guest.request], sessionLength: "1h" });
    await page.goto(`/game/${game.id}`);
    await guest.goto(`/game/${game.id}`);
    await expect(page.locator(".hud__kicker")).toContainText(/Round 1 of/);
    await expect(guest.locator(".hud__kicker")).toContainText(/Round 1 of/);

    // Not in "This round", for anyone.
    for (const p of [page, guest]) {
      await openPanel(p, "This round");
      await expect(p.getByRole("button", { name: "End game early" })).toHaveCount(0);
      await expect(p.getByRole("button", { name: "Pause the game" })).toHaveCount(0);
      await closePanel(p);
    }
    // The guest's Menu has neither.
    await press(guest, "Menu");
    await expect(guest.getByRole("heading", { name: "Game menu" })).toBeVisible();
    await expect(guest.getByRole("region", { name: "Host controls" })).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "End game early" })).toHaveCount(0);
    await press(guest, "Close");

    // The host's Menu: every control, each a full touch target inside the screen.
    await press(page, "Menu");
    const panel = page.getByRole("region", { name: "Host controls" });
    await expect(panel).toBeVisible();
    for (const name of ["Pause the game", "Add time", "End game early", "Close"]) {
      await page.getByRole("button", { name, exact: true }).scrollIntoViewIfNeeded();
      await expectTarget(page, name, width);
    }
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: info.outputPath(`menu-host-${width}.png`) });

    // The first press only arms it; the game runs on for the guest.
    await press(page, "End game early");
    await expect(panel.getByRole("button", { name: "End it for everyone?" })).toBeVisible();
    await expectTarget(page, "End it for everyone?", width);
    await page.getByRole("button", { name: "End it for everyone?" }).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));
    await page.screenshot({ path: info.outputPath(`menu-armed-${width}.png`) });
    await expect(guest.locator(".hud__kicker")).toContainText(/Round 1 of/);
    await expect(guest.getByRole("heading", { name: "The host ended the game" })).toHaveCount(0);

    await press(page, "End it for everyone?");
    for (const [who, p] of [["host", page], ["guest", guest]] as const) {
      await expect(p.getByRole("heading", { name: "The host ended the game" })).toBeVisible();
      await expect(p.getByText("Nobody wins and nothing is scored.")).toBeVisible();
      // No reveal, no ranking, no game board behind it.
      await expect(p.locator(".hud__kicker")).toHaveCount(0);
      await expect(p.getByText(/Job done|Busted|\bwins?\b(?! and nothing)/)).toHaveCount(0);
      await expectTarget(p, "Back to the start", width);
      expect(await fits(p)).toBe(true);
      await p.screenshot({ path: info.outputPath(`ended-${who}-${width}.png`), fullPage: true });
    }
    // The host's Menu (still open from the confirm) no longer offers the controls.
    if (!(await page.getByRole("heading", { name: "Game menu" }).isVisible())) await press(page, "Menu");
    await expect(page.getByRole("region", { name: "Host controls" })).toHaveCount(0);
    await press(page, "Close");

    // A reload keeps the ended screen; Back to the start leaves it.
    await guest.reload();
    await expect(guest.getByRole("heading", { name: "The host ended the game" })).toBeVisible();
    await press(guest, "Back to the start");
    await expect(guest).not.toHaveURL(/\/game\//);
    expect(errors).toEqual([]);
    await hostCtx.close();
    await guestCtx.close();
  });
}
