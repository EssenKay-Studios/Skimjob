import { RULESETS } from "@skimjob/content";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { openPanel, settle } from "./setupGame";

const expect = baseExpect.configure({ timeout: 15_000 });

// QA for S4.10, design §14: the Learn the game form and guide at every launch
// width (screenshots under test-results/learn-qa), one sheet at a time, the
// numbering, no black market or events in the rulebook, and the seen steps
// kept per game (a second lesson starts the guide again).

const guide = RULESETS.learn!.guide;
const title = (id: string) => guide.find((s) => s.id === id)!.title;
const WIDTHS = [360, 390, 768, 1024, 1280];
const SHOTS = "test-results/learn-qa";

async function noOverflow(page: Page, label: string): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), label).toBeLessThanOrEqual(0);
}

async function startLearn(page: Page, name: string): Promise<string> {
  await page.goto("/learn");
  await page.getByLabel("Your name in this game").fill(name);
  await page.getByRole("button", { name: "Start the lesson" }).click();
  await page.waitForURL(/\/game\//);
  const id = page.url().split("/game/")[1]!;
  expect((await page.request.post(`/api/games/${id}/pause`)).ok()).toBe(true);
  return id;
}

async function gotIt(page: Page, id: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: title(id) });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText(`Guide · ${guide.findIndex((s) => s.id === id) + 1} of ${guide.length}`);
  // One sheet at a time (design §15.6): no teaching lesson on top of a guide step.
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Got it" }).click();
  await expect(dialog).toBeHidden();
}

test("the Learn form and the welcome step at every launch width @learn", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set in the test");
  test.setTimeout(90_000);
  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "Learn the game" })).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await settle(page);
    await noOverflow(page, `form ${width}`);
    const start = page.getByRole("button", { name: "Start the lesson" });
    expect((await start.boundingBox())!.height, `${width}`).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${SHOTS}/form-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await startLearn(page, "Wren");
  const welcome = page.getByRole("dialog", { name: title("welcome") });
  await expect(welcome).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await settle(page);
    await noOverflow(page, `guide ${width}`);
    await page.screenshot({ path: `${SHOTS}/guide-${width}.png` });
  }
});

test("a Learn game has no black market or events in its rulebook, and each lesson starts the guide again @learn", async ({ page }) => {
  test.setTimeout(120_000);
  await startLearn(page, "Yara");
  for (const id of ["welcome", "role", "move"]) await gotIt(page, id);
  await openPanel(page, "This round");
  await expect(page.getByRole("button", { name: "Black market" })).toHaveCount(0);
  await page.getByRole("button", { name: "Rules", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rooms" })).toBeVisible();
  await expect(page.getByRole("list", { name: "This game's black market" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Black market", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Events", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/rulebook-${page.viewportSize()!.width}.png`, fullPage: true });

  // A second lesson is a new game: its guide starts from the welcome.
  await startLearn(page, "Yara");
  await gotIt(page, "welcome");
});
