import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

const expect = baseExpect.configure({ timeout: 15_000 });

// QA (S3b.4, design §10): two players see each other's placements and claims live,
// a reconnect gets the current board, and a stranger's socket never opens.

interface Entry {
  player: string;
  placed: string | null;
  room: string | null;
  power: { role: string; target: string } | null;
  agreed: boolean;
}
interface Probe {
  board: { round: number; entries: Entry[] } | null;
  frames: number;
  replies: Record<string, { ok?: true; rejected?: true; reason?: string }>;
  ws: WebSocket;
}
declare global {
  interface Window {
    __qaplan?: Probe;
  }
}

const newPage = async (browser: Browser, page: Page) => (await browser.newContext({ viewport: page.viewportSize()! })).newPage();

/** Opens the game socket; resolves "open" after presence, or "closed" if the server refuses it. */
async function openChannel(page: Page, gameId: string) {
  await page.goto("/");
  return page.evaluate(
    (id) =>
      new Promise<"open" | "closed">((resolve) => {
        const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/games/${id}/ws`);
        const probe: Probe = { board: null, frames: 0, replies: {}, ws };
        window.__qaplan = probe;
        ws.onmessage = (e) => {
          const m = JSON.parse(String(e.data));
          if (m.plan) {
            probe.board = m.plan;
            probe.frames++;
          }
          if (m.id) probe.replies[m.id] = m;
          if (m.presence) resolve("open");
        };
        ws.onclose = () => resolve("closed");
        ws.onerror = () => resolve("closed");
      }),
    gameId,
  );
}
async function post(page: Page, id: string, plan: unknown) {
  await page.evaluate(([i, p]) => window.__qaplan!.ws.send(JSON.stringify({ id: i, plan: p })), [id, plan] as const);
  await expect.poll(() => page.evaluate((i) => window.__qaplan!.replies[i] ?? null, id)).not.toBeNull();
  return page.evaluate((i) => window.__qaplan!.replies[i]!, id);
}
const board = (page: Page) => page.evaluate(() => window.__qaplan!.board);
const entry = async (page: Page, player: string) => (await board(page))!.entries.find((e) => e.player === player);

test("QA: each player sees the other's placement and claim live; a reconnect gets the board; strangers get no socket @plan", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const guest = await newPage(browser, page);
  const game = await startGame(page.request, { bots: 1, guests: [guest.request], sessionLength: "1w" });
  expect(await openChannel(page, game.id)).toBe("open");
  expect(await openChannel(guest, game.id)).toBe("open");
  // design §10: the bot took its spot as the round started; set its line aside.
  const bots = (await board(page))!.entries.map((e) => e.player);
  expect(bots).toHaveLength(1);

  // Each claims: their ids come from the board itself.
  expect(await post(page, "h1", { room: "office" })).toMatchObject({ ok: true });
  expect(await post(guest, "g1", { room: "vault", agree: true })).toMatchObject({ ok: true });
  await expect.poll(async () => (await board(page))?.entries.length).toBe(3);
  const [hostId, guestId] = (await board(page))!.entries.map((e) => e.player).filter((p) => !bots.includes(p)) as [string, string];

  // The host places the guest's avatar and pledges a power on the guest: the guest sees both live.
  expect(await post(page, "h2", { place: { player: guestId, room: "office" }, power: { role: "detective", target: guestId } })).toMatchObject({ ok: true });
  await expect.poll(() => entry(guest, guestId)).toEqual({ player: guestId, placed: "office", room: "vault", power: null, agreed: true });
  await expect.poll(() => entry(guest, hostId)).toMatchObject({ room: "office", power: { role: "detective", target: guestId }, agreed: false });

  // The guest moves the host's avatar; the host sees it, its own claims untouched.
  expect(await post(guest, "g2", { place: { player: hostId, room: "vault" } })).toMatchObject({ ok: true });
  await expect.poll(() => entry(page, hostId)).toEqual({ player: hostId, placed: "vault", room: "office", power: { role: "detective", target: guestId }, agreed: false });

  // The guest drops; the host edits while it is away; on reconnect its first board is the current one.
  await guest.evaluate(() => window.__qaplan!.ws.close());
  expect(await post(page, "h3", { agree: true, place: { player: guestId, room: null } })).toMatchObject({ ok: true });
  expect(await openChannel(guest, game.id)).toBe("open");
  expect(await guest.evaluate(() => window.__qaplan!.frames)).toBe(1);
  expect(await entry(guest, hostId)).toMatchObject({ placed: "vault", agreed: true });
  expect(await entry(guest, guestId)).toMatchObject({ placed: null, room: "vault", agreed: true });

  // A signed-in stranger (not seated) gets no socket at all.
  const stranger = await newPage(browser, page);
  expect((await stranger.request.post("/api/auth/guest", { data: { nickname: "Stranger" } })).ok()).toBe(true);
  expect(await openChannel(stranger, game.id)).toBe("closed");
});
