import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Adversarial QA for R6b, the extension UI (docs/extension.md): private tokens
// across clients, the role list host setting in a
// real game, and the gallery's extension parts at 360/768/1280 by touch and keyboard.

async function ok<T>(res: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function start(host: APIRequestContext, settings: object, guests: APIRequestContext[], bots: number) {
  await ok(await host.post("/api/auth/guest", { data: { nickname: "Host" } }));
  const game = await ok<{ id: string; inviteCode: string }>(await host.post("/api/games", { data: { settings } }));
  for (const [i, g] of guests.entries()) await ok(await g.post(`/api/invites/${game.inviteCode}/join`, { data: { nickname: `Guest ${i + 1}` } }));
  for (let i = 0; i < bots; i++) await ok(await host.post(`/api/games/${game.id}/bots`, { data: {} }));
  await ok(await host.post(`/api/games/${game.id}/start`, { data: {} }));
  return game;
}

/** Every websocket frame the page receives, as text. */
function frames(page: Page): string[] {
  const got: string[] = [];
  page.on("websocket", (ws) => ws.on("framereceived", (f) => got.push(typeof f.payload === "string" ? f.payload : f.payload.toString())));
  return got;
}

/** Objects anywhere in a JSON value whose `type` is one of `types`. */
function find(value: unknown, types: readonly string[], out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) for (const v of value) find(v, types, out);
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.type === "string" && types.includes(o.type)) out.push(o);
    for (const v of Object.values(o)) find(v, types, out);
  }
  return out;
}

test.describe("private tokens, two real clients", () => {
  test.beforeEach(() => test.skip(test.info().project.name !== "desktop", "one run is enough"));

  test("each player sees only their own tokens; no frame carries another's tokens @shop", async ({ browser }) => {
    test.setTimeout(90_000);
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const host = await hostCtx.newPage();
      const guest = await guestCtx.newPage();
      const game = await start(hostCtx.request, { sessionLength: "1h" }, [guestCtx.request], 3);
      const seen = frames(guest);
      await host.goto(`/game/${game.id}`);
      await guest.goto(`/game/${game.id}`);
      for (const p of [host, guest]) {
        const card = p.locator(".role-card");
        await expect(card.locator(".tokens")).toContainText(/\d+ tokens? · only you see this/, { timeout: 20_000 });
        await expect(card.getByRole("button", { name: "Shop", exact: true })).toBeVisible();
        // By keyboard: Enter opens the shop, Escape closes it and stays in the game.
        await card.getByRole("button", { name: "Shop", exact: true }).focus();
        await p.keyboard.press("Enter");
        await expect(p.getByRole("dialog", { name: "The shop" })).toBeVisible();
        await p.keyboard.press("Escape");
        await expect(p.getByRole("dialog", { name: "The shop" })).toHaveCount(0);
        await expect(p).toHaveURL(new RegExp(`/game/${game.id}$`));
        // Other players' rows never show a token count.
        await expect(p.locator(".tokens")).toHaveCount(1);
      }
      await expect.poll(() => seen.length, { timeout: 15_000 }).toBeGreaterThan(0);
      const msgs = seen.map((t) => {
        try {
          return JSON.parse(t) as unknown;
        } catch {
          return null;
        }
      });
      const wire = seen.join("\n");
      const meIds = new Set([...wire.matchAll(/"me":\{"id":"([^"]+)"/g)].map((m) => m[1]));
      expect(meIds.size).toBe(1);
      for (const e of find(msgs, ["tokenEarned", "perkBought", "perkUsed"])) expect(meIds.has(e.player as string), JSON.stringify(e)).toBe(true);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test("a Hidden role list says so on the role card; Possible lists roles that could be in play @shop", async ({ page }) => {
    test.setTimeout(60_000);
    const hidden = await start(page.request, { sessionLength: "1h", roleList: "hidden" }, [], 4);
    await page.goto(`/game/${hidden.id}`);
    const card = page.locator(".role-card");
    await expect(card).toContainText("The role list is hidden in this game.", { timeout: 20_000 });
    await expect(card.locator(".role-list__names")).toHaveCount(0);

    const possible = await start(page.request, { sessionLength: "1h", roleList: "possible" }, [], 4);
    await page.goto(`/game/${possible.id}`);
    await expect(card).toContainText("Roles that could be in play", { timeout: 20_000 });
    await expect(card.getByRole("list", { name: "Roles that could be in play" }).getByRole("listitem").first()).toBeVisible();
  });

  test("player-facing text never says act @shop", async ({ page }) => {
    test.setTimeout(60_000);
    const game = await start(page.request, { sessionLength: "1h" }, [], 4);
    await page.goto(`/game/${game.id}`);
    await expect(page.locator(".hud__kicker")).toContainText(/Meeting 1 after round 3/, { timeout: 20_000 });
    await page.getByRole("button", { name: "Rulebook", exact: true }).first().click();
    await expect(page.getByRole("dialog", { name: "Rulebook" })).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\bacts?\b/i);
    expect(text).toMatch(/between meetings/);
  });
});

test.describe("gallery extension parts: touch, keyboard, viewports", () => {
  test.beforeEach(() => test.skip(test.info().project.name !== "mobile", "viewports are set per test"));

  for (const width of [360, 768, 1280]) {
    test(`at ${width}px: shop and rulebook controls are ≥44px and fit; the shop works by keyboard @shop`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dev/gallery");
      const demo = page.getByTestId("shop-demo");
      await demo.scrollIntoViewIfNeeded();
      const small: string[] = [];
      for (const b of await demo.getByRole("button").all()) {
        const box = await b.boundingBox();
        if (box && (box.height < 44 || box.width < 44)) small.push(`${await b.textContent()} ${box.width}×${box.height}`);
      }
      expect(small).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

      // Keyboard: focus the Shop button, open with Enter, Buy is disabled at 0 tokens, Close by keyboard.
      // (Escape on /dev pages goes home, App.tsx; the game page's Escape is covered above.)
      const shopBtn = demo.getByRole("button", { name: "Shop", exact: true });
      await shopBtn.focus();
      await page.keyboard.press("Enter");
      const shop = page.getByRole("dialog", { name: "The shop" });
      await expect(shop).toBeVisible();
      for (const buy of await shop.getByRole("button", { name: /^Buy / }).all()) await expect(buy).toBeDisabled();
      const dialogBox = await shop.boundingBox();
      expect(dialogBox!.width).toBeLessThanOrEqual(width);
      await shop.getByRole("button", { name: "Close" }).focus();
      await page.keyboard.press("Enter");
      await expect(shop).toHaveCount(0);
      await expect(shopBtn).toBeFocused();
    });
  }
});
