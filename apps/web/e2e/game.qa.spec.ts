// QA for M2-6 (PR #31): the game screen under abuse. Full 15-min games with 12
// seats and 24-character names at 390×844 touch and 1280×800; reloads mid-round
// and between rounds; a killed socket; a client clock an hour off; an alibi
// posted from a stale screen (alibis have no window); and nothing on screen giving away another
// player's hidden move, split, role or "submitted" status.
import { mkdirSync } from "node:fs";
import { closePanel, gameOver, keepRoundOpen, openPanel, showResult } from "./setupGame";
import { expect, test, type APIRequestContext, type Browser, type Page, type WebSocketRoute } from "@playwright/test";
import { openLeads } from "./setupGame";
import { bagCoins, pickOtherRoom, pickRoom } from "./move";

const SHOTS = process.env.SHOTS_DIR;
const LONG_HOST = "WWWWWWWWWWWWWWWWWWWWWWWW"; // 24, the cap; the widest glyph, no break points
const LONG_GUEST = "Maximiliana Wolfensteins"; // 24

async function ok<T>(res: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function start(host: APIRequestContext, guest: APIRequestContext, bots: number, sessionLength: string) {
  await ok(await host.post("/api/auth/guest", { data: { nickname: LONG_HOST } }));
  const game = await ok<{ id: string; inviteCode: string }>(await host.post("/api/games", { data: { settings: { sessionLength } } }));
  await ok(await guest.post(`/api/invites/${game.inviteCode}/join`, { data: { nickname: LONG_GUEST } }));
  for (let i = 0; i < bots; i++) await ok(await host.post(`/api/games/${game.id}/bots`, { data: {} }));
  await ok(await host.post(`/api/games/${game.id}/start`, { data: {} }));
  // No teaching pop-up (design §15.6) over the board.
  for (const who of [host, guest]) await ok(await who.patch("/api/me", { data: { tips: false } }));
  return game;
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/qa-game-${name}-${page.viewportSize()!.width}.png`, fullPage: true }).catch(() => {});
}

/** Horizontal overflow and visible targets under 44 px. */
async function layoutProblems(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const out: string[] = [];
      const d = document.documentElement;
      if (d.scrollWidth > d.clientWidth) out.push(`overflow ${d.scrollWidth} > ${d.clientWidth}`);
      // Layout boxes are whole 1/64 px, but under a transformed ancestor (a
      // sheet's slide-in) Chromium maps the rect in float32: a 44 px button
      // reads 43.999996. Compare at layout precision; print two decimals so a
      // real 43.9 is not shown as 44.
      const px = (v: number) => Math.round(v * 64) / 64;
      for (const el of document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [role=button]")) {
        const r = el.getBoundingClientRect();
        const w = px(r.width);
        const h = px(r.height);
        if (w > 0 && (w < 44 || h < 44)) out.push(`target "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim()}" ${w.toFixed(2)}x${h.toFixed(2)}`);
      }
      // Text spilling out of a seat (the long names).
      for (const el of document.querySelectorAll<HTMLElement>(".crew-seat__name, .ranking__who")) if (el.scrollWidth > el.clientWidth + 1) out.push(`clipped "${el.textContent}"`);
      return out;
    })
    .catch(() => []);
}

/** What another player's seat and the guest's screen may not show before the reveal. */
async function leaks(guest: Page): Promise<string[]> {
  return guest
    .evaluate(() => {
      const out: string[] = [];
      for (const seat of document.querySelectorAll(".crew-seat:not(.is-you)")) {
        // Who has locked in is public (owner decision, 2 Nov); the room and split never are.
        if (/security chief|role|stash|pocket|\d+ loot/i.test(seat.textContent ?? "")) out.push(`seat text: ${seat.textContent}`);
        const title = seat.querySelector("[title]")?.getAttribute("title") ?? "";
        if (/pocket|loot|stash/i.test(title)) out.push(`seat title: ${title}`);
      }
      return out;
    })
    .catch(() => []);
}

async function contexts(browser: Browser, mobile: boolean) {
  const opts = mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 800 } };
  const hostCtx = await browser.newContext(opts);
  const guestCtx = await browser.newContext(opts);
  return { hostCtx, guestCtx, host: await hostCtx.newPage(), guest: await guestCtx.newPage() };
}

test("12 seats, 24-char names: a 15-min game to the end with moves changed, alibis, no leaks, no overflow @fast-clock @move", async ({ browser }, info) => {
  test.setTimeout(420_000);
  const mobile = info.project.name.startsWith("mobile");
  const { hostCtx, guestCtx, host, guest } = await contexts(browser, mobile);
  const errors: string[] = [];
  for (const p of [host, guest]) p.on("pageerror", (e) => errors.push(e.message));
  const game = await start(host.request, guest.request, 10, "15m");
  // At the fast clock a round is 3.75 s and a result window 1 s (× 0.05): under
  // CI load a round of taps outlasts them, so the test could miss them all. Until
  // the host has changed a move, and then posted an alibi, it pauses the game from
  // the push that opens the phase it needs (between rounds for the alibi panel; a pause stops every deadline and players
  // can still plan and post, design §15) and resumes once that is done. Both steps
  // are counted from the host's own view, not from a tap's promise: under load a
  // tap can time out after its click went through.
  let changed = 0; // rounds where the host resubmitted its move (design §5.1)
  let alibis = 0; // alibis the host posted (design §11.3)
  let phase = "";
  const holding = () => (phase === "planning" && changed === 0) || ((phase === "result" || phase === "awaitingMeeting") && alibis === 0);
  let pausing: ReturnType<APIRequestContext["post"]> | null = null;
  let pausedAt = 0;
  type Logged = { event: { type: string; player?: string; round?: number; statement?: { kind: string; player?: string } } };
  host.on("websocket", (ws) =>
    ws.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string" || !payload.startsWith('{"view"')) return;
      const { view } = JSON.parse(payload) as { view: { phase: { kind: string }; me: { id: string }; ledger: Logged[]; caseFile: Logged[] } };
      const mine = (log: Logged[], type: string) => log.filter(({ event }) => event.type === type && event.player === view.me.id).map(({ event }) => event.round);
      const submitted = mine(view.caseFile, "moveSubmitted");
      phase = view.phase.kind;
      changed = new Set(submitted.filter((r, i) => submitted.indexOf(r) !== i)).size;
      alibis = view.ledger.filter(({ event }) => event.type === "said" && event.statement?.kind === "alibi" && event.statement.player === view.me.id).length;
      if (!holding() || pausing) return;
      pausedAt = Date.now();
      pausing = host.request.post(`/api/games/${game.id}/pause`, { data: {} });
      // Awaited in the loop, where a rejection fails the test; this keeps it from going unhandled first.
      pausing.catch(() => {});
    }),
  );
  await host.goto(`/game/${game.id}`);
  await guest.goto(`/game/${game.id}`);
  await openPanel(host, "Crew");
  await expect(host.locator(".crew-seat")).toHaveCount(12);
  await closePanel(host);

  const tap = (p: Page, sel: ReturnType<Page["locator"]>) => (mobile ? sel.tap({ timeout: 1000 }) : sel.click({ timeout: 1000 }));
  const problems = new Set<string>();
  const leaked = new Set<string>();
  const shots = new Set<string>();
  const once = async (name: string, p: Page) => {
    if (shots.has(name)) return;
    shots.add(name);
    for (const x of await layoutProblems(p)) problems.add(`${name}: ${x}`);
    await shot(p, name);
  };
  const over = host.getByRole("list", { name: "Final ranking" });
  let round = 0;
  const post = host.getByRole("button", { name: "Post alibi" });
  try {
    while (!(await gameOver(host).isVisible())) {
      await keepRoundOpen(host); // below 1024 px the move panel and the alibi panel are in the "This round" sheet
      const heading = await host.locator("#move-h").textContent({ timeout: 200 }).catch(() => null);
      const lock = host.getByRole("button", { name: /Lock it in|Update move/ });
      if (heading && (await host.locator(".move__lock").isVisible().catch(() => false))) {
        const r = Number(/Round (\d+)/.exec(heading)?.[1] ?? 0);
        // Once a round; again until the view shows the change (a tap can still miss).
        if (r !== round || changed === 0) {
          round = r;
          if (r > 1) await once("missed-or-move", host);
          // Vault, pocket what the slider allows, lock; then change to another open room
          // (a Lockdown event can close a room for the round, design §13).
          await pickRoom(host, "Vault", 1000).catch(() => {});
          for (const _ of [1, 2]) await bagCoins(host, "duffel").first().click({ timeout: 500 }).catch(() => {});
          await once("move-picked", host);
          if (await lock.isEnabled({ timeout: 500 }).catch(() => false)) await tap(host, lock).catch(() => {});
          await once("locked", host);
          for (const x of await leaks(guest)) leaked.add(`round ${r}: ${x}`);
          await once("guest-view", guest);
          await pickOtherRoom(host, 1000).catch(() => {});
          const upd = host.getByRole("button", { name: "Update move" });
          if (await upd.isEnabled({ timeout: 500 }).catch(() => false)) await tap(host, upd).catch(() => {});
          // The guest locks in on even rounds only (odd rounds: missed deadline).
          if (r % 2 === 0) {
            await keepRoundOpen(guest);
            await pickRoom(guest, "Lobby", 1000).catch(() => {});
            await tap(guest, guest.getByRole("button", { name: "Lock it in" })).catch(() => {});
            for (const x of await leaks(host)) leaked.add(`host sees guest round ${r}: ${x}`);
          }
        }
      }
      // design §9.6: a meeting's result card is a modal over the board until it is closed; both seats close it.
      for (const p of [host, guest]) {
        const card = p.getByRole("button", { name: "Back to the bank" });
        if (await card.isVisible().catch(() => false)) await tap(p, card).catch(() => {});
      }
      if (await post.isVisible().catch(() => false)) {
        await once("alibi-open", host);
        await tap(host, host.getByRole("group", { name: "Alibi room" }).getByRole("button", { name: "Vault" })).catch(() => {});
        await tap(host, post).catch(() => {});
        await once("alibi-posted", host);
      }
      // A step that never lands fails here, readably, instead of holding the game paused.
      if (pausing) expect(Date.now() - pausedAt, `paused in ${phase} with ${changed} changes and ${alibis} alibis`).toBeLessThan(60_000);
      // Resume once the step is done, or at once if the pause landed in another phase.
      if (pausing && !holding()) {
        await ok(await pausing);
        pausing = null;
        await ok(await host.request.post(`/api/games/${game.id}/resume`, { data: {} }));
      }
      if (await host.locator(".panel[aria-live=polite]").isVisible().catch(() => false)) await once("waiting", host);
      // Wake as soon as the alibi panel shows rather than on a fixed 120 ms tick.
      await post.waitFor({ state: "visible", timeout: 120 }).catch(() => {});
    }
  } finally {
    // Never leave the game paused, even when a step above throws (set in the frame handler, so TS can't see it).
    const held = pausing as ReturnType<APIRequestContext["post"]> | null;
    if (held) await held.then(() => host.request.post(`/api/games/${game.id}/resume`, { data: {} })).catch(() => {});
  }
  await showResult(host);
  await expect(over.locator(".ranking__row")).toHaveCount(12);
  await expect(host.locator(".over__stamp")).toHaveText(/JOB DONE|BUSTED/);
  await once("over", host);
  await once("over-guest", guest);
  await showResult(guest);
  await openPanel(guest, "Case");
  await expect(await openLeads(guest)).toContainText("You missed round 1's deadline");

  expect(changed, "moves changed after locking").toBeGreaterThan(0);
  expect(alibis, "alibis posted").toBeGreaterThan(0);
  expect([...leaked]).toEqual([]);
  expect([...problems]).toEqual([]);
  expect(errors).toEqual([]);
  await hostCtx.close();
  await guestCtx.close();
});

const clock = (t: string | null) => {
  const m = /(?:(\d+)h\s*)?(\d+):(\d\d)/.exec(t ?? "");
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
};

test("reloads, a killed socket, a skewed clock and a late alibi (3h preset: 102 s rounds) @move", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one viewport is enough for the channel behaviour");
  test.setTimeout(240_000);
  const { hostCtx, guestCtx, host, guest } = await contexts(browser, false);
  // The guest's clock runs an hour fast; the countdown must still follow the server's.
  await guest.addInitScript(() => {
    const real = Date.now.bind(Date);
    Date.now = () => real() + 3_600_000;
  });
  // The host's game socket goes through a route the test can freeze (drop views) or kill.
  let freeze = false;
  const routes: WebSocketRoute[] = [];
  /** Every entry of each view the host's socket delivered (public and private), by seq. */
  const views: number[][] = [];
  await host.routeWebSocket(/\/api\/games\//, (ws) => {
    routes.push(ws);
    const server = ws.connectToServer();
    server.onMessage((m) => {
      if (freeze && typeof m === "string" && m.startsWith('{"view"')) return;
      if (typeof m === "string" && m.startsWith('{"view"')) {
        const { view } = JSON.parse(m) as { view: { ledger: { seq: number }[]; caseFile: { seq: number }[] } };
        views.push([...view.ledger, ...view.caseFile].map((e) => e.seq));
      }
      ws.send(m);
    });
  });
  const game = await start(host.request, guest.request, 3, "3h");
  await host.goto(`/game/${game.id}`);
  await guest.goto(`/game/${game.id}`);
  await expect(host.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();

  // Lock in, then reload mid-round: the move is still there.
  await pickRoom(host, "Vault");
  await host.getByRole("button", { name: "Lock it in" }).click();
  const status = host.locator(".move__status");
  await expect(status).toContainText("Locked in: Vault");
  const before = await status.textContent();
  await host.reload();
  await expect(status).toHaveText(before!);
  await expect(host.getByRole("button", { name: "Locked in" })).toBeDisabled();
  // The guest sees no sign the host moved.
  expect(await leaks(guest)).toEqual([]);

  // Skew: both countdowns agree within 2 s.
  const hostT = clock(await host.locator(".hud__timer b").textContent());
  const guestT = clock(await guest.locator(".hud__timer b").textContent());
  expect(Number.isNaN(hostT) || Number.isNaN(guestT), `${hostT} ${guestT}`).toBe(false);
  expect(Math.abs(hostT - guestT), `host ${hostT}s, skewed guest ${guestT}s`).toBeLessThanOrEqual(2);
  await shot(guest, "skewed-clock");

  // Kill the socket: banner, reconnect, and the fresh view has every entry once, nothing lost (no duplicates, no gaps).
  const delivered = views.length;
  const entriesBefore = views.at(-1)!.length;
  routes.at(-1)!.close({ code: 4000, reason: "qa kill" });
  await expect(host.getByText("Reconnecting…")).toBeVisible();
  await shot(host, "reconnecting");
  await expect(host.getByText("Reconnecting…")).toBeHidden({ timeout: 15_000 });
  await expect.poll(() => views.length).toBeGreaterThan(delivered);
  const seqs = [...views.at(-1)!].sort((a, b) => a - b);
  expect(seqs).toEqual(seqs.map((_, i) => i));
  expect(seqs.length).toBeGreaterThanOrEqual(entriesBefore);
  await expect(status).toHaveText(before!);

  // Round 1 resolves (≈102 s). The guest reloads between rounds and the alibi panel comes back.
  await expect(guest.getByRole("button", { name: "Post alibi" })).toBeVisible({ timeout: 150_000 });
  freeze = true; // the host's screen now keeps the alibi panel
  await guest.reload();
  await expect(guest.getByRole("button", { name: "Post alibi" })).toBeVisible({ timeout: 4000 });
  await guest.getByRole("group", { name: "Alibi room" }).getByRole("button", { name: "Lobby" }).click();
  await guest.getByRole("button", { name: "Post alibi" }).click();
  await expect(guest.getByText("You told the crew you were in the")).toBeVisible();
  await shot(guest, "alibi-posted-after-reload");

  // The host posts once round 2 is being planned (their screen is stale): alibis have no window, so it is
  // still taken for round 1 (design §11.3, owner 6 Nov). A briefing (after a raid) or the result window may come first (§9.2, §9.3).
  await expect(guest.getByRole("heading", { name: "Round 2 · Pick your room", level: 2 })).toBeVisible({ timeout: 90_000 });
  // The host's screen may have frozen on a meeting's vote: back to the board, where the alibi panel waits.
  const back = host.getByRole("button", { name: "Back to the board" });
  if (await back.isVisible()) await back.click();
  await host.getByRole("group", { name: "Alibi room" }).getByRole("button", { name: "Office" }).click();
  await host.getByRole("button", { name: "Post alibi" }).click();
  await expect(host.locator(".toast").filter({ hasText: "Alibi posted." })).toBeVisible();
  await shot(host, "alibi-late");
  freeze = false;
  await host.reload();
  await expect(host.locator(".hud__kicker")).toBeVisible();
  await hostCtx.close();
  await guestCtx.close();
});
