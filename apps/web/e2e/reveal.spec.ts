import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// M2-11: the end-of-game reveal (design §13). The gallery's hand-made game at
// every launch width (role envelopes, who won and why, the round timeline with
// its hidden causes; no sideways scroll), and a real 15-min game played out by
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
      for (const role of ["Rookie", "Mole", "Hacker", "Detective"]) await expect(crew).toContainText(role);
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

      // Next: police activity told apart, the Detective's check, the perk and the false claim.
      await reveal.getByRole("button", { name: "Next round" }).click();
      await expect(sheet.getByRole("heading", { name: "Round 2" })).toBeVisible();
      await expect(sheet).toContainText("Police activity (Heat +6) was a routine patrol.");
      await expect(sheet).toContainText("Police activity (Heat +6) was Ben's tip-off.");
      await expect(sheet).toContainText("Stash check: Ben holds 6 or more (not clean).");
      await expect(sheet).toContainText("You bought a Peek perk");
      await expect(sheet).toContainText("Ben claimed Lookout, but was really the Mole.");

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

// The 12-seat 15-min game QA (game.qa.spec.ts) sometimes ended 1 px or more
// wider than a 390 px phone: a 24-character name with no break points ("W"×24)
// in a timeline line, the "why" note or a token line would not wrap. Here the
// gallery's game with 24-character names, every ending and every round, at
// every launch width: nothing past the edge, not even 1 px.
const LAUNCH_WIDTHS = [360, 390, 768, 1024, 1280];
for (const width of LAUNCH_WIDTHS) {
  test.describe(`gallery reveal with 24-character names at ${width}`, () => {
    test.use({ viewport: { width, height: 800 }, hasTouch: width < 1024 });
    test("no line pushes the page sideways, in any ending or round", async ({ page }, info) => {
      test.skip(!info.project.name.startsWith("desktop") || info.project.name.endsWith("fast"), "the viewport is set here");
      // Twelve round sheets on the whole gallery page: slow on a busy runner.
      test.setTimeout(120_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/dev/gallery");
      const section = page.getByRole("region", { name: "End-of-game reveal" });
      await section.scrollIntoViewIfNeeded();
      await section.getByRole("button", { name: "24 characters" }).click();
      const reveal = section.getByRole("region", { name: "The reveal" });
      await expect(reveal.locator(".reveal__why")).toContainText("WWWWWWWWWWWWWWWWWWWWWWWW");
      for (const ending of ["Job done", "Raided (★ wins)", "Missed (nobody)"]) {
        await section.getByRole("button", { name: ending }).click();
        const rounds = reveal.getByRole("group", { name: "Rounds" }).getByRole("button");
        const n = await rounds.count();
        for (let i = 0; i < n; i++) {
          await rounds.nth(i).click();
          await expect(rounds.nth(i)).toHaveAttribute("aria-pressed", "true");
          const where = `${ending}, round chip ${i + 1}`;
          const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
          expect(o.scroll, `${where}: page wider than the viewport`).toBeLessThanOrEqual(o.client);
          // No box of the reveal past either edge (the round chips scroll inside their own strip).
          const out = await reveal.evaluate((el, w) => {
            const xs: string[] = [];
            for (const x of el.querySelectorAll<HTMLElement>("*")) {
              if (x.closest(".reveal__rounds")) continue;
              const r = x.getBoundingClientRect();
              if (r.width > 0 && (r.right > w || r.left < 0)) xs.push(`${x.getAttribute("class") ?? x.tagName} ${r.left.toFixed(1)}..${r.right.toFixed(1)}`);
            }
            return xs;
          }, width);
          expect(out, where).toEqual([]);
        }
      }
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
