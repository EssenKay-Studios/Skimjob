import { expect, test, type Page } from "@playwright/test";
import { settle } from "./setupGame";

// QA (PR #296, issue #261): a 12-seat lobby shows 12 different avatar colours at every width;
// a bot removed from the middle frees its colour and nobody else's changes. design §15; ui-style "Player avatars"
// Screens go to QA_SHOTS when set (evidence, not assertions).

const SHOTS = process.env.QA_SHOTS;

test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

const fills = (page: Page) =>
  page.locator(".seat .avatar__blob").evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
const names = (page: Page) => page.locator(".seat .seat__name").allTextContents();

for (const { width, height } of [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
]) {
  test(`${width}px: 12 seats, 12 colours; a freed seat's colour goes to the next bot, others keep theirs @lobby`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto("/");
    const id = await page.evaluate(async () => {
      const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      await post("/api/auth/guest", { nickname: "Mara Vox" });
      const g = await post("/api/games", {});
      for (let i = 0; i < 11; i++) await post(`/api/games/${g.id}/bots`, {});
      return g.id as string;
    });
    await page.goto(`/lobby/${id}`);
    await expect(page.locator(".seat")).toHaveCount(12);
    await settle(page);
    const before = await fills(page);
    expect(new Set(before).size).toBe(12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/qa-seat-colours-${width}.png`, fullPage: true });

    const beforeNames = await names(page);
    const statuses = await page.evaluate(async (gid) => {
      const del = await fetch(`/api/games/${gid}/bots/5`, { method: "DELETE" });
      const add = await fetch(`/api/games/${gid}/bots`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return [del.status, add.status];
    }, id);
    expect(statuses).toEqual([200, 201]);
    await page.reload();
    await expect(page.locator(".seat")).toHaveCount(12);
    const after = await fills(page);
    const afterNames = await names(page);
    for (let i = 0; i < 12; i++) {
      expect(after[i], `seat ${i}`).toBe(before[i]); // seat 5's colour went to the new bot; nobody else's moved
      if (i !== 5) expect(afterNames[i]).toBe(beforeNames[i]);
    }
    await ctx.close();
  });
}

test("the gallery shows the 12 seat colours, all different @lobby", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("/dev/gallery");
  const row = page.locator("section[aria-labelledby=g-avatars] .g-row").nth(1).locator(".avatar__blob");
  await expect(row).toHaveCount(12);
  expect(new Set(await row.evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor))).size).toBe(12);
  if (SHOTS) await page.locator("section[aria-labelledby=g-avatars]").screenshot({ path: `${SHOTS}/qa-seat-colours-gallery.png` });
  await ctx.close();
});
