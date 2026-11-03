import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// M2-11: the end-of-game reveal (design §13). The gallery's hand-made game at
// every launch width (role envelopes, who won and why, the round timeline with
// its hidden causes; no sideways scroll), and a real Quick game played out by
// bots, whose reveal only appears once it has ended.
// SHOTS_DIR=… saves the gallery section per viewport.
const SHOTS = process.env.SHOTS_DIR;

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

async function noSidewaysScroll(page: Page) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wide).toBeLessThanOrEqual(1);
}

for (const viewport of VIEWPORTS) {
  test.describe(`gallery reveal at ${viewport.width}`, () => {
    test.use({ viewport, hasTouch: viewport.width < 1024 });
    test("every role, who won and why, and a timeline to scrub through", async ({ page }, info) => {
      test.skip(!info.project.name.startsWith("desktop") || info.project.name.endsWith("fast"), "the viewport is set here");
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/dev/gallery");
      const section = page.getByRole("region", { name: "End-of-game reveal" });
      await section.scrollIntoViewIfNeeded();
      const reveal = section.getByRole("region", { name: "The reveal" });
      await expect(reveal).toBeVisible();

      // Job done: the top of the ranking wins; four envelopes with roles and the Mole's ★.
      const crew = reveal.getByRole("list", { name: "Every role, best first" });
      await expect(crew.locator(".reveal__card")).toHaveCount(4);
      for (const role of ["Rookie", "Mole", "Hacker", "Blackmailer"]) await expect(crew).toContainText(role);
      await expect(reveal.locator(".reveal__why")).toContainText("Job done, so the top of the ranking wins: Ben.");
      await expect(crew).toContainText("★ Also wins if the cops raid or the target is missed");
      await expect(reveal.locator(".reveal__void")).toHaveCount(0);

      // The timeline: round 1's real moves, the lie, and the Hacker's loop behind "camera offline".
      const sheet = reveal.locator(".reveal__round");
      await expect(sheet.getByRole("heading", { name: "Round 1" })).toBeVisible();
      await expect(sheet.getByRole("list", { name: "Where everyone really was" }).locator("li")).toHaveCount(4);
      await expect(sheet).toContainText("said Lobby: lie");
      await expect(sheet).toContainText("Your camera on the Vault went offline: Cy looped it.");
      await expect(sheet).toContainText("Cy earned a token for a loop that hid a pocketer.");

      // Next: police activity told apart, the stolen vote, the perk and the false claim.
      await reveal.getByRole("button", { name: "Next round" }).click();
      await expect(sheet.getByRole("heading", { name: "Round 2" })).toBeVisible();
      await expect(sheet).toContainText("Police activity (Heat +6) was a routine patrol.");
      await expect(sheet).toContainText("Police activity (Heat +6) was Ben's tip-off.");
      await expect(sheet).toContainText("Bot · Dot stole your vote, and it decided the shakedown.");
      await expect(sheet).toContainText("You bought a Peek perk");
      await expect(sheet).toContainText("Ben claimed Lookout, but was really the Mole.");
      await expect(sheet).toContainText("Forged:");

      // A round chip jumps straight there: the Power cut.
      const r3 = reveal.getByRole("group", { name: "Rounds" }).getByRole("button", { name: "Round 3" });
      await r3.click();
      await expect(r3).toHaveAttribute("aria-pressed", "true");
      await expect(sheet).toContainText("Power cut");
      await expect(sheet).toContainText("Your camera on the Deposit boxes went offline in the Power cut.");
      await expect(reveal.getByRole("button", { name: "Next round" })).toBeDisabled();
      const box = await r3.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await noSidewaysScroll(page);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.waitForTimeout(700);
        await section.screenshot({ path: `${SHOTS}/reveal-${viewport.width}.png` });
      }

      // A raid a ★ role wins; then a missed target nobody wins, every envelope VOID.
      await section.getByRole("button", { name: "Raided (★ wins)" }).click();
      await expect(reveal.locator(".reveal__why")).toContainText("A ★ role wins this ending from the top of the ranking: Ben.");
      await expect(reveal.locator(".reveal__void")).toHaveCount(3);
      await section.getByRole("button", { name: "Missed (nobody)" }).click();
      await expect(reveal.locator(".reveal__why")).toContainText("nobody wins: the ranking is a loss");
      await expect(reveal.locator(".reveal__void")).toHaveCount(4);
      await noSidewaysScroll(page);
      expect(errors).toEqual([]);
    });
  });
}

test("a real game shows its reveal only once it has ended @fast-clock", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-fast", "one viewport is enough for the flow");
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const game = await startGame(page.request, { bots: 3 });
  await page.goto(`/game/${game.id}`);
  await expect(page.locator(".hud__kicker")).toContainText(/Round \d of 9/);
  await expect(page.getByRole("region", { name: "The reveal" })).toHaveCount(0);

  // The host never moves (default moves); the bots play the game out.
  await expect(page.getByRole("list", { name: "Final ranking" })).toBeVisible({ timeout: 280_000 });
  const reveal = page.getByRole("region", { name: "The reveal" });
  await expect(reveal).toBeVisible();
  await expect(reveal.locator(".reveal__card")).toHaveCount(4);
  await expect(reveal.locator(".reveal__why")).toContainText(/Job done|The heist failed/);
  const sheet = reveal.locator(".reveal__round");
  const first = await sheet.getByRole("heading", { level: 4 }).textContent();
  if (first === "Setup") await reveal.getByRole("button", { name: "Next round" }).click();
  await expect(sheet.getByRole("heading", { name: "Round 1" })).toBeVisible();
  // Everyone's real move, the host's own default one included.
  const moves = sheet.getByRole("list", { name: "Where everyone really was" });
  await expect(moves.locator("li")).toHaveCount(4);
  await expect(moves).toContainText("missed the deadline");
  await noSidewaysScroll(page);
  expect(errors).toEqual([]);
});
