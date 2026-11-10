import { LESSONS } from "@skimjob/content";
import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// QA re-check for S4.6 (design §20.6 "one at a time", "Several at once queue"), the two QA #217 findings:
// 1. never a pop-up and a vote window open together, and a pop-up on screen always has focus on Got it;
// 2. the lesson on screen never changes until it is dismissed, a lesson left open through a meeting comes
//    back after it (not marked seen by stepping aside), and no lesson shows again once dismissed.

const TITLES = Object.values(LESSONS).map((l) => l.title);
const teachingOpen = (page: Page) => page.locator("dialog[open]").filter({ has: page.locator("#teaching-h") });
const idOf = (title: string) => Object.entries(LESSONS).find(([, l]) => l.title === title)![0];
const seenIds = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("skimjob.lessons.")).flatMap((k) => JSON.parse(localStorage.getItem(k)!) as string[]));
const over = (page: Page) => page.getByRole("list", { name: "Final ranking" });

test("one sheet at a time, and the open lesson stays until dismissed, in a live game @teaching", async ({ page }) => {
  test.setTimeout(300_000);
  const game = await startGame(page.request, { bots: 3, nickname: "Rechk", tips: true });
  await page.goto(`/game/${game.id}`);

  const dismissed: string[] = [];
  let showing: string | null = null; // the lesson on screen (or stepped aside), not yet dismissed
  let since = 0;
  let heldThroughMeeting = false; // the first lesson is left open until a meeting has come and gone
  let sawMeetingWhileHeld = false;
  const end = Date.now() + 280_000;
  while (Date.now() < end && !(await over(page).isVisible())) {
    // Both read in one go, so a phase change between two reads is not mistaken for an overlap.
    const { teach, vote } = await page.evaluate(() => ({
      teach: document.querySelectorAll("dialog[open] #teaching-h").length,
      vote: document.querySelectorAll("dialog[open][aria-labelledby=vote-h]").length,
    }));
    expect(teach && vote, "a pop-up and a vote window open together").toBeFalsy();
    // A meeting's result card holds the lessons back until it is closed (one sheet at a time, §20.6).
    const card = page.getByRole("button", { name: "Back to the bank" });
    if (!teach && (await card.isVisible())) await card.click();
    if (showing && vote) {
      sawMeetingWhileHeld = true;
      // Stepping aside is not Got it: the lesson is not stored as seen.
      expect(await seenIds(page), `"${showing}" marked seen while it stepped aside`).not.toContain(idOf(showing));
    }
    if (teach) {
      const title = (await page.locator("#teaching-h").textContent({ timeout: 1000 }).catch(() => null))?.trim();
      if (!title) continue; // closing between the two reads
      expect(TITLES).toContain(title);
      expect(dismissed, `"${title}" came back after Got it`).not.toContain(title);
      if (showing) expect(title, "the open lesson changed before it was dismissed").toBe(showing);
      else {
        showing = title;
        since = Date.now();
      }
      // Focus is on Got it while the sheet is up (it may step aside for a vote window in the meantime).
      await expect
        .poll(() => page.evaluate(() => !document.querySelector("dialog[open] #teaching-h") || document.activeElement?.textContent?.trim() === "Got it"), { timeout: 2000 })
        .toBe(true);
      const holdDone = heldThroughMeeting || sawMeetingWhileHeld || Date.now() - since > 40_000;
      if (holdDone && Date.now() - since > 1200) {
        heldThroughMeeting = true;
        dismissed.push(title);
        showing = null;
        await teachingOpen(page).getByRole("button", { name: "Got it" }).click();
        await expect(page.locator("#teaching-h").filter({ hasText: title })).toHaveCount(0);
      }
    }
    await page.waitForTimeout(150);
  }
  console.log(`lessons: ${dismissed.join(" | ")}; held one through a meeting: ${sawMeetingWhileHeld}`);
  expect(dismissed.length + (showing ? 1 : 0)).toBeGreaterThan(0);
});
