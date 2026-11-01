import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// M2-6 acceptance (docs/m2-plan.md): a host and a guest play a Quick game
// against bots to the end in the browser and see the ledger and the ranking.
// The server runs with TIME_SCALE=0.1 (playwright.config.ts): 4.5 s rounds and
// 12 s meetings, enough for the host to vote (the fast clock's 6 s windows weren't).
// SHOTS_DIR=… saves mid-round and game-over screenshots per viewport.
const SHOTS = process.env.SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(700); // entrances and the meter springs settle
  await page.screenshot({ path: `${SHOTS}/game-${name}-${page.viewportSize()!.width}.png`, fullPage: true });
}

test("a host and a guest play a Quick game against bots to the end", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const guestCtx = await browser.newContext({ viewport: page.viewportSize()! });
  const guest = await guestCtx.newPage();
  const game = await startGame(page.request, { bots: 2, guests: [guest.request] });

  await page.goto(`/game/${game.id}`);
  await guest.goto(`/game/${game.id}`);
  await expect(page.locator(".hud__kicker")).toContainText(/Round \d of 9/);
  await expect(page.locator(".crew-seat")).toHaveCount(4);

  // Until the end: the host moves every round (Office, all in) and posts alibis; the guest never moves.
  const over = page.getByRole("list", { name: "Final ranking" });
  let alibis = 0;
  let moves = 0;
  let votes = 0;
  while (!(await over.isVisible())) {
    // Each act's meeting (M2-7): the vote dialog opens by itself; the host skips.
    const dialog = page.getByRole("dialog", { name: "Who's skimming?" });
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole("group", { name: "Your vote" }).getByRole("button", { name: "Skip" }).click({ timeout: 1000 }).catch(() => {});
      await dialog.getByRole("button", { name: "Cast vote" }).click({ timeout: 1000 }).then(() => votes++, () => {});
      await dialog.getByRole("button", { name: "Back to the board" }).click({ timeout: 1000 }).catch(() => {});
    }
    const lock = page.getByRole("button", { name: "Lock it in" });
    if (await lock.isVisible().catch(() => false)) {
      await page.locator('.room-tile[data-room="Office"]').click({ timeout: 1000 }).catch(() => {});
      // isEnabled waits for the element: the round can end (and the button go) in between.
      if (await lock.isEnabled({ timeout: 500 }).catch(() => false)) {
        await lock.click({ timeout: 1000 }).then(() => moves++, () => {});
      }
    }
    const post = page.getByRole("button", { name: "Post alibi" });
    if (await post.isVisible().catch(() => false)) {
      await page.getByRole("group", { name: "Alibi room" }).getByRole("button", { name: "Lobby" }).click({ timeout: 1000 }).catch(() => {});
      await post.click({ timeout: 1000 }).then(() => alibis++, () => {});
    }
    await page.waitForTimeout(150);
  }
  expect(moves).toBeGreaterThan(0);
  expect(alibis).toBeGreaterThan(0);
  expect(votes).toBeGreaterThan(0);

  // Game over: stamp, ranking of all four, winners marked; the ledger has the rounds.
  await expect(page.locator(".over__stamp")).toHaveText(/JOB DONE|BUSTED/);
  await expect(over.locator(".ranking__row")).toHaveCount(4);
  const ledger = page.getByRole("list", { name: "Ledger" });
  await expect(ledger).toContainText("Round 1: Haul");
  await expect(ledger).toContainText("You say you were in the Lobby");
  await expect(ledger).toContainText(/Job done!|Busted:/);
  await page.getByRole("button", { name: /Case file/ }).click();
  await expect(page.getByRole("list", { name: "Case file" })).toContainText(/Round \d, Office: you found 4 loot/);
  // The act's meetings: the host's ballot (private in the default Hidden mode), and the results in the ledger.
  await expect(page.getByRole("list", { name: "Case file" })).toContainText("You voted to skip.");
  await page.getByRole("button", { name: /Ledger/ }).click();
  await expect(ledger).toContainText("The Act 1 meeting is open: time to vote.");
  await expect(ledger).toContainText(/Act 1 checkpoint: Haul \d+, target \d+/);
  await page.getByRole("button", { name: /Ledger/ }).click();
  await shot(page, "over");

  // The guest missed every deadline: the default move is in their case file (design §5.1), and they see the end too.
  await expect(guest.getByRole("list", { name: "Final ranking" })).toBeVisible();
  await guest.getByRole("button", { name: /Case file/ }).click();
  await expect(guest.getByRole("list", { name: "Case file" })).toContainText("You missed round 1's deadline: the default move went to the Lobby");
  expect(errors).toEqual([]);
  await guestCtx.close();
});

