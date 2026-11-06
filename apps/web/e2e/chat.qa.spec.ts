// QA for PR #38 (M2-8b chat UI), in real browsers against the real server:
// DM privacy with 4 humans across reloads and socket reconnects (frames, DOM
// and storage), hostile text, the limits across two tabs of one player, unread
// badges per thread, chat through phase changes and after the game ends,
// someone without a seat, and the layout at 360 and 1280 px. design §12.1
import { mkdirSync } from "node:fs";
import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

const expect = baseExpect.configure({ timeout: 15_000 });
// Screenshots only when QA_SHOTS names a folder (CI has no such folder).
const SHOTS = process.env.QA_SHOTS;
async function snap(p: Page, name: string, fullPage = true) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await p.screenshot({ path: `${SHOTS}/${name}`, fullPage });
}

async function player(browser: Browser, page: Page, width?: number) {
  const vp = page.viewportSize()!;
  const ctx = await browser.newContext({ viewport: width ? { width, height: 800 } : vp });
  return ctx.newPage();
}

/** Records every text frame the page's sockets receive. */
function recordFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on("websocket", (ws) => ws.on("framereceived", (f) => typeof f.payload === "string" && frames.push(f.payload)));
  return frames;
}

/** Lets the test drop the game socket and hold off reconnects (as chat.spec does). */
const socketControl = () => {
  const Real = window.WebSocket;
  const w = window as unknown as { __ws: WebSocket[]; __blockWs: boolean };
  w.__ws = [];
  w.__blockWs = false;
  window.WebSocket = class extends Real {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(w.__blockWs ? String(url).replace(/\/ws$/, "/ws-blocked") : url, protocols);
      w.__ws.push(this);
    }
  } as typeof WebSocket;
};
async function dropSocket(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __ws: WebSocket[]; __blockWs: boolean };
    w.__blockWs = true;
    w.__ws.at(-1)?.close();
  });
}
async function restoreSocket(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __blockWs: boolean }).__blockWs = false;
    window.dispatchEvent(new Event("online"));
  });
}

async function openChat(page: Page) {
  const fab = page.locator(".chat-fab");
  const region = page.getByRole("region", { name: "Chat" });
  await expect(fab.or(region)).toBeVisible();
  if (await fab.isVisible()) await fab.click();
  await expect(region).toBeVisible();
}
async function closeChat(page: Page) {
  const close = page.getByRole("button", { name: "Close chat" });
  if (await close.isVisible()) await close.click();
}
const feed = (page: Page) => page.locator(".chat__feed");
const composer = (page: Page) => page.locator(".chat__input");
const sendBtn = (page: Page) => page.getByRole("button", { name: "Send", exact: true });
const tabs = (page: Page) => page.getByRole("group", { name: "Conversations" });
async function say(page: Page, text: string) {
  await composer(page).fill(text);
  await sendBtn(page).click();
  await expect(composer(page)).toHaveValue("");
}
async function dm(page: Page, who: RegExp) {
  await page.getByRole("button", { name: "DM", exact: true }).click();
  await page.getByRole("group", { name: "Message a player privately" }).getByRole("button", { name: who }).click();
}
async function loaded(page: Page, gameId: string) {
  await page.goto(`/game/${gameId}`);
  await expect(page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();
}
/** No horizontal overflow on the page, no sideways scrolling in the chat, and nothing poking out of the panel. */
async function noOverflow(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const chat = document.querySelector(".chat")!;
    const box = chat.getBoundingClientRect();
    const els = [...chat.querySelectorAll<HTMLElement>("*")].filter((el) => !(el instanceof SVGElement) && el.getClientRects().length > 0);
    const scrolls = els.filter((el) => ["auto", "scroll"].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1);
    const out = els.filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > box.right + 1 || b.left < box.left - 1);
    });
    return {
      page: doc.scrollWidth - doc.clientWidth,
      panel: box.right - doc.clientWidth,
      over: [...scrolls, ...out].map((el) => `${el.className} ${Math.round(el.getBoundingClientRect().right)}>${Math.round(box.right)}`),
    };
  });
  expect(r.panel, `${label}: panel past the viewport`).toBeLessThanOrEqual(1);
  expect(r.page, `${label}: page overflow`).toBeLessThanOrEqual(0);
  expect(r.over, `${label}: chat overflow`).toEqual([]);
}

