import { expect, test, type Page } from "@playwright/test";
import { startGame, settle } from "./setupGame";

// QA for #234 (design §15.6): the laptop game layout fills the window up to
// --shell-max-w, then sits centred. Common laptop and monitor sizes between and
// beyond the builder's three, a short window where the drawing hits its 600 px
// floor, a 4K screen, and the top bar and away strip sharing the shell's cap.

test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

async function open(page: Page) {
  const game = await startGame(page.request, { bots: 5, sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  await expect(page.locator(".shell--wide")).toBeVisible();
  await settle(page);
}

const tokens = (page: Page) =>
  page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return { gutter: parseFloat(css.getPropertyValue("--gutter")), maxW: parseFloat(css.getPropertyValue("--shell-max-w")) };
  });

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1680, height: 1050 },
  { width: 1920, height: 1200 },
  { width: 3840, height: 2160 },
]) {
  test(`game at ${viewport.width}x${viewport.height}: shell fills to the cap, drawing keeps its shape and stays on screen @shell`, async ({ browser }, info) => {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await open(page);
    await page.screenshot({ path: info.outputPath(`qa-game-${viewport.width}x${viewport.height}.png`) });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const { gutter, maxW } = await tokens(page);
    const margin = (viewport.width - Math.min(viewport.width, maxW)) / 2;
    const strip = await box(page, ".shell__status");
    expect(Math.abs(strip.x - (margin + gutter))).toBeLessThanOrEqual(1);
    expect(Math.abs(viewport.width - margin - gutter - (strip.x + strip.width))).toBeLessThanOrEqual(1);

    // The drawing keeps the layout's aspect (no stretch), sits centred in the board frame and never drops below 600 px.
    const board = await box(page, ".shell__board");
    const bank = await box(page, ".shell__board .bank");
    const aspect = await page.locator(".shell__board .bank").evaluate((el) => parseFloat((el as HTMLElement).style.getPropertyValue("--bank-aspect")));
    expect(Math.abs(bank.width / bank.height - aspect)).toBeLessThan(0.02);
    // The floor caps the height rule only; a column narrower than 600 px still gets a full-width drawing.
    const room = await page.locator(".shell__board .bank").evaluate((el) => {
      const parent = el.parentElement!;
      const css = getComputedStyle(parent);
      return parent.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    });
    expect(bank.width).toBeGreaterThanOrEqual(Math.min(600, room) - 0.5);
    expect(Math.abs(bank.x - board.x - (board.x + board.width - bank.x - bank.width))).toBeLessThanOrEqual(1);
    // Whenever the drawing is above its floor, the whole board is on screen.
    if (bank.width > 600.5) expect(board.y + board.height).toBeLessThanOrEqual(viewport.height);
    await ctx.close();
  });
}

test("a short wide window keeps the drawing at its 600 px floor and scrolls the column, not the page sideways @shell", async ({ browser }, info) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 600 } });
  const page = await ctx.newPage();
  await open(page);
  await page.screenshot({ path: info.outputPath("qa-game-1600x600.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(Math.round((await box(page, ".shell__board .bank")).width)).toBe(600);
  await ctx.close();
});

test("the top bar and the away strip share the shell's width cap on the game screen @shell", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 1440 } });
  const page = await ctx.newPage();
  await open(page);
  const { maxW } = await tokens(page);
  expect(maxW).toBe(1920);
  const caps = await page.evaluate(() => {
    const away = document.createElement("section");
    away.className = "game-away";
    document.querySelector(".page")!.append(away);
    const read = (el: Element) => getComputedStyle(el).maxWidth;
    const out = { shell: read(document.querySelector(".shell--wide")!), topbar: read(document.querySelector(".topbar")!), away: read(away) };
    away.remove();
    return out;
  });
  expect(caps).toEqual({ shell: "1920px", topbar: "1920px", away: "1920px" });
  await ctx.close();
});
