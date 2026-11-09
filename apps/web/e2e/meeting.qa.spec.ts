import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { callEmergency, startGame } from "./setupGame";
import { pickRoom } from "./move";

// QA for M2-7 (PR #35): three human contexts in one game, 1-hour preset at
// TIME_SCALE 0.1 (30 s rounds, 6 s notice, 18 s vote window).
// Screenshots: qa-meet-*.png into QA_SHOTS (or SHOTS_DIR) when set; none otherwise (CI).
const DIR = process.env.QA_SHOTS ?? process.env.SHOTS_DIR;

async function shot(p: Page, name: string) {
  if (!DIR) return;
  mkdirSync(DIR, { recursive: true });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${DIR}/qa-meet-${name}-${p.viewportSize()!.width}.png`, fullPage: true });
}

/** No horizontal overflow, every visible control at least 44 × 44 px. */
async function layoutOk(p: Page, where: string) {
  const r = await p.evaluate(() => {
    const small = [...document.querySelectorAll("button, a[href], summary, select, input:not([type=hidden])")]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && (b.height < 43.5 || b.width < 43.5);
      })
      .map((e) => {
        const b = e.getBoundingClientRect();
        return `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)}" ${Math.round(b.width)}x${Math.round(b.height)}`;
      });
    return { overflow: document.documentElement.scrollWidth - window.innerWidth, small };
  });
  expect(r.overflow, `${where}: horizontal overflow`).toBeLessThanOrEqual(0);
  expect(r.small, `${where}: touch targets under 44 px`).toEqual([]);
}

const dialogOf = (p: Page) => p.getByRole("dialog", { name: "Who's skimming?" });

