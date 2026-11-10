// QA for PR #200 (S4: the live game in GameShell, one Modal base, swipe-dismiss).
// Chat sent from the phone sheet and the laptop panel; the grip swipe at the
// threshold (touch and mouse; short drags spring back; the sheet body still
// scrolls); nested modals (the vote window over the "This round" sheet: Esc
// closes the top one only, the scroll lock goes once both are shut); 12 seats
// with 24-character names at 360 and 1280; a resize from phone to laptop with a
// sheet open; and no R6 grid / chat dock / chat button left in the repo.
// SHOTS_DIR=… saves a screenshot of every panel at every launch width.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { pickRoom } from "./move";
import { callEmergency, chatTab, expectRankingReadable, openPanel, showResult, startGame, type PanelName } from "./setupGame";

const SHOTS = process.env.SHOTS_DIR;
const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

test.beforeEach(({}, info) => test.skip(!info.project.name.startsWith("mobile"), "viewports are set per test"));

async function ok<T>(res: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png` });
}

/** No sideways scroll, and no target under 44 px. */
async function fits(page: Page, what: string) {
  const o = await page.evaluate(() => {
    const small = [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [role=button]")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => r.width > 0 && !el.closest("[inert]") && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, small };
  });
  expect(o.scroll, `${what}: no sideways scroll`).toBeLessThanOrEqual(o.client);
  expect(o.small, `${what}: targets ≥ 44 px`).toEqual([]);
}

const newPage = async (browser: Browser, width: number, height: number) => {
  const wide = width >= 1024;
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: !wide, isMobile: !wide });
  return { ctx, page: await ctx.newPage() };
};
const modalOpen = (page: Page) => page.evaluate(() => document.documentElement.classList.contains("modal-open"));
const composer = (page: Page) => page.locator(".chat__input");

test("chat: a message sent from the phone sheet and one from the laptop panel reach each other @chat", async ({ browser }) => {
  test.setTimeout(90_000);
  const phone = await newPage(browser, 390, 844);
  const laptop = await newPage(browser, 1280, 800);
  const game = await startGame(phone.page.request, { bots: 1, guests: [laptop.page.request], sessionLength: "1w" });
  for (const p of [phone.page, laptop.page]) await p.goto(`/game/${game.id}`);
  await openPanel(phone.page, "Chat");
  await expect(phone.page.getByRole("dialog", { name: "Chat" })).toBeVisible();
  await composer(phone.page).fill("from the sheet");
  await composer(phone.page).press("Enter");
  await expect(composer(phone.page)).toHaveValue("");
  await expect(chatTab(laptop.page)).toHaveAccessibleName("Chat, 1 new", { timeout: 15_000 });
  await openPanel(laptop.page, "Chat");
  await expect(laptop.page.locator(".chat__feed")).toContainText("from the sheet");
  await expect(chatTab(laptop.page)).toHaveAccessibleName("Chat");
  await composer(laptop.page).fill("from the panel");
  await laptop.page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(phone.page.locator(".chat__feed")).toContainText("from the panel", { timeout: 15_000 });
  // The sheet is still up after sending, and the composer is on screen.
  await expect(phone.page.getByRole("dialog", { name: "Chat" })).toBeVisible();
  const c = (await composer(phone.page).boundingBox())!;
  expect(c.y + c.height).toBeLessThanOrEqual(844);
  await phone.ctx.close();
  await laptop.ctx.close();
});

test("swipe: 79 px springs back, 81 px dismisses, by touch and mouse; a cancelled drag resets; the body still scrolls @shell", async ({ browser }) => {
  test.setTimeout(60_000);
  const { ctx, page } = await newPage(browser, 390, 844);
  const game = await startGame(page.request, { bots: 3, sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  const cdp = await ctx.newCDPSession(page);
  const sheet = page.locator("dialog.bsheet[open]");
  const grip = page.locator(".bsheet__grip");
  const transform = () => page.locator(".bsheet__sheet").evaluate((el) => (el as HTMLElement).style.transform);
  const start = async () => {
    await settle(page);
    const b = (await grip.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const touch = async (dy: number, end: "touchEnd" | "touchCancel" = "touchEnd") => {
    const { x, y } = await start();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 5; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (dy * i) / 5 }] });
    if (end === "touchCancel") await expect.poll(transform).toBe(`translateY(${dy}px)`);
    await cdp.send("Input.dispatchTouchEvent", { type: end, touchPoints: [] });
  };
  const mouse = async (dy: number) => {
    const { x, y } = await start();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy, { steps: 5 });
    await page.mouse.up();
  };

  await openPanel(page, "Crew");
  expect(await page.locator(".bsheet__body").evaluate((el) => getComputedStyle(el).touchAction)).not.toBe("none");
  await touch(79);
  await expect(sheet).toHaveCount(1);
  await expect.poll(transform).toBe("");
  await mouse(79);
  await expect(sheet).toHaveCount(1);
  await expect.poll(transform).toBe("");
  // A drag the browser cancels (a scroll took over) springs back and keeps the sheet.
  await touch(150, "touchCancel");
  await expect(sheet).toHaveCount(1);
  await expect.poll(transform).toBe("");
  await touch(81);
  await expect(sheet).toHaveCount(0);
  expect(await modalOpen(page)).toBe(false);
  await openPanel(page, "Crew");
  await mouse(81);
  await expect(sheet).toHaveCount(0);
  await ctx.close();
});

test("nested modals: the vote window over the This round sheet; Esc closes the top one only, the lock goes with the last @meeting", async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await newPage(browser, 390, 844);
  const game = await startGame(page.request, { bots: 3, sessionLength: "1h" });
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "This round");
  await callEmergency(page);
  // A meeting opening switches an open Chat sheet to "This round", with the vote window over it.
  await openPanel(page, "Chat");
  const vote = page.getByRole("dialog", { name: "Who's skimming?" });
  await expect(vote).toBeVisible({ timeout: 30_000 });
  const sheet = page.locator("dialog.bsheet[open]");
  await expect(sheet.locator(".bsheet__head h2")).toHaveText("This round");
  await settle(page);
  // The vote window is on top: the point at its centre belongs to it.
  const b = (await vote.boundingBox())!;
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest("dialog.dialog"), [b.x + b.width / 2, b.y + b.height / 2])).toBe(true);
  await shot(page, "nested-vote");
  await page.keyboard.press("Escape");
  await expect(vote).toBeHidden();
  await expect(sheet).toHaveCount(1);
  expect(await modalOpen(page)).toBe(true);
  // Focus is somewhere in the sheet, not on the page behind.
  expect(await sheet.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  expect(await modalOpen(page)).toBe(false);
  await ctx.close();
});

const LONG = (i: number) => `${String.fromCharCode(65 + i)}${"W".repeat(23)}`;

test("12 seats with 24-character names: Crew and HUD fit at 360 and 1280 @shell", async ({ browser, playwright }, info) => {
  test.setTimeout(120_000);
  const host = await newPage(browser, 360, 740);
  const req = host.page.request;
  await ok(await req.post("/api/auth/guest", { data: { nickname: LONG(0) } }));
  const game = await ok<{ id: string; inviteCode: string }>(await req.post("/api/games", { data: { settings: { sessionLength: "1w" } } }));
  const guests: APIRequestContext[] = [];
  for (let i = 1; i < 12; i++) {
    const g = await playwright.request.newContext({ baseURL: info.project.use.baseURL! });
    guests.push(g);
    await ok(await g.post(`/api/invites/${game.inviteCode}/join`, { data: { nickname: LONG(i) } }));
  }
  await ok(await req.post(`/api/games/${game.id}/start`, { data: {} }));
  for (const [width, height] of [
    [360, 740],
    [1280, 800],
  ] as const) {
    await host.page.setViewportSize({ width, height });
    await host.page.goto(`/game/${game.id}`);
    await openPanel(host.page, "Crew");
    const crew = width >= 1024 ? host.page.locator(".shell__left") : host.page.locator("dialog.bsheet[open]");
    for (let i = 1; i < 12; i++) await expect(crew).toContainText(LONG(i));
    await settle(host.page);
    await fits(host.page, `crew at ${width}`);
    // Nothing in the Crew panel pokes out of it sideways.
    const out = await crew.evaluate((root) => {
      const r = root.getBoundingClientRect();
      return [...root.querySelectorAll<HTMLElement>("*")]
        .filter((x) => {
          if (x.closest("svg")) return false; // the frames' drawn outlines and hatched shadows hang a little past their box by design
          const b = x.getBoundingClientRect();
          return b.width > 0 && (b.right > r.right + 0.5 || b.left < r.left - 0.5);
        })
        .map((x) => `${x.tagName}.${x.getAttribute("class")} ${x.getBoundingClientRect().left.toFixed(1)}..${x.getBoundingClientRect().right.toFixed(1)} in ${r.left.toFixed(1)}..${r.right.toFixed(1)}`);
    });
    expect(out).toEqual([]);
    await shot(host.page, "crew-12x24");
  }
  for (const g of guests) await g.dispose();
  await host.ctx.close();
});

test("resize from phone to laptop with a sheet open: the sheet goes, the lock goes, it does not come back @shell", async ({ browser }) => {
  test.setTimeout(60_000);
  const { ctx, page } = await newPage(browser, 390, 844);
  const game = await startGame(page.request, { bots: 3, sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "Notes");
  await expect(page.locator("dialog.bsheet[open]")).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Side panel" })).toBeVisible();
  expect(await modalOpen(page)).toBe(false);
  // Nothing behind is left inert, and the side tabs work.
  expect(await page.locator("[inert]").count()).toBe(0);
  await page.getByRole("group", { name: "Side panel" }).getByRole("button", { name: /^Case/ }).click();
  await expect(page.getByRole("group", { name: "Side panel" }).getByRole("button", { name: /^Case/ })).toHaveAttribute("aria-pressed", "true");
  await fits(page, "after resize");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Game panels" })).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await openPanel(page, "Chat");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(chatTab(page)).toBeFocused();
  await ctx.close();
});

test("no game-grid, chat-dock or chat-fab left anywhere in the repo @shell", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const words = ["game" + "-grid", "chat" + "-dock", "chat" + "-fab", "chat-sheet" + "-open", "game" + "-page", "Game" + "Chat\\b(?!\\.tsx)"];
  let found = "";
  try {
    found = execFileSync("git", ["grep", "-nP", words.join("|"), "--", ".", ":!apps/web/e2e/game-shell.qa.spec.ts", ":!docs/archive"], { cwd: root, encoding: "utf8" });
  } catch (e) {
    if ((e as { status?: number }).status !== 1) throw e; // 1: no match
  }
  // useGameChat and the file name GameChat.tsx stay; the component is gone.
  expect(found.split("\n").filter((l) => l && !/useGameChat|GameChat\.tsx|\.\/GameChat"/.test(l))).toEqual([]);
});

// Screenshots of the live game at every width: each panel, the chat sheet half-swiped, and the 1280 top bar.
for (const { width, height } of VIEWPORTS) {
  test(`live game in the shell at ${width}: every panel fits, top bar lines up @shell`, async ({ browser }) => {
    test.setTimeout(90_000);
    const { ctx, page } = await newPage(browser, width, height);
    const game = await startGame(page.request, { bots: 5, sessionLength: "1w" });
    await page.goto(`/game/${game.id}`);
    await expect(page.locator(".hud__kicker")).toContainText(/Round 1 of/);
    await openPanel(page, "This round");
    await pickRoom(page, "Office");
    await openPanel(page, "Chat");
    for (const text of ["Anyone hitting the vault?", "Not me. Office for me, honest."]) {
      await composer(page).fill(text);
      await composer(page).press("Enter");
      await expect(page.locator(".chat__feed")).toContainText(text);
    }
    if (width < 1024) await openPanel(page, "Crew");
    await shot(page, "shell");
    for (const name of ["Crew", "Case", "Notes", "Chat", "This round"] satisfies PanelName[]) {
      await openPanel(page, name);
      await settle(page);
      await fits(page, `${name} at ${width}`);
      if (width < 1024) {
        const s = (await page.locator(".bsheet__sheet").boundingBox())!;
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x + s.width).toBeLessThanOrEqual(width);
        expect(s.y).toBeGreaterThanOrEqual(0);
      }
      await shot(page, `panel-${name.replace(" ", "-").toLowerCase()}`);
    }
    if (width < 1024) {
      // Half a swipe: the sheet follows the finger and the page stays dimmed behind it.
      await openPanel(page, "Chat");
      await settle(page);
      const b = (await page.locator(".bsheet__grip").boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 60, { steps: 4 });
      expect(await page.locator(".bsheet__sheet").evaluate((el) => (el as HTMLElement).style.transform)).toBe("translateY(60px)");
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-halfswipe-${width}.png` });
      await page.mouse.up();
      await expect(page.locator("dialog.bsheet[open]")).toHaveCount(1);
    } else {
      // Round-1 bug: the laptop Chat tab's composer was 52/92 px wide and sat under the frame. It must span the tab and show unscrolled.
      await openPanel(page, "Chat");
      const tab = (await page.locator(".shell__left .shell__scroll").boundingBox())!;
      const box = (await composer(page).boundingBox())!;
      const send = (await page.locator(".shell__left .chat__send").boundingBox())!;
      expect(box.width, "composer spans the tab").toBeGreaterThanOrEqual(tab.width * 0.7);
      expect(box.y + box.height, "composer shows unscrolled").toBeLessThanOrEqual(tab.y + tab.height + 1);
      expect(send.y + send.height, "Send shows unscrolled").toBeLessThanOrEqual(tab.y + tab.height + 1);
      // Round-2 bug: the chat frame's padding was 0 px sideways, so its outline cut through the text. Every child keeps ≥ 8 px inside it.
      const inset = await page.locator(".shell__left .shell-chat").evaluate((frame) => {
        const f = frame.getBoundingClientRect();
        const kids = [...frame.querySelectorAll(".chat__feed, .chat__compose-row, .chat__note, .chat__tabs, .chat__send")].filter((el) => el.getBoundingClientRect().width > 0);
        return Math.min(...kids.map((el) => { const r = el.getBoundingClientRect(); return Math.min(r.left - f.left, f.right - r.right); }));
      });
      expect(inset, "chat contents stay off the frame outline").toBeGreaterThanOrEqual(8);
      const strip = (await page.locator(".shell__status").boundingBox())!;
      const logo = (await page.locator(".topbar__home > :first-child").first().boundingBox())!;
      expect(Math.abs(logo.x - strip.x)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: SHOTS ? `${SHOTS}/topbar-${width}.png` : test.info().outputPath("topbar.png"), clip: { x: 0, y: 0, width, height: strip.y + strip.height + 10 } });
    }
    await ctx.close();
  });
}

