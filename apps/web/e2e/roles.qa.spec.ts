import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Adversarial QA for the role cards and rulebook: private purchases across
// clients (design §12, §18) and the role list host setting in a real game (§11.3).

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
  for (const who of [host, ...guests]) await ok(await who.patch("/api/me", { data: { tips: false } })); // no teaching pop-up (design §15.6)
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

test.describe("private purchases, two real clients", () => {
  test.beforeEach(() => test.skip(test.info().project.name !== "desktop", "one run is enough"));

  test("no tokens anywhere; the rulebook shows the black market; no frame carries another's purchase or Bail choice @roles", async ({ browser }) => {
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
        await expect(card).toContainText("only you see this", { timeout: 20_000 });
        await expect(card).not.toContainText(/token/i);
        // By keyboard: Enter opens the rulebook, Escape closes it and stays in the game.
        await card.getByRole("button", { name: "Rules", exact: true }).focus();
        await p.keyboard.press("Enter");
        const sheet = p.getByRole("dialog", { name: "This game" });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole("list", { name: "This game's black market" }).getByRole("listitem")).toHaveCount(3);
        await p.keyboard.press("Escape");
        await expect(sheet).toHaveCount(0);
        await expect(p).toHaveURL(new RegExp(`/game/${game.id}$`));
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
      for (const e of find(msgs, ["perkBought", "bailChosen"])) expect(meIds.has(e.player as string), JSON.stringify(e)).toBe(true);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test("a Hidden role list says so on Roles in play; Possible lists roles that could be in play @roles", async ({ page }) => {
    test.setTimeout(60_000);
    const hidden = await start(page.request, { sessionLength: "1h", roleList: "hidden" }, [], 4);
    await page.goto(`/game/${hidden.id}`);
    const panel = page.locator(".rolesinplay");
    await expect(panel).toContainText("hidden in this game", { timeout: 20_000 });
    await expect(panel.getByRole("button")).toHaveCount(0);
    await page.locator(".role-card").getByRole("button", { name: "Rules", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "This game" })).toContainText("The role list is hidden in this game.");

    const possible = await start(page.request, { sessionLength: "1h", roleList: "possible" }, [], 4);
    await page.goto(`/game/${possible.id}`);
    await expect(panel).toContainText("Roles that could be in play", { timeout: 20_000 });
    await expect(panel.getByRole("list", { name: "Roles that could be in play" }).getByRole("listitem").first()).toBeVisible();
  });

  test("player-facing text never says act, and an opponent's card explains its tell @roles", async ({ page }) => {
    test.setTimeout(60_000);
    const game = await start(page.request, { sessionLength: "1h" }, [], 4);
    await page.goto(`/game/${game.id}`);
    await expect(page.locator(".hud__kicker")).toContainText(/Round 1 of 12/, { timeout: 20_000 });
    // design §15.6: an opponent's role card names who could explain the tell.
    await page.locator(".rolesinplay").getByRole("button").filter({ hasNotText: "(you)" }).first().click();
    await expect(page.locator(".rolesinplay__why")).toContainText("or someone lying.");
    await page.locator(".role-card").getByRole("button", { name: "Rules", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "This game" })).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\bacts?\b/i);
    expect(text).toMatch(/between meetings/);
  });
});
