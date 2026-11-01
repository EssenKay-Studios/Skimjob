import { expect, test, type Page } from "@playwright/test";

// QA (PR #33, M2-9 art): cutaway, crooks, gallery and landing across viewports.
const VIEWPORTS = [360, 390, 768, 1024, 1280].map((width) => ({ width, height: width < 700 ? 800 : 900 }));
const SHOTS = "/home/claude/pipeline/shots";
test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));
test.describe.configure({ timeout: 60_000 });

const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Screen-space boxes of every crook figure (solid and ghost) with its room. */
const crookBoxes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<SVGGElement>(".bank-room")].flatMap((room) => {
      const r = room.getBoundingClientRect();
      return [...room.querySelectorAll<SVGGElement>(".crook-fig")].map((c) => {
        const b = c.getBoundingClientRect();
        return { room: room.dataset.room!, l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, roomBox: { l: r.left, t: r.top, r: r.right, b: r.bottom } };
      });
    }),
  );

for (const vp of VIEWPORTS) {
  test(`gallery + landing at ${vp.width}px: no overflow, room targets ≥44 px`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto("/");
    await page.locator(".bank__svg").first().waitFor();
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/qa-art-landing-${vp.width}.png`, fullPage: true });
    await page.goto("/dev/gallery");
    const bank = page.locator("#g-bank").locator("xpath=ancestor::section[1]");
    await bank.waitFor();
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
    const small = await page.$$eval(".bank-room[role=button]", (els) =>
      els.map((e) => ({ id: (e as SVGGElement).dataset.room, ...e.getBoundingClientRect().toJSON() })).filter((r) => r.width < 44 || r.height < 44),
    );
    expect(small).toEqual([]);
    const tagPx = await page.$$eval(".bank-tag__text", (els) => Math.min(...els.map((e) => e.getBoundingClientRect().height)));
    console.log(`QA ${vp.width}px: smallest room-label glyph box ${tagPx.toFixed(1)} px`);
    await bank.screenshot({ path: `${SHOTS}/qa-art-gallery-bank-${vp.width}.png` });
  });
}

for (const [label, query] of [
  ["1 in vault", "n=1"],
  ["6 in vault", "n=6"],
  ["12 in vault", "n=12"],
  ["12 across rooms", "n=12&spread=all"],
  ["12 small tier", "n=12&tier=small"],
] as const) {
  for (const width of [360, 1280]) {
    test(`crooks ${label} at ${width}px stay inside their room and don't stack`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/e2e/art-harness.qa.html?${query}`);
      await page.locator(".crook-fig").first().waitFor();
      const boxes = await crookBoxes(page);
      expect(boxes.length).toBe(Number(/n=(\d+)/.exec(query)![1]));
      for (const c of boxes) {
        expect(c.l, `${c.room} left`).toBeGreaterThanOrEqual(c.roomBox.l - 1);
        expect(c.r, `${c.room} right`).toBeLessThanOrEqual(c.roomBox.r + 1);
        expect(c.t, `${c.room} top`).toBeGreaterThanOrEqual(c.roomBox.t - 1);
      }
      // Overlap allowed only partially (front/back rows): no crook may be more than 60% hidden horizontally by a neighbour on the same row.
      const byRoom = Object.groupBy(boxes, (c) => c.room);
      for (const list of Object.values(byRoom)) {
        const rows = Object.values(Object.groupBy(list!, (c) => Math.round(c.b / 4)));
        for (const row of rows) {
          const xs = row!.sort((a, b) => a.l - b.l);
          for (let i = 1; i < xs.length; i++) expect((xs[i - 1]!.r - xs[i]!.l) / xs[i]!.w).toBeLessThan(0.6);
        }
      }
      await page.screenshot({ path: `${SHOTS}/qa-art-crooks-${label.replace(/ /g, "-")}-${width}.png`, fullPage: true });
    });
  }
}

for (const time of ["day", "dusk", "night"]) {
  test(`time ${time} + lockdown renders tape on closed rooms`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/e2e/art-harness.qa.html?n=6&spread=all&lock=1&time=${time}`);
    await expect(page.locator(".bank-room.is-closed")).toHaveCount(2);
    await expect(page.locator(".bank-room.is-closed[aria-label*=closed]")).toHaveCount(2);
    await page.screenshot({ path: `${SHOTS}/qa-art-${time}-lockdown-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: `${SHOTS}/qa-art-${time}-lockdown-1280.png`, fullPage: true });
  });
}

test("reduced motion stops every art animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dev/gallery");
  await page.locator(".bank-room").first().waitFor();
  const running = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running" && (a.effect as KeyframeEffect | null)?.target?.closest?.(".bank, .spot, .crook-avatar"))
      .map((a) => ((a.effect as KeyframeEffect).target as Element).getAttribute("class")),
  );
  expect(running).toEqual([]);
});

test("touch: tapping a room selects it", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("/dev/gallery");
  const lobby = page.locator(".bank-room[role=button][data-room=lobby]");
  await lobby.tap();
  await expect(lobby).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Selected: Lobby")).toBeVisible();
  await ctx.close();
});
