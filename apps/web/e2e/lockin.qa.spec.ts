// QA (PR #44): public lock-in marks and presence on the crew list, seen from
// another person's screen. Owner decisions, 2 Nov. design §5.1, §13
import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openPanel, startGame, settle } from "./setupGame";
import { pickRoom } from "./move";

const WIDTHS = [360, 390, 768, 1024, 1280];
const seat = (page: Page, name: string) => page.locator(".crew-seat:not(.is-you)").filter({ hasText: name });

test("a person's lock-in shows on others' seats, a change shows nothing; presence online → seen; no overflow at 360–1280 @move", async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  // Pipeline evidence folder locally; the test output folder on CI.
  const shots = existsSync("/home/claude/pipeline/shots") ? "/home/claude/pipeline/shots" : info.outputPath();
  const errors: string[] = [];
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const idle = await browser.newContext(); // never moves: keeps round 1 open
  // The one-week preset: round 1 stays open for the whole test.
  const game = await startGame(host.request, { bots: 2, guests: [page.request, idle.request], sessionLength: "1w" });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/game/${game.id}`);
  await expect(page.locator(".hud__kicker")).toContainText(/Round 1 of/);
  await openPanel(page, "Crew");
  // Before the host opens the game: never here; the idle guest too; bots show as bots, never online.
  await expect(seat(page, "Host")).toContainText("not here yet");
  await expect(seat(page, "Guest 2")).toContainText("not here yet");
  for (const b of await page.locator(".crew-seat:not(.is-you)").filter({ hasText: "Bot" }).all()) {
    await expect(b).toContainText("bot");
    await expect(b).not.toContainText("online");
  }
  await expect(seat(page, "Host").locator(".crook-avatar--ready")).toHaveCount(0);

  await host.goto(`/game/${game.id}`);
  await openPanel(host, "This round");
  await expect(host.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
  await expect(seat(page, "Host")).toContainText("online");

  // The host locks in: the guest sees the mark, never the room or split.
  await pickRoom(host, "Vault");
  await host.getByRole("button", { name: "Lock it in" }).click();
  await expect(host.getByRole("button", { name: "Locked in" })).toBeDisabled();
  await expect(seat(page, "Host").locator(".crook-avatar--ready")).toBeVisible();
  await expect(seat(page, "Host")).toContainText("locked in");
  const crewBefore = await page.locator(".crew-seat").evaluateAll((els) => els.map((e) => e.outerHTML).join("\n"));

  // A change: the guest's crew list is unchanged.
  // A room change.
  await pickRoom(host, "Office");
  await host.getByRole("button", { name: "Update move" }).click();
  await expect(host.getByText(/Locked in: Office/)).toBeVisible();
  await page.waitForTimeout(1000); // sleep: proves a negative (the crew list does not re-render)
  const crewAfter = await page.locator(".crew-seat").evaluateAll((els) => els.map((e) => e.outerHTML).join("\n"));
  expect(crewAfter).toBe(crewBefore);

  // Responsive: the crew list with marks and presence at every width.
  // A fresh tab per width (same guest), as game.responsive does: no resize artefacts.
  for (const w of WIDTHS) {
    const tab = await page.context().newPage();
    await tab.setViewportSize({ width: w, height: 844 });
    await tab.goto(`/game/${game.id}`);
    await openPanel(tab, "Crew");
    await expect(seat(tab, "Host")).toContainText("locked in");
    await expect(seat(tab, "Host")).toContainText("online");
    await settle(tab);
    const o = await tab.evaluate(() => {
      const client = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => el.getBoundingClientRect().right > client + 1)
        .slice(0, 3)
        .map((el) => `${el.tagName}.${el.className}`);
      return { scroll: document.documentElement.scrollWidth, client, wide };
    });
    expect(o.scroll, `horizontal overflow at ${w}px: ${o.wide.join(", ")}`).toBeLessThanOrEqual(o.client);
    // Seat rows' targets stay readable: the mark and the presence line never overlap the name.
    await tab.locator(".crew-seat").first().scrollIntoViewIfNeeded();
    await tab.screenshot({ path: `${shots}/qa-44-crew-${w}.png`, fullPage: true });
    await tab.close();
  }

  // The host leaves: offline, last seen just now.
  await hostCtx.close();
  await expect(seat(page, "Host")).toContainText("seen just now", { timeout: 10_000 });
  await expect(seat(page, "Host")).not.toContainText("online");
  expect(errors).toEqual([]);
  await idle.close();
});
