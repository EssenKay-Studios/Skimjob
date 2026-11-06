import { expect, test, type Page } from "@playwright/test";

// QA (PR #19): responsive guards for the web shell. decisions.md 2026-11-01
// "Web-first launch; responsive everywhere": 360–430 px phones, 768–1024 px
// tablets (both orientations), laptops; no horizontal overflow, ≥44 px touch
// targets. Every new screen should be added to ROUTES.
//
// Also the review of PR #19 (merged in from responsive.spec.ts): chips stay on
// screen, every target is ≥44 px on all screens, sheets keep a gutter on
// tablets, and the primary button passes WCAG AA contrast.

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];
const ROUTES = ["/", "/no-such-page", "/new", "/join/abcdefghjk", "/lobby/00000000-0000-0000-0000-000000000000", "/game/00000000-0000-0000-0000-000000000000"];

// Viewport sizes are set per test below, so run each test once.
test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

async function overflow(page: Page) {
  return page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth, client: document.documentElement.clientWidth }));
}

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

for (const { width, height } of VIEWPORTS) {
  for (const touch of [false, true]) {
    const name = `${width}x${height}${touch ? " touch" : ""}`;
    test.describe(name, () => {
      test.use({ viewport: { width, height }, hasTouch: touch, isMobile: touch });

      for (const route of ROUTES) {
        test(`no horizontal overflow on ${route}`, async ({ page }) => {
          await page.goto(route);
          await page.waitForTimeout(800); // let the entrance animation finish
          const o = await overflow(page);
          expect(o.scroll).toBeLessThanOrEqual(o.client);
          // A mobile browser widens the layout viewport to fit overflowing content.
          expect(o.viewport).toBe(width);
        });
      }

      // QA PR #19: topbar "Sign in" was 40px tall, home link 34px (fixed).
      test(`touch targets are at least 44px on /`, async ({ page }) => {
        await page.goto("/");
        expect(await smallTargets(page)).toEqual([]);
      });
    });
  }
}

// QA PR #19: `.enter-sheet`'s rotate(-1.2deg) on a tall sheet widened a
// phone's layout viewport for good (gallery at 390 touch: 413px). Fixed: no
// rotate in the entrance, and the body clips horizontal overflow.
test.describe("tall sheet", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("no horizontal overflow on /dev/gallery", async ({ page }) => {
    await page.goto("/dev/gallery");
    await page.waitForTimeout(800);
    expect((await overflow(page)).viewport).toBe(390);
  });
});

test.describe("landing behaviour", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("fonts are self-hosted and load with every other host blocked", async ({ page }) => {
    const external: string[] = [];
    await page.route(/^https?:\/\/(?!localhost[:/])/, (r) => {
      external.push(r.request().url());
      return r.abort();
    });
    await page.goto("/");
    const families = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family);
    });
    expect(families).toContain("Pangolin");
    expect(families).toContain("Inter");
    expect(external).toEqual([]);
  });

  test("keyboard focus is visible on every landing button and link", async ({ page }) => {
    // With Google sign-in on (M2-12), so its button is there to tab to.
    await page.route("**/api/auth/providers", (r) => r.fulfill({ json: { providers: ["google"] } }));
    await page.goto("/");
    // The button appears only after /auth/providers answers; tabbing earlier races it.
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const f = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const cs = getComputedStyle(el);
        return { tag: el.tagName, label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(), outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
      });
      if (f.tag !== "A" && f.tag !== "BUTTON") continue;
      seen.add(f.label);
      expect(f.outline, f.label).not.toBe("none");
      expect(f.width, f.label).toBeGreaterThanOrEqual(2);
    }
    expect([...seen]).toEqual(expect.arrayContaining(["Plan a heist", "Join crew", "Sign in with Google"]));
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("turns off the sheet entrance and toast animations", async ({ page }) => {
      await page.goto("/");
      expect(await page.locator(".enter-sheet").first().evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      expect(await page.locator(".toast").first().evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
    });
  });

  test("invite field: links, spaces and dashes are tidied; junk is refused without a request", async ({ page }) => {
    const api: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api")) api.push(r.url());
    });
    for (const [input, code] of [
      ["  K7QX-M2PA  ", "k7qxm2pa"],
      ["k7 qx m2 pa", "k7qxm2pa"],
      ["https://skimjob.app/join/AbCd1234?x=1", "abcd1234"],
    ] as const) {
      await page.goto("/");
      await page.getByPlaceholder("Invite code or link").fill(input);
      await page.getByRole("button", { name: "Join crew" }).click();
      await expect(page).toHaveURL(new RegExp(`/join/${code}$`)); // M2-5b: the invite page
    }
    const loaded = page.waitForResponse((r) => r.url().endsWith("/api/auth/providers"));
    await page.goto("/");
    await loaded;
    api.length = 0; // the page's own sign-in check on load (M2-12) isn't the field's
    const field = page.getByPlaceholder("Invite code or link");
    const join = page.getByRole("button", { name: "Join crew" });
    // 16px or more, so iOS Safari doesn't zoom on focus.
    expect(parseFloat(await field.evaluate((e) => getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);

    for (const junk of ["abc", "a".repeat(17), "ab_cd1234", "https://x/invite/", "ÄBCD1234", "<script>"]) {
      await field.fill(junk);
      await join.click();
      await expect(page.getByRole("alert")).toContainText("doesn't look like an invite code");
      await expect(field).toHaveAttribute("aria-invalid", "true");
      // Typing again clears the error. (Not End+Backspace: the caret is not at the end after the click.)
      await field.pressSequentially("x");
      await expect(page.getByRole("alert")).toHaveCount(0);
    }
    expect(api).toEqual([]);
  });

  // QA PR #19: the error shake used to remount the field (`key={shake}`), so
  // focus dropped to <body> and a phone's keyboard closed. Fixed.
  test("Enter on a bad code keeps focus in the invite field", async ({ page }) => {
    await page.goto("/");
    const field = page.getByPlaceholder("Invite code or link");
    await field.fill("abc");
    await field.press("Enter");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(field).toBeFocused();
  });
});

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
