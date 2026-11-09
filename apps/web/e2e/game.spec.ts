import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openLeads, startGame } from "./setupGame";
import { bagCoins, dragTo, pickRoom } from "./move";

// M2-6 acceptance (docs/m2-plan.md): a host and a guest play a 15-min game
// against bots to the end in the browser and see the ranking.
// The server runs with TIME_SCALE=0.1 (playwright.config.ts): 4.5 s rounds and
// 12 s meetings, enough for the host to vote (the fast clock's 6 s windows weren't).
// SHOTS_DIR=… saves mid-round and game-over screenshots per viewport.
const SHOTS = process.env.SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(700); // entrances and the bulb springs settle
  await page.screenshot({ path: `${SHOTS}/game-${name}-${page.viewportSize()!.width}.png`, fullPage: true });
}

test("a host and a guest play a 15-min game against bots to the end @move", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const guestCtx = await browser.newContext({ viewport: page.viewportSize()! });
  const guest = await guestCtx.newPage();
  const game = await startGame(page.request, { bots: 2, guests: [guest.request] });

  // The result window, where the alibi panel sits, is about a second of real time at this clock, shorter than a loaded runner's
  // click round trips, so the host's alibi is posted from inside the page (no round trips): pick the
  // Lobby, post, and note that the confirmation ("You told the crew ...") was shown (issue #127).
  await page.addInitScript(() => {
    const w = window as unknown as { __alibiShown?: boolean };
    setInterval(() => {
      const btn = (t: string, root: ParentNode = document) => [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === t);
      const post = btn("Post alibi");
      if (post) (post.disabled ? btn("Lobby", document.querySelector('[aria-label="Alibi room"]') ?? document) : post)?.click();
      if (document.body.innerText.includes("You told the crew you were in the")) w.__alibiShown = true;
    }, 25);
  });
  await page.goto(`/game/${game.id}`);
  await guest.goto(`/game/${game.id}`);
  await expect(page.locator(".hud__kicker")).toContainText(/Round \d+ of 12/);
  await expect(page.locator(".crew-seat")).toHaveCount(4);

  // Until the end: the host moves every round (Office, all in) and posts alibis; the guest never moves.
  const over = page.getByRole("list", { name: "Final ranking" });
  let alibis = 0;
  let moves = 0;
  let votes = 0;
  while (!(await over.isVisible())) {
    // Every interaction below waits generously for its click and counts only what the UI confirms ("Vote cast",
    // "Locked in: Office", "You told the crew ..."), never the click itself. A click that fails under load (the
    // sheet still animating, the round gone) is retried on the next pass. The three steps run side by side:
    // one that stalls on a vanished button (a 5 s click timeout) must not eat the result or vote window.
    // Issue #127: 1 s clicks that were counted, or followed by "Back to the board", left votes/alibis at 0.
    const landed = (l: Locator) => l.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
    const click = (l: Locator) => l.click({ timeout: 5000 }).catch(() => {});

    // Each meeting (M2-7, design §9): the vote dialog opens by itself; the host skips.
    const vote = async () => {
      const dialog = page.getByRole("dialog", { name: "Who's skimming?" });
      if (!(await dialog.isVisible().catch(() => false))) return;
      await click(dialog.getByRole("group", { name: "Your vote" }).getByRole("button", { name: "Skip" }));
      await click(dialog.getByRole("button", { name: "Cast vote" }));
      if (await landed(dialog.getByRole("button", { name: "Vote cast" }))) {
        votes++;
        await click(dialog.getByRole("button", { name: "Back to the board" }));
      }
    };
    const move = async () => {
      if (!(await page.getByRole("button", { name: "Lock it in" }).isVisible().catch(() => false))) return;
      await pickRoom(page, "Office", 5000).catch(() => {});
      await click(page.getByRole("button", { name: "Lock it in" }));
      if (await landed(page.getByText(/Locked in: Office/))) moves++;
    };
    await Promise.all([vote(), move()]);
    await page.waitForTimeout(150);
  }
  expect(moves).toBeGreaterThan(0);
  alibis = (await page.evaluate(() => (window as unknown as { __alibiShown?: boolean }).__alibiShown)) ? 1 : 0;
  expect(alibis).toBeGreaterThan(0);
  expect(votes).toBeGreaterThan(0);

  // Game over: stamp, ranking of all four, winners marked.
  // The server seeds each game afresh, so read the ending this game reached and check its own lines (design §5.5, §8, §20.2).
  const panel = page.locator("section.over");
  const ending = await panel.getAttribute("data-ending");
  const STAMPS: Record<string, string> = { success: "JOB DONE", bust: "BUSTED", theft: "BUSTED" };
  expect(Object.keys(STAMPS), `ending ${ending}`).toContain(ending);
  await expect(page.locator(".over__stamp")).toHaveText(STAMPS[ending!]!);
  if (ending === "bust") await expect(panel).toContainText("Busted. On a bust, only the Rooftop gets away.");
  await expect(over.locator(".ranking__row")).toHaveCount(4);
  await shot(page, "over");

  // The case board keeps the game's facts (design §15.4): the round haul, the host's alibi and grab, the host's
  // ballot (private in the default Hidden mode: seen by you, not a public fact) and the ending.
  const ENDS: Record<string, string> = { success: "Job done! The crew got away with it", bust: "Busted: Wanted hit the bust line and the heist failed", theft: "The heist was sunk by theft" };
  const leads = await openLeads(page);
  await expect(leads).toContainText(/Fact Round 1: \d+ taken/);
  await expect(leads).toContainText("Said You say you were in the Lobby");
  await expect(leads).toContainText(/Seen by you Round \d+, Office: you grabbed \d+ coins/);
  await expect(leads).toContainText("Seen by you You voted to skip.");
  await expect(leads).toContainText(ENDS[ending!]!);

  // The guest missed every deadline: the default move is on their board (design §3.3), and they see the end too.
  await expect(guest.getByRole("list", { name: "Final ranking" })).toBeVisible();
  await expect(await openLeads(guest)).toContainText("Seen by you You missed round 1's deadline: the default move went to the Lobby");
  expect(errors).toEqual([]);
  await guestCtx.close();
});

