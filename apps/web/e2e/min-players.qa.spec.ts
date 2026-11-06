import { expect, test } from "@playwright/test";

// QA (PR #125, C2a): games need 3 seats. The host alone or with one bot can't
// start; the second bot (3 seats) enables Start and it lands on the game.
// Run at 360 px (mobile project, narrowed) and 1280 px (desktop).

test("the lobby can't start below 3 seats; bots fill to 3 and the game starts", async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/");
  await page.getByRole("button", { name: "Plan a heist" }).click();
  await expect(page).toHaveURL(/\/new$/);
  await page.getByLabel("Your name in this game").fill("Mara");
  await page.getByRole("button", { name: "Open the lobby" }).click();
  await expect(page).toHaveURL(/\/lobby\/[0-9a-f-]{36}$/);

  const startBtn = page.getByRole("button", { name: "Start the job" });
  const need = page.getByText("You need at least 3 seats: invite a friend or add a bot.");
  await expect(startBtn).toBeDisabled();
  await expect(need).toBeVisible();

  await page.getByRole("button", { name: "Add bot" }).click();
  await expect(page.locator(".seat--bot")).toHaveCount(1);
  await expect(startBtn).toBeDisabled(); // 2 seats: still not enough
  await expect(need).toBeVisible();

  await page.getByRole("button", { name: "Add bot" }).click();
  await expect(page.locator(".seat--bot")).toHaveCount(2);
  await expect(startBtn).toBeEnabled();
  await expect(need).toHaveCount(0);
  await page.screenshot({ path: `test-results/qa125-lobby-3-${info.project.name}.png`, fullPage: true });

  // Removing a bot drops back to 2 seats: Start is disabled again.
  await page.getByRole("button", { name: /^Remove Bot/ }).first().click();
  await expect(page.locator(".seat--bot")).toHaveCount(1);
  await expect(startBtn).toBeDisabled();
  await page.getByRole("button", { name: "Add bot" }).click();
  await expect(startBtn).toBeEnabled();

  await startBtn.click();
  await expect(page).toHaveURL(/\/game\//);
  await expect(page.getByRole("region", { name: "Heist status" })).toBeVisible();
});
