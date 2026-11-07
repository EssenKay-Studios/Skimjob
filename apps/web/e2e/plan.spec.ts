import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

const expect = baseExpect.configure({ timeout: 15_000 });

// S3b.4 acceptance (design §10): the plan board's live channel. There is no board
// UI yet (S4.3), so each player's page opens the game socket itself and speaks the
// wire format: one player's room claim, power claim and "I agree" reach the other
// live, either can put the other's avatar on the proposed plan, and a forged actor is refused.

interface Probe {
  board: { round: number; entries: { player: string; room: string | null; power: { role: string; target: string } | null; agreed: boolean }[] } | null;
  replies: Record<string, { ok?: true; rejected?: true; reason?: string }>;
  ws: WebSocket;
}
declare global {
  interface Window {
    __plan?: Probe;
  }
}

async function player(browser: Browser, page: Page) {
  const ctx = await browser.newContext({ viewport: page.viewportSize()! });
  return ctx.newPage();
}

/** Opens the game socket in `page` and waits for its first frames (the board comes before presence). */
async function openChannel(page: Page, gameId: string) {
  await page.goto("/");
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve) => {
        const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/games/${id}/ws`);
        const probe: Probe = { board: null, replies: {}, ws };
        window.__plan = probe;
        ws.onmessage = (e) => {
          const m = JSON.parse(String(e.data));
          if (m.plan) probe.board = m.plan;
          if (m.id) probe.replies[m.id] = m;
          if (m.presence) resolve();
        };
      }),
    gameId,
  );
}

/** Sends `{ plan, id }` and returns the server's reply to it. */
async function post(page: Page, id: string, plan: unknown) {
  await page.evaluate(([i, p]) => window.__plan!.ws.send(JSON.stringify({ id: i, plan: p })), [id, plan] as const);
  await expect.poll(() => page.evaluate((i) => window.__plan!.replies[i] ?? null, id)).not.toBeNull();
  return page.evaluate((i) => window.__plan!.replies[i]!, id);
}

const board = (page: Page) => page.evaluate(() => window.__plan!.board);

test("two players see each other's plan entry live @plan", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const guest = await player(browser, page);
  // One-week preset: nothing moves on while we plan.
  const game = await startGame(page.request, { bots: 1, guests: [guest.request], sessionLength: "1w" });
  await openChannel(page, game.id);
  await openChannel(guest, game.id);
  expect(await board(page)).toEqual({ round: 1, entries: [] });

  expect(await post(page, "a1", { room: "office", agree: true })).toMatchObject({ ok: true });
  await expect.poll(() => board(guest)).toMatchObject({ round: 1, entries: [{ room: "office", power: null, agreed: true }] });
  const hostId = (await board(guest))!.entries[0]!.player;

  expect(await post(guest, "g1", { room: "vault", power: { role: "hacker", target: "vault" } })).toMatchObject({ ok: true });
  await expect.poll(() => board(page)).toMatchObject({
    entries: [
      { player: hostId, room: "office", agreed: true },
      { room: "vault", power: { role: "hacker", target: "vault" }, agreed: false },
    ],
  });

  // Anyone may put any avatar on the proposed plan, apart from the claims.
  expect(await post(guest, "g4", { place: { player: hostId, room: "vault" } })).toMatchObject({ ok: true });
  await expect.poll(async () => (await board(page))!.entries.find((e) => e.player === hostId)).toMatchObject({ placed: "vault", room: "office", agreed: true });

  // Nobody writes another seat's claims, and a claim must name something in the game.
  expect(await post(guest, "g2", { room: "office", player: hostId })).toMatchObject({ rejected: true, reason: 'unknown plan field "player"' });
  expect(await post(guest, "g3", { room: "nowhere" })).toMatchObject({ rejected: true, reason: "no such room" });
  expect((await board(page))!.entries.find((e) => e.player === hostId)).toMatchObject({ room: "office" });
});
