import { expect, test, type Locator, type Page } from "@playwright/test";

// QA (PR #55, M2-11): the reveal UI at 360 and 1280 on the gallery's hand-made
// game (design §13; ui-style "End-of-game reveal"; CLAUDE.md UI rules):
// envelopes in ranking order with the stash over time that ends at the stash,
// tokens with their triggers and perks bought/used, locks only on what was
// hidden, VOID only on failed non-winners, keyboard-only scrubbing, 44 px
// targets and nothing past the viewport edge.

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 1280, height: 800 },
];

async function insideViewport(page: Page, root: Locator) {
  const width = page.viewportSize()!.width;
  const over = await root.evaluate(
    (el, w) =>
      [...el.querySelectorAll<HTMLElement>("*")]
        .filter((x) => {
          const r = x.getBoundingClientRect();
          return r.width > 0 && (r.right > w + 1 || r.left < -1);
        })
        .map((x) => x.className.toString() || x.tagName),
    width,
  );
  expect(over).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

for (const viewport of VIEWPORTS) {
  test.describe(`QA reveal at ${viewport.width}`, () => {
    test.use({ viewport, hasTouch: viewport.width < 1024 });

    test("envelopes, tokens, perks, locks, VOID and keyboard scrubbing", async ({ page }, info) => {
      test.skip(!info.project.name.startsWith("desktop") || info.project.name.endsWith("fast"), "the viewport is set here");
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/dev/gallery");
      const section = page.getByRole("region", { name: "End-of-game reveal" });
      await section.scrollIntoViewIfNeeded();
      const reveal = section.getByRole("region", { name: "The reveal" });
      await expect(reveal).toBeVisible();

      // Ranking order, places and the stash line ending at each envelope's stash (Ben 12, Cy 5, Dot 2, you 1).
      const cards = reveal.locator(".reveal__card");
      await expect(cards).toHaveCount(4);
      await expect(cards.locator(".reveal__place")).toHaveText(["1", "2", "3", "4"]);
      await expect(cards.locator(".reveal__who b")).toHaveText(["Ben", "Cy", "Bot · Dot", "You"]);
      await expect(cards.locator(".reveal__score b")).toHaveText(["12", "5", "2", "1"]);
      await expect(cards.nth(0).getByRole("img", { name: "Ben's stash over time: 3, 7, 12" })).toBeVisible();
      await expect(cards.nth(1).getByRole("img", { name: "Cy's stash over time: 0, 3, 5" })).toBeVisible();
      await expect(cards.nth(3).getByRole("img", { name: "Your stash over time: 0, 1, 1" })).toBeVisible();

      // Tokens with what earned them, and perks bought and used.
      await expect(cards.nth(0)).toContainText("1 token for a tip-off landing");
      await expect(cards.nth(1)).toContainText("1 token for a loop that hid a pocketer");
      await expect(cards.nth(2)).toContainText("Detective");
      await expect(cards.nth(3).locator(".reveal__perks")).toContainText("Bought (1 used):");
      await expect(cards.nth(3).locator(".reveal__perks")).toContainText("Peek");
      await expect(cards.nth(0).locator(".reveal__perks")).toHaveCount(0);

      // Success: only Ben wins, nobody is VOID.
      await expect(cards.nth(0)).toContainText("Winner");
      await expect(reveal.getByText("Winner", { exact: true })).toHaveCount(1);
      await expect(reveal.locator(".reveal__void")).toHaveCount(0);

      // Keyboard only: Prev starts disabled; Tab to Next and press Enter.
      const prev = reveal.getByRole("button", { name: "Previous round" });
      const next = reveal.getByRole("button", { name: "Next round" });
      await expect(prev).toBeDisabled();
      await next.focus();
      await page.keyboard.press("Enter");
      const sheet = reveal.locator(".reveal__round");
      await expect(sheet.getByRole("heading", { name: "Round 2" })).toBeVisible();
      await expect(prev).toBeEnabled();

      // Locks: on the hidden causes (police told apart, the Detective's check), not on the public claim or checkpoint.
      const item = (text: string) => sheet.locator(".reveal__item").filter({ hasText: text });
      for (const hidden of ["was Ben's tip-off", "was a routine patrol", "Stash check: Ben holds"]) {
        await expect(item(hidden).locator(".reveal__lock"), hidden).toHaveCount(1);
      }
      await expect(item("claimed Lookout").locator(".reveal__lock")).toHaveCount(0);
      await expect(sheet.locator(".reveal__item:not(.is-hidden)").first()).toBeVisible();

      // Every scrub control is a 44 px target; nothing spills past the edge.
      for (const b of [prev, next, ...(await reveal.getByRole("group", { name: "Rounds" }).getByRole("button").all())]) {
        const box = (await b.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      await insideViewport(page, reveal);

      // Raided, a ★ wins: Ben is the only winner and every other envelope is VOID.
      await section.getByRole("button", { name: "Raided (★ wins)" }).click();
      await expect(reveal.locator(".reveal__void")).toHaveCount(3);
      await expect(cards.nth(0).locator(".reveal__void")).toHaveCount(0);
      await expect(cards.nth(0)).toContainText("★ Also wins if the cops raid or the target is missed");
      // The timeline restarts at round 1 for the new ending.
      await expect(reveal.locator(".reveal__round").getByRole("heading", { name: "Round 1" })).toBeVisible();

      // Missed, nobody wins: Cy (Hacker, no ★) on top, top-of-ranking chip but no Winner, all VOID.
      await section.getByRole("button", { name: "Missed (nobody)" }).click();
      await expect(cards.locator(".reveal__who b")).toHaveText(["Cy", "Ben", "Bot · Dot", "You"]);
      await expect(reveal.getByText("Winner", { exact: true })).toHaveCount(0);
      await expect(cards.nth(0)).toContainText("Top of the ranking");
      await expect(reveal.locator(".reveal__void")).toHaveCount(4);
      await expect(cards.nth(0).getByRole("img", { name: "Cy's stash over time: 0, 3, 9" })).toBeVisible();
      await insideViewport(page, reveal);
      await page.screenshot({ path: info.outputPath(`qa-reveal-${viewport.width}.png`), fullPage: false });
      expect(errors).toEqual([]);
    });
  });
}
