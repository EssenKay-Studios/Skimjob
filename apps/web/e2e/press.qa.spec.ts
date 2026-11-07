// QA for PR #62, regression tests for two fixes found in its review:
// (1) the chat's "New messages ↓" pill (.chat__jump) sat in the feed's flex row
//     because .btn { position: relative } beat its position: absolute, pushing
//     the page 84 px wide at 1280 px; now .btn.chat__jump.
// (2) the :active press squish scale(0.97) shrank the button's own box, so a
//     pressed 44 px target measured 42.7 px ("Vault" in the 12-seat alibi
//     picker); now only its children scale. ui-style §5, design §12.1
import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

const expect = baseExpect.configure({ timeout: 15_000 });

async function openChat(page: Page) {
  const fab = page.locator(".chat-fab");
  const region = page.getByRole("region", { name: "Chat" });
  await expect(fab.or(region)).toBeVisible();
  if (await fab.isVisible()) await fab.click();
  await expect(region).toBeVisible();
}
async function say(page: Page, text: string) {
  const input = page.locator(".chat__input");
  await input.fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(input).toHaveValue("");
}
async function guest(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 800 } });
  return ctx.newPage();
}
const LONG = (tag: string) => `${tag} ` + "the vault, the vents, the van and the escape plan again ".repeat(8);

test("QA: the chat's New messages pill stays inside the viewport with no sideways scroll at 1280 and 390 px @chat", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "mobile", "the viewport is set here");
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const gs = [await guest(browser), await guest(browser), await guest(browser)];
  const game = await startGame(page.request, { bots: 1, guests: gs.map((g) => g.request), sessionLength: "1w" });
  for (const p of [page, ...gs]) {
    await p.goto(`/game/${game.id}`);
    await expect(p.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
  }
  for (const g of gs) await openChat(g);

  const feed = page.locator(".chat__feed");
  const jump = page.locator(".chat__jump");
  for (const [i, width] of [1280, 390].entries()) {
    await page.setViewportSize({ width, height: width > 1000 ? 800 : 844 });
    // Below 1024 px the docked panel becomes a sheet behind the chat button.
    if (width < 1024) await expect(page.locator(".chat-fab")).toBeVisible();
    else await expect(page.locator(".chat-dock.is-docked")).toBeVisible();
    await openChat(page);
    // Enough long messages that the feed scrolls (rate limit: 8 per 10 s per player).
    const filler = gs[i]!;
    for (let n = 1; n <= 6; n++) await say(filler, LONG(`w${width}-m${n}`));
    await expect(feed).toContainText(`w${width}-m6`);
    await expect
      .poll(() => feed.evaluate((el) => `${el.scrollHeight - el.clientHeight > 100} ${el.scrollHeight}/${el.clientHeight} doc ${document.documentElement.scrollHeight}`), { message: `${width} px: the feed scrolls` })
      .toMatch(/^true/);
    // Scroll up to read, then a message arrives.
    await feed.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(200);
    await say(gs[2]!, `w${width} arrives while scrolled up`);
    await expect(feed).toContainText(`w${width} arrives while scrolled up`);
    await expect(jump).toBeVisible();
    await page.waitForTimeout(400); // springy entrance settles
    // The page may scroll vertically (the chat panel can run past the fold at 800 px tall); bring the pill on screen, never sideways.
    await jump.scrollIntoViewIfNeeded();
    const r = await page.evaluate(() => {
      const b = document.querySelector(".chat__jump")!.getBoundingClientRect();
      const s = document.scrollingElement!;
      return {
        box: { left: b.left, right: b.right, top: b.top, bottom: b.bottom, h: b.height },
        vw: document.documentElement.clientWidth,
        vh: window.innerHeight,
        sideways: s.scrollWidth - s.clientWidth,
        bodySideways: document.body.scrollWidth - document.body.clientWidth,
      };
    });
    const at = `${width} px: pill ${r.box.left.toFixed(1)}..${r.box.right.toFixed(1)} x ${r.box.top.toFixed(1)}..${r.box.bottom.toFixed(1)} in ${r.vw}x${r.vh}`;
    expect(r.sideways, `${at}: page scrolls sideways`).toBeLessThanOrEqual(0);
    expect(r.bodySideways, `${at}: body scrolls sideways`).toBeLessThanOrEqual(0);
    expect(r.box.left, at).toBeGreaterThanOrEqual(0);
    expect(r.box.right, at).toBeLessThanOrEqual(r.vw);
    expect(r.box.top, at).toBeGreaterThanOrEqual(0);
    expect(r.box.bottom, at).toBeLessThanOrEqual(r.vh);
    expect(r.box.h, `${at}: touch target`).toBeGreaterThanOrEqual(44);
    // The pill floats over the feed, inside it.
    const f = await feed.boundingBox();
    expect(r.box.left, at).toBeGreaterThanOrEqual(f!.x - 1);
    expect(r.box.right, at).toBeLessThanOrEqual(f!.x + f!.width + 1);
    // And it works: back to the latest, pill gone.
    await jump.click();
    await expect(jump).toBeHidden();
    await expect.poll(() => feed.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(48);
  }
  expect(errors).toEqual([]);
  for (const g of gs) await g.context().close();
});

const VARIANTS = ["primary", "secondary", "small", "ghost", "back", "premium", "toggle", "danger"];

for (const project of ["mobile", "desktop"]) {
  test(`QA: a pressed .btn keeps its box (>= 44 px) for every variant in the gallery (${project}) @board`, async ({ page }, info) => {
    test.skip(info.project.name !== project, "one run per project");
    test.setTimeout(60_000);
    await page.goto("/dev/gallery");
    await expect(page.locator(".btn").first()).toBeVisible();
    const problems: string[] = [];
    let measured = 0;
    for (const v of VARIANTS) {
      const btn = page.locator(`.btn.btn--${v}:not(:disabled)`).first();
      if ((await btn.count()) === 0) {
        if (v !== "danger") problems.push(`${v}: no enabled .btn--${v} in the gallery`);
        continue;
      }
      await btn.scrollIntoViewIfNeeded();
      const rest = (await btn.boundingBox())!;
      await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(250); // the press transition is 0.06 s
      const held = await btn.evaluate((el) => {
        const b = el.getBoundingClientRect();
        return { w: b.width, h: b.height, active: el.matches(":active") };
      });
      // Release off the button so no click fires (no navigation, no arming).
      await page.mouse.move(2, 2);
      await page.mouse.up();
      measured++;
      const at = `${v}: rest ${rest.width.toFixed(1)}x${rest.height.toFixed(1)}, held ${held.w.toFixed(1)}x${held.h.toFixed(1)}`;
      if (!held.active) problems.push(`${at}: not :active while held`);
      if (held.h < 44) problems.push(`${at}: pressed height < 44`);
      if (held.h < rest.height - 0.5 || held.w < rest.width - 0.5) problems.push(`${at}: pressed box shrank`);
    }
    expect(problems).toEqual([]);
    expect(measured).toBeGreaterThanOrEqual(7);
  });
}
