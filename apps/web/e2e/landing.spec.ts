import { expect, test } from "@playwright/test";

// Smoke test: the landing page renders its main actions (m2-plan M2-5), with
// no console errors, and the invite field rejects junk without a request.
test("landing renders", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // The unknown code's 404 is expected (the invite page says so).
    if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text());
  });
  await page.goto("/");

  await expect(page.getByRole("img", { name: "Skimjob" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Steal from your crew.");
  await expect(page.getByRole("button", { name: "Plan a heist" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join crew" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  // Sketch frames have drawn their SVG outlines.
  await expect(page.locator(".sk-frame .sk-ink").first()).toBeAttached();

  await page.getByRole("button", { name: "Join crew" }).click();
  await expect(page.getByRole("alert")).toContainText("Paste the code");

  await page.getByPlaceholder("Invite code or link").fill("K7QX-M2PA");
  await page.getByRole("button", { name: "Join crew" }).click();
  await expect(page).toHaveURL(/\/join\/k7qxm2pa$/); // M2-5b: the invite page
  await expect(page.getByRole("heading", { name: "That invite doesn't open anything." })).toBeVisible();

  expect(errors).toEqual([]);
});
