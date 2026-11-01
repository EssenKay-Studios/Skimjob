import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// Several browsers and a server share the machine: allow for slow round trips.
const expect = baseExpect.configure({ timeout: 15_000 });

// M2-8b acceptance (docs/m2-plan.md M2-8): three players in their own browser
// contexts. Crew messages reach everyone as plain text, a DM reaches only its
// two players, and the third sees just the notice ("Host is DMing Guest 1").
// Evidence cards, the length and rate limits, reconnects and the read marks too.
// Runs in both projects: 390 px (the chat is a sheet behind a button) and
// 1280 px (a side panel).

async function player(browser: Browser, page: Page) {
  const ctx = await browser.newContext({ viewport: page.viewportSize()! });
  return ctx.newPage();
}

/** Opens the chat sheet on narrow screens (on wide ones the panel is always there). */
async function openChat(page: Page) {
  const fab = page.locator(".chat-fab");
  const region = page.getByRole("region", { name: "Chat" });
  await expect(fab.or(region)).toBeVisible(); // the game has loaded
  if (await fab.isVisible()) await fab.click();
  await expect(region).toBeVisible();
}

const feed = (page: Page) => page.locator(".chat__feed");
const composer = (page: Page) => page.locator(".chat__input");
async function say(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer(page)).toHaveValue("");
}