test("the move panel: pick a room, split the loot, lock it in, change it; reconnects after a dropped socket", async ({ page }) => {
  test.setTimeout(60_000);
  // Keep a handle on the page's sockets so the test can drop the game's (not Vite's, which would reload the page).
  await page.addInitScript(() => {
    const Real = window.WebSocket;
    const all: WebSocket[] = [];
    (window as unknown as { __sockets: WebSocket[] }).__sockets = all;
    window.WebSocket = class extends Real {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        all.push(this);
      }
    } as typeof WebSocket;
  });
  const gameSockets = () => page.evaluate(() => (window as unknown as { __sockets: WebSocket[] }).__sockets.filter((ws) => ws.url.includes("/api/games/")).length);
  // The 1-hour preset (30 s rounds at TIME_SCALE 0.1): time to look around in round 1.
  const game = await startGame(page.request, { bots: 3, sessionLength: "1h" });
  await page.goto(`/game/${game.id}`);
  await expect(page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
  await expect(page.getByText("Miss the deadline and you go to the Lobby, handing everything in.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeDisabled();

  // The Vault, pocketing 2 (the slider's value is the Haul share).
  await page.locator('.room-tile[data-room="Vault"]').click();
  await page.locator("#split").fill("4");
  await expect(page.locator(".split__pocket")).toContainText("2");
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page.getByRole("button", { name: "Locked in" })).toBeDisabled();
  await expect(page.getByText("Locked in: Vault, pocket 2.")).toBeVisible();
  await expect(page.locator(".crew-seat.is-you .avatar__dot")).toBeVisible(); // your own "move in" mark
  await expect(page.locator(".crew-seat:not(.is-you) .avatar__dot")).toHaveCount(0); // others' moves stay hidden
  await shot(page, "mid-round");

  // Security needs a room to watch before it can lock in. design §6.1
  await page.locator('.room-tile[data-room="Security"]').click();
  await expect(page.getByRole("button", { name: "Update move" })).toBeDisabled();
  await page.getByRole("group", { name: "Room to watch" }).getByRole("button", { name: "Vault" }).click();
  await page.getByRole("button", { name: "Update move" }).click();
  await expect(page.getByText("Locked in: Security, all to the Haul.")).toBeVisible();

  // Drop the socket: the screen says it is reconnecting, opens a new one, and the move is still there.
  expect(await gameSockets()).toBe(1);
  await page.evaluate(() => (window as unknown as { __sockets: WebSocket[] }).__sockets.filter((ws) => ws.url.includes("/api/games/")).forEach((ws) => ws.close()));
  await expect(page.getByText("Reconnecting…")).toBeVisible();
  await expect(page.getByText("Reconnecting…")).toBeHidden({ timeout: 10_000 });
  expect(await gameSockets()).toBe(2);
  await expect(page.getByText("Locked in: Security, all to the Haul.")).toBeVisible();
});

test("shows the default move after a missed round (design §5.1)", async ({ page }) => {
  test.setTimeout(60_000);
  const game = await startGame(page.request, { bots: 1 });
  await page.goto(`/game/${game.id}`);
  await expect(page.getByRole("heading", { name: "Round 2 · Pick your room", level: 2 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status").filter({ hasText: "You missed round 1: the default move sent you to the Lobby" })).toBeVisible();
});

test("a game you're not in says so", async ({ page }) => {
  await page.request.post("/api/auth/guest", { data: { nickname: "Nosy" } });
  await page.goto("/game/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("heading", { name: "No job here" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to the start" })).toBeVisible();
});
