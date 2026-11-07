import { expect, test, type Page } from "@playwright/test";

// QA (S3b.5, PR #165): the case board shell on /dev/gallery (design §15.4, §15.6).
// Screenshots at the five widths (evidence in test-results), keyboard and
// screen-reader names, the shell's case panel, reduced motion and the theme tokens.

const WIDTHS = [360, 390, 768, 1024, 1280];

test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

async function gallery(browser: import("@playwright/test").Browser, width: number, reducedMotion: "no-preference" | "reduce" = "no-preference") {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, isMobile: width < 1024, reducedMotion });
  const page = await ctx.newPage();
  await page.goto("/dev/gallery");
  const section = page.locator('section[aria-labelledby="g-caseboard"]');
  await section.scrollIntoViewIfNeeded();
  return { ctx, page, section, board: section.getByRole("region", { name: "Case board" }).first() };
}

/** Elements sticking out of the board's right edge (the frame's own hatched shadow aside). */
const overflowing = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('section[aria-labelledby="g-caseboard"] .cb')].flatMap((board) => {
      const edge = board.getBoundingClientRect().right + 0.5;
      return [...board.querySelectorAll<HTMLElement>("*")]
        .filter((el) => !el.closest(".sk-art") && el.getBoundingClientRect().right > edge)
        .map((el) => el.getAttribute("class") ?? el.tagName);
    }),
  );

for (const width of WIDTHS) {
  test(`${width}px: everything opened and pinned still fits; screenshot @caseboard`, async ({ browser }, info) => {
    const { ctx, page, section, board } = await gallery(browser, width);
    const leads = board.getByRole("group", { name: "Leads" });
    // Open every lead and pin every lead and every fact: the longest the board gets.
    for (const btn of await leads.locator(".cb__lead-btn").all()) await btn.click();
    for (const name of await leads.getByRole("button", { name: /^Pin: / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!))) {
      await leads.getByRole("button", { name, exact: true }).first().click();
    }
    await expect(leads.getByRole("button", { name: /^Pin: / })).toHaveCount(0);
    // 4 leads + 6 facts pinned (the demo's one starting pin included).
    await expect(board.getByRole("group", { name: "Pinned" }).locator("li")).toHaveCount(10);
    expect(await overflowing(page)).toEqual([]);
    const o = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(o[0]).toBeLessThanOrEqual(o[1]!);
    await section.screenshot({ path: info.outputPath(`caseboard-${width}.png`) });
    await ctx.close();
  });
}

test("keyboard: Tab reaches a lead, Enter opens its facts, Space pins a fact, focus stays put @caseboard", async ({ browser }) => {
  const { ctx, page, board } = await gallery(browser, 1280);
  const vault = board.locator(".cb__lead-btn", { hasText: "Vault" });
  await vault.focus();
  await page.keyboard.press("Enter");
  await expect(vault).toHaveAttribute("aria-expanded", "true");
  // aria-controls points at the open list of facts.
  const panel = await vault.getAttribute("aria-controls");
  await expect(board.locator(`[id="${panel}"]`)).toContainText("The bell rang 3 times.");
  await page.keyboard.press("Tab"); // the lead's own pin
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Pin: Vault");
  await page.keyboard.press("Tab"); // the first fact's pin
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Pin: The bell rang 3 times.");
  await page.keyboard.press("Space");
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Unpin: The bell rang 3 times.");
  await expect(page.locator(":focus")).toHaveAttribute("aria-pressed", "true");
  await expect(board.getByRole("group", { name: "Pinned" })).toContainText("The bell rang 3 times.");
  // Focus is visible on the pin (not hover-only styling).
  const outline = await page.locator(":focus").evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  // A Players chip toggles with the keyboard and says it is pressed.
  const ben = board.getByRole("button", { name: /^Ben,/ });
  await ben.focus();
  await page.keyboard.press("Enter");
  await expect(ben).toHaveAttribute("aria-pressed", "true");
  await expect(board.getByRole("group", { name: "Leads" }).locator(".cb__title")).toHaveText(["Vault"]);
  await page.keyboard.press("Enter");
  await expect(ben).toHaveAttribute("aria-pressed", "false");
  await ctx.close();
});

test("screen reader: the board's regions, groups and buttons all have names @caseboard", async ({ browser }) => {
  const { ctx, board } = await gallery(browser, 390);
  const unnamed = await board.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>("button, [role=img], [role=group]")]
      .filter((el) => !(el.getAttribute("aria-label") ?? el.textContent ?? "").trim())
      .map((el) => el.outerHTML.slice(0, 80)),
  );
  expect(unnamed).toEqual([]);
  // Icons are hidden from the reader; the only drawn pictures it hears are named avatars.
  const loud = await board.evaluate((root) => [...root.querySelectorAll("svg:not([aria-hidden=true])")].filter((el) => !(el.getAttribute("role") === "img" && el.getAttribute("aria-label"))).length);
  expect(loud).toBe(0);
  await ctx.close();
});

test("the shell's Case tab holds the board, with 44px targets, at 360 and 1280 @caseboard", async ({ browser }) => {
  for (const width of [360, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: true, isMobile: width < 1024 });
    const page = await ctx.newPage();
    await page.goto("/dev/gallery");
    const caseTab = page.getByRole("button", { name: /^Case/ }).first();
    if (await caseTab.isVisible()) await caseTab.click();
    const board = page.getByRole("region", { name: "Case board" }).filter({ has: page.locator(".cb__card") });
    await expect(board.first()).toBeAttached();
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".cb button")]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && (r.width < 44 || r.height < 44)).length,
    );
    expect(small).toBe(0);
    await ctx.close();
  }
});

test("reduced motion: nothing on the board moves (colour fades aside) @caseboard", async ({ browser }) => {
  const { ctx, board } = await gallery(browser, 390, "reduce");
  await board.locator(".cb__lead-btn").first().click();
  const moving = await board.evaluate((root) =>
    [root, ...root.querySelectorAll<HTMLElement>("*")]
      .map((el) => getComputedStyle(el))
      .filter((s) => {
        const durations = s.transitionDuration.split(",").map(parseFloat);
        const moving = s.transitionProperty.split(",").map((p) => p.trim()).filter((p, i) => (durations[i % durations.length] ?? 0) > 0 && !["fill", "color", "background-color", "border-color", "stroke", "opacity"].includes(p));
        return (s.animationName !== "none" && s.animationDuration !== "0s") || moving.length > 0;
      }).length,
  );
  expect(moving).toBe(0);
  await ctx.close();
});