test("QA: four humans: a DM between two guests never reaches the other two, in frames, DOM or storage, across reloads and reconnects @chat", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  await page.addInitScript(socketControl);
  const [g1, g2, g3] = [await player(browser, page), await player(browser, page), await player(browser, page)];
  await g3.addInitScript(socketControl);
  const hostFrames = recordFrames(page);
  const g3Frames = recordFrames(g3);
  for (const p of [page, g1, g2, g3]) p.on("pageerror", (e) => errors.push(e.message));
  const game = await startGame(page.request, { bots: 1, guests: [g1.request, g2.request, g3.request], sessionLength: "1w" });
  for (const p of [page, g1, g2, g3]) await loaded(p, game.id);
  for (const p of [page, g1, g2, g3]) await openChat(p);

  const SECRET = "QA-SECRET-7f3a vault at dawn";
  const REPLY = "QA-REPLY-91bc fine by me";
  await dm(g1, /Guest 2/);
  await say(g1, SECRET);
  await tabs(g2).getByRole("button", { name: /^Guest 1 \(direct message\)/ }).click();
  await expect(feed(g2)).toContainText(SECRET);

  // The host drops off while the DM goes on, and catches up on reconnect.
  await dropSocket(page);
  await expect(page.locator(".chat__conn")).toContainText("Connection lost");
  await say(g2, REPLY);
  await say(g3, "crew line while host is away");
  await restoreSocket(page);
  await expect(feed(page)).toContainText("crew line while host is away", { timeout: 20_000 });
  await expect(feed(page)).toContainText(/Guest 1 and Guest 2 are DMing ×2/);

  // Guest 3 reloads and reconnects too.
  await g3.reload();
  await openChat(g3);
  await expect(feed(g3)).toContainText(/Guest 1 and Guest 2 are DMing ×2/);
  await dropSocket(g3);
  await restoreSocket(g3);
  await expect(g3.locator(".chat__conn")).toHaveCount(0, { timeout: 20_000 });
  await page.reload();
  await openChat(page);
  await expect(feed(page)).toContainText(/Guest 1 and Guest 2 are DMing ×2/);

  for (const [p, frames, label] of [[page, hostFrames, "host"], [g3, g3Frames, "guest 3"]] as const) {
    expect(frames.length, label).toBeGreaterThan(3);
    const raw = frames.join("\n");
    expect(raw, `${label} frames`).not.toContain("QA-SECRET");
    expect(raw, `${label} frames`).not.toContain("QA-REPLY");
    // No chat frame addressed to someone else, live or in history.
    const chats = frames.flatMap((f) => {
      const m = JSON.parse(f) as { chat?: { to: string | null }; chatHistory?: { messages: { to: string | null }[] } };
      return [...(m.chat ? [m.chat] : []), ...(m.chatHistory?.messages ?? [])];
    });
    expect(chats.filter((c) => c.to !== null), `${label}: DMs received`).toEqual([]);
    await expect(p.locator("body")).not.toContainText("QA-SECRET");
    await expect(tabs(p).getByRole("button", { name: /direct message/ })).toHaveCount(0);
    const storage = await p.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(storage, `${label} storage`).not.toContain("QA-");
  }
  // The two in the DM still have it after a reload.
  await g1.reload();
  await openChat(g1);
  await tabs(g1).getByRole("button", { name: /^Guest 2/ }).click();
  await expect(feed(g1)).toContainText(SECRET);
  await expect(feed(g1)).toContainText(REPLY);
  expect(errors).toEqual([]);
  for (const p of [g1, g2, g3]) await p.context().close();
});

