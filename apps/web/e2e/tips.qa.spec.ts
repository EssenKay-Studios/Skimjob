import { expect, test, type Page } from "@playwright/test";

// QA for S3b.3 (design §15.6): the Tips toggle on the landing page by
// keyboard and touch, its accessible name and state, a failed save, sign-out,
// and the notebook look at every launch width (screenshots in test-results/).

const guestIn = (page: Page, nickname = "Tipqa") => page.request.post("/api/auth/guest", { data: { nickname } });
const tipsGroup = (page: Page) => page.getByRole("group", { name: "Tips" });
const serverTips = async (page: Page) => (await (await page.request.get("/api/me")).json()).user.tips as boolean;

test("the Tips toggle works from the keyboard and names its state @auth", async ({ page }) => {
  await guestIn(page);
  await page.goto("/");
  const on = tipsGroup(page).getByRole("button", { name: "On" });
  const off = tipsGroup(page).getByRole("button", { name: "Off" });
  await expect(on).toHaveAttribute("aria-pressed", "true");
  await expect(off).toHaveAttribute("aria-pressed", "false");
  await off.focus();
  await expect(off).toBeFocused();
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith("/api/me"));
  await page.keyboard.press("Space");
  expect((await saved).status()).toBe(200);
  await expect(off).toHaveAttribute("aria-pressed", "true");
  await expect(on).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Shift+Tab");
  await expect(on).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(on).toHaveAttribute("aria-pressed", "true");
  expect(await serverTips(page)).toBe(true);
});

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 360, height: 740 } });
  test("a tap switches Tips off and the choice survives a reload @auth", async ({ page }) => {
    await guestIn(page);
    await page.goto("/");
    await tipsGroup(page).getByRole("button", { name: "Off" }).tap();
    await expect(tipsGroup(page).getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(tipsGroup(page).getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
    expect(await serverTips(page)).toBe(false);
  });
});

test("a failed save says so and leaves the toggle as it was @auth", async ({ page }) => {
  await guestIn(page);
  await page.route("**/api/me", (r) => (r.request().method() === "PATCH" ? r.fulfill({ status: 500, json: { error: "boom" } }) : r.fallback()));
  await page.goto("/");
  await tipsGroup(page).getByRole("button", { name: "Off" }).click();
  await expect(page.locator(".toast").first()).toBeVisible();
  await expect(tipsGroup(page).getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
  expect(await serverTips(page)).toBe(true);
});

test("after signing out the toggle is gone, and a new guest starts with Tips on @auth", async ({ page }) => {
  await guestIn(page, "Leaver");
  await page.goto("/");
  await tipsGroup(page).getByRole("button", { name: "Off" }).click();
  await expect(tipsGroup(page).getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  expect((await page.request.post("/api/auth/logout")).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("button", { name: "Plan a heist" })).toBeVisible();
  await expect(tipsGroup(page)).toHaveCount(0);
  await guestIn(page, "Comeback");
  await page.reload();
  await expect(tipsGroup(page).getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
});

test("the Tips row uses the notebook kit at every launch width @auth", async ({ page }, info) => {
  await guestIn(page);
  for (const width of [360, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const group = tipsGroup(page);
    await expect(group).toBeVisible();
    const look = await group.evaluate((el) => {
      const label = getComputedStyle(el.querySelector(".seg__label")!);
      const btn = el.querySelector("button")!;
      const r = el.getBoundingClientRect();
      return { label: label.fontFamily, button: getComputedStyle(btn).fontFamily, cls: btn.className, left: r.left, right: r.right };
    });
    expect(look.label, `label font at ${width}`).toMatch(/Pangolin|Inter/);
    expect(look.button, `button font at ${width}`).toMatch(/Pangolin|Inter/);
    expect(look.cls, `kit button at ${width}`).toMatch(/btn/);
    expect(look.left).toBeGreaterThanOrEqual(0);
    expect(look.right).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await group.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`tips-${width}.png`), fullPage: true });
  }
});
