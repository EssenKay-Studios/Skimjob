import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// QA (PR #218, S4.8): the meeting screens in a real bot game, 6 and 12 seats, a 24-character host name, Open and Secret.
// The game is held (host pause) while each screen is looked at in all five widths. QA_SHOTS=… saves qa218-game-*.png.
const DIR = process.env.QA_SHOTS;
const WIDTHS = [360, 390, 768, 1024, 1280] as const;
const NAME = "Maximiliana Wolfeschlege"; // 24 characters
const RESULT_NAME = /shaken down|fell through|The crew voted|No majority|Too few votes/;

async function paused(page: Page, gameId: string, steps: () => Promise<void>) {
  const post = async (what: "pause" | "resume") => expect((await page.request.post(`/api/games/${gameId}/${what}`)).ok(), what).toBe(true);
  await post("pause");
  await expect(page.getByText("Paused by the host")).toBeVisible();
  try {
    await steps();
  } finally {
    await post("resume");
  }
}

/** Every width: no horizontal overflow, then a screenshot. */
async function widths(page: Page, name: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(700); // sleep kept: the meeting sheet mounts after the resize, so settling the animations present now is not enough
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${name} at ${width}: horizontal overflow`).toBeLessThanOrEqual(0);
    if (DIR) {
      mkdirSync(DIR, { recursive: true });
      await page.screenshot({ path: `${DIR}/qa218-game-${name}-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

for (const bots of [5, 11])
  for (const mode of ["open", "secret"] as const)
    test(`QA: a real bot game's meeting screens at every width (${bots + 1} seats, ${mode}) @meeting`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "the widths are set by hand");
      test.setTimeout(240_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const game = await startGame(page.request, { bots, sessionLength: "1h", voteVisibility: mode, nickname: NAME });
      await page.goto(`/game/${game.id}`);
      await expect(page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
      const call = page.getByRole("button", { name: "Call an emergency meeting" });
      const alert = page.locator(".hud__alert");
      // design §9.3: no emergency button while planning, only the pool count.
      await expect(call).toHaveCount(0);
      await expect(page.getByText(/\d left for the crew\./).first()).toBeVisible();
      await expect(call.or(alert).first()).toBeVisible({ timeout: 60_000 });
      const earlier = page.getByRole("dialog", { name: RESULT_NAME });
      await paused(page, game.id, async () => {
        if (await earlier.isVisible()) await earlier.getByRole("button", { name: "Back to the bank" }).click();
        if ((await call.count()) > 0) await widths(page, `${mode}-${bots + 1}-window`);
        if ((await call.count()) > 0 && (await call.isEnabled())) {
          await call.click();
          await page.getByRole("button", { name: "Sure? Tap again to call it" }).click();
        }
      });
      const dialog = page.getByRole("dialog", { name: "Who's skimming?" });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      await paused(page, game.id, async () => {
        await expect(dialog).toContainText("Emergency pool:");
        await widths(page, `${mode}-${bots + 1}-vote`);
        await dialog.getByRole("group", { name: "Your vote" }).getByRole("button").first().click();
        await dialog.getByRole("button", { name: "Cast vote" }).click();
        await expect(dialog.locator(".vote__status")).toContainText("Your vote: shake down Bot");
        if (mode === "secret") await expect(dialog.locator(".ballots")).toHaveCount(0);
        await widths(page, `${mode}-${bots + 1}-voted`);
      });
      // The shakedown window (if the vote passed), then the result card.
      const deciding = page.getByRole("region", { name: "The crew is deciding…" });
      const results = page.getByRole("dialog", { name: RESULT_NAME });
      await expect(deciding.or(results).first()).toBeVisible({ timeout: 60_000 });
      if (await deciding.isVisible()) {
        await paused(page, game.id, async () => {
          await expect(deciding.getByText(/Bail/)).toHaveCount(0);
          await widths(page, `${mode}-${bots + 1}-deciding`);
        });
      }
      await expect(results).toBeVisible({ timeout: 60_000 });
      await paused(page, game.id, async () => {
        if (mode === "secret") await expect(results.getByRole("list", { name: "How everyone voted" })).toHaveCount(0);
        await widths(page, `${mode}-${bots + 1}-result`);
        await expect(call).toHaveCount(0);
      });
      expect(errors).toEqual([]);
    });
