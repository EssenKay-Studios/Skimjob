import { expect, test, type Browser, type Page } from "@playwright/test";
import { settle } from "./setupGame";

// M2-5 acceptance (m2-plan): two browsers. The host creates a game, copies the
// invite link, a guest joins with a nickname, the host adds bots, and start
// lands both on the game route. Plus the host hand-over (decisions.md M2-5b).

async function hostGame(browser: Browser, name: string) {
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Plan a heist" }).click();
  await expect(page).toHaveURL(/\/new$/);
  await page.getByLabel("Your name in this game").fill(name);
  await page.getByRole("button", { name: "Open the lobby" }).click();
  await expect(page).toHaveURL(/\/lobby\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Assemble the crew" })).toBeVisible();
  return page;
}

async function joinAs(browser: Browser, link: string, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await page.getByLabel("Your nickname").fill(name);
  await page.getByRole("button", { name: "Join the crew" }).click();
  await expect(page).toHaveURL(/\/lobby\//);
  return page;
}

test("host creates, copies the invite, guest joins, host adds bots, start lands both on the game @lobby", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough: two browsers each");
  const host = await hostGame(browser, "Mara");

  await host.getByRole("button", { name: "Copy invite link" }).click();
  const link = await host.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/join\/[a-z0-9]{10}$/);

  const guest = await joinAs(browser, new URL(link).pathname, "Lucky Lou");
  await expect(guest.getByText("Waiting for Mara to start the job")).toBeVisible();
  await expect(host.locator(".seat__name", { hasText: "Lucky Lou" })).toBeVisible(); // the host's poll sees the guest

  await host.getByRole("button", { name: "Greedy" }).click();
  await host.getByRole("button", { name: "Add bot" }).click();
  await host.getByRole("button", { name: "Add bot" }).click();
  await expect(host.locator(".seat--bot")).toHaveCount(2);
  await expect(host.locator(".seat--bot").first()).toContainText("Bot · Greedy");
  await host.getByRole("button", { name: "Remove Bot · Max" }).click();
  await expect(host.locator(".seat--bot")).toHaveCount(1);

  // Host settings, incl. DM notices and the vote setting; the guest sees them read-only.
  await host.getByRole("group", { name: "DM notices" }).getByRole("button", { name: "Off" }).click();
  await host.getByRole("group", { name: "Votes" }).getByRole("button", { name: "Open" }).click();
  await expect(host.getByRole("group", { name: "DM notices" }).getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  await expect(guest.getByRole("group", { name: "Votes" })).toContainText("Open");
  await expect(guest.getByRole("group", { name: "Votes" }).getByRole("button")).toHaveCount(0);

  await host.getByRole("button", { name: "Start the job" }).click();
  await expect(host).toHaveURL(/\/game\//);
  await expect(guest).toHaveURL(/\/game\//, { timeout: 10_000 });
  // The game screen (M2-6): the HUD, and each player's own seat.
  await expect(host.getByRole("region", { name: "Heist status" })).toBeVisible();
  await expect(guest.getByRole("img", { name: "Lucky Lou (you)" })).toBeVisible();
});

test("the host hands over to another player, then leaves @lobby", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  const host = await hostGame(browser, "Dez");
  const code = (await host.locator(".invite-card .num").textContent())!.trim();
  const guest = await joinAs(browser, `/join/${code}`, "Priya");
  await expect(host.getByRole("button", { name: "Leave crew" })).toHaveCount(0); // the host can't leave yet

  const make = host.getByRole("button", { name: "Make Priya host" });
  await make.click();
  await make.click(); // danger: arm, then confirm
  await expect(host.getByText("Priya is hosting")).toBeVisible();
  await expect(guest.getByRole("button", { name: "Start the job" })).toBeVisible({ timeout: 10_000 });

  const leave = host.getByRole("button", { name: "Leave crew" });
  await leave.click();
  await host.getByRole("button", { name: "Leave? Tap again" }).click();
  await expect(host).toHaveURL(/\/$/);
  await expect(guest.locator(".seat")).toHaveCount(1, { timeout: 10_000 });
});

// PR #27 review: a signed-in player who hosts under another name keeps their session and their other games.
test("hosting under a different name keeps the session @lobby", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  const page = await hostGame(browser, "Mara");
  const first = page.url();
  await page.goto("/new");
  await expect(page.getByLabel("Your name in this game")).toHaveValue("Mara");
  await page.getByLabel("Your name in this game").fill("Mara 2");
  await page.getByRole("button", { name: "Open the lobby" }).click();
  await expect(page).toHaveURL(/\/lobby\//);
  await expect(page.locator(".seat__name")).toHaveText(["Mara 2"]);
  expect(page.url()).not.toBe(first);
  const me = await page.evaluate(() => fetch("/api/me").then((r) => r.json()));
  expect(me.user.name).toBe("Mara");
  await page.goto(first);
  await expect(page.getByRole("heading", { name: "Assemble the crew" })).toBeVisible(); // still in the first game
});

test("a bad invite says so @lobby", async ({ page }) => {
  await page.goto("/join/zzzzzzzzzz");
  await expect(page.getByRole("heading", { name: "That invite doesn't open anything." })).toBeVisible();
});

// Responsive (CLAUDE.md UI rules): a full lobby, as host and as guest, at every width.
test.describe("lobby and invite at every width", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));
  for (const { width, height } of [
    { width: 360, height: 740 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
  ]) {
    test(`${width}x${height}: no overflow, targets ≥44px @lobby`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      // Set up through the API (same origin, so the session cookie sticks).
      await page.goto("/");
      const { id, code } = await page.evaluate(async () => {
        const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
        await post("/api/auth/guest", { nickname: "Mara Vox the Magnificent" });
        const g = await post("/api/games", {});
        for (const personality of ["greedy", "honest", "cautious"]) await post(`/api/games/${g.id}/bots`, { personality });
        return { id: g.id as string, code: g.inviteCode as string };
      });
      const guest = await (await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true })).newPage();
      const pages: [Page, string, string][] = [
        [page, `/lobby/${id}`, "lobby-host"],
        [guest, `/join/${code}`, "invite"],
      ];
      for (const [p, route, shot] of pages) {
        await p.goto(route);
        await settle(p);
        const o = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, vw: window.innerWidth }));
        expect(o.scroll, route).toBeLessThanOrEqual(o.client);
        expect(o.vw, route).toBe(width);
        // Measure the resting layout (as responsive*.spec.ts): finite entrance animations done.
        await p.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
              .map((a) => a.finished.catch(() => undefined)),
          ),
        );
        const small = await p.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [role=button]")]
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
            .map(({ el, r }) => `${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim()} ${Math.round(r.width)}x${Math.round(r.height)}`),
        );
        expect(small, route).toEqual([]);
        if (process.env.SHOTS && (width === 390 || width === 1280)) await p.screenshot({ path: `${process.env.SHOTS}/${shot}-${width}.png`, fullPage: true });
      }
      await guest.getByLabel("Your nickname").fill("Lucky Lou");
      await guest.getByRole("button", { name: "Join the crew" }).click();
      await expect(guest).toHaveURL(/\/lobby\//);
      await settle(guest);
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      if (process.env.SHOTS && (width === 390 || width === 1280)) await guest.screenshot({ path: `${process.env.SHOTS}/lobby-guest-${width}.png`, fullPage: true });
    });
  }
});

