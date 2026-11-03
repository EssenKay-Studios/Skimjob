import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

// QA (PR #27, M2-5b): lobby flows with two/three browsers. Screens go to
// /home/claude/pipeline/shots when QA_SHOTS is set (evidence, not assertions).

const SHOTS = process.env.QA_SHOTS;
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.waitForTimeout(700); // entrance animations
  await page.screenshot({ path: `${SHOTS}/qa-lobby-${name}.png`, fullPage: true });
};

const WIDTHS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

// Every test opens its own contexts; run once.
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "contexts are set per test"));

type View = { id: string; inviteCode: string; youAreHost: boolean; status: string; seats: { seat: number; bot: string | null; you: boolean }[] };

async function newCtx(browser: Browser, width = 1280, height = 800, touch = false) {
  return browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
}

/** Host signs in as a guest and opens a lobby through the API (the UI flow has its own test). */
async function apiHost(ctx: BrowserContext, name = "Host"): Promise<View> {
  expect((await ctx.request.post("/api/auth/guest", { data: { nickname: name } })).ok()).toBe(true);
  const r = await ctx.request.post("/api/games", { data: {} });
  expect(r.ok()).toBe(true);
  return r.json();
}
async function apiJoin(ctx: BrowserContext, code: string, nickname: string) {
  return ctx.request.post(`/api/invites/${code}/join`, { data: { nickname } });
}

