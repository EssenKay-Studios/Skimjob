import { expect, test, type Browser, type Page } from "@playwright/test";
import { settle } from "./setupGame";

// QA for the game shell and bottom sheet (design §15.6, S3b.2): the breakpoint
// edges, a landscape phone, long sheet content, the page behind a sheet, focus
// both ways round the sheet, and a sheet left open while the window widens.

test.beforeEach(({}, info) =>
  test.skip(info.project.name !== "mobile", "viewports are set per test"),
);

async function open(
  browser: Browser,
  viewport: { width: number; height: number },
  touch = viewport.width < 1024,
) {
  const ctx = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch,
  });
  const page = await ctx.newPage();
  await page.goto("/dev/gallery/shell");
  await expect(page.getByText("The bank board")).toBeVisible();
  return { ctx, page };
}

const noOverflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );

for (const [width, wide] of [
  [1023, false],
  [1024, true],
  [1025, true],
] as const) {
  test(`shell at ${width}px: ${wide ? "three columns" : "tab bar"}, no overflow @shell`, async ({
    browser,
  }) => {
    const { ctx, page } = await open(browser, { width, height: 720 });
    await expect(
      page.getByRole("navigation", { name: "Game panels" }),
    ).toHaveCount(wide ? 0 : 1);
    await expect(page.getByRole("heading", { name: "This round" })).toHaveCount(
      wide ? 1 : 0,
    );
    expect(await noOverflow(page)).toBe(true);
    if (wide)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= window.innerHeight,
        ),
      ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`qa-shell-${width}.png`),
    });
    await ctx.close();
  });
}

test("landscape phone: tab bar on screen, sheet fits and its close button is reachable @shell", async ({
  browser,
}) => {
  const viewport = { width: 844, height: 390 };
  const { ctx, page } = await open(browser, viewport, true);
  const tabs = page.getByRole("navigation", { name: "Game panels" });
  const bar = (await tabs.boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(viewport.height);
  expect(await noOverflow(page)).toBe(true);
  await tabs.getByRole("button", { name: "Crew" }).click();
  const sheet = page.getByRole("dialog", { name: "Crew" });
  await settle(page);
  const s = (await sheet.locator(".bsheet__sheet").boundingBox())!;
  expect(s.y).toBeGreaterThanOrEqual(0);
  const close = (await sheet
    .getByRole("button", { name: "Close" })
    .boundingBox())!;
  expect(close.y).toBeGreaterThanOrEqual(0);
  expect(close.y + close.height).toBeLessThanOrEqual(viewport.height);
  await page.screenshot({
    path: test.info().outputPath("qa-shell-landscape-sheet.png"),
  });
  await ctx.close();
});

test("long content scrolls inside the sheet, which stays on screen @shell", async ({
  browser,
}) => {
  const viewport = { width: 844, height: 390 };
  const { ctx, page } = await open(browser, viewport, false);
  await page
    .getByRole("navigation", { name: "Game panels" })
    .getByRole("button", { name: "Case" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Case" });
  await expect(sheet).toBeVisible();
  // Long content (the case board will be long).
  await sheet.locator(".bsheet__body").evaluate((b) => {
    for (let i = 0; i < 60; i++)
      b.insertAdjacentHTML("beforeend", `<p>Line ${i}</p>`);
  });
  await settle(page);
  const s = (await sheet.locator(".bsheet__sheet").boundingBox())!;
  expect(s.y).toBeGreaterThanOrEqual(0);
  await expect(sheet.getByRole("button", { name: "Close" })).toBeInViewport();
  const body = sheet.locator(".bsheet__body");
  const b = (await body.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 400);
  await expect
    .poll(() => body.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await ctx.close();
});

test("focus stays in the sheet both ways (Shift+Tab too) and goes back to the dock; the tab badge is read out @shell", async ({
  browser,
}) => {
  const { ctx, page } = await open(browser, { width: 390, height: 844 });
  const opener = page.getByRole("button", { name: "Grab coins" });
  await opener.click();
  const sheet = page.getByRole("dialog", { name: "Grab and split" });
  await expect(sheet).toBeVisible();
  for (const key of [
    "Shift+Tab",
    "Shift+Tab",
    "Shift+Tab",
    "Tab",
    "Tab",
    "Tab",
  ]) {
    await page.keyboard.press(key);
    // Never on the page behind (the top bar included): inside the sheet, or out to the browser's own controls.
    expect(
      await page.evaluate(
        () =>
          document.activeElement === document.body ||
          !!document.activeElement?.closest("dialog[open]"),
      ),
      key,
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page).toHaveURL(/\/dev\/gallery\/shell$/);
  // The tab badge is read out, not just drawn.
  await expect(page.getByRole("button", { name: "Chat, 3 new" })).toBeVisible();
  await ctx.close();
});

test("a tap inside the sheet keeps it open; a tap beside it (tablet) closes it @shell", async ({
  browser,
}) => {
  const viewport = { width: 768, height: 1024 };
  const { ctx, page } = await open(browser, viewport);
  const tabs = page.getByRole("navigation", { name: "Game panels" });
  await tabs.getByRole("button", { name: "This round" }).click();
  const sheet = page.getByRole("dialog", { name: "This round" });
  await settle(page);
  await sheet.getByRole("heading", { name: "This round" }).click();
  await sheet.getByText("Your move and its preview.").click();
  await expect(sheet).toBeVisible();
  const s = (await sheet.locator(".bsheet__sheet").boundingBox())!;
  expect(s.x).toBeGreaterThan(44); // the sheet is capped, so there is backdrop beside it
  await page.mouse.click(s.x / 2, s.y + s.height / 2);
  await expect(sheet).toBeHidden();
  await ctx.close();
});

test("widening past 1024 px with a sheet open drops it, and narrowing does not bring it back @shell", async ({
  browser,
}) => {
  const { ctx, page } = await open(
    browser,
    { width: 1000, height: 760 },
    false,
  );
  await page
    .getByRole("navigation", { name: "Game panels" })
    .getByRole("button", { name: "Case" })
    .click();
  await expect(page.getByRole("dialog", { name: "Case" })).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect(page.getByRole("heading", { name: "This round" })).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  // The laptop layout is usable: nothing inert is left behind.
  await page.getByRole("button", { name: "Chat" }).click();
  await expect(page.getByText("The crew chat.")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await page.setViewportSize({ width: 1000, height: 760 });
  await expect(
    page.getByRole("navigation", { name: "Game panels" }),
  ).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  // Sheets still open after the round trip.
  await page
    .getByRole("navigation", { name: "Game panels" })
    .getByRole("button", { name: "Crew" })
    .click();
  await expect(page.getByRole("dialog", { name: "Crew" })).toBeVisible();
  await ctx.close();
});
