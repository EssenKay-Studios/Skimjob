import { expect, test, type Page } from "@playwright/test";

// Review of PR #19 against decisions.md 2026-11-01 "Web-first launch;
// responsive everywhere": chips stay on screen, every target is ≥44 px on all
// screens, sheets keep a gutter on tablets, and the primary button passes
// WCAG AA contrast.

test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

async function smallTargets(page: Page) {
  // Measure the resting layout: wait for the entrance animations (sheet-in, toast-in, pop-in) to
  // finish. Mid-animation, a translated element's box can come out a hair under 44 px (43.99…),
  // which made this check flaky in CI. Infinite ones (line boil, the premium button's bang) are left running.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [role=button]")]
      .filter((el) => !el.closest("footer")) // the dev-only gallery link
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim()} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );
}

test.describe("phones", () => {
  for (const width of [360, 390]) {
    test.describe(`${width}px`, () => {
      test.use({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true });

      test("every landing chip is fully on screen", async ({ page }) => {
        await page.goto("/");
        await page.waitForTimeout(700);
        const boxes = await page.locator(".landing__chips .chip").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
        expect(boxes).toHaveLength(3);
        for (const b of boxes) {
          expect(b.left).toBeGreaterThanOrEqual(0);
          expect(b.right).toBeLessThanOrEqual(width);
        }
      });

      test("gallery, 404, new-game and invite targets are at least 44px", async ({ page }) => {
        await page.goto("/dev/gallery");
        await expect(page.getByRole("heading", { name: "Component gallery" })).toBeVisible();
        expect(await smallTargets(page)).toEqual([]);
        // The last is the game screen's "not your game" sheet (M2-6).
        for (const route of ["/no-such-page", "/new", "/join/abcdefghjk", "/game/00000000-0000-0000-0000-000000000000"]) {
          await page.goto(route);
          expect(await smallTargets(page), route).toEqual([]);
        }
      });
    });
  }
});

test.describe("tablets", () => {
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    test.describe(`${viewport.width}x${viewport.height}`, () => {
      test.use({ viewport, hasTouch: true, isMobile: true });
      test("the sheet keeps a gutter so its frame and shadow are not clipped", async ({ page }) => {
        await page.goto("/");
        await page.waitForTimeout(700);
        const r = await page.locator(".landing__sheet").evaluate((e) => e.getBoundingClientRect().toJSON());
        expect(r.left).toBeGreaterThanOrEqual(12);
        expect(viewport.width - r.right).toBeGreaterThanOrEqual(12);
      });

      test("no button label spills out of its frame", async ({ page }) => {
        await page.goto("/");
        await page.waitForTimeout(700);
        const spilled = await page.locator("button").evaluateAll((els) =>
          els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent?.trim()),
        );
        expect(spilled).toEqual([]);
      });
    });
  }
});

test.describe("primary button contrast", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  function luminance(rgb: string) {
    const c = rgb.startsWith("#")
      ? [1, 3, 5].map((i) => parseInt(rgb.slice(i, i + 2), 16))
      : rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
    const [r, g, b] = c.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const ratio = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
    return (x + 0.05) / (y + 0.05);
  };
  const colours = (page: Page) =>
    page.getByRole("button", { name: "Plan a heist" }).evaluate((e) => {
      const cs = getComputedStyle(e);
      return { text: cs.color, fill: cs.getPropertyValue("--fr-fill").trim() };
    });

  test("label is at least 4.5:1 on the clay fill, at rest and on hover", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(700);
    const rest = await colours(page);
    // --fr-fill is a var() chain; resolve it through a probe element.
    const resolve = (v: string) =>
      page.evaluate((v) => {
        const p = document.createElement("i");
        p.style.color = v;
        document.body.append(p);
        const c = getComputedStyle(p).color;
        p.remove();
        return c;
      }, v);
    expect(ratio(rest.text, await resolve(rest.fill))).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("button", { name: "Plan a heist" }).hover();
    const hover = await colours(page);
    expect(hover.fill).not.toBe(rest.fill);
    expect(ratio(hover.text, await resolve(hover.fill))).toBeGreaterThanOrEqual(4.5);
  });
});