test("the move panel: pick a room, coins into the bags, lock it in, change it; reconnects after a dropped socket @move", async ({ page, browser }) => {
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
  // An absent guest who never moves keeps round 1 open: once the whole crew has locked in, a round ends
  // a few seconds later (owner decision, 2 Nov).
  const idle = await browser.newContext();
  const game = await startGame(page.request, { bots: 3, guests: [idle.request], sessionLength: "1h" });
  await page.goto(`/game/${game.id}`);
  await expect(page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
  await expect(page.getByText("Miss the deadline and you go to the Lobby, handing everything in.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeDisabled();

  // The Vault's 3 coins, all in the duffel at first: a tap sends one to the pocket, a drag another (design §3.2).
  await pickRoom(page, "Vault");
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  await expect(bagCoins(page, "duffel")).toHaveCount(3);
  await bagCoins(page, "duffel").first().click();
  await expect(bagCoins(page, "pocket")).toHaveCount(1);
  await dragTo(page, bagCoins(page, "duffel").first(), page.locator("[data-bag=pocket]"));
  await expect(bagCoins(page, "pocket")).toHaveCount(2);
  await expect(bagCoins(page, "duffel")).toHaveCount(1);
  // The previews follow the grab: the Vault's bell (a Locksmith's coins are silent) and what the duffel adds to the share (5 in the crew).
  await expect(page.locator(".coin-bags").getByRole("img", { name: /^Bell: 0 of 4 lit(, your grab adds 3)?$/ })).toBeVisible();
  await expect(page.getByText("Your 1 duffel coin adds about 0.2 to each share.")).toBeVisible();
  // A tap alternative to dragging: a coin is a button, Enter sends it to the other bag.
  await bagCoins(page, "pocket").first().focus();
  await page.keyboard.press("Enter");
  await expect(bagCoins(page, "duffel")).toHaveCount(2);
  await bagCoins(page, "duffel").first().click();
  await expect(bagCoins(page, "pocket")).toHaveCount(2);
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page.getByRole("button", { name: "Locked in" })).toBeDisabled();
  await expect(page.getByText("Locked in: Vault, pocket 2.")).toBeVisible();
  await expect(page.locator(".crew-seat.is-you .crook-avatar--ready")).toBeVisible(); // your own "locked in" mark (everyone's is public)
  // Lock-ins are public (owner decision, 2 Nov): the bots have locked in, the idle guest hasn't; never a room or split.
  await expect(page.locator(".crew-seat:not(.is-you) .crook-avatar--ready")).toHaveCount(3);
  await expect(page.locator(".crew-seat:not(.is-you)").filter({ hasText: "Guest 1" })).toContainText("not here yet");
  await expect(page.locator(".crew-seat:not(.is-you)").filter({ hasText: "Bot" }).first()).toContainText("bot");
  await shot(page, "mid-round");

  // Security needs a room to watch before it can lock in. design §6.1
  await pickRoom(page, "Security");
  await expect(page.getByRole("button", { name: "Update move" })).toBeDisabled();
  await page.getByRole("group", { name: "Room to watch" }).getByRole("button", { name: "Vault" }).click();
  await page.getByRole("button", { name: "Update move" }).click();
  await expect(page.getByText("Locked in: Security, all to the duffel.")).toBeVisible();

  // Drop the socket: the screen says it is reconnecting, opens a new one, and the move is still there.
  expect(await gameSockets()).toBe(1);
  await page.evaluate(() => (window as unknown as { __sockets: WebSocket[] }).__sockets.filter((ws) => ws.url.includes("/api/games/")).forEach((ws) => ws.close()));
  await expect(page.getByText("Reconnecting…")).toBeVisible();
  await expect(page.getByText("Reconnecting…")).toBeHidden({ timeout: 10_000 });
  expect(await gameSockets()).toBe(2);
  await expect(page.getByText("Locked in: Security, all to the duffel.")).toBeVisible();
  await idle.close();
});

test("the bank board: tap a room to pick it, see who you saw and the alibi claims; claim a role (M2-9, R4b) @board", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The 1-hour preset: 30 s rounds and 6 s result windows at TIME_SCALE 0.1.
  // An absent guest keeps the round to its full length (it would end soon after everyone locks in: owner decision, 2 Nov).
  const idle = await browser.newContext();
  const game = await startGame(page.request, { bots: 4, guests: [idle.request], sessionLength: "1h" });
  await page.goto(`/game/${game.id}`);
  await expect(page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
  const board = page.getByRole("region", { name: "The bank" });
  await expect(board.getByText("Round 1: tap a room to pick it.")).toBeVisible();

  // The board drives the move panel, and the panel drives the board.
  await board.locator(".bank-room[data-room=vault]").click();
  await expect(page.locator(".move__room-name")).toHaveText("Vault");
  await expect(board.locator(".bank-room[data-room=vault]")).toHaveAttribute("aria-pressed", "true");
  await expect(board.getByText(/heading for the Vault/)).toBeVisible();
  await pickRoom(page, "Office");
  await expect(board.locator(".bank-room[data-room=office]")).toHaveAttribute("aria-pressed", "true");
  await expect(board.locator(".bank-room[data-room=vault]")).toHaveAttribute("aria-pressed", "false");
  // Only you stand in the bank while planning: nobody else's pick is drawn.
  await expect(board.locator(".bank-room .crook-fig")).toHaveCount(1);
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page.getByText("Locked in: Office")).toBeVisible();

  // Claim a role from the role card, any time (owner, 2 Nov): once between meetings.
  const card = page.locator(".role-card");
  await card.getByRole("button", { name: "Claim role" }).click();
  await card.getByRole("group", { name: "Role to claim" }).getByRole("button", { name: "Lookout" }).click();
  await card.getByRole("button", { name: "Claim the Lookout" }).click();
  await expect(card.getByText("You claimed to be the Lookout. One claim between meetings")).toBeVisible();
  await expect(card.getByRole("button", { name: "Claim role" })).toHaveCount(0);

  // The result window (6 s): the board shows the resolved round, with you in the Office; the plan board offers the alibi for it.
  const alibi = page.locator(".plan__alibi");
  await expect(alibi).toBeVisible({ timeout: 45_000 });
  await expect(board.getByText(/as you saw it/)).toBeVisible();
  await expect(board.locator(".bank-room.is-selected[data-room=office]")).toBeVisible();
  await expect(card.getByText("You claimed to be the Lookout. One claim between meetings")).toBeVisible();
  expect(errors).toEqual([]);
  await idle.close();
});

test("shows the default move after a missed round (design §5.1) @move", async ({ page }) => {
  test.setTimeout(60_000);
  const game = await startGame(page.request, { bots: 2 });
  await page.goto(`/game/${game.id}`);
  await expect(page.getByRole("heading", { name: "Round 2 · Pick your room", level: 2 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status").filter({ hasText: "You missed round 1: the default move sent you to the Lobby" })).toBeVisible();
});

test("a game you're not in says so @move", async ({ page }) => {
  await page.request.post("/api/auth/guest", { data: { nickname: "Nosy" } });
  await page.goto("/game/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("heading", { name: "No job here" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to the start" })).toBeVisible();
});
