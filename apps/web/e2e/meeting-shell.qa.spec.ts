import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { applyEvent, handleCommand, privateTo, viewFor, type GameState, type PlayerCommand, type SystemCommand } from "@skimjob/engine";
import { createGame } from "../src/game/deal.testkit";
import { startGame, settle } from "./setupGame";

// QA (PR #218, S4.8, after #200): the vote window, the Bail prompt and the result card inside the GameShell. A bot game can't be steered into "you are the
// target and hold a Bail", so the game's socket is mocked with a real engine view of that state (design §9.6, §17.4);
// the page, the shell and the access check are the real ones. QA_SHOTS=… saves qa218-shell-*.png.
const DIR = process.env.QA_SHOTS;
const WIDTHS = [360, 768, 1280] as const;
const NAMES = ["Maximiliana Wolfeschlege", "Christopher Montgomeryyy", "Bot Cy", "Bot Dee", "Bot Eve", "Bot Fox"];
const players = NAMES.map((name, i) => ({ id: `p${i + 1}`, name, isBot: i > 1 }));

function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}

/** Round 1's result window, before anyone calls a meeting. */
function resultWindow(): GameState {
  const s: GameState = { ...createGame({ seed: "qa218-shell", players, job: "bank", eventsEnabled: false, voteVisibility: "open" }), shop: ["bail", "tail", "softShoes"] as GameState["shop"] };
  return run(s, { type: "advance", deadline: { kind: "round", round: 1 } });
}

/** A bell rang in round 1, so the bell lesson (design §15.6) is due in its result window. */
const rang = (s: GameState): GameState =>
  applyEvent(s, { type: "bellsRung", visibility: { kind: "public" }, round: 1, bells: { vault: 2, lobby: 0, security: 0, rooftop: 0, office: 0 }, hidden: [] } as never);

/** p1 holds a Bail; p3 calls an emergency in round 1's result window and the crew votes p1 out (open: the vote is still on). */
function deciding(resolved: boolean, open = false, bell = false): GameState {
  let s: GameState = { ...createGame({ seed: "qa218-shell", players, job: "bank", eventsEnabled: false, voteVisibility: "open" }), shop: ["bail", "tail", "softShoes"] as GameState["shop"] };
  s = applyEvent(s, { type: "perkBought", visibility: privateTo("p1"), player: "p1", round: 1, perk: { kind: "bail" }, cost: 0 });
  s = run(s, { type: "advance", deadline: { kind: "round", round: 1 } });
  if (bell) s = rang(s);
  s = run(s, { type: "callEmergency", player: "p3" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-1" } });
  for (const p of players.slice(1)) s = run(s, { type: "castVote", player: p.id, vote: { kind: "shakedown", target: "p1" } });
  if (open) return s;
  s = run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-1" } });
  if (resolved) s = run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "emergency-1" } });
  return s;
}

/** Opens the real game page with its socket answered by `viewFor(state, me)`; the returned function pushes a later state. */
async function open(page: Page, state: GameState, me: string, tips = false): Promise<(next: GameState) => void> {
  const game = await startGame(page.request, { bots: 5, nickname: NAMES[0]!, tips });
  let push: (next: GameState) => void = () => {};
  await page.routeWebSocket(/\/api\/games\/.*\/ws$/, (ws) => {
    ws.onMessage(() => {}); // commands are not answered
    push = (next) => ws.send(JSON.stringify({ view: viewFor(next, me), timers: [], now: Date.now() }));
    push(state);
  });
  await page.goto(`/game/${game.id}`);
  return (next) => push(next);
}

