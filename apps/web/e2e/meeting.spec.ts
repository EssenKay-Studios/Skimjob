import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// M2-7 acceptance (docs/m2-plan.md): one full meeting and vote in the browser,
// in each vote mode. The 1-hour preset at TIME_SCALE 0.1: a 6 s emergency
// notice and an 18 s vote window. MEET_SHOTS=… saves the vote dialog and the
// results as meet-<mode>-<what>-<width>.png.
const SHOTS = process.env.MEET_SHOTS ?? process.env.SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(700); // the sheet's spring and the tally bars settle
  await page.screenshot({ path: `${SHOTS}/meet-${name}-${page.viewportSize()!.width}.png` });
}

for (const mode of ["hiddenThenRevealed", "open", "secret"] as const) {
  test(`an emergency meeting: call it, vote, change the vote, see the result (${mode})`, async ({ page }, info) => {
    // Not about widths (game.responsive.spec.ts covers them): Hidden at both, the other modes on desktop only.
    test.skip(mode !== "hiddenThenRevealed" && info.project.name !== "desktop", "one viewport is enough");
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const game = await startGame(page.request, { bots: 3, sessionLength: "1h", voteVisibility: mode });
    await page.goto(`/game/${game.id}`);
    await expect(page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();

    // design §11.1: the emergency button arms, then calls; then it's spent for the game.
    const call = page.getByRole("button", { name: "Call an emergency meeting" });
    await call.click();
    await page.getByRole("button", { name: "Sure? Tap again to call it" }).click();
    await expect(page.locator(".hud__alert")).toContainText("Emergency meeting in");

    // The vote window opens by itself as a dialog.
    const dialog = page.getByRole("dialog", { name: "Who's skimming?" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText("Emergency meeting · called by you");
    const pick = dialog.getByRole("group", { name: "Your vote" });
    await expect(pick.getByRole("button")).toHaveCount(4); // three others and Skip, never yourself
    await pick.getByRole("button").first().click();
    await dialog.getByRole("button", { name: "Cast vote" }).click();
    await expect(dialog.locator(".vote__status")).toContainText("Your vote: shake down Bot");
    // design §11.2: change it until the window closes.
    await pick.getByRole("button", { name: "Skip" }).click();
    await dialog.getByRole("button", { name: "Change vote" }).click();
    await expect(dialog.locator(".vote__status")).toContainText("Your vote: skip.");
    await expect(dialog.getByRole("button", { name: "Vote cast" })).toBeDisabled();

    // Each mode shows only what it allows (design §11.2).
    if (mode === "open") {
      await expect(dialog.getByRole("list", { name: "Live tally" })).toBeVisible();
      await expect(dialog.getByRole("list", { name: "Live tally" })).toContainText("Skip");
    } else {
      await expect(dialog.getByRole("list", { name: "Live tally" })).toHaveCount(0);
      await expect(dialog.getByRole("list", { name: "Ballots so far" })).toHaveCount(0);
    }
    await shot(page, `${mode}-vote`);

    // Back to the board and in again.
    await dialog.getByRole("button", { name: "Back to the board" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Change your vote" }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The window closes: the result banner with the tally (and the shakedown window if one opens).
    const results = page.getByRole("region", { name: /The crew voted|No majority|Too few votes/ });
    await expect(results.or(page.getByRole("heading", { name: "The crew is deciding…" }))).toBeVisible({ timeout: 30_000 });
    await expect(results).toBeVisible({ timeout: 30_000 });
    await expect(results.getByRole("list", { name: "Final tally" })).toContainText("Skip");
    if (mode === "secret") {
      await expect(results.getByRole("list", { name: "How everyone voted" })).toHaveCount(0);
      await expect(results).toContainText("only the final tally is ever shown");
    } else {
      await expect(results.getByRole("list", { name: "How everyone voted" })).toContainText("You: skip");
    }
    await results.scrollIntoViewIfNeeded();
    await shot(page, `${mode}-results`);

    const ledger = page.getByRole("list", { name: "Ledger" });
    await expect(ledger).toContainText("You called an emergency meeting.");
    await expect(ledger).toContainText(/The crew voted|No majority|Too few votes/);
    if (mode === "open") await expect(ledger).toContainText("You voted to skip.");
    else {
      await expect(ledger).not.toContainText("You voted");
      await page.getByRole("button", { name: /Case file/ }).click();
      await expect(page.getByRole("list", { name: "Case file" })).toContainText("You voted to skip.");
    }
    await expect(call).toBeDisabled();
    await expect(page.getByText("You've called your emergency meeting for this game.")).toBeVisible();
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(results).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test("propose a meeting time, a second player backs it, and leave a sealed vote (design §11.1, §11.2)", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one viewport is enough");
  test.setTimeout(60_000);
  // One-week preset: the crew picks the slot. Three people (one stays away) and no bots (bots lock "the end of the act" at once).
  // A majority of 3 people is 2, so the guest's backing still locks it.
  const guestCtx = await browser.newContext({ viewport: page.viewportSize()! });
  const guest = await guestCtx.newPage();
  const away = await browser.newContext();
  const game = await startGame(page.request, { bots: 0, guests: [guest.request, away.request], sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  await guest.goto(`/game/${game.id}`);
  const panel = page.getByRole("region", { name: "Crew meetings" });
  const when = new Date(Date.now() + 26 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  await panel.getByLabel("Propose a time").fill(`${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T21:30`);
  await panel.getByRole("button", { name: "Propose" }).click();
  const proposals = panel.getByRole("list", { name: "Proposed times" });
  await expect(proposals).toContainText(/9:30/);
  await expect(proposals).toContainText("your idea · 1 of 2 needed");
  await expect(proposals.getByRole("button", { name: "Backed" })).toBeDisabled();

  // The guest backs it: a majority locks it in for both.
  const theirs = guest.getByRole("region", { name: "Crew meetings" });
  await expect(theirs.getByRole("list", { name: "Proposed times" })).toContainText("from Host · 1 of 2 needed");
  await theirs.getByRole("button", { name: "Back this time" }).click();
  await expect(panel.getByText(/Set for .*9:30/)).toBeVisible();
  await expect(theirs.getByText(/Set for .*9:30/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Ledger" })).toContainText(/Meeting 1 is set for .*9:30/);
  await shot(page, "planner");

  await panel.getByText("Can't make the meeting?").click();
  await panel.getByRole("group", { name: "Sealed vote" }).getByRole("button", { name: "Skip" }).click();
  await panel.getByRole("button", { name: "Seal vote" }).click();
  await expect(panel.getByText("Sealed: skip")).toBeVisible();
  await page.getByRole("button", { name: /Case file/ }).click();
  await expect(page.getByRole("list", { name: "Case file" })).toContainText("You sealed a vote to skip.");
  await guestCtx.close();
  await away.close();
});
