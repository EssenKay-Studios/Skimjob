import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// M2-10: "While you were away" (design §13), the suspicion board (§12.3) and
// the case board, at every launch width.

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

/** The seen mark reaching the server (debounced on the page). */
const seenSaved = (page: Page) => page.waitForResponse((r) => r.url().includes("/notes/seen") && r.request().method() === "PATCH" && r.ok());

test("the recap shows what changed while you were away, once, and the board stays private @caseboard", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one viewport is enough for the flow; widths are checked below");
  test.setTimeout(90_000);
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  // One-week preset: rounds and the emergency's lead time are long, so nothing else happens meanwhile.
  const game = await startGame(host.request, { bots: 3, guests: [guest.request], sessionLength: "1w" });

  // First visit: nothing to catch up on; the mark is set.
  const saved = seenSaved(host);
  await host.goto(`/game/${game.id}`);
  await expect(host.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
  await saved;
  await expect(host.getByRole("region", { name: "While you were away" })).toHaveCount(0);
  await host.close();

  // While the host is away, the guest calls an emergency meeting.
  await guest.goto(`/game/${game.id}`);
  await guest.getByRole("button", { name: "Call an emergency meeting" }).click();
  await guest.getByRole("button", { name: "Sure? Tap again to call it" }).click();
  await expect(guest.locator(".hud__alert")).toContainText("Emergency meeting in");

  // Back: the recap is at the top of the screen.
  const back = await hostCtx.newPage();
  await back.goto(`/game/${game.id}`);
  const recap = back.getByRole("region", { name: "While you were away" });
  await expect(recap).toBeVisible();
  await expect(recap).toContainText("Guest 1 called an emergency meeting.");
  expect(await recap.locator(".away__line").count()).toBeGreaterThanOrEqual(2);
  const dismissed = seenSaved(back);
  await recap.getByRole("button", { name: "Caught up" }).click();
  await expect(recap).toHaveCount(0);
  await dismissed;
  await back.reload();
  await expect(back.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
  await expect(back.getByRole("region", { name: "While you were away" })).toHaveCount(0);

  // design §12.3: tag the guest suspicious with a note; it survives a reload.
  const board = back.getByRole("region", { name: "Your suspicion board" });
  const row = board.getByRole("group", { name: "Your tag for Guest 1" });
  await row.getByRole("button", { name: "Suspicious" }).click();
  await expect(row.getByRole("button", { name: "Suspicious" })).toHaveAttribute("aria-pressed", "true");
  await row.getByRole("button", { name: "Add note" }).click();
  await board.getByLabel("Note on Guest 1").fill("Says Lobby, smells like Vault");
  await board.getByRole("button", { name: "Save note" }).click();
  await expect(board).toContainText("Says Lobby, smells like Vault");
  await expect(back.locator(".crew .sus-mark--suspicious")).toHaveText("Suspicious");
  await back.reload();
  await expect(back.getByRole("region", { name: "Your suspicion board" })).toContainText("Says Lobby, smells like Vault");
  await expect(back.getByRole("region", { name: "Your suspicion board" }).getByRole("group", { name: "Your tag for Guest 1" }).getByRole("button", { name: "Suspicious" })).toHaveAttribute("aria-pressed", "true");

  // The guest sees none of it, anywhere on their screen.
  await guest.reload();
  await expect(guest.getByRole("region", { name: "Your suspicion board" })).toBeVisible();
  await expect(guest.locator("body")).not.toContainText("smells like Vault");
  await expect(guest.locator(".sus-row.is-suspicious, .sus-mark")).toHaveCount(0);
  await hostCtx.close();
  await guestCtx.close();
});

test("a hidden tab coming back to the front shows the recap, and the missed events stay unseen until then (QA, PR #46) @caseboard", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one viewport is enough for the flow");
  test.setTimeout(90_000);
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  // A tab the test can hide and show: visibilityState plus the visibilitychange event.
  await host.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    (window as unknown as { setHidden: (h: boolean) => void }).setHidden = (h) => {
      hidden = h;
      document.dispatchEvent(new Event("visibilitychange"));
    };
  });
  const game = await startGame(host.request, { bots: 3, guests: [guest.request], sessionLength: "1w" });
  const saved = seenSaved(host);
  await host.goto(`/game/${game.id}`);
  await expect(host.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
  await saved;
  const lastSeen = async () => ((await (await host.request.get(`/api/games/${game.id}/notes`)).json()) as { lastSeen: number }).lastSeen;
  const before = await lastSeen();

  await host.evaluate(() => (window as unknown as { setHidden: (h: boolean) => void }).setHidden(true));
  const hiddenAt = Date.now();
  await guest.goto(`/game/${game.id}`);
  await guest.getByRole("button", { name: "Call an emergency meeting" }).click();
  await guest.getByRole("button", { name: "Sure? Tap again to call it" }).click();
  // It reaches the hidden tab's view (the emergency shows on its screen), but nobody is looking: the mark stays put.
  await expect(host.locator(".hud__alert")).toContainText("Emergency meeting in");
  await host.waitForTimeout(2500);
  expect(await lastSeen()).toBe(before);
  // Away long enough to count (AWAY_MIN_HIDDEN_MS, 10 s): a quick tab switch gets no recap.
  await host.waitForTimeout(Math.max(0, hiddenAt + 10_500 - Date.now()));

  await host.evaluate(() => (window as unknown as { setHidden: (h: boolean) => void }).setHidden(false));
  const recap = host.getByRole("region", { name: "While you were away" });
  await expect(recap).toBeVisible();
  await expect(recap).toContainText("Guest 1 called an emergency meeting.");
  await host.waitForTimeout(2500);
  expect(await lastSeen()).toBe(before);
  const dismissed = seenSaved(host);
  await recap.getByRole("button", { name: "Caught up" }).click();
  await dismissed;
  expect(await lastSeen()).toBeGreaterThan(before);
  await hostCtx.close();
  await guestCtx.close();
});

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
const overflow = (page: Page) => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, viewport: window.innerWidth }));

for (const viewport of VIEWPORTS) {
  test(`recap, the case board and the suspicion board at ${viewport.width}x${viewport.height}: no overflow, targets ≥44px @caseboard`, async ({ browser }, info) => {
    test.skip(info.project.name !== "mobile", "viewports are set per test");
    const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 1024, isMobile: viewport.width < 1024 });
    const page = await ctx.newPage();
    const game = await startGame(page.request, { bots: 5, sessionLength: "1w" });
    // As if last seen at the very start: the recap shows what has happened since.
    expect((await page.request.patch(`/api/games/${game.id}/notes/seen`, { data: { seq: 0 } })).ok()).toBe(true);
    await page.goto(`/game/${game.id}`);
    const recap = page.getByRole("region", { name: "While you were away" });
    await expect(recap).toBeVisible();
    const box = await recap.boundingBox();
    expect(box!.y).toBeLessThan(200);

    await expect(page.getByRole("region", { name: "Case board" })).toBeVisible();

    const board = page.getByRole("region", { name: "Your suspicion board" });
    const first = board.getByRole("group").first();
    await first.getByRole("button", { name: "Unsure" }).click();
    await expect(first.getByRole("button", { name: "Unsure" })).toHaveAttribute("aria-pressed", "true");
    await first.getByRole("button", { name: "Add note" }).click();

    const o = await overflow(page);
    expect(o.scroll).toBeLessThanOrEqual(o.client);
    expect(o.viewport).toBe(viewport.width);
    expect(await smallTargets(page)).toEqual([]);
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/m210-${viewport.width}.png`, fullPage: true });
    await ctx.close();
  });
}
