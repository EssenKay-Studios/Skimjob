import { expect, test, type Page } from "@playwright/test";
import { openPanel, startGame } from "./setupGame";

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

test("the Players strip is one scrolling row of whole names at 360 px @caseboard", async ({ browser }) => {
  const { ctx, board } = await open(browser, VIEWPORTS[0]!);
  const chips = board.locator(".cb__player");
  await expect(chips).toHaveCount(3);
  const tops = await chips.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size, "one row").toBe(1);
  // Names are whole (no mid-word break, no ellipsis for short names), and zero counts are not drawn.
  for (const [i, name] of ["Ben", "Cy", "DotB"].entries()) {
    const n = chips.nth(i).locator(".cb__pname");
    await expect(n).toHaveText(name);
    expect(await n.evaluate((el) => el.scrollWidth <= el.clientWidth && el.getClientRects().length === 1)).toBe(true);
  }
  await expect(chips.nth(2).locator(".cb__counts")).toHaveCount(0);
  await ctx.close();
});

test("a pinned pin looks different from an unpinned one, and the pinned row sits in the Pinned group @caseboard", async ({ browser }) => {
  const { ctx, board } = await open(browser, VIEWPORTS[1]!);
  const leads = board.getByRole("group", { name: "Leads" });
  const pin = leads.getByRole("button", { name: "Pin: Black market" });
  const off = await pin.innerHTML();
  await pin.click();
  const on = await leads.getByRole("button", { name: "Unpin: Black market" }).innerHTML();
  expect(on).not.toBe(off);
  expect(on).toContain("var(--clay)");
  expect(off).not.toContain("var(--clay)");
  await expect(board.getByRole("group", { name: "Pinned" })).toContainText("Black market");
  await ctx.close();
});

test("the suspect card names its basis and each lead has its summary line @caseboard", async ({ browser }) => {
  const { ctx, board } = await open(browser, VIEWPORTS[1]!);
  await expect(board.locator(".cb__kicker").first()).toContainText("Most likely liar · from all leads");
  await expect(board.locator(".cb__summary").first()).toHaveText("rang 3 · Ben, Cy inside");
  // The demo starts with one pin; a second makes the card read the pins only.
  await board.getByRole("button", { name: "Pin: Black market" }).click();
  await expect(board.locator(".cb__kicker").first()).toContainText("from 2 pins");
  await ctx.close();
});

// The live game keeps the case board in the shell at every width: a side tab beside the bank from 1024 px, a bottom sheet below it.
for (const width of [960, 980, 1023, 1024, 1280]) {
  test(`in the live game the case board has its own place at ${width} px @caseboard`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    const game = await startGame(page.request, { bots: 3, sessionLength: "1w" });
    await page.goto(`/game/${game.id}`);
    await openPanel(page, "Case");
    const board = page.getByRole("region", { name: "Case board" });
    const bank = page.getByRole("region", { name: "The bank" });
    await expect(board).toBeVisible();
    const b = (await board.boundingBox())!;
    if (width >= 1024) {
      // In the left column, level with the bank and to its left.
      const k = (await bank.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(k.x + 1);
    } else {
      // In the sheet, inside the screen.
      await expect(page.locator("dialog.bsheet[open] .bsheet__head h2")).toHaveText("Case");
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
    }
    const o = await overflow(page);
    expect(o.scroll).toBeLessThanOrEqual(o.client);
    await ctx.close();
  });
}