for (const mode of ["hiddenThenRevealed", "open", "secret"] as const) {
  test(`QA: 3 humans, emergency after round 1, sealed vote while absent, reload mid-meeting, clean shakedown (${mode}) @meeting`, async ({ page: host, browser }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    const vp = host.viewportSize()!;
    const c1 = await browser.newContext({ viewport: vp });
    const c2 = await browser.newContext({ viewport: vp });
    const g1 = await c1.newPage();
    const g2 = await c2.newPage();
    for (const p of [host, g1, g2]) p.on("pageerror", (e) => errors.push(e.message));
    const game = await startGame(host.request, { bots: 0, guests: [g1.request, g2.request], voteVisibility: mode, sessionLength: "1h" });
    await Promise.all([host, g1, g2].map((p) => p.goto(`/game/${game.id}`)));

    // Round 1: the host loots the Office.
    await pickRoom(host, "Office");
    await expect(host.getByRole("button", { name: "Lock it in" })).toBeEnabled();
    await host.getByRole("button", { name: "Lock it in" }).click();

    // design §9.5, §11.3: every seat is dealt a role, and a Smooth Talker's skip counts twice, so with Guest 2
    // as the Smooth Talker the 2 ballots for Guest 2 tie the skip's 2 and nothing passes.
    const talker = (await g2.locator("#role-h").textContent())?.trim() === "Smooth Talker";
    // Guest 2 can't make it: seals a skip , then leaves.
    const panel2 = g2.getByRole("region", { name: "Crew meetings" });
    await panel2.getByText("Can't make the meeting?").click();
    await panel2.getByRole("group", { name: "Sealed vote" }).getByRole("button", { name: "Skip" }).click();
    await panel2.getByRole("button", { name: "Seal vote" }).click();
    await expect(panel2.getByText("Sealed: skip")).toBeVisible();
    await g2.close();

    // Guest 1 calls the emergency meeting in a round's result window (design §9.3).
    await callEmergency(g1);
    await expect(host.locator(".hud__alert")).toContainText("Emergency meeting in");

    const hd = dialogOf(host);
    const gd = dialogOf(g1);
    await expect(hd).toBeVisible({ timeout: 10_000 });
    await expect(gd).toBeVisible();
    await expect(hd).toContainText("called by Guest 1");
    // The host votes Guest 2.
    await hd.getByRole("group", { name: "Your vote" }).getByRole("button", { name: "Guest 2" }).click();
    await hd.getByRole("button", { name: "Cast vote" }).click();
    await expect(hd.locator(".vote__status")).toContainText("Your vote: shake down Guest 2");

    // What guest 1 sees of the host's ballot, per mode (design §11.2).
    if (mode === "open") {
      await expect(gd.getByRole("list", { name: "Ballots so far" })).toContainText("Guest 2");
      await expect(gd.getByRole("list", { name: "Live tally" })).toBeVisible();
    } else {
      await expect(gd.getByRole("list", { name: "Ballots so far" })).toHaveCount(0);
      await expect(gd.getByRole("list", { name: "Live tally" })).toHaveCount(0);
      await expect(gd.locator(".vote__status")).not.toContainText("Host");
      await expect(g1.locator("body")).not.toContainText("Host voted");
    }
    await shot(g1, `${mode}-g1-dialog`);
    await layoutOk(g1, `${mode} vote dialog`);

    // Guest 1: vote, change, change back.
    const pick = gd.getByRole("group", { name: "Your vote" });
    await pick.getByRole("button", { name: "Skip" }).click();
    await gd.getByRole("button", { name: "Cast vote" }).click();
    await expect(gd.locator(".vote__status")).toContainText("Your vote: skip");
    await pick.getByRole("button", { name: "Guest 2" }).click();
    await gd.getByRole("button", { name: "Change vote" }).click();
    await expect(gd.locator(".vote__status")).toContainText("Your vote: shake down Guest 2");
    await shot(host, `${mode}-host-dialog`);

    // The host reloads mid-meeting: the ballot is still theirs.
    await host.reload();
    const again = host.getByRole("button", { name: "Change your vote" });
    // The vote dialog reopens by itself after a reload (or via "Change your vote").
    await expect(hd).toBeVisible({ timeout: 5_000 }).catch(() => again.click());
    await expect(hd.locator(".vote__status")).toContainText("Your vote: shake down Guest 2");
    await hd.getByRole("button", { name: "Back to the board" }).click();

    // Result: 2 for Guest 2, 1 sealed skip → passes; Guest 2 is clean (only the share): nothing is taken (design §9.6).
    const results = host.getByRole("region", { name: /The crew voted|No majority|Too few votes/ });
    await expect(results).toBeVisible({ timeout: 25_000 });
    if (talker) {
      await expect(results).toContainText("No majority: nobody is shaken down");
    } else {
      await expect(results).toContainText("The crew voted to shake down Guest 2");
      await expect(results).toContainText(/Clean! Guest 2 was holding \d+/);
      await expect(results).toContainText("Nothing above the share: nothing taken.");
    }
    const tally = results.getByRole("list", { name: "Final tally" });
    await expect(tally).toContainText("Skip");
    if (mode === "secret") await expect(results.getByRole("list", { name: "How everyone voted" })).toHaveCount(0);
    else await expect(results.getByRole("list", { name: "How everyone voted" })).toContainText(/Guest 2: skip/);
    await results.scrollIntoViewIfNeeded();
    await shot(host, `${mode}-host-results`);
    await layoutOk(host, `${mode} results`);

    // Guest 2 comes back: their sealed vote was used.
    const back = await c2.newPage();
    back.on("pageerror", (e) => errors.push(e.message));
    await back.goto(`/game/${game.id}`);
    // The results banner lasts until the next round resolves: they were the one shaken down.
    if (talker) await expect(back.getByRole("region", { name: /No majority/ })).toBeVisible();
    else await expect(back.getByRole("region", { name: /The crew voted/ })).toContainText("The crew voted to shake you down");
    await shot(back, `${mode}-g2-back`);

    expect(errors).toEqual([]);
    await c1.close();
    await c2.close();
  });
}
