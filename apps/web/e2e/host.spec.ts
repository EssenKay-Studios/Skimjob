import { expect, test } from "@playwright/test";
import { startGame } from "./setupGame";

// M2-13 (design §15): the host pauses (everyone sees it, it survives a reload),
// adds time and resumes; in the lobby the host removes a guest's seat.

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
  await expect(guest.getByRole("region", { name: "Host controls" })).toHaveCount(0);
  await panel.getByText("Host controls").click();
  await panel.getByRole("button", { name: "Pause the game" }).click();
  await expect(page.getByText("Paused by the host")).toBeVisible();
  await expect(guest.getByText("Paused by the host")).toBeVisible();
  // The round's countdown says who stopped it: no meeting is open (QA, PR #54).
  await expect(guest.locator(".hud__timer")).toContainText("(the host paused the game)");
  await expect(guest.locator(".hud__timer")).not.toContainText("meeting");

  await page.reload();
  await expect(page.getByText("Paused by the host")).toBeVisible();
  await expect(panel.getByText("Paused", { exact: true })).toBeVisible();
  await panel.getByText("Host controls").click();
  await panel.getByRole("button", { name: "Add time" }).click();
  await expect(page.getByText(/Added \d+ (s|min)\./)).toBeVisible();
  // No sideways scroll with the panel open.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.getByRole("button", { name: "Resume the game" }).click();
  await expect(page.getByText("Paused by the host")).toHaveCount(0);
  await expect(guest.getByText("Paused by the host")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Pause the game" })).toBeVisible();
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
