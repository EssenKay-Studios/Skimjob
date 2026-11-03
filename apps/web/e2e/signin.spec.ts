import { expect, test, type Page } from "@playwright/test";

// Google sign-in on the landing page (m2-plan M2-12). The E2E server has no
// Google client id, so "on" is the server's /auth/providers answer mocked here;
// the OAuth round trip itself is covered by apps/server/src/auth.test.ts.
const googleOn = (page: Page) => page.route("**/api/auth/providers", (r) => r.fulfill({ json: { providers: ["google"] } }));
const signedIn = (page: Page, name: string) =>
  page.route("**/api/me", (r) => r.fulfill({ json: { user: { id: "u1", name, guest: false } } }));

test("without a Google client id there's no Google button and Sign in explains nicknames", async ({ page }) => {
  const providers = page.waitForResponse((r) => r.url().endsWith("/api/auth/providers"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Plan a heist" })).toBeVisible();
  // The real server answered (no Google) before checking the button stays hidden.
  expect(await (await providers).json()).toEqual({ providers: [] });
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".toast").first()).toContainText("pick a nickname");
});

for (const [label, name] of [
  ["Sign in with Google", "Sign in with Google"],
  ["top bar Sign in", "Sign in"],
] as const) {
  test(`with Google on, ${label} goes to the server's Google start (back to /)`, async ({ page }) => {
    await googleOn(page);
    let started: URL | null = null;
    await page.route("**/api/auth/google/start**", (r) => {
      started = new URL(r.request().url());
      return r.fulfill({ contentType: "text/html", body: "<h1>Google</h1>" });
    });
    await page.goto("/");
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Google" })).toBeVisible();
    expect(started!.pathname).toBe("/api/auth/google/start");
    expect(started!.searchParams.get("returnTo")).toBe("/");
  });
}

test("signed in with Google: the top bar shows the name and the sign-in card is gone", async ({ page }) => {
  await googleOn(page);
  await signedIn(page, "Riya");
  await page.goto("/");
  await expect(page.getByLabel("Signed in as Riya")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
});

// UI rules: 360–1280 px, no overflow, touch targets ≥ 44 px (the card and the longest name).
for (const width of [360, 390, 768, 1024, 1280]) {
  test(`fits at ${width}px with the Google card and with a long signed-in name`, async ({ page }, info) => {
    test.skip(!info.project.name.startsWith("mobile"), "viewports are set per test");
    await page.setViewportSize({ width, height: 800 });
    await googleOn(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await fits()).toBe(true);
    const box = await page.getByRole("button", { name: "Sign in with Google" }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await signedIn(page, "Wolfgang Amadeus Mozartt"); // 24 characters, the most a name can have
    await page.reload();
    await expect(page.getByLabel(/Signed in as/)).toBeVisible();
    expect(await fits()).toBe(true);
  });
}