test("crew chat reaches everyone; a DM reaches only its two players", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const guest1 = await player(browser, page);
  const guest2 = await player(browser, page);
  for (const p of [page, guest1, guest2]) p.on("pageerror", (e) => errors.push(e.message));
  // One-week preset: nothing moves on while we talk.
  const game = await startGame(page.request, { bots: 1, guests: [guest1.request, guest2.request], sessionLength: "1w" });
  for (const p of [page, guest1, guest2]) {
    await p.goto(`/game/${game.id}`);
    await expect(p.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
  }

  // Unread before opening: the phone button counts it.
  await openChat(page);
  await say(page, "Hi crew <b>not bold</b> **not bold either**");
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  if (!wide) await expect(guest1.locator(".chat-fab")).toHaveAccessibleName("Open chat, 1 unread");

  // Crew message: everyone sees it, as text.
  for (const p of [guest1, guest2]) {
    await openChat(p);
    await expect(feed(p)).toContainText("Hi crew <b>not bold</b> **not bold either**");
    await expect(feed(p).locator("b, strong")).toHaveCount(0);
  }
  await say(guest1, "Hey Host");
  await expect(feed(page)).toContainText("Hey Host");
  await expect(feed(guest2)).toContainText("Hey Host");

  // The host DMs Guest 1 by picking them.
  await page.getByRole("button", { name: "DM", exact: true }).click();
  const picker = page.getByRole("group", { name: "Message a player privately" });
  await expect(picker.getByRole("button")).toHaveCount(2); // the two guests; never the bot
  await picker.getByRole("button", { name: /Guest 1/ }).click();
  await expect(page.locator(".chat__note")).toContainText("Only you and Guest 1");
  await say(page, "Psst: Vault in round 2, keep it quiet");
  await expect(feed(page)).toContainText("Psst: Vault in round 2");
  await expect(feed(guest2)).toContainText("Host is DMing Guest 1");

  // Guest 1: a DM tab with an unread badge, then the message.
  const tab = guest1.getByRole("group", { name: "Conversations" }).getByRole("button", { name: /^Host \(direct message\), 1 unread/ });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(feed(guest1)).toContainText("Psst: Vault in round 2");
  await say(guest1, "Deal.");
  await expect(feed(page)).toContainText("Deal.");

  // Guest 2: only that a DM happened, never what, and no DM tab.
  // One way, then both ways (a run of notices for the same two folds into one row).
  await expect(feed(guest2)).toContainText(/Host and Guest 1 are DMing ×2/);
  await expect(guest2.getByRole("group", { name: "Conversations" }).getByRole("button", { name: /Host|Guest 1/ })).toHaveCount(0);
  await expect(guest2.locator("body")).not.toContainText("Psst");
  await expect(guest2.locator("body")).not.toContainText("Deal.");

  // Evidence card: the host shares a case-file entry to the crew.
  await page.getByRole("group", { name: "Conversations" }).getByRole("button", { name: /^Crew/ }).click();
  await page.getByRole("button", { name: "Share evidence" }).click();
  await page.getByRole("group", { name: "Share a case-file entry" }).getByRole("button").first().click();
  const card = guest2.getByRole("group", { name: "Evidence card, verified" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Cameras can be tampered with.");

  // After a reload (history on reconnect): the same, and still no DM for Guest 2.
  await guest2.reload();
  await openChat(guest2);
  await expect(feed(guest2)).toContainText("Hey Host");
  await expect(feed(guest2)).toContainText(/Host and Guest 1 are DMing/);
  await expect(guest2.locator("body")).not.toContainText("Psst");
  await guest1.reload();
  await openChat(guest1);
  await guest1.getByRole("group", { name: "Conversations" }).getByRole("button", { name: /^Host/ }).click();
  await expect(feed(guest1)).toContainText("Psst: Vault in round 2");

  expect(errors).toEqual([]);
  await guest1.context().close();
  await guest2.context().close();
});

test("the composer explains the length and rate limits", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const guest = await player(browser, page);
  const game = await startGame(page.request, { bots: 1, guests: [guest.request], sessionLength: "1w" });
  // A fixed clock in the page (timers still run): the eight messages land in one rate window however slow the machine is.
  const t0 = Date.parse("2026-11-02T12:00:00Z");
  await page.clock.setFixedTime(t0);
  await page.goto(`/game/${game.id}`);
  await openChat(page);
  const send = page.getByRole("button", { name: "Send", exact: true });
  const status = page.locator(".chat__status");

  await composer(page).fill("x".repeat(420));
  await expect(status).toContainText("420/500");
  await expect(send).toBeEnabled();
  await composer(page).fill("x".repeat(503));
  await expect(status).toContainText("Too long by 3");
  await expect(send).toBeDisabled();

  // Eight in ten seconds is the server's limit: the ninth waits.
  for (let i = 1; i <= 8; i++) await say(page, `spam ${i}`);
  await composer(page).fill("one more");
  await expect(status).toContainText(/Slow down: 8 messages per 10 s\. Send again in 10 s\./);
  await expect(send).toBeDisabled();
  await page.clock.setFixedTime(t0 + 10_500);
  await expect(send).toBeEnabled();
  await expect(status).not.toContainText(/Slow down/);
  await guest.context().close();
});

test("a dropped connection says so and catches up on reconnect", async ({ page, browser }) => {
  test.setTimeout(90_000);
  // Lets the test drop the game socket and hold off reconnects.
  await page.addInitScript(() => {
    const Real = window.WebSocket;
    const w = window as unknown as { __ws: WebSocket[]; __blockWs: boolean };
    w.__ws = [];
    w.__blockWs = false;
    window.WebSocket = class extends Real {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(w.__blockWs ? String(url).replace(/\/ws$/, "/ws-blocked") : url, protocols);
        w.__ws.push(this);
      }
    } as typeof WebSocket;
  });
  const guest = await player(browser, page);
  const game = await startGame(page.request, { bots: 1, guests: [guest.request], sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  await guest.goto(`/game/${game.id}`);
  await openChat(page);
  await openChat(guest);
  await expect(page.locator(".chat__empty")).toContainText("No messages yet");

  await page.evaluate(() => {
    const w = window as unknown as { __ws: WebSocket[]; __blockWs: boolean };
    w.__blockWs = true;
    w.__ws.at(-1)?.close();
  });
  await expect(page.locator(".chat__conn")).toContainText("Connection lost");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await say(guest, "While you were out");

  await page.evaluate(() => {
    (window as unknown as { __blockWs: boolean }).__blockWs = false;
    window.dispatchEvent(new Event("online")); // reconnect now rather than after the backoff
  });
  await expect(feed(page)).toContainText("While you were out", { timeout: 20_000 });
  await expect(page.locator(".chat__conn")).toHaveCount(0);
  await guest.context().close();
});
