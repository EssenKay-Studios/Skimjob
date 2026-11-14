import { RULESETS } from "@skimjob/content";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { showsAfterCards } from "./meetingCards";
import { grabAll, pickRoom } from "./move";
import { openPanel, settle } from "./setupGame";

const expect = baseExpect.configure({ timeout: 15_000 });

// S4.10, design §14: Learn the game. From the start page a player starts a
// single-player game with 3 bots under the Learn ruleset (6 rounds, no shop) and a
// scripted guide pop-up opens at each step; a step once dismissed never returns.
// Which step is due is unit-tested in game/guide.test.ts. The host's pause holds
// the 15 min preset's short e2e round while the test reads.

const guide = RULESETS.learn!.guide;
const title = (id: string) => guide.find((s) => s.id === id)!.title;
const stepDialog = (page: Page, id: string) => page.getByRole("dialog", { name: title(id) });

async function gotIt(page: Page, id: string): Promise<void> {
  const dialog = stepDialog(page, id);
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole("button", { name: "Got it" }).click();
  await expect(dialog).toBeHidden();
}

/** Starts a Learn the game from the start page and pauses it (the player is its host). */
async function startLearn(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Learn the game" }).click();
  await expect(page.getByRole("heading", { name: "Learn the game" })).toBeVisible();
  await page.getByLabel("Your name in this game").fill("Mara");
  await page.getByRole("button", { name: "Start the lesson" }).click();
  await page.waitForURL(/\/game\//);
  const id = page.url().split("/game/")[1]!;
  expect((await page.request.post(`/api/games/${id}/pause`)).ok()).toBe(true);
  return id;
}

test("Learn the game: you and 3 bots, 6 rounds, no shop, a guide pop-up at each step @learn", async ({ page }) => {
  test.setTimeout(150_000);
  const id = await startLearn(page);

  // Round 1 opens with the welcome, then your role and your move, each once.
  const welcome = stepDialog(page, "welcome");
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText(`Guide · 1 of ${guide.length}`);
  for (const line of guide[0]!.lines) await expect(welcome).toContainText(line);
  await gotIt(page, "welcome");
  await page.reload();
  await gotIt(page, "role");
  await expect(welcome).toBeHidden();
  await gotIt(page, "move");

  await expect(page.getByText("Round 1 of 6")).toBeVisible();
  await openPanel(page, "This round");
  await expect(page.getByRole("button", { name: "Black market" })).toHaveCount(0);
  await pickRoom(page, "Lobby");
  await grabAll(page);
  await page.getByRole("button", { name: "Lock it in" }).click();

  // Locked in: the guide explains the alibi pop-up before it comes.
  await expect(stepDialog(page, "alibi")).toContainText("Miss it and the crew sees the room you were really in");
  await gotIt(page, "alibi");
  expect((await page.request.post(`/api/games/${id}/resume`)).ok()).toBe(true);

  // The round resolves: the real alibi pop-up, then round 2 teaches the snapshot card.
  const popup = page.getByRole("dialog", { name: "Psst. Where were you?" });
  await expect(popup).toBeVisible({ timeout: 60_000 });
  await popup.getByRole("group", { name: "Where you say you were" }).getByRole("button", { name: /^Office/ }).click();
  await popup.getByRole("button", { name: "I was in the Office" }).click();
  // A raid in round 1 calls a briefing: its result card goes first, and the step waits for it.
  await showsAfterCards(page, stepDialog(page, "snapshot"), 90_000);
  await gotIt(page, "snapshot");
});

test("the guide pop-up fits every launch width with a 44 px Got it @learn", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set in the test");
  test.setTimeout(90_000);
  await startLearn(page);
  const dialog = stepDialog(page, "welcome");
  for (const vp of [
    { width: 360, height: 740 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(vp);
    await expect(dialog).toBeVisible();
    await settle(page);
    const box = (await dialog.locator(".dialog__sheet").boundingBox())!;
    expect(box.x, `${vp.width}`).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `${vp.width}`).toBeLessThanOrEqual(vp.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${vp.width}`).toBe(true);
    const ok = dialog.getByRole("button", { name: "Got it" });
    expect(await ok.evaluate((el) => (el as HTMLElement).offsetHeight), `${vp.width}`).toBeGreaterThanOrEqual(44);
  }
});
