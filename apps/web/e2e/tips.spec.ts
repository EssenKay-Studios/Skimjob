import { expect, test } from "@playwright/test";

// S3b.3, design §15.6: the per-user Tips setting on the landing page. It is on
// by default, saved on the user (a guest here), and survives reloads.

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

test("the Tips setting is on by default and an Off choice survives a reload @auth", async ({ page }) => {
  await page.request.post("/api/auth/guest", { data: { nickname: "Tipster" } });
  await page.goto("/");
  const tips = page.getByRole("group", { name: "Tips" });
  await expect(tips.getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
  await tips.getByRole("button", { name: "Off" }).click();
  await expect(tips.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(tips.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  expect((await (await page.request.get("/api/me")).json()).user.tips).toBe(false);
  await tips.getByRole("button", { name: "On" }).click();
  await page.reload();
  await expect(tips.getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
});

test("signed out, the landing page has no Tips setting @auth", async ({ page }) => {
  const me = page.waitForResponse((r) => r.url().endsWith("/api/me"));
  await page.goto("/");
  expect((await me).status()).toBe(401);
  await expect(page.getByRole("group", { name: "Tips" })).toHaveCount(0);
});

test("the Tips toggle fits every launch width with 44 px targets @auth", async ({ page }) => {
  await page.request.post("/api/auth/guest", { data: { nickname: "Tipster" } });
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await page.goto("/");
    const tips = page.getByRole("group", { name: "Tips" });
    await expect(tips).toBeVisible();
    for (const name of ["On", "Off"]) {
      const box = (await tips.getByRole("button", { name }).boundingBox())!;
      expect(box.height, `${name} at ${vp.width}`).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
