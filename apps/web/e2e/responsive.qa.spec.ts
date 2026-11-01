import { expect, test, type Page } from "@playwright/test";

// QA (PR #19): responsive guards for the web shell. decisions.md 2026-11-01
// "Web-first launch; responsive everywhere": 360–430 px phones, 768–1024 px
// tablets (both orientations), laptops; no horizontal overflow, ≥44 px touch
// targets. Every new screen should be added to ROUTES.

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];
const ROUTES = ["/", "/no-such-page"];

// Viewport sizes are set per test below, so run each test once.
test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

async function overflow(page: Page) {
  return page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth, client: document.documentElement.clientWidth }));
}

async function smallTargets(page: Page) {
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
    await page.goto("/");
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
      await page.getByRole("button", { name: "Join crew" }).click();
      await page.getByPlaceholder("Invite code or link").fill("abcd1234");
      await page.getByRole("button", { name: "Join crew" }).click();
      expect(await page.locator(".toast").first().evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
    });
  });

  test("invite field: links, spaces and dashes are tidied; junk is refused without a request", async ({ page }) => {
    const api: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api")) api.push(r.url());
    });
    await page.goto("/");
    const field = page.getByPlaceholder("Invite code or link");
    const join = page.getByRole("button", { name: "Join crew" });
    // 16px or more, so iOS Safari doesn't zoom on focus.
    expect(parseFloat(await field.evaluate((e) => getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);

    for (const [input, code] of [
      ["  K7QX-M2PA  ", "k7qxm2pa"],
      ["k7 qx m2 pa", "k7qxm2pa"],
      ["https://skimjob.app/join/AbCd1234?x=1", "abcd1234"],
    ] as const) {
      await field.fill(input);
      await join.click();
      await expect(page.getByRole("status").filter({ hasText: code }).last()).toBeVisible();
      await expect(field).toHaveAttribute("aria-invalid", "false");
    }
    for (const junk of ["abc", "a".repeat(17), "ab_cd1234", "https://x/invite/", "ÄBCD1234", "<script>"]) {
      await field.fill(junk);
      await join.click();
      await expect(page.getByRole("alert")).toContainText("doesn't look like an invite code");
      await expect(field).toHaveAttribute("aria-invalid", "true");
      // Typing again clears the error.
      await field.press("End");
      await field.press("Backspace");
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