// Round-2 blocker: a toast must not cover the phone tab bar or the dock, at any narrow width, even with two toasts stacked.
for (const { width, height } of VIEWPORTS.filter((v) => v.width < 1024)) {
  test(`toasts at ${width}: clear of the tab bar and the dock, and the tabs take taps @shell`, async ({ browser }) => {
    test.setTimeout(60_000);
    const { ctx, page } = await newPage(browser, width, height);
    const game = await startGame(page.request, { bots: 3, sessionLength: "1w" });
    await page.goto(`/game/${game.id}`);
    await openPanel(page, "This round");
    await pickRoom(page, "Office");
    await page.getByRole("button", { name: "Lock it in" }).click();
    await openPanel(page, "Chat");
    await composer(page).fill("toast check");
    await composer(page).press("Enter");
    await page.locator(".bsheet__close").click();
    const toasts = page.locator(".toasts");
    await expect(page.locator(".toast").first()).toBeVisible();
    await settle(page);
    const t = (await toasts.boundingBox())!;
    for (const part of [".shell__tabs", ".shell__dock"]) {
      const b = (await page.locator(part).boundingBox())!;
      expect(t.y + t.height, `toasts end above ${part} at ${width}`).toBeLessThanOrEqual(b.y);
    }
    await shot(page, "toast");
    await page.getByRole("navigation", { name: "Game panels" }).getByRole("button", { name: /^Notes/ }).click();
    await expect(page.locator("dialog.bsheet[open]")).toHaveCount(1);
    await ctx.close();
  });
}

test("finished game: The result panel at every width @fast-clock @reveal", async ({ browser }, info) => {
  test.skip(info.project.name !== "mobile-fast", "one game, the widths are set here");
  test.setTimeout(400_000);
  const { ctx, page } = await newPage(browser, 390, 844);
  const game = await startGame(page.request, { bots: 3, sessionLength: "15m" });
  await page.goto(`/game/${game.id}`);
  await showResult(page, 360_000);
  for (const { width, height } of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    await showResult(page);
    await fits(page, `result at ${width}`);
    // Round-1 bug: at 1024/1280 the ranking names wrapped one letter per line. Every name gets at least 40 px.
    // The layout swap at 1024 px and the frames' redraw take a moment: a squeezed name that stays squeezed fails.
    await expect(async () => {
      const narrow = await page.locator(".ranking__who").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width < 40).map((e) => e.textContent));
      expect(narrow, `ranking names at ${width}`).toEqual([]);
    }).toPass({ timeout: 5_000 });
    await expectRankingReadable(page);
    await shot(page, "result");
  }
  await ctx.close();
});
