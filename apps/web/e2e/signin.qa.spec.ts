import { expect, test } from "@playwright/test";

// QA (m2-plan M2-12): Google sign-in from the browser's side. The E2E server
// has no Google client id, so "on" is a mocked /auth/providers answer.

test("Google off: the real server 404s Google's start and callback, and a signed-out landing page shows no account or Tips @auth", async ({ page }) => {
  const providers = page.waitForResponse((r) => r.url().endsWith("/api/auth/providers"));
  await page.goto("/");
  await providers;
  await expect(page.getByRole("button", { name: "Plan a heist" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Tips" })).toHaveCount(0);
  const start = await page.request.get("/api/auth/google/start?returnTo=/", { maxRedirects: 0 });
  expect(start.status()).toBe(404);
  const cb = await page.request.get("/api/auth/google/callback?code=c&state=s", { maxRedirects: 0 });
  expect(cb.status()).toBe(404);
});

test("Google on: a guest still sees Sign in with Google, and the start link ignores the page's own query @auth", async ({ page }) => {
  await page.route("**/api/auth/providers", (r) => r.fulfill({ json: { providers: ["google"] } }));
  await page.route("**/api/me", (r) => r.fulfill({ json: { user: { id: "g1", name: "Rookie", guest: true, tips: true } } }));
  let started: URL | null = null;
  await page.route("**/api/auth/google/start**", (r) => {
    started = new URL(r.request().url());
    return r.fulfill({ contentType: "text/html", body: "<h1>Google</h1>" });
  });
  await page.goto("/?returnTo=//evil.example#//evil.example");
  await expect(page.getByLabel(/Signed in as/)).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByRole("heading", { name: "Google" })).toBeVisible();
  expect(started!.searchParams.get("returnTo")).toBe("/");
});

test("/auth/providers failing: the landing page still works signed out @auth", async ({ page }) => {
  await page.route("**/api/auth/providers", (r) => r.fulfill({ status: 500, json: { error: "boom" } }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Plan a heist" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toHaveCount(0);
});

// QA #264: the top bar's own Sign in is gone, so with Google on "Sign in with
// Google" is the page's only sign-in control, and a guest's top bar is empty.
for (const width of [360, 390, 768, 1024, 1280]) {
  test(`at ${width}px a guest's top bar has no sign-in or name, and Sign in with Google is the only sign-in @auth`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.route("**/api/auth/providers", (r) => r.fulfill({ json: { providers: ["google"] } }));
    await page.route("**/api/me", (r) => r.fulfill({ json: { user: { id: "g1", name: "Rookie", guest: true, tips: true } } }));
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toHaveCount(1);
    await expect(page.locator(".topbar__nav").getByRole("button")).toHaveCount(0);
    await expect(page.getByLabel(/Signed in as/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/qa-264/guest-${width}.png` });
  });
}