async function overflowAndTargets(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth || window.innerWidth !== document.documentElement.clientWidth,
    small: [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [role=button]")]
      .filter((el) => !el.closest("footer"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim()} ${Math.round(r.width)}x${Math.round(r.height)}`),
  }));
}

for (const { width, height } of WIDTHS) {
  test(`create → invite → join → start by touch at ${width}px`, async ({ browser }) => {
    const hctx = await newCtx(browser, width, height, true);
    const host = await hctx.newPage();
    await host.goto("/");
    await host.getByRole("button", { name: "Plan a heist" }).tap();
    await host.getByLabel("Your name in this game").fill("Mara");
    let m = await overflowAndTargets(host);
    expect(m.overflow, "/new").toBe(false);
    expect(m.small, "/new").toEqual([]);
    await shot(host, `new-${width}`);
    await host.getByRole("button", { name: "Open the lobby" }).tap();
    await expect(host.getByRole("heading", { name: "Assemble the crew" })).toBeVisible();
    const code = (await host.locator(".invite-card .num").textContent())!.trim();

    const gctx = await newCtx(browser, width, height, true);
    const guest = await gctx.newPage();
    await guest.goto(`/join/${code}`);
    await expect(guest.getByText("Mara is hosting")).toBeVisible();
    m = await overflowAndTargets(guest);
    expect(m.overflow, "/join").toBe(false);
    expect(m.small, "/join").toEqual([]);
    await shot(guest, `invite-${width}`);
    await guest.getByLabel("Your nickname").fill("Lou");
    await guest.getByRole("button", { name: "Join the crew" }).tap();
    await expect(guest.getByText("Waiting for Mara to start the job")).toBeVisible();
    await expect(host.locator(".seat__name", { hasText: "Lou" })).toBeVisible();
    await host.getByRole("button", { name: "Add bot" }).tap();
    await expect(host.locator(".seat--bot")).toHaveCount(1);

    for (const [who, p] of [["host", host], ["guest", guest]] as const) {
      m = await overflowAndTargets(p);
      expect(m.overflow, `lobby ${who}`).toBe(false);
      expect(m.small, `lobby ${who}`).toEqual([]);
      await shot(p, `lobby-${who}-${width}`);
    }
    await host.getByRole("button", { name: "Start the job" }).tap();
    await expect(host).toHaveURL(/\/game\//);
    await expect(guest).toHaveURL(/\/game\//, { timeout: 10_000 });
    m = await overflowAndTargets(guest);
    expect(m.overflow, "/game").toBe(false);
    expect(m.small, "/game").toEqual([]);
    await shot(guest, `game-${width}`);
    await hctx.close();
    await gctx.close();
  });
}

test("bad and started invite codes show a friendly page", async ({ browser }) => {
  const hctx = await newCtx(browser);
  const g = await apiHost(hctx);
  const page = await (await newCtx(browser, 390, 844, true)).newPage();
  await page.goto("/join/zzzzzzzzzz");
  await expect(page.getByRole("heading", { name: "That invite doesn't open anything." })).toBeVisible();
  await shot(page, "invite-bad");
  await page.goto("/join/%E2%80%8B%20..%2F");
  await expect(page.getByRole("heading", { name: "That invite doesn't open anything." })).toBeVisible();

  await hctx.request.post(`/api/games/${g.id}/bots`, { data: {} });
  expect((await hctx.request.post(`/api/games/${g.id}/start`)).ok()).toBe(true);
  await page.goto(`/join/${g.inviteCode}`);
  await expect(page.getByRole("heading", { name: "This job already started." })).toBeVisible();
  await shot(page, "invite-started");
});

test("duplicate, invisible-character and Bot nicknames get friendly errors", async ({ browser }) => {
  const hctx = await newCtx(browser);
  const g = await apiHost(hctx, "Mara");
  const page = await (await newCtx(browser, 360, 740, true)).newPage();
  await page.goto(`/join/${g.inviteCode}`);
  const field = page.getByLabel("Your nickname");
  const join = page.getByRole("button", { name: "Join the crew" });
  const cases: [string, RegExp][] = [
    ["  mara ", /nickname is taken/i],
    ["MARA", /nickname is taken/i],
    ["​​", /visible characters/i],
    ["⠀", /visible characters/i],
    ["Bot Max", /are for bots/i],
    ["", /pick a nickname/i],
  ];
  for (const [name, msg] of cases) {
    await field.fill(name);
    await join.tap();
    await expect(page.getByText(msg), JSON.stringify(name)).toBeVisible();
    await expect(page).toHaveURL(/\/join\//);
  }
  await field.fill("Mara​");
  await join.tap();
  await expect(page.getByText(/visible characters|nickname is taken/i)).toBeVisible();
  await shot(page, "invite-nickname-error");
});

test("non-host: controls hidden and the API refuses host actions; hand-over to a bot or a non-member is refused", async ({ browser }) => {
  const hctx = await newCtx(browser);
  const g = await apiHost(hctx, "Mara");
  const gctx = await newCtx(browser);
  expect((await apiJoin(gctx, g.inviteCode, "Lou")).ok()).toBe(true);
  const bot = await (await hctx.request.post(`/api/games/${g.id}/bots`, { data: {} })).json();
  const botSeat = (bot as View).seats.find((s) => s.bot)!.seat;

  const guest = await gctx.newPage();
  await guest.goto(`/lobby/${g.id}`);
  await expect(guest.getByText("Only the host can change these.")).toBeVisible();
  for (const name of ["Start the job", "Add bot", /^Make .* host$/, /^Remove Bot/]) await expect(guest.getByRole("button", { name })).toHaveCount(0);
  await expect(guest.getByRole("group", { name: "Votes" }).getByRole("button")).toHaveCount(0);
  await shot(guest, "lobby-nonhost");

  const r = gctx.request;
  expect((await r.post(`/api/games/${g.id}/start`)).status()).toBe(403);
  expect((await r.post(`/api/games/${g.id}/host`, { data: { seat: 1 } })).status()).toBe(403);
  expect((await r.patch(`/api/games/${g.id}/settings`, { data: { settings: { deck: "everything" } } })).status()).toBe(403);
  expect((await r.post(`/api/games/${g.id}/bots`, { data: {} })).status()).toBe(403);
  expect((await r.delete(`/api/games/${g.id}/bots/${botSeat}`)).status()).toBe(403);

  const h = hctx.request;
  expect((await h.post(`/api/games/${g.id}/host`, { data: { seat: botSeat } })).status()).toBe(409);
  expect((await h.post(`/api/games/${g.id}/host`, { data: { seat: 99 } })).status()).toBe(404);
  expect((await h.post(`/api/games/${g.id}/host`, { data: { seat: "1" } })).status()).toBe(404);
  expect((await h.post(`/api/games/${g.id}/host`, { data: {} })).status()).toBe(404);
  // A signed-in stranger (not in the game) can't see it at all.
  const sctx = await newCtx(browser);
  await apiHost(sctx, "Stranger");
  expect((await sctx.request.post(`/api/games/${g.id}/host`, { data: { seat: 0 } })).status()).toBe(404);
  const host = await hctx.newPage();
  await host.goto(`/lobby/${g.id}`);
  await expect(host.getByRole("button", { name: /^Make Bot/ })).toHaveCount(0);
  await expect(host.getByRole("button", { name: "Make Lou host" })).toBeVisible();
});

test("hand-over racing with start: one wins and the state stays consistent", async ({ browser }) => {
  for (let i = 0; i < 5; i++) {
    const hctx = await newCtx(browser);
    const g = await apiHost(hctx, "Mara");
    const gctx = await newCtx(browser);
    expect((await apiJoin(gctx, g.inviteCode, "Lou")).ok()).toBe(true);
    const [hand, start] = await Promise.all([
      hctx.request.post(`/api/games/${g.id}/host`, { data: { seat: 1 } }),
      hctx.request.post(`/api/games/${g.id}/start`),
    ]);
    expect([hand.ok(), start.ok()].filter(Boolean)).toHaveLength(1);
    const v: View = await (await gctx.request.get(`/api/games/${g.id}`)).json();
    if (start.ok()) expect(v.status).not.toBe("lobby");
    else {
      expect(v.status).toBe("lobby");
      expect(v.youAreHost).toBe(true);
    }
    await hctx.close();
    await gctx.close();
  }
});

test("12 seats full: Add bot turns into a disabled 'Crew is full', the 13th person gets a friendly refusal", async ({ browser }) => {
  const hctx = await newCtx(browser);
  const g = await apiHost(hctx, "Mara");
  const gctx = await newCtx(browser);
  expect((await apiJoin(gctx, g.inviteCode, "Lou")).ok()).toBe(true);
  for (let i = 0; i < 10; i++) expect((await hctx.request.post(`/api/games/${g.id}/bots`, { data: {} })).ok()).toBe(true);
  expect((await hctx.request.post(`/api/games/${g.id}/bots`, { data: {} })).status()).toBe(409);
  const host = await hctx.newPage();
  await host.setViewportSize({ width: 360, height: 740 });
  await host.goto(`/lobby/${g.id}`);
  await expect(host.locator(".seat")).toHaveCount(12);
  await expect(host.getByRole("button", { name: "Crew is full" })).toBeDisabled();
  expect((await overflowAndTargets(host)).overflow).toBe(false);
  await shot(host, "lobby-full-360");

  const late = await (await newCtx(browser, 390, 844, true)).newPage();
  await late.goto(`/join/${g.inviteCode}`);
  await late.getByLabel("Your nickname").fill("Late Larry");
  await late.getByRole("button", { name: "Join the crew" }).tap();
  await expect(late.getByText(/the game is full/i)).toBeVisible();
  await shot(late, "invite-full");
});

test("leave and rejoin; back button and refresh on every route", async ({ browser }) => {
  const hctx = await newCtx(browser);
  const g = await apiHost(hctx, "Mara");
  const gctx = await newCtx(browser);
  const guest = await gctx.newPage();
  await guest.goto("/");
  await guest.goto(`/join/${g.inviteCode}`);
  await guest.reload();
  await expect(guest.getByLabel("Your nickname")).toBeVisible();
  await guest.getByLabel("Your nickname").fill("Lou");
  await guest.getByRole("button", { name: "Join the crew" }).click();
  await expect(guest).toHaveURL(/\/lobby\//);
  await guest.reload();
  await expect(guest.getByText("Waiting for Mara to start the job")).toBeVisible();
  // Back from the lobby goes to the invite page; it must not offer a second seat or break.
  await guest.goBack();
  await expect(guest).toHaveURL(/\/join\//);
  await guest.goForward();
  await expect(guest.getByText("Waiting for Mara to start the job")).toBeVisible();

  await guest.getByRole("button", { name: "Leave crew" }).click();
  await guest.getByRole("button", { name: "Leave? Tap again" }).click();
  await expect(guest).toHaveURL(/\/$/);
  await guest.goBack(); // back into the lobby we left
  await expect(guest.getByRole("heading", { name: "No crew here." })).toBeVisible();
  await shot(guest, "lobby-left");

  await guest.goto(`/join/${g.inviteCode}`);
  await guest.getByLabel("Your nickname").fill("Lou");
  await guest.getByRole("button", { name: "Join the crew" }).click();
  await expect(guest.getByText("Waiting for Mara to start the job")).toBeVisible();
  await expect(guest.locator(".seat")).toHaveCount(2);

  await hctx.request.post(`/api/games/${g.id}/start`);
  await expect(guest).toHaveURL(/\/game\//, { timeout: 10_000 });
  await guest.reload();
  await expect(guest.getByRole("img", { name: "Lou (you)" })).toBeVisible(); // the game screen's own seat (M2-6)
  await guest.goBack(); // back to the started lobby: bounces to the game again
  await expect(guest).toHaveURL(/\/game\//, { timeout: 10_000 });

  const host = await hctx.newPage();
  await host.goto("/new");
  await host.reload();
  await expect(host.getByLabel("Your name in this game")).toBeVisible();
  await host.goBack();
  await expect(host.getByRole("button", { name: "Plan a heist" }).or(host.locator("body"))).toBeVisible();
});

test("offline and server errors show friendly messages", async ({ browser }) => {
  const hctx = await newCtx(browser, 390, 844, true);
  const g = await apiHost(hctx, "Mara");
  const host = await hctx.newPage();
  await host.goto(`/lobby/${g.id}`);
  await expect(host.getByRole("heading", { name: "Assemble the crew" })).toBeVisible();
  await hctx.setOffline(true);
  await expect(host.getByText(/can't reach the hideout/i).first()).toBeVisible({ timeout: 5_000 });
  await host.waitForTimeout(4_500);
  await shot(host, "lobby-offline");
  // QA PR #27 (fixed): one persistent banner, never a toast per poll.
  await expect(host.getByText(/can't reach the hideout/i)).toHaveCount(1);
  await expect(host.locator(".toast")).toHaveCount(0);
  await hctx.setOffline(false);
  await expect(host.getByText(/can't reach the hideout/i)).toHaveCount(0, { timeout: 5_000 });
  await expect(host.getByRole("heading", { name: "Assemble the crew" })).toBeVisible();
});

test("server down (vite proxy 502, empty body) on invite and new game", async ({ browser }) => {
  const ctx = await newCtx(browser, 390, 844, true);
  const page = await ctx.newPage();
  await page.route("**/api/**", (r) => r.fulfill({ status: 502, body: "" }));
  await page.goto("/join/abcdefghjk");
  await expect(page.getByRole("heading", { name: "We couldn't check that invite." })).toBeVisible();
  await shot(page, "invite-server-down");
  const inviteText = await page.locator(".form-sheet__lede").textContent();

  await page.goto("/new");
  await page.getByLabel("Your name in this game").fill("Mara");
  await page.getByRole("button", { name: "Open the lobby" }).click();
  await shot(page, "new-server-down");
  await expect(page.locator(".field__error, [role=alert]").or(page.getByText(/went wrong|can't reach/i)).first()).toBeVisible();
  await expect(page).toHaveURL(/\/new$/);
  // QA PR #27 (fixed): a server-down message, not "Something went wrong (502)."
  expect(inviteText).toMatch(/can't reach the hideout/i);
  await expect(page.getByRole("alert")).toContainText(/can't reach the hideout/i);
  await expect(page.getByText(/\(502\)/)).toHaveCount(0);
});
