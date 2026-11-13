import { expect, test, type Page } from "@playwright/test";
import { openPanel, startGame, settle } from "./setupGame";

/** A public event any time (design §11.3): the player claims the Lookout from the role card. */
async function claimLookout(page: Page): Promise<void> {
  await openPanel(page, "This round");
  const card = page.locator(".role-card");
  await card.getByRole("button", { name: "Claim role" }).click();
  await card.getByRole("group", { name: "Role to claim" }).getByRole("button", { name: "Lookout" }).click();
  await card.getByRole("button", { name: "Claim the Lookout" }).click();
  await expect(card.getByText("You claimed to be the Lookout.")).toBeVisible();
}

// M2-10: "While you were away" (design §13), and your private note on a seat in
// the case board's Players strip (§15.3, §15.4), at every launch width.

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

/** The seen mark reaching the server (debounced on the page). */
const seenSaved = (page: Page) => page.waitForResponse((r) => r.url().includes("/notes/seen") && r.request().method() === "PATCH" && r.ok());

/** Taps a seat in the case board's Players strip; its note card comes up. design §15.4 */
async function openSeat(page: Page, name: string) {
  await openPanel(page, "Case");
  const board = page.getByRole("region", { name: "Case board" });
  const seat = board.getByRole("list", { name: "Players" }).getByRole("button", { name: new RegExp(`^${name},`) });
  if ((await seat.getAttribute("aria-pressed")) !== "true") await seat.click();
  return board.getByRole("group", { name: `Your note on ${name}` });
}

test("the recap shows what changed while you were away, once, and your notes stay private @caseboard", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one viewport is enough for the flow; widths are checked below");
  test.setTimeout(90_000);
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  // One-week preset: rounds are long, so nothing else happens meanwhile.
  const game = await startGame(host.request, { bots: 3, guests: [guest.request], sessionLength: "1w" });

  // First visit: nothing to catch up on; the mark is set.
  const saved = seenSaved(host);
  await host.goto(`/game/${game.id}`);
  await expect(host.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
  await saved;
  await expect(host.getByRole("region", { name: "While you were away" })).toHaveCount(0);
  await host.close();

  // While the host is away, the guest claims a role.
  await guest.goto(`/game/${game.id}`);
  await claimLookout(guest);

  // Back: the recap is at the top of the screen.
  const back = await hostCtx.newPage();
  // One GET /notes per game page, shared by the recap, the notes and the pins (#165); dev StrictMode mounts effects twice.
  let notesLoads = 0;
  back.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname.endsWith(`/games/${game.id}/notes`)) notesLoads++;
  });
  await back.goto(`/game/${game.id}`);
  const recap = back.getByRole("region", { name: "While you were away" });
  await expect(recap).toBeVisible();
  await openPanel(back, "Case");
  await expect(back.getByRole("region", { name: "Case board" }).getByRole("button", { name: /^Pin:/ }).first()).toBeEnabled();
  expect(notesLoads).toBeGreaterThan(0);
  expect(notesLoads).toBeLessThanOrEqual(2);
  await expect(recap).toContainText("Guest 1 claims to be the Lookout.");
  expect(await recap.locator(".away__line").count()).toBeGreaterThanOrEqual(2);
  const dismissed = seenSaved(back);
  await recap.getByRole("button", { name: "Caught up" }).click();
  await expect(recap).toHaveCount(0);
  await dismissed;
  await back.reload();
  await expect(back.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
  await expect(back.getByRole("region", { name: "While you were away" })).toHaveCount(0);

  // design §15.3: a note on the guest from the Players strip; it survives a reload.
  const note = await openSeat(back, "Guest 1");
  await note.getByRole("button", { name: "Add note" }).click();
  await note.getByLabel("Note on Guest 1").fill("Says Lobby, smells like Vault");
  await note.getByRole("button", { name: "Save note" }).click();
  await expect(note.locator(".cb__note-text")).toHaveText("Says Lobby, smells like Vault");
  await expect(note.getByRole("button", { name: "Edit note" })).toBeVisible();
  await back.reload();
  await expect((await openSeat(back, "Guest 1")).locator(".cb__note-text")).toHaveText("Says Lobby, smells like Vault");

  // The guest sees none of it, anywhere on their screen; their note on the host is empty.
  await guest.reload();
  await expect((await openSeat(guest, "Host")).getByRole("button", { name: "Add note" })).toBeVisible();
  await expect(guest.locator("body")).not.toContainText("smells like Vault");

  // Cancel keeps the note; saving it empty clears it, also after a reload.
  const again = await openSeat(back, "Guest 1");
  await again.getByRole("button", { name: "Edit note" }).click();
  await again.getByLabel("Note on Guest 1").fill("changed my mind");
  await again.getByRole("button", { name: "Cancel" }).click();
  await expect(again.locator(".cb__note-text")).toHaveText("Says Lobby, smells like Vault");
  await again.getByRole("button", { name: "Edit note" }).click();
  await again.getByLabel("Note on Guest 1").fill("");
  await again.getByRole("button", { name: "Save note" }).click();
  await expect(again.getByRole("button", { name: "Add note" })).toBeVisible();
  await expect(again.locator(".cb__note-text")).toHaveCount(0);
  await back.reload();
  await expect((await openSeat(back, "Guest 1")).getByRole("button", { name: "Add note" })).toBeVisible();
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
  await claimLookout(guest);
  // It reaches the hidden tab's view, but nobody is looking: the mark stays put.
  await host.waitForTimeout(2500); // sleep: proves a negative while the tab is hidden
  expect(await lastSeen()).toBe(before);
  // Away long enough to count (AWAY_MIN_HIDDEN_MS, 10 s): a quick tab switch gets no recap.
  await host.waitForTimeout(Math.max(0, hiddenAt + 10_500 - Date.now())); // sleep: the away threshold is wall time (AWAY_MIN_HIDDEN_MS)

  await host.evaluate(() => (window as unknown as { setHidden: (h: boolean) => void }).setHidden(false));
  const recap = host.getByRole("region", { name: "While you were away" });
  await expect(recap).toBeVisible();
  await expect(recap).toContainText("Guest 1 claims to be the Lookout.");
  await host.waitForTimeout(2500); // sleep: proves a negative after the short switch
  expect(await lastSeen()).toBe(before);
  const dismissed = seenSaved(host);
  await recap.getByRole("button", { name: "Caught up" }).click();
  await dismissed;
  expect(await lastSeen()).toBeGreaterThan(before);
  await hostCtx.close();
  await guestCtx.close();
});

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
  test(`recap and the case board with a seat's note open at ${viewport.width}x${viewport.height}: no overflow, targets ≥44px @caseboard`, async ({ browser }, info) => {
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

    await openPanel(page, "Case");
    const board = page.getByRole("region", { name: "Case board" });
    await board.getByRole("list", { name: "Players" }).getByRole("button").first().click();
    const note = board.getByRole("group", { name: /^Your note on / });
    await note.getByRole("button", { name: "Add note" }).click();
    await note.getByRole("textbox").fill("W".repeat(280));
    await expect(note.getByRole("button", { name: "Save note" })).toBeVisible();

    const o = await overflow(page);
    expect(o.scroll).toBeLessThanOrEqual(o.client);
    expect(o.viewport).toBe(viewport.width);
    expect(await smallTargets(page)).toEqual([]);
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/m210-${viewport.width}.png`, fullPage: true });
    await ctx.close();
  });
}
