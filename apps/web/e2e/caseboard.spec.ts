import { expect, test, type Page } from "@playwright/test";

// The case board shell (design §15.4, S3b.5) on /dev/gallery at the five launch widths:
// tap a lead to open its facts, pin a lead or a single fact into the Pinned group,
// the Players strip filters the leads, and the phone sheet holds the same board.
// No overflow, 44 px targets, no hover needed, reduced motion honoured.

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

async function open(browser: import("@playwright/test").Browser, viewport: { width: number; height: number }, reducedMotion: "no-preference" | "reduce" = "no-preference") {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: viewport.width < 1024, reducedMotion });
  const page = await ctx.newPage();
  await page.goto("/dev/gallery");
  const section = page.locator('section[aria-labelledby="g-caseboard"]');
  await section.scrollIntoViewIfNeeded();
  // The first board in the section: the one with leads, not the empty one or the sheet's.
  return { ctx, page, section, board: section.getByRole("region", { name: "Case board" }).first() };
}

const smallTargets = (page: Page, root: string) =>
  page.evaluate(
    (sel) =>
      [...document.querySelectorAll<HTMLElement>(`${sel} a[href], ${sel} button, ${sel} [role=button]`)]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
        .map(({ el, r }) => `${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim()} ${Math.round(r.width)}x${Math.round(r.height)}`),
    root,
  );
const overflow = (page: Page) => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));

for (const viewport of VIEWPORTS) {
  test(`leads, pins and the Players strip at ${viewport.width}x${viewport.height}: no overflow, targets ≥44px @caseboard`, async ({ browser }) => {
    const { ctx, page, board } = await open(browser, viewport);
    const leads = board.getByRole("group", { name: "Leads" });
    // Newest first, with ⚠ and bell icons; facts stay folded until a lead is tapped.
    const titles = await leads.locator(".cb__title").allTextContents();
    expect(titles).toEqual(["Vault", "Black market", "The crew", "Lobby"]);
    await expect(leads.getByRole("img", { name: "Doesn't add up" })).toHaveCount(1);
    await expect(leads.getByRole("img", { name: "Bell rang" })).toHaveCount(2);
    await expect(leads.getByText("The bell rang 3 times.")).toHaveCount(0);

    await leads.locator(".cb__lead-btn", { hasText: "Vault" }).click();
    await expect(leads.getByText("The bell rang 3 times.")).toBeVisible();
    await expect(leads.getByText("You saw Ben in the Vault; he said Security.")).toBeVisible();
    await expect(leads.getByText("Seen by you")).toBeVisible();

    // Pin one fact (the demo starts with "You saw Ben here." pinned) and a whole lead.
    const pinned = board.getByRole("group", { name: "Pinned" });
    await expect(pinned).toContainText("You saw Ben here.");
    await leads.getByRole("button", { name: "Pin: The bell rang 3 times." }).click();
    await leads.getByRole("button", { name: "Pin: Black market" }).click();
    await expect(pinned).toContainText("The bell rang 3 times.");
    await expect(pinned).toContainText("Black market");
    await pinned.getByRole("button", { name: "Unpin: The bell rang 3 times." }).click();
    await expect(pinned).not.toContainText("The bell rang 3 times.");
    await expect(leads.getByRole("button", { name: "Pin: The bell rang 3 times." })).toHaveAttribute("aria-pressed", "false");

    // The Players strip: counts, and a tap shows the leads that name the player.
    await expect(board.getByRole("button", { name: "Ben, 1 warnings, 1 pins" })).toBeVisible();
    await board.getByRole("button", { name: /^Ben,/ }).click();
    await expect(leads.locator(".cb__title")).toHaveText(["Vault"]);
    await board.getByRole("button", { name: "All leads" }).click();
    await expect(leads.locator(".cb__title")).toHaveCount(4);

    const o = await overflow(page);
    expect(o.scroll).toBeLessThanOrEqual(o.client);
    expect(await smallTargets(page, 'section[aria-labelledby="g-caseboard"] .cb')).toEqual([]);
    await ctx.close();
  });
}

test("the suspect card names a player with a reason, or nobody @caseboard", async ({ browser }) => {
  const { ctx, section, board } = await open(browser, VIEWPORTS[1]!);
  await expect(board.locator(".cb__card")).toContainText("Said Security in R4; you saw him in the Vault.");
  await expect(section.getByRole("region", { name: "Case board" }).last().locator(".cb__card")).toContainText("Nobody yet.");
  await ctx.close();
});

test("the same board opens in a phone bottom sheet and pins work there @caseboard", async ({ browser }) => {
  const { ctx, page, section } = await open(browser, VIEWPORTS[0]!);
  await section.getByRole("button", { name: "Open as a phone sheet" }).click();
  const sheet = page.getByRole("dialog", { name: "Case board" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Pin: Lobby" }).click();
  await expect(sheet.getByRole("group", { name: "Pinned" })).toContainText("Lobby");
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await ctx.close();
});

test("reduced motion: the pin does not animate @caseboard", async ({ browser }) => {
  const { ctx, board } = await open(browser, VIEWPORTS[1]!, "reduce");
  const duration = await board.locator(".cb__pin").first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration).toBe("0s");
  await ctx.close();
});