test("QA: with DM notices off, a third player gets no frame and no row for a DM @chat", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const [g1, g2] = [await player(browser, page), await player(browser, page)];
  const g2Frames = recordFrames(g2);
  await page.request.post("/api/auth/guest", { data: { nickname: "Host" } });
  const res = await page.request.post("/api/games", { data: { settings: { sessionLength: "1w", dmNotices: false } } });
  expect(res.ok(), await res.text()).toBe(true);
  const game = (await res.json()) as { id: string; inviteCode: string };
  for (const [i, g] of [g1, g2].entries()) expect((await g.request.post(`/api/invites/${game.inviteCode}/join`, { data: { nickname: `Guest ${i + 1}` } })).ok()).toBe(true);
  expect((await page.request.post(`/api/games/${game.id}/start`, { data: {} })).ok()).toBe(true);
  for (const p of [page, g1, g2]) await loaded(p, game.id);
  for (const p of [page, g1, g2]) await openChat(p);

  await dm(page, /Guest 1/);
  // The DM note doesn't claim the crew can see the two of you talking.
  await expect(page.locator(".chat__note")).toHaveText("Only you and Guest 1 see what's said here.");
  await say(page, "QA-QUIET hello");
  await tabs(g1).getByRole("button", { name: /^Host/ }).click();
  await expect(feed(g1)).toContainText("QA-QUIET hello");
  await say(page, "QA-QUIET second");
  await tabs(page).getByRole("button", { name: /^Crew/ }).click();
  await say(page, "crew marker");
  await expect(feed(g2)).toContainText("crew marker");
  await g2.reload();
  await openChat(g2);
  await expect(feed(g2)).toContainText("crew marker");
  await expect(feed(g2).locator(".chat-note")).toHaveCount(0);
  const raw = g2Frames.join("\n");
  expect(raw).not.toContain("dmNotice\":{");
  expect(raw).not.toContain("QA-QUIET");
  for (const f of g2Frames) {
    const m = JSON.parse(f) as { chatHistory?: { dmNotices: unknown[] } };
    if (m.chatHistory) expect(m.chatHistory.dmNotices).toEqual([]);
  }
  for (const p of [g1, g2]) await p.context().close();
});

test("QA: hostile text arrives inert and wraps at 360 and 1280 px @chat", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const narrow = await player(browser, page, 360);
  const wide = await player(browser, page, 1280);
  const game = await startGame(page.request, { bots: 1, guests: [narrow.request, wide.request], sessionLength: "1w" });
  for (const p of [page, narrow, wide]) {
    await p.addInitScript(() => ((window as unknown as { __pwned: number }).__pwned = 0));
    await loaded(p, game.id);
    await openChat(p);
  }
  const bodies = [
    `<img src=x onerror="window.__pwned=1">`,
    `<svg onload="window.__pwned=2"></svg><script>window.__pwned=3</script>`,
    `**bold** _it_ [link](javascript:window.__pwned=4) ![i](x) \`code\``,
    "שלום mixed RTL مرحبا — a\u200bb\u200d\u2060c \u200f! \u200e123",
    "W".repeat(500),
    `https://example.com/${"a".repeat(470)}`,
  ];
  for (const b of bodies) await say(page, b);
  // A bidi override: the server refuses it, so Send stays off and the composer says why; the draft is kept (QA nit, PR #38).
  await composer(page).fill("hi \u202eevil");
  await expect(sendBtn(page)).toBeDisabled();
  await expect(page.locator(".chat__status")).toContainText(/text-direction characters/i);
  await expect(composer(page)).toHaveValue("hi \u202eevil");
  await composer(page).fill("");

  for (const [p, w] of [[narrow, 360], [wide, 1280]] as const) {
    const texts = feed(p).locator(".chat-msg__text");
    await expect(texts).toHaveCount(bodies.length);
    for (const [i, b] of bodies.entries()) await expect(texts.nth(i)).toHaveText(b, { useInnerText: false });
    await expect(feed(p).locator("img, script, iframe, a, strong, em, code, svg[onload]")).toHaveCount(0);
    expect(await p.evaluate(() => (window as unknown as { __pwned: number }).__pwned)).toBe(0);
    // Each text stays inside the feed's width.
    const widths = await p.evaluate(() => {
      const f = document.querySelector(".chat__feed")!.getBoundingClientRect();
      return [...document.querySelectorAll(".chat-msg__text")].map((el) => el.getBoundingClientRect().right - f.right);
    });
    for (const d of widths) expect(d).toBeLessThanOrEqual(1);
    await noOverflow(p, `${w}px`);
    await snap(p, `qa-chat38-hostile-${w}.png`, false);
  }
  for (const p of [narrow, wide]) await p.context().close();
});

