import { expect, test, type Page } from "@playwright/test";

// QA (PR #301, #294): the alibi pop-up, the 12-crook snapshot card, its key and the mark pop-over on
// /dev/gallery at the five widths (design §10). Screenshots kept in test-results as evidence; no page
// overflow, every tap target at least 44 px, the pop-up inside the viewport, and the pop-over's
// two buttons per state, closed by a tap elsewhere with no change.

const WIDTHS = [360, 390, 768, 1024, 1280];

test.beforeEach(({}, info) =>
  test.skip(info.project.name !== "mobile", "viewports are set per test"),
);

const section = (page: Page) =>
  page.locator('section[aria-labelledby="g-alibi"]');

/** Visible tap targets inside `scope` smaller than 44 × 44 px. */
const smallTargets = (page: Page, scope: string) =>
  page.evaluate(
    (sel) =>
      [...document.querySelectorAll<HTMLElement>(`${sel} button`)].flatMap(
        (b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && (r.width < 44 || r.height < 44)
            ? [
                `${b.getAttribute("aria-label") ?? b.textContent} ${r.width}x${r.height}`,
              ]
            : [];
        },
      ),
    scope,
  );

for (const width of WIDTHS) {
  test(`${width}px: card, key, pop-up and pop-over fit, with 44 px targets; screenshots @alibi`, async ({
    browser,
  }, info) => {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      hasTouch: true,
      isMobile: width < 1024,
    });
    const page = await ctx.newPage();
    await page.goto("/dev/gallery");
    const s = section(page);
    await s.scrollIntoViewIfNeeded();
    const noOverflow = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
    expect(await noOverflow()).toBe(true);

    // The card: 12 crooks, each a 44 px tap box; the key closed by default and one open.
    const card = s.locator(".snap").first();
    // 12 crooks; the viewer's own avatar is not a button (no mark on yourself).
    await expect(card.locator(".snap__crook")).toHaveCount(12);
    await expect(card.locator("button.snap__crook")).toHaveCount(11);
    expect(
      await smallTargets(page, 'section[aria-labelledby="g-alibi"] .snap'),
    ).toEqual([]);
    const keys = s.locator(".cardkey__btn");
    await expect(keys.first()).toHaveAttribute("aria-expanded", "false");
    await expect(keys.nth(1)).toHaveAttribute("aria-expanded", "true");
    await card.screenshot({ path: info.outputPath(`card-${width}.png`) });
    await s
      .locator(".cardkey")
      .nth(1)
      .screenshot({ path: info.outputPath(`key-${width}.png`) });

    // The mark pop-over at a crook: two buttons, each a 44 px target; Escape closes it.
    await card.locator("button.snap__crook").first().click();
    const pop = page.locator(".markpop:popover-open");
    await expect(pop).toBeVisible();
    await expect(pop.getByRole("button")).toHaveCount(2);
    expect(await smallTargets(page, ".markpop:popover-open")).toEqual([]);
    const pb = (await pop.boundingBox())!;
    expect(pb.x).toBeGreaterThanOrEqual(0);
    expect(pb.x + pb.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`popover-${width}.png`) });
    // Tapping anywhere else closes it with no change (Escape on /dev/gallery also leaves the page, so tap).
    const outside = () => s.locator("#g-alibi").click();
    await outside();
    await expect(pop).toBeHidden();
    await expect(card.locator(".snap__badge")).toHaveCount(2);

    // Each pop-over state offers the two states it isn't in (design §10).
    const offered: Record<string, string[]> = {
      unmarked: ["Trusted", "Liar"],
      Trusted: ["Clear", "Liar"],
      Liar: ["Trusted", "Clear"],
    };
    for (const [state, want] of Object.entries(offered)) {
      await s.getByRole("button", { name: `Pop-over: ${state}` }).click();
      const labels = await page
        .locator(".markpop:popover-open")
        .getByRole("button")
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute("aria-label") ?? ""),
        );
      expect(
        labels.map((l) =>
          l.startsWith("Clear") ? "Clear" : l.split(" ").at(-1),
        ),
      ).toEqual(want);
      await outside();
      await expect(page.locator(".markpop:popover-open")).toHaveCount(0);
    }

    // The pop-up: inside the viewport, every room tile and the post button 44 px or more.
    await s.getByRole("button", { name: "Open the alibi pop-up" }).click();
    const popup = page.getByRole("dialog", { name: "Psst. Where were you?" });
    await expect(popup).toBeVisible();
    // Let the springy entrance finish before measuring and the screenshot.
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished),
      ),
    );
    await popup
      .getByRole("group", { name: "Where you say you were" })
      .getByRole("button")
      .first()
      .click();
    await expect(
      popup.getByRole("button", { name: "I was in the Rooftop" }),
    ).toBeEnabled();
    expect(await smallTargets(page, '[role="dialog"]')).toEqual([]);
    const db = (await popup.boundingBox())!;
    expect(db.x).toBeGreaterThanOrEqual(0);
    expect(db.x + db.width).toBeLessThanOrEqual(width + 0.5);
    expect(await noOverflow()).toBe(true);
    await page.screenshot({ path: info.outputPath(`popup-${width}.png`) });
    await ctx.close();
  });
}
