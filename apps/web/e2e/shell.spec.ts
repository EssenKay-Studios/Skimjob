import { expect, test, type Page } from "@playwright/test";

// The one-screen layout shell and the bottom sheet (design §15.6, S3b.2) at the
// five launch widths, on the gallery's demo page: no horizontal overflow, targets
// at least 44 px, three columns from 1024 px, and sheets that open, trap focus,
// close and give the focus back. Screenshots go to test-results/ (not committed).

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function check(page: Page, width: number) {
  await settle(page);
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, viewport: window.innerWidth }));
  expect(o.viewport).toBe(width);
  expect(o.scroll).toBeLessThanOrEqual(o.client);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [role=button]")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim()} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );
  expect(small).toEqual([]);
}

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

for (const viewport of VIEWPORTS) {
  const wide = viewport.width >= 1024;
  test(`shell at ${viewport.width}x${viewport.height}: ${wide ? "three columns" : "board, dock and tab bar"} @shell`, async ({ browser }, info) => {
    const ctx = await browser.newContext({ viewport, hasTouch: !wide, isMobile: !wide });
    const page = await ctx.newPage();
    await page.goto("/dev/gallery/shell");
    await expect(page.getByRole("region", { name: "Bank board" }).or(page.getByRole("main", { name: "Bank board" }))).toBeVisible();
    await check(page, viewport.width);
    await page.screenshot({ path: info.outputPath(`shell-${viewport.width}.png`) });

    if (wide) {
      const left = await box(page, ".shell__left");
      const centre = await box(page, ".shell__centre");
      const right = await box(page, ".shell__right");
      const board = await box(page, ".shell__board");
      const plan = await box(page, ".shell__plan");
      expect(left.x + left.width).toBeLessThanOrEqual(centre.x);
      expect(centre.x + centre.width).toBeLessThanOrEqual(right.x);
      expect(plan.y).toBeGreaterThanOrEqual(board.y + board.height); // the plan board sits under the bank
      await expect(page.getByRole("heading", { name: "This round" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Game panels" })).toHaveCount(0);
      // One screen: the page itself does not scroll.
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
      // The side tabs swap the panel.
      await page.getByRole("button", { name: "Chat" }).click();
      await expect(page.getByText("The crew chat.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "true");
    } else {
      const tabs = page.getByRole("navigation", { name: "Game panels" });
      const bar = await tabs.boundingBox();
      expect(bar!.y + bar!.height).toBeLessThanOrEqual(viewport.height);
      await expect(page.getByRole("button", { name: "Grab coins" })).toBeVisible();

      // A tab opens its panel as a sheet that fits the screen, with the focus inside.
      const opener = tabs.getByRole("button", { name: "Case" });
      await opener.click();
      const sheet = page.getByRole("dialog", { name: "Case" });
      await expect(sheet).toBeVisible();
      await settle(page);
      const s = await sheet.locator(".bsheet__sheet").boundingBox();
      expect(s!.y).toBeGreaterThanOrEqual(0);
      expect(s!.x).toBeGreaterThanOrEqual(0);
      expect(s!.x + s!.width).toBeLessThanOrEqual(viewport.width);
      expect(await sheet.evaluate((d) => d.contains(document.activeElement))).toBe(true);
      await check(page, viewport.width);
      await page.screenshot({ path: info.outputPath(`shell-${viewport.width}-sheet.png`) });

      // Tab never lands on the page behind (it leaves for the browser's own controls, or stays in the sheet).
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Tab");
        expect(await sheet.evaluate((d) => d.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
      }
      await sheet.getByRole("button", { name: "Close" }).focus();
      // Esc closes it and the focus goes back to the tab.
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(page).toHaveURL(/\/dev\/gallery\/shell$/);
      await expect(opener).toBeFocused();

      // The close button and a tap outside close it too.
      await opener.click();
      await sheet.getByRole("button", { name: "Close" }).click();
      await expect(sheet).toBeHidden();
      await opener.click();
      await page.mouse.click(viewport.width / 2, 4);
      await expect(sheet).toBeHidden();

      // The dock opens the pick and grab sheets, which are not in the tab bar.
      await page.getByRole("button", { name: "Grab coins" }).click();
      await expect(page.getByRole("dialog", { name: "Grab and split" })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Change" }).click();
      await expect(page.getByRole("dialog", { name: "Pick a room" })).toBeVisible();
      await check(page, viewport.width);
    }
    await ctx.close();
  });
}

test("bottom sheet: no slide under reduced motion, and the gallery section opens one @shell", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/dev/gallery");
  const opener = page.getByRole("button", { name: "Open a bottom sheet" });
  await opener.click();
  const sheet = page.getByRole("dialog", { name: "Pick a room" });
  await expect(sheet).toBeVisible();
  expect(await sheet.locator(".bsheet__sheet").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(opener).toBeFocused();
  await ctx.close();
});

// QA round 2: the plan board keeps its size on short laptop windows (the column scrolls instead).
for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1280, height: 600 },
]) {
  test(`plan board at ${viewport.width}x${viewport.height} keeps its heading inside its frame @shell`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto("/dev/gallery/shell");
    await expect(page.getByRole("heading", { name: "Plan board" })).toBeAttached();
    await settle(page);
    const plan = await box(page, ".shell__plan");
    const head = (await page.getByRole("heading", { name: "Plan board" }).boundingBox())!;
    expect(plan.height).toBeGreaterThanOrEqual(160);
    expect(head.y + head.height).toBeLessThanOrEqual(plan.y + plan.height);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    await ctx.close();
  });
}

test("a sheet locks the page behind it and gives the scroll back on close @shell", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("/dev/gallery/shell");
  await expect(page.getByText("The bank board")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 120));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.getByRole("navigation", { name: "Game panels" }).getByRole("button", { name: "Case" }).click();
  await expect(page.getByRole("dialog", { name: "Case" })).toBeVisible();
  await settle(page);
  // The offset can move by a pixel as the sheet opens (rounding); what must hold is that it stays where it is once the sheet is up.
  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
  const before = await scrollY();
  await page.mouse.move(420, 20); // the backdrop
  await page.mouse.wheel(0, 300);
  await page.mouse.move(420, 380); // the sheet's header area
  await page.mouse.wheel(0, 300);
  expect(await scrollY()).toBe(before);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.classList.contains("sheet-open"))).toBe(false);
  await page.mouse.wheel(0, 100);
  await expect.poll(scrollY).toBeGreaterThan(before);
  await ctx.close();
});
