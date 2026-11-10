// Starts a game through the lobby API (M2-2) from inside a browser context, so
// the context's cookie is the host's session. The lobby screens (M2-5b) do the
// same with clicks; the game screen tests only need a started game.
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { clearMeeting } from "./meetingCards";

export interface StartedGame {
  readonly id: string;
  readonly inviteCode: string;
}

async function ok<T>(res: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/**
 * Signs `host` in as a guest, creates a game, seats `guests` (each signed in
 * through the invite) and `bots` bots, and starts it. Tips are switched off for
 * every human (unless `tips`), so a teaching pop-up (design §15.6) never covers
 * the board mid-test; teaching.spec.ts turns them on. `seed` names the game's
 * seed (the E2E server takes it), so a spec that needs one course of play replays it.
 */
export async function startGame(
  host: APIRequestContext,
  {
    bots,
    guests = [],
    sessionLength = "15m",
    nickname = "Host",
    voteVisibility,
    tips = false,
    seed,
  }: {
    bots: number;
    guests?: readonly APIRequestContext[];
    sessionLength?: string;
    nickname?: string;
    voteVisibility?: "hiddenThenRevealed" | "open" | "secret";
    tips?: boolean;
    seed?: string;
  },
): Promise<StartedGame> {
  await ok(await host.post("/api/auth/guest", { data: { nickname } }));
  const settings = { sessionLength, ...(voteVisibility && { voteVisibility }) };
  const game = await ok<StartedGame>(await host.post("/api/games", { data: { settings } }));
  for (const [i, g] of guests.entries()) await ok(await g.post(`/api/invites/${game.inviteCode}/join`, { data: { nickname: `Guest ${i + 1}` } }));
  if (!tips) for (const who of [host, ...guests]) await ok(await who.patch("/api/me", { data: { tips: false } }));
  for (let i = 0; i < bots; i++) await ok(await host.post(`/api/games/${game.id}/bots`, { data: {} }));
  await ok(await host.post(`/api/games/${game.id}/start`, { data: seed ? { seed } : {} }));
  return game;
}

/**
 * Waits for a round's result window and spends the crew's emergency (design
 * §9.3): the button only works between a round's result and the next planning;
 * it arms, then calls.
 */
export async function callEmergency(page: Page): Promise<void> {
  await clearMeeting(page); // an automatic meeting's result card (a third of the bank gone, a raid) would cover the button
  const call = page.getByRole("button", { name: "Call an emergency meeting" });
  await expect(call).toBeEnabled({ timeout: 60_000 });
  await call.click();
  await page.getByRole("button", { name: "Sure? Tap again to call it" }).click();
}

/** design §15.4: the live case board with every lead opened, so each fact shows ("<trust> <line>"). */
export async function openLeads(page: Page): Promise<Locator> {
  const leads = page.getByRole("region", { name: "Case board" }).getByRole("group", { name: "Leads" });
  const closed = leads.locator('.cb__lead-btn[aria-expanded="false"]');
  while ((await closed.count()) > 0) await closed.first().click();
  return leads;
}

export type PanelName = "Crew" | "Case" | "Notes" | "Chat" | "This round" | "The result";

/** The game shell's laptop layout (three columns) starts at 1024 px; below it the panels are bottom sheets. */
export const isWide = (page: Page): boolean => (page.viewportSize()?.width ?? 0) >= 1024;

/**
 * Brings a game panel on screen. Laptops: "Crew", "Case", "Notes" and "Chat" are side tabs, "This round" and
 * "The result" are always there. Below 1024 px: opens its bottom sheet from the tab bar (and closes another
 * sheet that is open). Safe to call twice.
 */
export async function openPanel(page: Page, name: PanelName): Promise<void> {
  const button = new RegExp(`^${name}\\b`);
  if (isWide(page)) {
    if (name !== "This round" && name !== "The result") await page.getByRole("group", { name: "Side panel" }).getByRole("button", { name: button }).click();
    return;
  }
  const sheet = page.locator("dialog.bsheet[open]");
  if (await sheet.count()) {
    if ((await sheet.locator(".bsheet__head h2").textContent()) === name) return;
    await closePanel(page);
  }
  await page.getByRole("navigation", { name: "Game panels" }).getByRole("button", { name: button }).click();
  await expect(sheet.locator(".bsheet__head h2")).toHaveText(name);
  // Read it once it has slid up, as a player does: mid-slide its fractional offset measures a 44 px target as 43.99997 px.
  await sheet.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
}

/** Closes the open bottom sheet, if any, with its close button (Esc is tested on its own; a text field in the sheet may take it). */
export async function closePanel(page: Page): Promise<void> {
  const sheet = page.locator("dialog.bsheet[open]");
  if (!(await sheet.count())) return;
  await sheet.locator(".bsheet__close").click();
  await expect(sheet).toHaveCount(0);
}

/** The tab that opens the chat: a button in the phone tab bar, a side tab from 1024 px. Its name carries the unread count ("Chat, 3 new"). */
export function chatTab(page: Page): Locator {
  const group = isWide(page) ? page.getByRole("group", { name: "Side panel" }) : page.getByRole("navigation", { name: "Game panels" });
  return group.getByRole("button", { name: /^Chat/ });
}

/** Opens the chat (waits for the game to have loaded first). */
export async function openChat(page: Page): Promise<void> {
  await expect(chatTab(page)).toBeVisible();
  await openPanel(page, "Chat");
  await expect(page.getByRole("region", { name: "Chat" })).toBeVisible();
}

/** Takes the chat off screen: closes its sheet, or switches the side tab back to "Crew". Its messages stop counting as read. */
export async function closeChat(page: Page): Promise<void> {
  if (isWide(page)) await openPanel(page, "Crew");
  else await closePanel(page);
}

/** What shows that the game is over: from 1024 px the final ranking, below it the "The result" tab (the ranking is in its sheet). */
export function gameOver(page: Page): Locator {
  return isWide(page) ? page.getByRole("list", { name: /Final ranking/ }) : page.getByRole("navigation", { name: "Game panels" }).getByRole("button", { name: /^The result/ });
}

/** Waits for the game to end, then brings the result panel on screen. */
export async function showResult(page: Page, timeout?: number): Promise<void> {
  await expect(gameOver(page)).toBeVisible(timeout === undefined ? {} : { timeout });
  await openPanel(page, "The result");
  await expect(page.getByRole("list", { name: /Final ranking/ })).toBeVisible();
}

/**
 * For a loop that plays a whole game: below 1024 px keeps the "This round" sheet (move panel, alibis, "The result")
 * open, as one tap on the tab bar when it isn't (nothing happens while another dialog, the vote window, is open).
 */
export async function keepRoundOpen(page: Page): Promise<void> {
  if (isWide(page) || (await page.locator("dialog[open]").count())) return;
  await page
    .getByRole("navigation", { name: "Game panels" })
    .getByRole("button", { name: /^(This round|The result)/ })
    .click({ timeout: 1000 })
    .catch(() => {});
}

/** The final ranking in the "The result" panel keeps each row readable: a name and a role stay on one line (no letter-per-line wrapping) and nothing leaves the panel. */
export async function expectRankingReadable(page: Page): Promise<void> {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    const panel = document.querySelector(".ranking")?.closest("section, dialog, aside, div.shell__right")?.getBoundingClientRect();
    for (const row of document.querySelectorAll<HTMLElement>(".ranking__row")) {
      const r = row.getBoundingClientRect();
      if (panel && (r.left < panel.left - 1 || r.right > panel.right + 1)) out.push(`row leaves its panel: ${row.textContent}`);
      for (const el of row.querySelectorAll<HTMLElement>(".ranking__who *, .ranking__score *")) {
        const text = el.textContent?.trim() ?? "";
        if (el.children.length || text.length === 0 || text.length > 16) continue; // short words only: a 24-character name may wrap
        const range = document.createRange();
        range.selectNodeContents(el);
        const lines = new Set([...range.getClientRects()].map((q) => Math.round(q.top)));
        if (lines.size > 1) out.push(`"${text}" wraps onto ${lines.size} lines`);
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
}
