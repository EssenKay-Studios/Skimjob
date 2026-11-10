import { expect, test } from "@playwright/test";
import { openPanel, startGame } from "./setupGame";

// QA (M2-10, PR #46): the suspicion board renders hostile notes as text and
// stays private (design §12.3); 12 seats at the narrowest and widest widths.
// (The hidden-tab recap is reported as a bug on the PR, not tested here.)

test("hostile notes are plain text; nothing of the board reaches the other seat; another seat's notes are refused @caseboard", async ({ browser }, info) => {
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
  await openPanel(host, "Notes");
  const board = host.getByRole("region", { name: "Your suspicion board" });
  const row = board.getByRole("group", { name: "Your tag for Guest 1" });
  await row.getByRole("button", { name: "Add note" }).click();
  const evil = `<img src=x onerror="window.__xss=1;alert(1)"><script>window.__xss=2</script>`;
  await board.getByLabel("Note on Guest 1").fill(evil);
  await board.getByRole("button", { name: "Save note" }).click();
  await expect(board.locator(".sus-row__note")).toHaveText(evil);
  await host.reload();
  await openPanel(host, "Notes");
  await expect(host.getByRole("region", { name: "Your suspicion board" }).locator(".sus-row__note")).toHaveText(evil);
  expect(await host.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await host.locator(".sus img, .sus script").count()).toBe(0);

  // An invisible-only note is refused with a message, and nothing is saved.
  await host.getByRole("region", { name: "Your suspicion board" }).getByRole("group", { name: "Your tag for Guest 1" }).getByRole("button", { name: "Edit note" }).click();
  await host.getByLabel("Note on Guest 1").fill("​​");
  await host.getByRole("button", { name: "Save note" }).click();
  await expect(host.getByRole("region", { name: "Your suspicion board" }).getByRole("alert")).toBeVisible();
  await host.reload();
  await openPanel(host, "Notes");
  await expect(host.getByRole("region", { name: "Your suspicion board" }).locator(".sus-row__note")).toHaveText(evil);

  // The guest's own notes are their own; a stranger has none.
  const mine = (await (await guest.request.get(`/api/games/${game.id}/notes`)).json()) as { board: Record<string, unknown> };
  expect(mine.board).toEqual({});
  const strangerCtx = await browser.newContext();
  const stranger = strangerCtx.request;
  await stranger.post("/api/auth/guest", { data: { nickname: "Nosy" } });
  expect((await stranger.get(`/api/games/${game.id}/notes`)).status()).toBe(404);
  expect((await stranger.patch(`/api/games/${game.id}/notes/board`, { data: { subject: "p1", tag: "trusted" } })).status()).toBe(404);
  await guest.goto(`/game/${game.id}`);
  await openPanel(guest, "Notes");
  await expect(guest.getByRole("region", { name: "Your suspicion board" })).toBeVisible();
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
  test(`12 seats at ${viewport.width}px: the board, crew marks and the case board fit, targets ≥44px @caseboard`, async ({ browser }, info) => {
    test.skip(info.project.name !== "mobile", "viewports are set per test");
    test.setTimeout(60_000);
    const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 1024, isMobile: viewport.width < 1024 });
    const page = await ctx.newPage();
    const game = await startGame(page.request, { bots: 11, sessionLength: "1w" });
    await page.goto(`/game/${game.id}`);
    await openPanel(page, "Notes");
    const board = page.getByRole("region", { name: "Your suspicion board" });
    await expect(board.locator(".sus-row")).toHaveCount(11);
    // Tag everyone, one long unbroken note on the last.
    const groups = board.getByRole("group");
    for (let i = 0; i < 11; i++) {
      const t = ["Trusted", "Unsure", "Suspicious"][i % 3]!;
      await groups.nth(i).getByRole("button", { name: t }).click();
      await expect(groups.nth(i).getByRole("button", { name: t })).toHaveAttribute("aria-pressed", "true");
    }
    await groups.nth(10).getByRole("button", { name: "Add note" }).click();
    await board.locator("input, textarea").first().fill("W".repeat(280));
    await board.getByRole("button", { name: "Save note" }).click();
    await expect(board.locator(".sus-row__note")).toHaveCount(1);
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
    const note = await board.locator(".sus-row__note").boundingBox();
    expect(note!.x + note!.width).toBeLessThanOrEqual(viewport.width);
    await fits(".sus button");
    await openPanel(page, "Crew");
    await expect(page.locator(".crew .sus-mark")).toHaveCount(11);
    await fits(".crew button");
    await openPanel(page, "Case");
    await expect(page.getByRole("region", { name: "Case board" })).toBeVisible();
    await fits(".cb button");
    if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/qa-m210-12seats-${viewport.width}.png`, fullPage: true });
    await ctx.close();
  });
}
