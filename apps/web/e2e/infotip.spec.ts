import { TERMS, TIPS } from "@skimjob/content";
import { expect, test, type Browser, type Page } from "@playwright/test";

// The InfoTip (design §15.6, §20.5, S3b.1) on the gallery page at the five launch
// widths: it opens on a tap, a hover and keyboard focus, shows the line from content
// inside the viewport, has 44 px targets, closes with Esc, a tap elsewhere or its
// close button, sits above a bottom sheet and honours reduced motion. Screenshots go
// to test-results/ (not committed).

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

const tipButton = (page: Page, name: string) => page.getByRole("button", { name: `About ${name}` }).first();
const popover = (page: Page) => page.locator(".infotip__pop:popover-open");

async function open(browser: Browser, viewport: { width: number; height: number }, touch = true) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch && viewport.width < 1024 });
  const p = await ctx.newPage();
  await p.goto("/dev/gallery");
  await p.getByRole("heading", { name: "InfoTip" }).scrollIntoViewIfNeeded();
  return p;
}

for (const viewport of VIEWPORTS) {
  test(`a tap opens the line from content inside a ${viewport.width} px screen, with 44 px targets @infotip`, async ({ browser }, info) => {
    const p = await open(browser, viewport, viewport.width < 1024);
    const bell = tipButton(p, "Bell");
    const b = (await bell.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
    await bell.click();
    await expect(popover(p)).toBeVisible();
    await expect(popover(p)).toContainText(TIPS.bell.text);
    await expect(bell).toHaveAttribute("aria-expanded", "true");
    const t = (await popover(p).boundingBox())!;
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width).toBeLessThanOrEqual(viewport.width);
    expect(t.y).toBeGreaterThanOrEqual(0);
    expect(t.y + t.height).toBeLessThanOrEqual(viewport.height);
    const close = (await popover(p).getByRole("button", { name: "Close" }).boundingBox())!;
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
    const o = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(o.scroll).toBeLessThanOrEqual(o.client);
    await p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
    await p.screenshot({ path: info.outputPath(`infotip-${viewport.width}.png`) });
    await p.context().close();
  });
}

test("a tip at the right edge stays inside the screen @infotip", async ({ browser }) => {
  const p = await open(browser, { width: 360, height: 740 });
  const far = p.locator(".g-infotips__edge .infotip__btn");
  await far.click();
  const t = (await popover(p).boundingBox())!;
  expect(t.x).toBeGreaterThanOrEqual(0);
  expect(t.x + t.width).toBeLessThanOrEqual(360);
  await p.context().close();
});

test("a tap on another tip or elsewhere closes it, and so does the close button @infotip", async ({ browser }) => {
  const p = await open(browser, { width: 390, height: 844 });
  await tipButton(p, "Duffel").click();
  await expect(popover(p)).toContainText(TERMS.duffel.text);
  await tipButton(p, "Stash").click();
  await expect(popover(p)).toHaveCount(1);
  await expect(popover(p)).toContainText(TERMS.stash.text);
  await p.getByRole("heading", { name: "InfoTip" }).click();
  await expect(popover(p)).toHaveCount(0);
  await tipButton(p, "Stash").click();
  await popover(p).getByRole("button", { name: "Close" }).click();
  await expect(popover(p)).toHaveCount(0);
  await expect(tipButton(p, "Stash")).toBeFocused();
  await p.context().close();
});

test("keyboard: Tab to the i opens it, Enter pins it, Esc closes it and keeps the focus @infotip", async ({ browser }) => {
  const p = await open(browser, { width: 1280, height: 800 }, false);
  const duffel = tipButton(p, "Duffel");
  await duffel.focus();
  await p.keyboard.press("Shift+Tab");
  await p.keyboard.press("Tab");
  await expect(duffel).toBeFocused();
  await expect(popover(p)).toContainText(TERMS.duffel.text);
  await p.keyboard.press("Enter");
  await expect(popover(p)).toHaveCount(1);
  await p.keyboard.press("Escape");
  await expect(popover(p)).toHaveCount(0);
  await expect(duffel).toBeFocused();
  await p.context().close();
});

test("a mouse hover previews the tip and leaving closes it, unless a click pinned it @infotip", async ({ browser }) => {
  const p = await open(browser, { width: 1280, height: 800 }, false);
  const vault = tipButton(p, "Vault");
  await vault.hover();
  await expect(popover(p)).toBeVisible();
  await p.getByRole("heading", { name: "InfoTip" }).hover();
  await expect(popover(p)).toHaveCount(0);
  await vault.click();
  await p.getByRole("heading", { name: "InfoTip" }).hover();
  await expect(popover(p)).toBeVisible();
  await p.context().close();
});

test("inside a bottom sheet the tip shows above it, and Esc closes the tip but not the sheet @infotip", async ({ browser }) => {
  const p = await open(browser, { width: 390, height: 844 });
  await p.getByRole("button", { name: "Open a sheet with a tip" }).click();
  const sheet = p.getByRole("dialog", { name: "Pocket" });
  await expect(sheet).toBeVisible();
  const pocket = sheet.getByRole("button", { name: "About Pocket" });
  await pocket.click();
  await expect(popover(p)).toBeVisible();
  await expect(popover(p)).toContainText(TIPS.movePocket.text);
  await p.keyboard.press("Escape");
  await expect(popover(p)).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await p.context().close();
});

test("under reduced motion the tip does not animate @infotip", async ({ browser }) => {
  const p = await open(browser, { width: 390, height: 844 });
  await p.emulateMedia({ reducedMotion: "reduce" });
  await tipButton(p, "Bell").click();
  const name = await popover(p).evaluate((el) => getComputedStyle(el).animationName);
  expect(name).toBe("none");
  await p.context().close();
});