test("QA: limits: exactly 500 sends, 501 can't even by Enter; a second tab of the same player is refused by the server's rate limit with the draft kept @chat", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const guest = await player(browser, page);
  const game = await startGame(page.request, { bots: 1, guests: [guest.request], sessionLength: "1w" });
  const tab2 = await page.context().newPage();
  for (const p of [page, tab2, guest]) await loaded(p, game.id);
  for (const p of [page, tab2, guest]) await openChat(p);

  // 8 from the player straight over a socket (fast, so the 10 s window holds on a busy machine), then tab 2,
  // whose own counter is empty, tries: the server refuses and the tab says so, keeping the draft.
  await composer(tab2).fill("from the other tab");
  const oks = await page.evaluate(async (id) => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/games/${id}/ws`);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    const replies: boolean[] = [];
    const done = new Promise<void>((r) =>
      ws.addEventListener("message", (e) => {
        const m = JSON.parse(String(e.data)) as { id?: string; ok?: boolean };
        if (typeof m.id === "string" && m.id.startsWith("qa")) replies.push(m.ok === true);
        if (replies.length === 8) r();
      }),
    );
    for (let i = 1; i <= 8; i++) ws.send(JSON.stringify({ chat: { to: null, text: `burst ${i}` }, id: `qa${i}` }));
    await done;
    ws.close();
    return replies;
  }, game.id);
  expect(oks).toEqual(Array(8).fill(true));
  await sendBtn(tab2).click();
  await expect(tab2.locator(".chat__status")).toContainText(/slow down/i);
  await expect(composer(tab2)).toHaveValue("from the other tab");
  await expect(feed(guest)).toContainText("burst 8");
  await expect(feed(guest)).not.toContainText("from the other tab");
  // The window clears and tab 2 can send again.
  await tab2.waitForTimeout(10_500);
  await say(tab2, "from the other tab");
  await expect(feed(guest)).toContainText("from the other tab");

  await composer(page).fill("y".repeat(501));
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveValue("y".repeat(501));
  await expect(page.locator(".chat__status")).toContainText("Too long by 1");
  await expect(page.locator(".chat__count")).toHaveText("501/500");
  await expect(composer(page)).toHaveAttribute("aria-invalid", "true");
  await say(page, "y".repeat(500));
  await expect(feed(guest).locator(".chat-msg__text").last()).toHaveText("y".repeat(500));
  await tab2.close();
  await guest.context().close();
});

test("QA: unread badges per thread: a DM's badge and the crew's are separate, and opening one clears only it @chat", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const [g1, g2] = [await player(browser, page), await player(browser, page)];
  const game = await startGame(page.request, { bots: 1, guests: [g1.request, g2.request], sessionLength: "1w" });
  for (const p of [page, g1, g2]) await loaded(p, game.id);
  for (const p of [g1, g2]) await openChat(p);
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;

  await dm(g2, /Host/);
  await say(g2, "dm one");
  await say(g2, "dm two");
  await say(g1, "crew one");
  if (!wide) {
    await expect(page.locator(".chat-fab")).toHaveAccessibleName("Open chat, 3 unread");
    await expect(page.locator(".chat-fab .chat-badge")).toHaveText("3");
    await openChat(page);
  }
  // Wide: the panel shows the crew feed, so the crew counts as read at once; the DM doesn't.
  const dmTab = tabs(page).getByRole("button", { name: /^Guest 2 \(direct message\), 2 unread/ });
  await expect(dmTab).toBeVisible();
  await expect(tabs(page).getByRole("button", { name: /^Crew/ })).toHaveAccessibleName(/^Crew\s*$/);
  await dmTab.click();
  await expect(tabs(page).getByRole("button", { name: /^Guest 2/ })).toHaveAccessibleName(/^Guest 2\s*\(direct message\)\s*$/);
  // A crew message while reading the DM badges the crew tab only.
  await say(g1, "crew two");
  await expect(tabs(page).getByRole("button", { name: /^Crew\W*1 unread/ })).toBeVisible();
  await expect(tabs(page).getByRole("button", { name: /^Guest 2/ })).toHaveAccessibleName(/^Guest 2\s*\(direct message\)\s*$/);
  // Read marks survive a reload.
  await tabs(page).getByRole("button", { name: /^Crew/ }).click();
  await page.reload();
  if (!wide) await expect(page.locator(".chat-fab")).toHaveAccessibleName("Open chat");
  await openChat(page);
  await expect(tabs(page).getByRole("button", { name: /unread/ })).toHaveCount(0);
  if (!wide) {
    // A hidden sheet marks nothing read.
    await closeChat(page);
    await say(g1, "crew three");
    await expect(page.locator(".chat-fab")).toHaveAccessibleName("Open chat, 1 unread");
  }
  for (const p of [g1, g2]) await p.context().close();
});

test("QA: two tabs of one player share read marks: a DM read in tab A stays read after tab B reads the crew (QA repro, PR #38) @chat", async ({ page, browser }) => {
  test.skip(!test.info().project.name.startsWith("mobile"), "the sheet decides what's on screen; the docked panel reads the crew at once");
  test.setTimeout(90_000);
  const [g1, g2] = [await player(browser, page), await player(browser, page)];
  const game = await startGame(page.request, { bots: 1, guests: [g1.request, g2.request], sessionLength: "1w" });
  const tabB = await page.context().newPage();
  for (const p of [page, tabB, g1, g2]) await loaded(p, game.id);
  for (const g of [g1, g2]) await openChat(g);
  const fab = (p: Page) => p.locator(".chat-fab");

  await dm(g2, /Host/);
  await say(g2, "dm to host");
  await expect(fab(page)).toHaveAccessibleName("Open chat, 1 unread");
  await expect(fab(tabB)).toHaveAccessibleName("Open chat, 1 unread");
  // Tab A reads the DM; tab B hears about it through storage.
  await openChat(page);
  await tabs(page).getByRole("button", { name: /^Guest 2/ }).click();
  await expect(tabs(page).getByRole("button", { name: /^Guest 2/ })).not.toHaveAccessibleName(/unread/);
  await closeChat(page);
  await expect(fab(tabB)).toHaveAccessibleName("Open chat");
  // A crew message; tab B reads the crew. Its write must not drop tab A's DM mark.
  await say(g1, "crew msg");
  await openChat(tabB);
  await expect(feed(tabB)).toContainText("crew msg");
  await expect(fab(page)).toHaveAccessibleName("Open chat");
  await page.reload();
  await expect(fab(page)).toHaveAccessibleName("Open chat");
  await openChat(page);
  await expect(tabs(page).getByRole("button", { name: /unread/ })).toHaveCount(0);
  // A tab that was closed meanwhile also starts from the merged marks.
  const tabC = await page.context().newPage();
  await loaded(tabC, game.id);
  await expect(fab(tabC)).toHaveAccessibleName("Open chat");
  for (const p of [tabB, tabC]) await p.close();
  for (const g of [g1, g2]) await g.context().close();
});

test("QA: chat survives phase changes (draft kept, event rows), and still works after the game ends, DMs still private @chat", async ({ page, browser }) => {
  test.setTimeout(330_000);
  const errors: string[] = [];
  const [g1, g2] = [await player(browser, page), await player(browser, page)];
  for (const p of [page, g1, g2]) p.on("pageerror", (e) => errors.push(e.message));
  const g2Frames = recordFrames(g2);
  const game = await startGame(page.request, { bots: 1, guests: [g1.request, g2.request] }); // 15 min, ×10 speed
  for (const p of [page, g1, g2]) await p.goto(`/game/${game.id}`);
  for (const p of [page, g1, g2]) await openChat(p);

  const draft = "half-typed thought, don't lose me";
  await composer(page).fill(draft);
  // A round resolves and the next phase starts while the draft sits there.
  const kicker = page.locator(".hud__kicker");
  await expect(kicker).toContainText(/Round [2-9] of 9/, { timeout: 60_000 });
  await expect(composer(page)).toHaveValue(draft);
  await expect(feed(page).locator(".chat-event").first()).toBeVisible();
  await sendBtn(page).click();
  await expect(feed(g1)).toContainText(draft);

  // To the end.
  await expect(page.getByRole("list", { name: "Final ranking" })).toBeVisible({ timeout: 280_000 });
  await openChat(page);
  await expect(page.getByRole("region", { name: "Chat" })).toBeVisible();
  await expect(feed(page)).toContainText(draft); // history kept
  await say(page, "gg crew");
  await expect(feed(g1)).toContainText("gg crew");
  await expect(feed(g2)).toContainText("gg crew");
  await dm(page, /Guest 1/);
  await say(page, "QA-AFTER-END dm");
  await openChat(g1);
  await tabs(g1).getByRole("button", { name: /^Host/ }).click();
  await expect(feed(g1)).toContainText("QA-AFTER-END dm");
  await expect(feed(g2)).toContainText("Host is DMing Guest 1");
  await expect(g2.locator("body")).not.toContainText("QA-AFTER-END");
  expect(g2Frames.join("\n")).not.toContain("QA-AFTER-END");
  // The evidence picker still offers the case file after the end.
  await page.getByRole("button", { name: "Share evidence" }).click();
  await expect(page.getByRole("group", { name: "Share a case-file entry" }).getByRole("button").first()).toBeVisible();
  expect(errors).toEqual([]);
  for (const p of [g1, g2]) await p.context().close();
});

test("QA: someone without a seat (no spectators in M2) gets no chat and no messages @chat", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const guest = await player(browser, page);
  const outsider = await player(browser, page);
  const outsiderFrames = recordFrames(outsider);
  const game = await startGame(page.request, { bots: 1, guests: [guest.request], sessionLength: "1w" });
  await loaded(page, game.id);
  await openChat(page);
  await say(page, "QA-INSIDERS only");
  await outsider.request.post("/api/auth/guest", { data: { nickname: "Nosy" } });
  await outsider.goto(`/game/${game.id}`);
  await expect(outsider.getByRole("heading", { name: "No job here" })).toBeVisible();
  await outsider.waitForTimeout(1500);
  await expect(outsider.locator(".chat, .chat-fab")).toHaveCount(0);
  await expect(outsider.locator("body")).not.toContainText("QA-INSIDERS");
  expect(outsiderFrames.join("\n")).not.toContain("QA-INSIDERS");
  for (const p of [guest, outsider]) await p.context().close();
});

test("QA: layout at 360 and 1280 px with five long-named humans, DM tabs, an evidence card and the pickers open @chat", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const guests = await Promise.all([0, 1, 2, 3].map(() => player(browser, page)));
  await page.request.post("/api/auth/guest", { data: { nickname: "Host" } });
  const res = await page.request.post("/api/games", { data: { settings: { sessionLength: "1w" } } });
  const game = (await res.json()) as { id: string; inviteCode: string };
  const names = ["WWWWWWWWWWWWWWWWWWWWWWWW", "مرحبا مرحبا مرحبا مرحبا", "😀😀😀😀😀😀😀😀😀😀😀😀", "Supercalifragilisticexpi"];
  for (const [i, g] of guests.entries()) expect((await g.request.post(`/api/invites/${game.inviteCode}/join`, { data: { nickname: names[i] } })).ok()).toBe(true);
  expect((await page.request.post(`/api/games/${game.id}/start`, { data: {} })).ok()).toBe(true);
  for (const g of guests) await loaded(g, game.id);
  for (const g of guests) await openChat(g);
  // Everyone DMs the viewer, so the viewer has four DM tabs with long names.
  for (const g of guests) {
    await dm(g, /Host/);
    await say(g, `${"Z".repeat(300)} from a long name`);
  }
  for (const w of [360, 1280]) {
    const view = await page.context().newPage();
    await view.setViewportSize({ width: w, height: 800 });
    await loaded(view, game.id);
    await openChat(view);
    await expect(tabs(view).getByRole("button", { name: /direct message/ })).toHaveCount(4);
    await say(view, "M".repeat(500));
    await view.getByRole("button", { name: "Share evidence" }).click();
    await noOverflow(view, `${w}px evidence picker`);
    const pick = view.getByRole("group", { name: "Share a case-file entry" }).getByRole("button");
    if ((await pick.count()) > 0) {
      await pick.first().click();
      // The share's reply closes whatever picker is open, so wait for it before opening the DM picker.
      await expect(view.getByRole("group", { name: "Share a case-file entry" })).toHaveCount(0);
    }
    await view.getByRole("button", { name: "DM", exact: true }).click();
    await expect(view.getByRole("group", { name: "Message a player privately" }).getByRole("button")).toHaveCount(4);
    await noOverflow(view, `${w}px DM picker`);
    // Targets at least 44 px (touch) in the chat.
    const small = await view.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".chat button, .chat textarea")]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ c: el.className, ...el.getBoundingClientRect().toJSON() }))
        .filter((r) => r.width < 44 || r.height < 44)
        .map((r) => `${r.c} ${Math.round(r.width)}×${Math.round(r.height)}`),
    );
    expect(small, `${w}px small targets`).toEqual([]);
    await snap(view, `qa-chat38-layout-${w}.png`);
    await tabs(view).getByRole("button", { name: /^WWWW/ }).click();
    await noOverflow(view, `${w}px DM thread`);
    await snap(view, `qa-chat38-dm-${w}.png`);
    await view.close();
  }
  for (const g of guests) await g.context().close();
});
