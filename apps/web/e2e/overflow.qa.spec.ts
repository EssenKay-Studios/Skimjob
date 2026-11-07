// QA for PR #62 (the 1 px sideways overflow on the game-over screen with
// 24-character names). Long names with no break points: "W"×24 (the widest
// glyph), 24 emoji, and "W" + combining diaeresis ×12 (24 code points), all
// within the nickname rules (1–24 code points, visible). Checked on the
// gallery reveal and on a real fast-clock 15-min game's game-over screen
// (ranking, reveal and its timeline, case file sheet) at 360, 390 and 768 px:
// nothing past the edge, and every name still whole in the DOM (wrapped, not cut).
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const WIDE = "W".repeat(24);
const EMOJI = "\u{1F600}".repeat(24); // 24 code points, no break points
const COMBINING = "W\u0308".repeat(12); // 24 code points, 12 graphemes
const WIDTHS = [360, 390, 768];

async function ok<T>(res: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/** document.scrollingElement wider than the window, and any box of the game-over / reveal / case file past either edge (chip strips scroll on their own). */
async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const s = document.scrollingElement!;
    if (s.scrollWidth > window.innerWidth) out.push(`scrollWidth ${s.scrollWidth} > innerWidth ${window.innerWidth}`);
    const w = document.documentElement.clientWidth;
    for (const x of document.querySelectorAll<HTMLElement>(".over *, .reveal *, .records *")) {
      if (x.closest(".reveal__rounds, .seg, [role=tablist]")) continue;
      const r = x.getBoundingClientRect();
      if (r.width > 0 && (r.right > w + 0.5 || r.left < -0.5)) out.push(`${x.getAttribute("class") ?? x.tagName} ${r.left.toFixed(1)}..${r.right.toFixed(1)}`);
    }
    return out;
  });
}

for (const width of WIDTHS) {
  test(`gallery reveal, 24-character names at ${width}: no overflow, names whole @reveal`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "the viewport is set here");
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/dev/gallery");
    const section = page.getByRole("region", { name: "End-of-game reveal" });
    await section.scrollIntoViewIfNeeded();
    await section.getByRole("button", { name: "24 characters" }).click();
    const reveal = section.getByRole("region", { name: "The reveal" });
    for (const ending of ["Job done", "Busted (Rooftop)", "Missed (nobody)"]) {
      await section.getByRole("button", { name: ending }).click();
      await expect(reveal).toContainText(WIDE);
      await expect(reveal).toContainText("M".repeat(24));
      const rounds = reveal.getByRole("group", { name: "Rounds" }).getByRole("button");
      const n = await rounds.count();
      for (let i = 0; i < n; i++) {
        await rounds.nth(i).click();
        await expect(rounds.nth(i)).toHaveAttribute("aria-pressed", "true");
        expect(await overflow(page), `${ending}, round ${i + 1}`).toEqual([]);
      }
    }
  });
}

test("real 15-min game over with W×24, emoji×24 and combining-mark names: no overflow at 360/390/768 @fast-clock @reveal", async ({ browser }, info) => {
  test.skip(info.project.name !== "mobile-fast", "one game, the widths are set here");
  test.setTimeout(400_000);
  const opts = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
  const ctxs = await Promise.all([0, 1, 2].map(() => browser.newContext(opts)));
  const [host, g1, g2]: Page[] = await Promise.all(ctxs.map((c) => c.newPage()));
  if (!host || !g1 || !g2) throw new Error("three pages");
  const errors: string[] = [];
  for (const p of [host, g1, g2]) p.on("pageerror", (e) => errors.push(e.message));

  await ok(await host.request.post("/api/auth/guest", { data: { nickname: WIDE } }));
  const game = await ok<{ id: string; inviteCode: string }>(await host.request.post("/api/games", { data: { settings: { sessionLength: "quick" } } }));
  await ok(await g1.request.post(`/api/invites/${game.inviteCode}/join`, { data: { nickname: EMOJI } }));
  await ok(await g2.request.post(`/api/invites/${game.inviteCode}/join`, { data: { nickname: COMBINING } }));
  for (let i = 0; i < 2; i++) await ok(await host.request.post(`/api/games/${game.id}/bots`, { data: {} }));
  await ok(await host.request.post(`/api/games/${game.id}/start`, { data: {} }));
  await g1.goto(`/game/${game.id}`);
  await g2.goto(`/game/${game.id}`);
  await host.goto(`/game/${game.id}`);

  // Nobody moves: the deadlines run the game out.
  const ranking = g1.getByRole("list", { name: /Final ranking/ });
  await expect(ranking).toBeVisible({ timeout: 360_000 });
  await expect(ranking.locator(".ranking__row")).toHaveCount(5);

  const problems: string[] = [];
  const pages: [string, Page][] = [["emoji guest", g1], ["combining guest", g2], ["host", host]];
  for (const [label, page] of pages) {
    await page.reload();
    await expect(page.getByRole("list", { name: /Final ranking/ })).toBeVisible({ timeout: 20_000 });
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(150);
      const who = `${label} ${width}`;
      for (const x of await overflow(page)) problems.push(`${who} game over: ${x}`);
      // Every name whole in the ranking (wrapped, never truncated).
      const text = ((await page.getByRole("list", { name: /Final ranking/ }).textContent()) ?? "").normalize("NFD");
      for (const n of [WIDE, EMOJI, COMBINING]) expect(text, `${who}: ranking has ${n}`).toContain(n.normalize("NFD"));
      // The reveal timeline: every round chip.
      const reveal = page.getByRole("region", { name: "The reveal" });
      if (await reveal.isVisible().catch(() => false)) {
        const rounds = reveal.getByRole("group", { name: "Rounds" }).getByRole("button");
        const n = await rounds.count();
        for (let i = 0; i < n; i++) {
          await rounds.nth(i).click();
          await expect(rounds.nth(i)).toHaveAttribute("aria-pressed", "true");
          for (const x of await overflow(page)) problems.push(`${who} round ${i + 1}: ${x}`);
        }
        const all = ((await reveal.textContent()) ?? "").normalize("NFD");
        for (const nm of [WIDE, EMOJI, COMBINING]) expect(all, `${who}: reveal has ${nm}`).toContain(nm.normalize("NFD"));
      } else problems.push(`${who}: no reveal on the game-over screen`);
      // The case file sheet (a button below 1024 px).
      const open = page.getByRole("button", { name: /Case file/ }).first();
      if (await open.isVisible().catch(() => false)) {
        await open.click();
        await expect(page.getByRole("list", { name: "Case file" })).toBeVisible();
        await page.waitForTimeout(400);
        for (const x of await overflow(page)) problems.push(`${who} case file: ${x}`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      } else problems.push(`${who}: no case file button`);
    }
  }
  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
  for (const c of ctxs) await c.close();
});