// PR #27 QA/review: one poll loop, a clear state when the server is down on load, no edits while offline.
test.describe("lobby while the server is unreachable", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "one run is enough"));

  async function lobbyPage(browser: Browser) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");
    const id = await page.evaluate(async () => {
      const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      await post("/api/auth/guest", { nickname: "Mara" });
      return (await post("/api/games", {})).id as string;
    });
    return { ctx, page, id };
  }

  test("an 'online' event mid-poll never starts a second poll loop @lobby", async ({ browser }) => {
    const { page, id } = await lobbyPage(browser);
    let polls = 0;
    await page.route(`**/api/games/${id}`, async (r) => {
      polls++;
      await new Promise((res) => setTimeout(res, 300)); // keep each poll in flight a while
      await r.continue();
    });
    await page.goto(`/lobby/${id}`);
    await expect(page.getByRole("heading", { name: "Assemble the crew" })).toBeVisible();
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await page.waitForTimeout(120); // sleep kept: spaces the online events
    }
    polls = 0;
    await page.waitForTimeout(6_900); // sleep kept: counts polls over a fixed span of wall time
    // One loop: a poll every ~2.3 s (2 s wait + 0.3 s in flight) → about 3 in 6.9 s; two loops would be ~6.
    expect(polls).toBeLessThanOrEqual(4);
  });

  test("opening the lobby with the server down shows the offline state, then the lobby @lobby", async ({ browser }) => {
    const { page, id } = await lobbyPage(browser);
    await page.route("**/api/**", (r) => r.fulfill({ status: 502, body: "" }));
    await page.goto(`/lobby/${id}`);
    await expect(page.getByText(/can't reach the hideout/i)).toBeVisible();
    await expect(page.getByText("Waiting for the hideout to answer")).toBeVisible();
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/lobby-down-1280.png` });
    await page.unroute("**/api/**");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("heading", { name: "Assemble the crew" })).toBeVisible();
    await expect(page.getByText(/can't reach the hideout/i)).toHaveCount(0);
  });

  test("settings can't be changed while offline, so nothing looks saved and reverts @lobby", async ({ browser }) => {
    const { ctx, page, id } = await lobbyPage(browser);
    await page.goto(`/lobby/${id}`);
    const off = page.getByRole("group", { name: "DM notices" }).getByRole("button", { name: "Off" });
    await expect(off).toBeEnabled();
    await ctx.setOffline(true);
    await expect(page.getByText(/can't reach the hideout/i)).toBeVisible({ timeout: 5_000 });
    await expect(off).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add bot" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Start the job" })).toBeDisabled();
    await ctx.setOffline(false);
    await expect(off).toBeEnabled({ timeout: 10_000 });
  });

  test("a change that fails to reach the server says it wasn't saved @lobby", async ({ browser }) => {
    const { page, id } = await lobbyPage(browser);
    await page.goto(`/lobby/${id}`);
    const group = page.getByRole("group", { name: "DM notices" });
    await page.route(`**/api/games/${id}/settings`, (r) => r.fulfill({ status: 502, body: "" }));
    await group.getByRole("button", { name: "Off" }).click();
    await expect(page.getByText("That change wasn't saved")).toBeVisible();
    await expect(group.getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
  });
});
