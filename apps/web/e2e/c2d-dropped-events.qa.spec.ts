// QA (PR #132, R7 C2d): no dropped event card (Quiet night, Payday, Power cut, Raid rumour,
// Double-cross) and no Server-room pocket count shows in the UI, at 360 and 1280 wide. design §10
import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

const DROPPED = /Quiet night|Payday|Power cut|Raid rumou?r|Double[- ]cross|pocket count|how many (players )?pocketed/i;
const KEPT = /Shift change|Lockdown|Audit|Inside tip/;
const width = (name: string) => (name.startsWith("mobile") ? 360 : 1280);

const text = async (page: Page) => (await page.locator("body").innerText().catch(() => "")) ?? "";

test("the dev gallery shows only kept event cards", async ({ page }, info) => {
  await page.setViewportSize({ width: width(info.project.name), height: 900 });
  await page.goto("/dev/gallery");
  await expect(page.locator("body")).toContainText(KEPT);
  expect(await text(page)).not.toMatch(DROPPED);
});

test("a 15-min game with events on, played to the end: kept cards flip, no dropped card ever shows", async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: width(info.project.name), height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const game = await startGame(page.request, { bots: 5 });
  await page.goto(`/game/${game.id}`);
  await expect(page.locator(".hud__kicker")).toContainText(/Round \d of 9/);
  const over = page.getByRole("list", { name: "Final ranking" });
  const seen: string[] = [];
  while (!(await over.isVisible())) {
    const dialog = page.getByRole("dialog", { name: "Who's skimming?" });
    if (await dialog.isVisible().catch(() => false)) {
      seen.push(await text(page));
      await dialog.getByRole("group", { name: "Your vote" }).getByRole("button", { name: "Skip" }).click({ timeout: 1000 }).catch(() => {});
      await dialog.getByRole("button", { name: "Cast vote" }).click({ timeout: 1000 }).catch(() => {});
      await dialog.getByRole("button", { name: "Back to the board" }).click({ timeout: 1000 }).catch(() => {});
    }
    const lock = page.getByRole("button", { name: "Lock it in" });
    if (await lock.isVisible().catch(() => false)) {
      seen.push(await text(page));
      await page.locator('.room-tile[data-room="Office"]').click({ timeout: 1000 }).catch(() => {});
      if (await lock.isEnabled({ timeout: 500 }).catch(() => false)) await lock.click({ timeout: 1000 }).catch(() => {});
    }
    await page.waitForTimeout(250);
  }
  const ledger = page.getByRole("list", { name: "Ledger" });
  await expect(ledger).toContainText(KEPT);
  seen.push(await text(page));
  await page.getByRole("button", { name: /Case file/ }).click();
  seen.push(await text(page));
  for (const t of seen) expect(t).not.toMatch(DROPPED);
  expect(errors).toEqual([]);
});