async function widths(page: Page, name: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${name} at ${width}: overflow`).toBeLessThanOrEqual(0);
    if (DIR) {
      mkdirSync(DIR, { recursive: true });
      await page.screenshot({ path: `${DIR}/qa218-shell-${name}-${width}.png` });
    }
  }
}

const bail = (page: Page) => page.getByRole("group", { name: "Your Bail choice" });

test.describe("QA #218 the vote window, the Bail prompt and the result card in the GameShell @meeting", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "widths set by hand"));

  for (const width of WIDTHS)
    test(`a meeting opens while you look at the board at ${width}: the vote window opens by itself (design §9.4, §11.2)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const push = await open(page, resultWindow(), "p1");
      await expect(page.getByRole("heading", { name: "Shakedown pending" }).or(page.locator(".hud")).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500); // sleep: lets the pushed state propagate through the poll
      push(deciding(false, true));
      await page.waitForTimeout(1_500); // sleep: lets the pushed state propagate through the poll
      if (DIR) await page.screenshot({ path: `${DIR}/qa218-shell-vote-opens-${width}.png` });
      await expect(page.getByRole("dialog", { name: "Who's skimming?" })).toBeVisible();
    });

  for (const width of WIDTHS)
    test(`the vote closes against you at ${width}: the round panel opens on the Bail prompt, and a toast`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const push = await open(page, deciding(false, true), "p1");
      await expect(page.getByRole("dialog", { name: "Who's skimming?" })).toBeVisible({ timeout: 15_000 });
      await page.getByRole("dialog", { name: "Who's skimming?" }).getByRole("button", { name: "Back to the board" }).click();
      push(deciding(false));
      await expect(bail(page)).toBeInViewport({ timeout: 10_000 });
      await settle(page);
      if (DIR) await page.screenshot({ path: `${DIR}/qa218-shell-bail-live-${width}.png` });
      // design §17.4: the holder is told as the window opens (dev StrictMode runs the effect twice, so no exact count here).
      await expect(page.locator(".toasts").getByText("The crew voted to shake you down").first()).toBeVisible();
    });

  test("the target sees it in the round panel, at every width", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page, deciding(false), "p1");
    const panel = page.getByRole("region", { name: "The crew is deciding…" });
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(bail(page)).toBeVisible();
    await expect(bail(page)).toContainText("Use your Bail?");
    await widths(page, "bail");
    // Each touch target ≥ 44 px.
    for (const b of await bail(page).getByRole("button").all()) {
      const box = (await b.boundingBox())!;
      expect(Math.min(box.width, box.height), await b.innerText()).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
  });

  test("anyone else in the same window: no Bail prompt", async ({ page }) => {
    await open(page, deciding(false), "p2");
    await expect(page.getByRole("region", { name: "The crew is deciding…" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Bail/)).toHaveCount(0);
  });

  test("the target after the stash opens: no Bail prompt, the result card instead", async ({ page }) => {
    await open(page, deciding(true), "p1");
    const card = page.getByRole("dialog", { name: /shaken down|fell through|No majority|Too few votes/ });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("region", { name: "The crew is deciding…" })).toHaveCount(0);
    await expect(bail(page)).toHaveCount(0);
    await widths(page, "bail-after");
  });

  // design §20.6: one sheet at a time. An open tip steps aside for the vote window, waits behind the result card, and comes back unchanged.
  for (const width of [390, 1280])
    test(`a tip steps aside for a meeting and waits behind its result card at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const tip = page.locator("dialog[open]").filter({ has: page.locator("#teaching-h") });
      const vote = page.getByRole("dialog", { name: "Who's skimming?" });
      const card = page.getByRole("dialog", { name: /shaken down|fell through|No majority|Too few votes/ });
      const snap = async (name: string) => {
        await settle(page);
        if (DIR) await page.screenshot({ path: `${DIR}/qa218-teach-${name}-${width}.png` });
      };
      const push = await open(page, rang(resultWindow()), "p1", true);
      await expect(tip).toBeVisible({ timeout: 15_000 });
      const title = (await tip.locator("#teaching-h").textContent())!.trim();
      await snap("tip");
      push(deciding(false, true, true));
      await expect(vote).toBeVisible({ timeout: 10_000 });
      await expect(tip).toHaveCount(0);
      await snap("vote");
      push(deciding(true, false, true));
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(tip).toHaveCount(0);
      expect(await page.locator("dialog[open]:not(.bsheet)").count(), "one sheet at a time (a phone panel sheet is not a sheet over the board)").toBe(1);
      await snap("card");
      await card.getByRole("button", { name: "Back to the bank" }).click();
      await expect(tip).toBeVisible({ timeout: 10_000 });
      await expect(tip.locator("#teaching-h")).toHaveText(title); // the same lesson, not the newer shakedown one
      await snap("tip-back");
    });
});
