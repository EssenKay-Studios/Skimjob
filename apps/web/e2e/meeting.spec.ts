import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { clearMeeting } from "./meetingCards";
import { callEmergency, openPanel, startGame, settle } from "./setupGame";

// M2-7 acceptance (docs/m2-plan.md): one full meeting and vote in the browser,
// in each vote mode. The 1-hour preset at TIME_SCALE 0.1: round 1 resolves
// (30 s), the result window (6 s) takes the emergency,
// then a 6 s notice and an 18 s vote window. The game's seed is pinned: with a
// random one, a raid in round 1 may call a police briefing first (design §9.2;
// the result window then opens at 48 to 51 s), and a bot may spend the crew's
// only emergency the moment the window opens (design §9.3), before any person can. MEET_SHOTS=… saves the vote dialog and the
// results as meet-<mode>-<what>-<width>.png.
const SHOTS = process.env.MEET_SHOTS ?? process.env.SHOTS_DIR;

/** design §15.4: opens the newest case board lead titled `title` and returns it. */
async function openLead(page: Page, title: string): Promise<Locator> {
  await openPanel(page, "Case");
  const lead = page.getByRole("group", { name: "Leads" }).locator(".cb__lead", { has: page.locator(".cb__title", { hasText: title }) }).first();
  const btn = lead.locator(".cb__lead-btn");
  if ((await btn.getAttribute("aria-expanded")) === "false") await btn.click();
  return lead;
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/meet-${name}-${page.viewportSize()!.width}.png` });
}

/** The title of a meeting's result card. */
const RESULT_NAME = /shaken down|fell through|The crew voted|No majority|Too few votes/;

/**
 * Holds every clock while `steps` runs, so a slow run (CI shards, a busy Mac) can't close the result window or the vote
 * window under the test (#176, #204). Only the host may pause; the game is resumed afterwards.
 */
async function paused(page: Page, gameId: string, steps: () => Promise<void>) {
  const post = async (what: "pause" | "resume") => expect((await page.request.post(`/api/games/${gameId}/${what}`)).ok(), `${what} the game`).toBe(true);
  await post("pause");
  // The paused banner re-lays the page out; wait for it, or a click lands on a button that is about to be rebuilt.
  await expect(page.getByText("Paused by the host")).toBeVisible();
  try {
    await steps();
  } finally {
    await post("resume");
  }
}

for (const mode of ["hiddenThenRevealed", "open", "secret"] as const) {
  test(`an emergency meeting: call it, vote, change the vote, see the result (${mode}) @meeting`, async ({ page }, info) => {
    // Not about widths (game.responsive.spec.ts covers them): Hidden at both, the other modes on desktop only.
    test.skip(mode !== "hiddenThenRevealed" && info.project.name !== "desktop", "one viewport is enough");
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const game = await startGame(page.request, { bots: 3, sessionLength: "1h", voteVisibility: mode, seed: "meeting-1" });
    await page.goto(`/game/${game.id}`);
    await openPanel(page, "This round"); // below 1024 px it stays open: the vote dialog opens over it
    await expect(page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();

    // design §9.3: the button is offered only in a round's result window, never while planning; there it arms, then calls;
    // then the crew's pool is spent. The game is held while we click, so the 6 s window can't close on a slow run. A bot may
    // spend the pool first (#204): then there is no button, and the meeting is its call.
    const call = page.getByRole("button", { name: "Call an emergency meeting" });
    const alert = page.locator(".hud__alert");
    await expect(call).toHaveCount(0);
    await expect(page.getByText("1 left for the crew.")).toBeVisible();
    // A bot's call leaves the button there, disabled (one per window), beside the alert.
    await expect(call.or(alert).first()).toBeVisible({ timeout: 60_000 });
    let mine = false;
    // A regular meeting can fall due after round 1 (a third of the bank gone): its result card sits over the page, and
    // the result window with the emergency button comes after it (§9.3). Close the card first.
    const earlier = page.getByRole("dialog", { name: RESULT_NAME });
    await paused(page, game.id, async () => {
      if (await earlier.isVisible()) await earlier.getByRole("button", { name: "Back to the bank" }).click();
      if ((await call.count()) > 0 && (await call.isEnabled())) {
        await call.click({ timeout: 10_000 });
        await page.getByRole("button", { name: "Sure? Tap again to call it" }).click({ timeout: 10_000 });
        mine = true;
      }
      await expect(alert).toContainText("Emergency meeting in");
    });

    // The vote window opens by itself as a dialog.
    const dialog = page.getByRole("dialog", { name: "Who's skimming?" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText(mine ? "Emergency meeting · called by you" : /Emergency meeting · called by Bot/);
    // The briefing: why it is on, and the pool the call just spent (design §9.1, §9.3).
    await expect(dialog).toContainText("Called from the crew's emergency pool.");
    await expect(dialog).toContainText("Emergency pool: 0 left for the crew.");
    const pick = dialog.getByRole("group", { name: "Your vote" });
    await paused(page, game.id, async () => {
      // Three others and Skip, never yourself, and never a protected player (§9.7): a regular meeting before this one may have shaken one down.
      const shielded = ((await dialog.locator(".briefing__protected").textContent({ timeout: 1_000 }).catch(() => null)) ?? "").split("list: ")[1]?.replace(/\.$/, "").split(", ") ?? [];
      await expect(pick.getByRole("button")).toHaveCount(4 - shielded.filter((n) => n !== "You").length);
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
    });

    // The window closes: the result card with the tally (after the Bail window, if a bot holds one).
    const results = page.getByRole("dialog", { name: RESULT_NAME });
    await expect(results).toBeVisible({ timeout: 60_000 });
    await expect(results.getByRole("list", { name: "Final tally" })).toContainText("Skip");
    // The card opens on its primary button, not on an InfoTip whose focus preview would open by itself.
    await expect(results.getByRole("button", { name: "Back to the bank" })).toBeFocused();
    await expect(page.locator(".infotip__pop:popover-open")).toHaveCount(0);
    if (mode === "secret") {
      await expect(results.getByRole("list", { name: "How everyone voted" })).toHaveCount(0);
      await expect(results).toContainText("only the final tally is ever shown");
    } else {
      await expect(results.getByRole("list", { name: "How everyone voted" })).toContainText("You: skip");
    }
    // design §9.6, §9.7: a shakedown opens the stash and protects the target; any other result does neither.
    const title = (await results.locator("h2").textContent()) ?? "";
    if (title.endsWith("shaken down") && !title.startsWith("No majority")) {
      await expect(results.locator(".result__rows")).toContainText("stash");
      await expect(results).toContainText("until the next regular meeting");
    } else {
      await expect(results.locator(".result__rows")).toHaveCount(0);
    }
    await results.scrollIntoViewIfNeeded();
    await shot(page, `${mode}-results`);

    await expect(call).toHaveCount(0);
    await page.getByRole("button", { name: "Back to the bank" }).click();
    await expect(results).toBeHidden();
    await expect(page.getByText("The crew's emergency meetings are all spent.")).toBeVisible();

    // The case board's lead for the meeting (design §15.4): the call, the result, and your ballot, a public fact only in Open mode.
    const lead = await openLead(page, "Emergency meeting");
    await expect(lead).toContainText(mine ? "Fact You called an emergency meeting." : /Fact Bot .* called an emergency meeting\./);
    await expect(lead).toContainText(/The crew voted|No majority|Too few votes/);
    await expect(lead).toContainText(mode === "open" ? "Fact You voted to skip." : "Seen by you You voted to skip.");
    expect(errors).toEqual([]);
  });
}

test("a player a shakedown passed against is left off the next vote's list (design §9.5, §9.7) @meeting", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one viewport is enough");
  test.setTimeout(90_000);
  // This seed's round 1 ends in a raid: the police briefing's shakedown passes against a bot (design §9.2), who is then protected.
  const game = await startGame(page.request, { bots: 3, sessionLength: "1h", voteVisibility: "hiddenThenRevealed", seed: "meeting-6" });
  await page.goto(`/game/${game.id}`);
  await expect(page.getByRole("heading", { name: "Police briefing" })).toBeVisible({ timeout: 45_000 });
  // The briefing's cards, then round 1's result window: held while we call, so its 6 s can't run out between the two taps.
  await clearMeeting(page);
  await expect(page.getByRole("button", { name: "Call an emergency meeting" })).toBeEnabled({ timeout: 30_000 });
  await paused(page, game.id, () => callEmergency(page));
  const dialog = page.getByRole("dialog", { name: "Who's skimming?" });
  await expect(dialog).toContainText("Emergency meeting · called by you", { timeout: 20_000 });
  const pick = dialog.getByRole("group", { name: "Your vote" });
  // The protected bot is named on the briefing and left off the list: two others and Skip.
  await expect(dialog.locator(".briefing__protected")).toContainText(/so not on the list: Bot/);
  await expect(pick.getByRole("button")).toHaveCount(3);
  await pick.getByRole("button").first().click();
  await dialog.getByRole("button", { name: "Cast vote" }).click();
  await expect(dialog.locator(".vote__status")).toContainText("Your vote: shake down Bot");
});

test("propose a meeting time, a second player backs it, and leave a sealed vote (design §11.1, §11.2) @meeting", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one viewport is enough");
  test.setTimeout(60_000);
  // One-week preset: the crew picks the slot. Three people (one stays away) and no bots: the slot planner is for people.
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
  await expect(await openLead(page, "Meeting")).toContainText(/Fact The next meeting is set for .*9:30/);
  await shot(page, "planner");

  await panel.getByText("Can't make the meeting?").click();
  await panel.getByRole("group", { name: "Sealed vote" }).getByRole("button", { name: "Skip" }).click();
  await panel.getByRole("button", { name: "Seal vote" }).click();
  await expect(panel.getByText("Sealed: skip")).toBeVisible();
  await expect(await openLead(page, "Crew")).toContainText("Seen by you You sealed a vote to skip.");
  await guestCtx.close();
  await away.close();
});
