// QA (PR #132, R7 C2d): no dropped event card (Quiet night, Payday, Power cut, Raid rumour,
// Double-cross) and no Server-room pocket count shows in the UI, at 360 and 1280 wide. design §13
// The Electrician's power cut is live again (design §11.1, §18: "Power cut in the Office", no
// source; the gallery's "A power cut" label), so only a bare "Power cut", the old card's name, is banned.
import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";
import { pickRoom } from "./move";

const DROPPED = /Quiet night|Payday|(?<!a )Power cut(?! in the )|Raid rumou?r|Double[- ]cross|pocket count|how many (players )?pocketed/i;
const KEPT = /Shift change|Lockdown|Audit|Inside tip/;
const width = (name: string) => (name.startsWith("mobile") ? 360 : 1280);

const text = async (page: Page) => (await page.locator("body").innerText().catch(() => "")) ?? "";

test("the dev gallery shows only kept event cards @board", async ({ page }, info) => {
  await page.setViewportSize({ width: width(info.project.name), height: 900 });
  await page.goto("/dev/gallery");
  await expect(page.locator("body")).toContainText(KEPT);
  expect(await text(page)).not.toMatch(DROPPED);
});

test("a 15-min game with events on, played to the end: kept cards flip, no dropped card ever shows @board", async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: width(info.project.name), height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const game = await startGame(page.request, { bots: 5 });
  await page.goto(`/game/${game.id}`);
  await expect(page.locator(".hud__kicker")).toContainText(/Round \d+ of 12/);
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
      await pickRoom(page, "Office", 1000).catch(() => {});
      if (await lock.isEnabled({ timeout: 500 }).catch(() => false)) await lock.click({ timeout: 1000 }).catch(() => {});
    }
    await page.waitForTimeout(250);
  }
  seen.push(await text(page));
  // The kept cards flipped on the board (the HUD names each round's card) over the game.
  expect(seen.join("\n")).toMatch(KEPT);
  for (const t of seen) expect(t).not.toMatch(DROPPED);
  expect(errors).toEqual([]);
});
