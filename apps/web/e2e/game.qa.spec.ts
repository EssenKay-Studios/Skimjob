// QA for M2-6 (PR #31): the game screen under abuse. Full Quick games with 12
// seats and 24-character names at 390×844 touch and 1280×800; reloads mid-round
// and mid-alibi window; a killed socket; a client clock an hour off; an alibi
// posted after its window closed; and nothing on screen giving away another
// player's hidden move, split, role or "submitted" status.
import { mkdirSync } from "node:fs";
import { expect, test, type APIRequestContext, type Browser, type Page, type WebSocketRoute } from "@playwright/test";

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
        if (/inside man|security chief|role|stash|pocket|\d+ loot/i.test(seat.textContent ?? "")) out.push(`seat text: ${seat.textContent}`);
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

test("12 seats, 24-char names: a Quick game to the end with moves changed, alibis, no leaks, no overflow @fast-clock", async ({ browser }, info) => {
  test.setTimeout(420_000);
  const mobile = info.project.name.startsWith("mobile");
  const { hostCtx, guestCtx, host, guest } = await contexts(browser, mobile);
  const errors: string[] = [];
  for (const p of [host, guest]) p.on("pageerror", (e) => errors.push(e.message));
  const game = await start(host.request, guest.request, 10, "quick");
  await host.goto(`/game/${game.id}`);
  await guest.goto(`/game/${game.id}`);
  await expect(host.locator(".crew-seat")).toHaveCount(12);

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
  let changed = 0;
  let alibis = 0;
  let round = 0;
  const post = host.getByRole("button", { name: "Post alibi" });
  while (!(await over.isVisible())) {
    const heading = await host.locator("#move-h").textContent({ timeout: 200 }).catch(() => null);
    const lock = host.getByRole("button", { name: /Lock it in|Update move/ });
    if (heading && (await lock.isVisible().catch(() => false))) {
      const r = Number(/Round (\d+)/.exec(heading)?.[1] ?? 0);
      if (r !== round) {
        round = r;
        if (r > 1) await once("missed-or-move", host);
        // Vault, pocket what the slider allows, lock; then change to the Office.
        await tap(host, host.locator('.room-tile[data-room="Vault"]')).catch(() => {});
        await host.locator("#split").fill("1", { timeout: 500 }).catch(() => {});
        await once("move-picked", host);
        if (await lock.isEnabled({ timeout: 500 }).catch(() => false)) await tap(host, lock).catch(() => {});
        await once("locked", host);
        for (const x of await leaks(guest)) leaked.add(`round ${r}: ${x}`);
        await once("guest-view", guest);
        await tap(host, host.locator('.room-tile[data-room="Office"]')).catch(() => {});
        const upd = host.getByRole("button", { name: "Update move" });
        if (await upd.isEnabled({ timeout: 500 }).catch(() => false)) await tap(host, upd).then(() => changed++, () => {});
        // The guest locks in on even rounds only (odd rounds: missed deadline).
        if (r % 2 === 0) {
          await tap(guest, guest.locator('.room-tile[data-room="Lobby"]')).catch(() => {});
          await tap(guest, guest.getByRole("button", { name: "Lock it in" })).catch(() => {});
          for (const x of await leaks(host)) leaked.add(`host sees guest round ${r}: ${x}`);
        }
      }
    }
    // At the fast clock an alibi window is under a second: act first, check the
    // layout after. Until one alibi is in, tap straight away; the open panel is
    // checked on a later window, once the count no longer depends on it.
    if (await post.isVisible().catch(() => false)) {
      if (alibis > 0) await once("alibi-open", host);
      await tap(host, host.getByRole("group", { name: "Alibi room" }).getByRole("button", { name: "Vault" })).catch(() => {});
      await tap(host, post).then(() => alibis++, () => {});
      await once("alibi-posted", host);
    }
    if (await host.locator(".panel[aria-live=polite]").isVisible().catch(() => false)) await once("waiting", host);
    // Wake as soon as an alibi window opens rather than on a fixed 120 ms tick.
    await post.waitFor({ state: "visible", timeout: 120 }).catch(() => {});
  }
  await expect(over.locator(".ranking__row")).toHaveCount(12);
  await expect(host.locator(".over__stamp")).toHaveText(/JOB DONE|BUSTED/);
  await once("over", host);
  await once("over-guest", guest);
  await guest.getByRole("button", { name: /Case file/ }).click();
  await expect(guest.getByRole("list", { name: "Case file" })).toContainText("You missed round 1's deadline");
  await once("over-guest-casefile", guest);

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
const ledgerRows = (p: Page) => p.getByRole("list", { name: "Ledger" }).locator(".records__row").allTextContents();

test("reloads, a killed socket, a skewed clock and a late alibi (3h preset: 102 s rounds, 6 s alibi window)", async ({ browser }, info) => {
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
  await host.routeWebSocket(/\/api\/games\//, (ws) => {
    routes.push(ws);
    const server = ws.connectToServer();
    server.onMessage((m) => {
      if (freeze && typeof m === "string" && m.startsWith('{"view"')) return;
      ws.send(m);
    });
  });
  const game = await start(host.request, guest.request, 3, "3h");
  await host.goto(`/game/${game.id}`);
  await guest.goto(`/game/${game.id}`);
  await expect(host.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();

  // Lock in, then reload mid-round: the move is still there.
  await host.locator('.room-tile[data-room="Vault"]').click();
  const split = host.locator("#split");
  if (await split.isVisible()) await split.fill("3");
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

  // Kill the socket: banner, reconnect, and the ledger matches a fresh load (no duplicates).
  const ledger0 = await ledgerRows(host);
  routes.at(-1)!.close({ code: 4000, reason: "qa kill" });
  await expect(host.getByText("Reconnecting…")).toBeVisible();
  await shot(host, "reconnecting");
  await expect(host.getByText("Reconnecting…")).toBeHidden({ timeout: 15_000 });
  const ledger1 = await ledgerRows(host);
  expect(ledger1).toEqual(ledger0);
  const count = Number(/\d+/.exec((await host.getByRole("button", { name: /Ledger/ }).textContent()) ?? "")?.[0]);
  expect(ledger1.filter((t) => t !== "Nothing yet.").length).toBe(count);
  await expect(status).toHaveText(before!);

  // Round 1 resolves (≈102 s). The guest reloads mid-alibi window and the panel comes back.
  await expect(guest.getByRole("button", { name: "Post alibi" })).toBeVisible({ timeout: 150_000 });
  freeze = true; // the host's screen now keeps the open window
  await guest.reload();
  await expect(guest.getByRole("button", { name: "Post alibi" })).toBeVisible({ timeout: 4000 });
  await guest.getByRole("group", { name: "Alibi room" }).getByRole("button", { name: "Lobby" }).click();
  await guest.getByRole("button", { name: "Post alibi" }).click();
  await expect(guest.getByText("You told the crew you were in the")).toBeVisible();
  await shot(guest, "alibi-posted-after-reload");

  // The host posts after the window closed (their screen is stale): refused, with a readable reason.
  await expect(guest.getByRole("heading", { name: "Round 2 · Pick your room", level: 2 })).toBeVisible({ timeout: 15_000 });
  await host.getByRole("group", { name: "Alibi room" }).getByRole("button", { name: "Office" }).click();
  await host.getByRole("button", { name: "Post alibi" }).click();
  const toast = host.locator(".toast").filter({ hasText: /closed/i });
  await expect(toast).toBeVisible();
  const text = (await toast.textContent()) ?? "";
  expect(text, "refusal reads as a sentence, no raw error").not.toMatch(/error|undefined|\{|rejected/i);
  await shot(host, "alibi-refused");
  freeze = false;
  await host.reload();
  await expect(host.getByRole("heading", { name: "Round 2 · Pick your room", level: 2 })).toBeVisible();
  await expect(host.getByRole("list", { name: "Ledger" })).not.toContainText("You say you were in the Office");
  await hostCtx.close();
  await guestCtx.close();
});
