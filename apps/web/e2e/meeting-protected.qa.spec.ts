import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { clearMeeting } from "./meetingCards";
import { callEmergency, openPanel, startGame, settle } from "./setupGame";

// QA (PR #226, the lost vote): seed meeting-4's round 1 ends in a raid whose police briefing shakes a bot down, so that
// bot is protected (design §9.2, §9.7). The sealed picker in the result window still lists them (a sealed vote may name
// a protected player, §9.5); the live emergency vote that follows leaves them off, and the vote cast is the one shown.
// Both widths. QA_SHOTS=… saves the pickers as qa226-<what>-<width>.png.
const DIR = process.env.QA_SHOTS;

test("a briefing's protected bot: on the sealed picker, off the live one, and the live vote lands (design §9.5, §9.7) @meeting", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (what: string) => {
    if (!DIR) return;
    mkdirSync(DIR, { recursive: true });
    await settle(page);
    await page.screenshot({ path: `${DIR}/qa226-${what}-${page.viewportSize()!.width}.png` });
  };
  const game = await startGame(page.request, { bots: 3, sessionLength: "1h", voteVisibility: "hiddenThenRevealed", seed: "meeting-4" });
  const hold = async (what: "pause" | "resume") => expect((await page.request.post(`/api/games/${game.id}/${what}`)).ok(), what).toBe(true);
  const held = async (steps: () => Promise<void>) => {
    await hold("pause");
    await expect(page.getByText("Paused by the host")).toBeVisible(); // its banner re-lays the page out
    try {
      await steps();
    } finally {
      await hold("resume");
    }
  };
  let sealedNames: string[] = [];
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "This round"); // below 1024 px it stays open: the vote dialog opens over it
  await expect(page.getByRole("heading", { name: "Police briefing" })).toBeVisible({ timeout: 45_000 });
  await clearMeeting(page);
  await expect(page.getByRole("button", { name: "Call an emergency meeting" })).toBeEnabled({ timeout: 30_000 });

  // Held while we look and call: the result window's 6 s can't run out under the checks.
  await held(async () => {
    await clearMeeting(page); // the briefing's result card can still be up (modal) over the panel
    const panel = page.getByRole("region", { name: "Crew meetings" });
    await panel.getByText("Can't make the meeting?").click();
    const sealed = panel.getByRole("group", { name: "Sealed vote" }).getByRole("button");
    await expect(sealed).toHaveCount(4); // all three bots, the protected one too, and Skip
    sealedNames = (await sealed.allInnerTexts()).map((t) => t.trim());
    await shot("sealed-picker");
    await panel.getByText("Can't make the meeting?").click();
    await callEmergency(page);
  });

  // The notice runs, the vote opens; then held again while every check and vote lands.
  const dialog = page.getByRole("dialog", { name: "Who's skimming?" });
  await expect(dialog).toContainText("Emergency meeting · called by you", { timeout: 20_000 });
  await held(async () => {
    const note = dialog.locator(".briefing__protected");
    await expect(note).toContainText(/so not on the list: \w+B\b/);
    const shielded = (await note.innerText()).match(/not on the list: (.+)\./)![1]!.trim();
    expect(sealedNames.some((t) => t.endsWith(shielded)), `sealed picker lists ${shielded}: ${sealedNames}`).toBe(true);
    const live = dialog.getByRole("group", { name: "Your vote" }).getByRole("button");
    await expect(live).toHaveCount(3); // two bots and Skip
    for (const t of await live.allInnerTexts()) expect(t.trim().endsWith(shielded), `live picker offers ${t}`).toBe(false);
    await shot("live-picker");
    // Every bot the live picker offers takes the vote (the lost vote was a refused one): cast one, then change to the other.
    for (const i of [0, 1]) {
      const name = (await live.nth(i).innerText()).trim().replace(/^\S\s*/, "");
      await live.nth(i).click();
      await dialog.getByRole("button", { name: i === 0 ? "Cast vote" : "Change vote" }).click();
      await expect(dialog.locator(".vote__status")).toContainText(`Your vote: shake down ${name}`);
    }
    await shot("live-voted");
  });
  expect(errors).toEqual([]);
});
