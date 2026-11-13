import { expect, test, type Page } from "@playwright/test";
import { closePanel, openPanel, startGame } from "./setupGame";

// M2-13 (design §15): the host pauses (everyone sees it, it survives a reload),
// adds time and resumes, all from the game Menu, then ends the game early; in the lobby the host removes a guest's seat.

test("the host pauses, the crew sees it, a reload keeps it, add time, then resume @host", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const guestCtx = await browser.newContext({ viewport: page.viewportSize()! });
  const guest = await guestCtx.newPage();
  const game = await startGame(page.request, { bots: 2, guests: [guest.request], sessionLength: "1h" });
  await page.goto(`/game/${game.id}`);
  await guest.goto(`/game/${game.id}`);
  await expect(page.locator(".hud__kicker")).toContainText(/Round 1 of/);

  const panel = page.getByRole("region", { name: "Host controls" });
  const menu = async (p: Page, then: () => Promise<void>) => {
    await closePanel(p);
    await p.getByRole("button", { name: "Menu", exact: true }).click();
    await then();
    await p.getByRole("button", { name: "Close", exact: true }).click();
  };
  await openPanel(page, "This round");
  await openPanel(guest, "This round");
  // design §16: the host controls are in the Menu, not in "This round", and only the host has them.
  await expect(page.getByRole("region", { name: "Host controls" })).toHaveCount(0);
  await closePanel(guest);
  await guest.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(guest.getByRole("region", { name: "Host controls" })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: "End game early" })).toHaveCount(0);
  await guest.getByRole("button", { name: "Close", exact: true }).click();
  await menu(page, () => panel.getByRole("button", { name: "Pause the game" }).click());
  await openPanel(page, "This round");
  await openPanel(guest, "This round");
  await expect(page.getByText("Paused by the host")).toBeVisible();
  await expect(guest.getByText("Paused by the host")).toBeVisible();
  // The round's countdown says who stopped it: no meeting is open (QA, PR #54).
  await expect(guest.locator(".hud__timer")).toContainText("(the host paused the game)");
  await expect(guest.locator(".hud__timer")).not.toContainText("meeting");

  await page.reload();
  await openPanel(page, "This round");
  await expect(page.getByText("Paused by the host")).toBeVisible();
  await menu(page, async () => {
    await expect(panel.getByText("Paused", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Add time" }).click();
    await expect(page.getByText(/Added \d+ (s|min)\./)).toBeVisible();
    // No sideways scroll with the panel open.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await panel.getByRole("button", { name: "Resume the game" }).click();
    await expect(panel.getByRole("button", { name: "Pause the game" })).toBeVisible();
  });
  await openPanel(page, "This round");
  await openPanel(guest, "This round");
  await expect(page.getByText("Paused by the host")).toHaveCount(0);
  await expect(guest.getByText("Paused by the host")).toHaveCount(0);

  // design §6.2, §16: End game early asks twice, then every player sees the ended screen: no winner, no reveal.
  await closePanel(page);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const end = panel.getByRole("button", { name: "End game early" });
  await end.click();
  await expect(guest.getByRole("heading", { name: "The host ended the game" })).toHaveCount(0);
  await panel.getByRole("button", { name: "End it for everyone?" }).click();
  for (const p of [page, guest]) {
    await expect(p.getByRole("heading", { name: "The host ended the game" })).toBeVisible();
    await expect(p.getByText("Nobody wins and nothing is scored.")).toBeVisible();
  }
  expect((await page.request.post(`/api/games/${game.id}/end`, { data: {} })).status()).toBe(200);
  expect((await guest.request.post(`/api/games/${game.id}/end`, { data: {} })).status()).toBe(403);
  expect(errors).toEqual([]);
  await guestCtx.close();
});

test("in the lobby the host removes a guest's seat @host", async ({ page, browser }) => {
  const guestCtx = await browser.newContext({ viewport: page.viewportSize()! });
  const guest = await guestCtx.newPage();
  const created = await page.request.post("/api/auth/guest", { data: { nickname: "Host" } });
  expect(created.ok()).toBe(true);
  const game = (await (await page.request.post("/api/games", { data: { settings: {} } })).json()) as { id: string; inviteCode: string };
  expect((await guest.request.post(`/api/invites/${game.inviteCode}/join`, { data: { nickname: "Guest 1" } })).ok()).toBe(true);
  await page.goto(`/lobby/${game.id}`);
  const remove = page.getByRole("button", { name: "Remove Guest 1" });
  await remove.click();
  await remove.click(); // armed: confirm
  await expect(page.locator(".seat")).toHaveCount(1);
  await guest.goto(`/lobby/${game.id}`);
  await expect(guest.getByText("No crew here.")).toBeVisible();
  await guestCtx.close();
});
