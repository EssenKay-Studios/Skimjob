import { expect, test } from "@playwright/test";
import { startGame } from "./setupGame";

// design §7.5, §15: the honesty meter in the HUD at every launch width, 12 seats and a long name.
const WIDTHS = [360, 390, 768, 1024, 1280];
const LONG = "Abcdefghijklmnopqrstuvwx";

test("the honesty meter reads full, shows the line and fits the HUD at every width @board", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  test.setTimeout(90_000);
  const game = await startGame(page.request, { bots: 11, nickname: LONG });
  await page.goto(`/game/${game.id}`);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const meter = page.getByRole("meter", { name: "Honesty" });
    await expect(meter).toBeVisible();
    await expect(meter).toHaveAttribute("aria-valuenow", "100");
    await expect(meter).toHaveAttribute("aria-valuetext", /the line is ⅔/);
    await expect(page.locator(".hud__honesty")).toContainText("line ⅔");
    await expect(async () => {
      const bad = await page.evaluate(() => {
        const hud = document.querySelector(".hud")!.getBoundingClientRect();
        const m = document.querySelector(".hud__honesty")!.getBoundingClientRect();
        const line = document.querySelector(".honesty__line")!.getBoundingClientRect();
        const track = document.querySelector(".honesty")!.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          outside: m.left < hud.left - 1 || m.right > hud.right + 1,
          lineOff: line.left < track.left || line.right > track.right,
        };
      });
      expect(bad, `${width}px`).toEqual({ overflow: false, outside: false, lineOff: false });
    }).toPass({ timeout: 5_000 });
    await page.screenshot({ path: `test-results/honesty-hud-${width}.png` });
  }
});
