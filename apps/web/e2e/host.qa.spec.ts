import { expect, test } from "@playwright/test";
import { openPanel, startGame } from "./setupGame";

// QA, M2-13 host controls (design §15): the host panel at 360 and 1280 px (no sideways
// scroll, touch targets ≥ 44 px), only the host gets it, a guest's own API calls are refused,
// and pause/resume reach both screens.

test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

for (const width of [360, 1280]) {
  test(`host panel at ${width}px: host only, fits, pause and resume reach the crew @host`, async ({ page, browser }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 800 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const guestCtx = await browser.newContext({ viewport: { width, height: 800 } });
    const guest = await guestCtx.newPage();
    const game = await startGame(page.request, { bots: 1, guests: [guest.request], sessionLength: "1h" });
    await page.goto(`/game/${game.id}`);
    await guest.goto(`/game/${game.id}`);
    await expect(page.locator(".hud__kicker")).toContainText(/Round 1 of/);
    await expect(guest.locator(".hud__kicker")).toContainText(/Round 1 of/);

    const panel = page.getByRole("region", { name: "Host controls" });
    await openPanel(page, "This round");
    await openPanel(guest, "This round");
    await expect(guest.getByRole("region", { name: "Host controls" })).toHaveCount(0);
    // A guest going round the UI is refused, and nothing shows as paused.
    for (const path of ["pause", "extend", "resume"]) {
      expect((await guest.request.post(`/api/games/${game.id}/${path}`, { data: {} })).status()).toBe(403);
    }
    await expect(guest.getByText("Paused by the host")).toHaveCount(0);

    await panel.getByText("Host controls").click();
    const pause = panel.getByRole("button", { name: "Pause the game" });
    const extend = panel.getByRole("button", { name: "Add time" });
    for (const button of [pause, extend]) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await pause.click();
    await expect(page.getByText("Paused by the host")).toBeVisible();
    await expect(guest.getByText("Paused by the host")).toBeVisible();
    // Pausing again over the API (a double click from another tab) is refused and changes nothing.
    expect((await page.request.post(`/api/games/${game.id}/pause`, { data: {} })).status()).toBe(409);
    for (const p of [page, guest]) {
      expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`host-panel-paused-${width}.png`), fullPage: true });
    await guest.screenshot({ path: info.outputPath(`guest-paused-${width}.png`), fullPage: true });

    const resume = panel.getByRole("button", { name: "Resume the game" });
    expect((await resume.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await resume.click();
    await expect(page.getByText("Paused by the host")).toHaveCount(0);
    await expect(guest.getByText("Paused by the host")).toHaveCount(0);
    expect((await page.request.post(`/api/games/${game.id}/resume`, { data: {} })).status()).toBe(409);
    expect(errors).toEqual([]);
    await guestCtx.close();
  });
}
