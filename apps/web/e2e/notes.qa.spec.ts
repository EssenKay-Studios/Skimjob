import { expect, test, type Page } from "@playwright/test";
import { openPanel, startGame } from "./setupGame";

// QA (M2-10, PR #46; #202): your private notes, now on the case board's Players
// strip, render hostile text as text and stay private (design §15.3); 12 seats
// at the narrowest and widest widths.
// (The hidden-tab recap is reported as a bug on the PR, not tested here.)

/** Taps a seat in the case board's Players strip; its note card comes up. design §15.4 */
async function openSeat(page: Page, name: string) {
  await openPanel(page, "Case");
  const board = page.getByRole("region", { name: "Case board" });
  const seat = board.getByRole("list", { name: "Players" }).getByRole("button", { name: new RegExp(`^${name},`) });
  if ((await seat.getAttribute("aria-pressed")) !== "true") await seat.click();
  return board.getByRole("group", { name: `Your note on ${name}` });
}

test("hostile notes are plain text; nothing of the notes reaches the other seat; another seat's notes are refused @caseboard", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one viewport is enough for the flow");
  test.setTimeout(60_000);
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  const errors: string[] = [];
  host.on("pageerror", (e) => errors.push(e.message));
  host.on("dialog", (d) => {
    errors.push(`dialog: ${d.message()}`);
    void d.dismiss();
  });
  const game = await startGame(host.request, { bots: 2, guests: [guest.request], sessionLength: "1w" });
  await host.goto(`/game/${game.id}`);
  const note = await openSeat(host, "Guest 1");
  await note.getByRole("button", { name: "Add note" }).click();
  const evil = `<img src=x onerror="window.__xss=1;alert(1)"><script>window.__xss=2</script>`;
  await note.getByLabel("Note on Guest 1").fill(evil);
  await note.getByRole("button", { name: "Save note" }).click();
  await expect(note.locator(".cb__note-text")).toHaveText(evil);
  await host.reload();
  await expect((await openSeat(host, "Guest 1")).locator(".cb__note-text")).toHaveText(evil);
  expect(await host.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await host.locator(".cb__note img, .cb__note script").count()).toBe(0);

  // An invisible-only note is refused with a message, and nothing is saved.
  const again = await openSeat(host, "Guest 1");
  await again.getByRole("button", { name: "Edit note" }).click();
  await again.getByLabel("Note on Guest 1").fill("\u200b\u200b");
  await again.getByRole("button", { name: "Save note" }).click();
  await expect(again.getByRole("alert")).toBeVisible();
  await host.reload();
  await expect((await openSeat(host, "Guest 1")).locator(".cb__note-text")).toHaveText(evil);

  // The guest's own notes are their own; a stranger has none.
  const mine = (await (await guest.request.get(`/api/games/${game.id}/notes`)).json()) as { board: Record<string, unknown> };
  expect(mine.board).toEqual({});
  const strangerCtx = await browser.newContext();
  const stranger = strangerCtx.request;
  await stranger.post("/api/auth/guest", { data: { nickname: "Nosy" } });
  expect((await stranger.get(`/api/games/${game.id}/notes`)).status()).toBe(404);
  expect((await stranger.patch(`/api/games/${game.id}/notes/board`, { data: { subject: "p1", note: "nosy" } })).status()).toBe(404);
  await guest.goto(`/game/${game.id}`);
  await expect(await openSeat(guest, "Host")).toBeVisible();
  await expect(guest.locator("body")).not.toContainText("onerror");
  expect(errors).toEqual([]);
  await strangerCtx.close();
  await hostCtx.close();
  await guestCtx.close();
});

for (const viewport of [
  { width: 360, height: 740 },
  { width: 1280, height: 800 },
]) {
  test(`12 seats at ${viewport.width}px: the Players strip, a long note and the crew fit, targets ≥44px @caseboard`, async ({ browser }, info) => {
    test.skip(info.project.name !== "mobile", "viewports are set per test");
    test.setTimeout(60_000);
    const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 1024, isMobile: viewport.width < 1024 });
    const page = await ctx.newPage();
    const game = await startGame(page.request, { bots: 11, sessionLength: "1w" });
    await page.goto(`/game/${game.id}`);
    await openPanel(page, "Case");
    const board = page.getByRole("region", { name: "Case board" });
    const seats = board.getByRole("list", { name: "Players" }).getByRole("button");
    await expect(seats).toHaveCount(11);
    // One long unbroken note on the last seat (the strip scrolls to it).
    await seats.nth(10).click();
    const note = board.getByRole("group", { name: /^Your note on / });
    await note.getByRole("button", { name: "Add note" }).click();
    await note.getByRole("textbox").fill("W".repeat(280));
    await note.getByRole("button", { name: "Save note" }).click();
    await expect(note.locator(".cb__note-text")).toHaveCount(1);
    // Each panel (a side tab from 1024 px, a sheet below) fits and has 44 px targets.
    const fits = async (selector: string) => {
      const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(o.scroll).toBeLessThanOrEqual(o.client);
      const small = await page.evaluate(
        (sel) =>
          [...document.querySelectorAll<HTMLElement>(sel)]
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && (r.width < 44 || r.height < 44)).length,
        selector,
      );
      expect(small).toBe(0);
    };
    const text = await note.locator(".cb__note-text").boundingBox();
    expect(text!.x + text!.width).toBeLessThanOrEqual(viewport.width);
    await fits(".cb button");
    await openPanel(page, "Crew");
    await expect(page.locator(".crew .crew-seat")).toHaveCount(12);
    await fits(".crew button");
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/qa-m210-12seats-${viewport.width}.png`, fullPage: true });
    await ctx.close();
  });
}
