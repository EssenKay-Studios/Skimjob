import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";
import { pickRoom } from "./move";

// QA (PR #41): the bank board at every launch width with a full 12-seat crew
// and with 3 seats: no overflow, every target ≥ 44 px, keyboard picking (no
// hover-only), only your figure while planning, and the role card's claim list
// open. Screenshots go to /home/claude/pipeline/shots/qa-board-*.png.

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];
const SHOTS = process.env.QA_SHOTS;

test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function check(page: Page, where: string) {
  await settle(page);
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(o.scroll, `${where}: horizontal overflow`).toBeLessThanOrEqual(o.client);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [role=button]")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 43.5 || r.height < 43.5))
      .map(({ el, r }) => `${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim()} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`),
  );
  expect(small, `${where}: small targets`).toEqual([]);
  // Nothing in the board or the crew sticks out past the viewport.
  const out = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".board, .board *, .crew, .crew *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.left < -0.5 || r.right > document.documentElement.clientWidth + 0.5);
      })
      .map((el) => el.className.toString())
      .slice(0, 5),
  );
  expect(out, `${where}: board/crew outside the viewport`).toEqual([]);
}

for (const seats of [12, 3]) {
  for (const viewport of VIEWPORTS) {
    test(`QA board, ${seats} seats at ${viewport.width}: fits, keyboard picks, only you while planning, claim list @board`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 1024, isMobile: viewport.width < 1024 });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const game = await startGame(page.request, { bots: seats - 1, sessionLength: "1w" });
      await page.goto(`/game/${game.id}`);
      await expect(page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
      await expect(page.locator(".crew-seat")).toHaveCount(seats);
      const board = page.getByRole("region", { name: "The bank" });
      await expect(board.locator(".bank-room .crook-fig")).toHaveCount(0);
      await check(page, "planning, nothing picked");

      // Keyboard: focus a room on the board and press Enter (no hover-only interaction).
      const lobby = board.locator(".bank-room[data-room=lobby]");
      await lobby.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".move__room-name")).toHaveText("Lobby");
      await expect(board.locator(".bank-room .crook-fig")).toHaveCount(1);
      await expect(board.locator(".bank-room[data-room=lobby] .crook-fig")).toHaveCount(1);
      // Panel -> board.
      await pickRoom(page, "Vault");
      await expect(board.locator(".bank-room[data-room=vault]")).toHaveAttribute("aria-pressed", "true");
      await expect(board.locator(".bank-room .crook-fig")).toHaveCount(1);
      await page.getByRole("button", { name: "Lock it in" }).click();
      await expect(page.getByText(/Locked in: Vault/)).toBeVisible();
      await expect(board.locator(".bank-room .crook-fig")).toHaveCount(1);
      // However many others lock in meanwhile, their picks never appear on your board.
      for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(1000);
        await expect(board.locator(".bank-room .crook-fig")).toHaveCount(1);
      }
      await check(page, "locked in");
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/qa-board-${seats}p-${viewport.width}.png`, fullPage: true });

      const card = page.locator(".role-card");
      await card.getByRole("button", { name: "Claim role" }).click();
      const group = card.getByRole("group", { name: "Role to claim" });
      await expect(group).toBeVisible();
      await check(page, "claim list open");
      if (SHOTS && viewport.width === 360) await page.screenshot({ path: `${SHOTS}/qa-claim-${seats}p-360.png`, fullPage: true });
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }
}
