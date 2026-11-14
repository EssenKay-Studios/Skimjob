import { mkdirSync } from "node:fs";
import { ROLES, TERMS, TIPS } from "@skimjob/content";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { closePanel, openPanel, settle, DEFAULT_SEED } from "./setupGame";

// QA for PR #207 (S4.5; design §11.3, §15.6, §18, §20): the role card, Roles in
// play and the "This game" rulebook in real bot games with Exact, Possible and
// Hidden role lists at the five launch widths (no overflow, 44 px targets, nothing
// hidden from the crew leaks), the pinned-tip rules on the HUD meters, and focus
// handling of the dialogs. SHOTS_DIR=… saves screenshots.
const SHOTS = process.env.SHOTS_DIR;
const WIDTHS = [360, 390, 768, 1024, 1280];
type List = "exact" | "possible" | "hidden";

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "viewports are set per test"));

async function ok<T>(res: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}
/** A started 5-seat bot game (you + 4 bots) with this role list. */
async function botGame(page: Page, roleList: List) {
  const r = page.request;
  await ok(await r.post("/api/auth/guest", { data: { nickname: "Sam" } }));
  const game = await ok<{ id: string }>(await r.post("/api/games", { data: { settings: { sessionLength: "1h", roleList } } }));
  for (let i = 0; i < 4; i++) await ok(await r.post(`/api/games/${game.id}/bots`, { data: {} }));
  await ok(await r.post(`/api/games/${game.id}/start`, { data: { seed: DEFAULT_SEED } }));
  await ok(await r.patch("/api/me", { data: { tips: false } })); // no teaching pop-up (design §15.6) over the cards
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "This round"); // below 1024 px the role card is in this sheet
  const panel = page.locator(".role-card");
  await expect(panel).toContainText("only you see this", { timeout: 20_000 });
  return panel;
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** Visible buttons under 44 px either way. */
const small = (scope: Locator) =>
  scope.evaluate((el) =>
    [...el.querySelectorAll("button")].flatMap((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && (r.height < 43.5 || r.width < 43.5) ? [`${b.textContent || b.ariaLabel} ${r.width}×${r.height}`] : [];
    }),
  );
/** Text that is cut off: an element whose content is wider than its box while it hides overflow. */
const clipped = (scope: Locator) =>
  scope.evaluate((el) =>
    [el, ...el.querySelectorAll("*")].flatMap((n) => {
      const s = getComputedStyle(n);
      return n.scrollWidth > n.clientWidth + 1 && /hidden|clip/.test(s.overflowX) && n.clientWidth > 0 ? [`${n.className} ${n.scrollWidth}>${n.clientWidth}`] : [];
    }),
  );
async function shot(page: Page, name: string, el?: Locator) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  await (el ?? page).screenshot({ path: `${SHOTS}/${name}.png` });
}
const pop = (page: Page) => page.locator(".infotip__pop:popover-open");

for (const list of ["exact", "possible", "hidden"] as const) {
  test(`a real game with a ${list} role list: role card, roles in play and the rulebook at every launch width @roles`, async ({ page }) => {
    test.setTimeout(240_000);
    const panel = await botGame(page, list);
    const myRole = await panel.locator("#role-h").evaluate((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim());
    const rip = panel.locator(".rolesinplay");
    const chips = rip.locator(".rolesinplay__chips").getByRole("button");
    // design §11.3: exact = the dealt roles once each (5 seats); possible = every role; hidden = none.
    if (list === "exact") {
      await expect(rip.getByText(/^exact list · 5 dealt$/)).toBeVisible();
      await expect(panel.getByRole("button", { name: /\(you\)$/ })).toHaveCount(1);
    } else if (list === "possible") {
      await expect(chips).toHaveCount(Object.keys(ROLES).length);
      await expect(rip).not.toContainText(/dealt|×\d/);
      await expect(rip.getByText(/\(you\)/)).toHaveCount(1);
    } else {
      await expect(chips).toHaveCount(0);
      await expect(rip).toContainText("hidden in this game");
    }
    // design §18: no other seat's role anywhere in the page's markup or ARIA (the bots are named "<Name>B").
    const dom = await page.content();
    expect(dom).not.toMatch(/data-role=|"role":"/);
    const tree = await page.locator("body").ariaSnapshot();
    expect(tree).not.toMatch(/[a-z]B\b[^\n]*(Lookout|Locksmith|Detective|Auditor|Smooth Talker|Hacker|Electrician|Priest|Mole|Fixer)/);

    for (const width of list === "exact" ? WIDTHS : [360, 1280]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await expect(page.locator(".shell--wide")).toHaveCount(width >= 1024 ? 1 : 0); // the layout swap at 1024 px remounts the panel and closes the sheet
      await openPanel(page, "This round");
      await panel.scrollIntoViewIfNeeded();
      expect(await overflow(page), `${width} page`).toBeLessThanOrEqual(0);
      expect(await small(panel), `${width} panel`).toEqual([]);
      expect(await clipped(panel), `${width} panel`).toEqual([]);
      if ((await chips.count()) > 1) await chips.filter({ hasNotText: "(you)" }).first().click();
      await shot(page, `${list}-${width}-panel`, panel);

      // The role card: focus goes in, Esc closes it and gives it back to "Role card".
      const open = panel.getByRole("button", { name: "Role card", exact: true });
      await open.focus();
      await page.keyboard.press("Enter");
      const card = page.getByRole("dialog", { name: myRole });
      await expect(card).toBeVisible();
      await expect(card.locator("#role-card-h")).toHaveText(myRole);
      expect(await card.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      await settle(page);
      expect((await card.boundingBox())!.width).toBeLessThanOrEqual(width);
      expect(await small(card), `${width} card`).toEqual([]);
      expect(await clipped(card), `${width} card`).toEqual([]);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await shot(page, `${list}-${width}-card`);
      await page.keyboard.press("Escape");
      await expect(card).toHaveCount(0);
      await expect(open).toBeFocused();

      // The rulebook: this game's list only, then its bottom (Numbers, Terms).
      await panel.getByRole("button", { name: "Rules", exact: true }).click();
      const book = page.getByRole("dialog", { name: "This game" });
      await expect(book).toBeVisible();
      const rows = book.locator('section[aria-labelledby="rb-roles"] li');
      await expect(rows).toHaveCount(list === "hidden" ? 0 : list === "possible" ? Object.keys(ROLES).length : await chips.count());
      await settle(page);
      expect((await book.boundingBox())!.width).toBeLessThanOrEqual(width);
      expect(await small(book), `${width} book`).toEqual([]);
      expect(await clipped(book), `${width} book`).toEqual([]);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await shot(page, `${list}-${width}-rulebook-top`);
      // A perk's tip inside the rulebook: no "More in This game" there.
      const perkTip = book.getByRole("list", { name: "This game's black market" }).getByRole("button", { name: /^About / }).first();
      await perkTip.scrollIntoViewIfNeeded();
      await perkTip.click();
      await expect(pop(page)).toBeVisible();
      await expect(pop(page).getByText("More in This game")).toHaveCount(0);
      await shot(page, `${list}-${width}-rulebook-perktip`);
      await page.keyboard.press("Escape");
      await expect(pop(page)).toHaveCount(0);
      await expect(book).toBeVisible(); // Esc closes the tip, not the rulebook
      await book.getByRole("heading", { name: "Terms", level: 3 }).scrollIntoViewIfNeeded();
      await shot(page, `${list}-${width}-rulebook-bottom`);
      await book.locator(".btn", { hasText: "Close" }).click();
      await expect(book).toHaveCount(0);

      // A role tip and a meter tip (Wanted), each ending with "More in This game".
      // Re-check (QA round 1): the role tip is body text, not the h2's Pangolin, and the h2 is just the name.
      await expect(panel.getByRole("heading", { level: 2, name: myRole, exact: true })).toBeVisible();
      await panel.getByRole("button", { name: `About ${myRole}` }).click();
      await expect(pop(page).getByRole("button", { name: "More in This game" })).toBeVisible();
      const fonts = await pop(page).evaluate((el) => [el, ...el.querySelectorAll("p")].map((n) => `${getComputedStyle(n).fontFamily} ${getComputedStyle(n).fontWeight}`));
      for (const f of fonts.slice(1)) expect(f, `${width} role tip body`).not.toMatch(/Pangolin|700/);
      await shot(page, `${list}-${width}-roletip`);
      await page.keyboard.press("Escape");
      if (list === "exact") {
        await closePanel(page); // the HUD is behind the sheet on phones
        const wanted = page.getByRole("button", { name: "About Wanted" });
        await wanted.scrollIntoViewIfNeeded();
        await wanted.click();
        await expect(pop(page)).toContainText(TERMS.wanted.text);
        const t = (await pop(page).boundingBox())!;
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x + t.width).toBeLessThanOrEqual(width);
        await shot(page, `${list}-${width}-metertip`);
        await page.keyboard.press("Escape");
      }
    }
  });
}

test("pinned tips on the HUD: hover another i, Esc, a tap elsewhere and a scroll @roles", async ({ page }) => {
  test.setTimeout(90_000);
  await botGame(page, "exact");
  const bank = page.getByRole("button", { name: "About Bank" });
  const wanted = page.getByRole("button", { name: "About Wanted" });
  const share = page.getByRole("button", { name: "About Share" });

  // Hovering another "i" neither closes the pinned tip nor previews its own.
  await bank.click();
  await expect(pop(page)).toContainText(TIPS.bank.text);
  await wanted.hover();
  await settle(page);
  await expect(pop(page)).toHaveCount(1);
  await expect(pop(page)).toContainText(TIPS.bank.text);
  await expect(wanted).toHaveAttribute("aria-expanded", "false");
  await share.hover();
  await settle(page);
  await expect(share).toHaveAttribute("aria-expanded", "false");

  // Esc closes it and keeps the focus on its "i".
  await page.keyboard.press("Escape");
  await expect(pop(page)).toHaveCount(0);
  await expect(bank).toBeFocused();

  // A tap elsewhere closes it.
  await page.mouse.move(0, 0);
  await bank.click();
  await expect(pop(page)).toHaveCount(1);
  await page.locator(".hud__title").click();
  await expect(pop(page)).toHaveCount(0);

  // A click on another "i" moves the pin there.
  await bank.click();
  await wanted.click();
  await expect(pop(page)).toHaveCount(1);
  await expect(pop(page)).toContainText(TERMS.wanted.text);
  await expect(bank).toHaveAttribute("aria-expanded", "false");

  // A scroll that takes the "i" off the screen closes it.
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 600 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await bank.click();
  await expect(pop(page)).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(pop(page)).toHaveCount(0);
  await expect(bank).toHaveAttribute("aria-expanded", "false");
});

test("keyboard: Tab reaches every tip in the rulebook, and Esc on a pinned tip leaves the rulebook open @roles", async ({ page }) => {
  test.setTimeout(90_000);
  const panel = await botGame(page, "exact");
  const rules = panel.getByRole("button", { name: "Rules", exact: true });
  await rules.focus();
  await page.keyboard.press("Enter");
  const book = page.getByRole("dialog", { name: "This game" });
  await expect(book).toBeVisible();
  const tips = book.getByRole("button", { name: /^About / });
  const want = await tips.count();
  expect(want).toBeGreaterThanOrEqual(3 + 1); // three perks and at least one role
  const reached = new Set<string>();
  for (let i = 0; i < 60 && reached.size < want; i++) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    if (name.startsWith("About ")) reached.add(name);
    expect(await book.evaluate((el) => el.contains(document.activeElement))).toBe(true); // focus stays in the dialog
  }
  expect(reached.size).toBe(new Set(await tips.evaluateAll((b) => b.map((x) => x.getAttribute("aria-label")))).size);
  await page.keyboard.press("Enter");
  await expect(pop(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(pop(page)).toHaveCount(0);
  await expect(book).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(book).toHaveCount(0);
  await expect(rules).toBeFocused();
});

test("a tip opened inside the rulebook looks like any other tip: 16 px title, no section squiggle (board 4b) @roles", async ({ page }) => {
  test.setTimeout(90_000);
  const panel = await botGame(page, "exact");
  const title = () => pop(page).locator("h3").evaluate((el) => { const s = getComputedStyle(el); return `${s.fontSize} ${s.textDecorationLine}`; });
  await page.getByRole("button", { name: "About Wanted" }).click();
  const hud = await title();
  expect(hud).toBe("16px none");
  await page.keyboard.press("Escape");
  await panel.getByRole("button", { name: "Rules", exact: true }).click();
  const book = page.getByRole("dialog", { name: "This game" });
  const perk = book.getByRole("list", { name: "This game's black market" }).getByRole("button", { name: /^About / }).first();
  for (const [what, tip] of [["perk", perk], ["room", book.getByRole("button", { name: "About Vault" })]] as const) {
    await tip.click();
    expect(await title(), `${what} tip title`).toBe(hud);
    await page.keyboard.press("Escape");
  }
});

test("QA round 4: a tip inside the rulebook has the same header, title, body and close layout as one outside it, at 360 and 1280 (board 4b) @roles", async ({ page }) => {
  test.setTimeout(120_000);
  const panel = await botGame(page, "exact");
  // Layout and the tip's own type only: the body's weight is inherited from where the "i" sits (the HUD's
  // 600 predates #207), so it is left out.
  const look = () =>
    pop(page).evaluate((el) => {
      const pick = (q: string, keys: string[]) => { const s = getComputedStyle(el.querySelector(q)!) as unknown as Record<string, string>; return Object.fromEntries(keys.map((k) => [k, s[k]])); };
      const head = el.querySelector(".infotip__head")!.getBoundingClientRect();
      const x = el.querySelector(".infotip__close")!.getBoundingClientRect();
      return {
        head: pick(".infotip__head", ["display", "flexWrap", "alignItems", "justifyContent", "columnGap", "rowGap", "margin"]),
        title: pick(".infotip__head h3", ["fontFamily", "fontSize", "textDecorationLine", "margin", "flexGrow"]),
        body: pick(":scope p", ["fontFamily", "fontSize", "margin", "overflowWrap"]),
        closeBox: `${Math.round(x.width)}x${Math.round(x.height)}`,
        closeRight: Math.round(head.right - x.right),
        oneRow: Math.abs(x.top + x.height / 2 - (head.top + head.height / 2)) < 2,
      };
    });
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".shell--wide")).toHaveCount(width >= 1024 ? 1 : 0);
    await closePanel(page); // the HUD is behind the sheet on phones
    await page.getByRole("button", { name: "About Bank" }).click();
    const outside = await look();
    await shot(page, `r4-${width}-tip-outside`, pop(page));
    await page.keyboard.press("Escape");
    await openPanel(page, "This round");
    await panel.getByRole("button", { name: "Rules", exact: true }).click();
    const book = page.getByRole("dialog", { name: "This game" });
    for (const [what, tip] of [
      ["perk", book.getByRole("list", { name: "This game's black market" }).getByRole("button", { name: /^About / }).first()],
      ["room", book.getByRole("button", { name: "About Vault" })],
    ] as const) {
      await tip.scrollIntoViewIfNeeded();
      await tip.click();
      const inside = await look();
      await shot(page, `r4-${width}-tip-inside-${what}`, pop(page));
      await shot(page, `r4-${width}-tip-inside-${what}-page`);
      expect(inside, `${what} tip at ${width}`).toEqual(outside);
      expect(inside.oneRow).toBe(true);
      await page.keyboard.press("Escape");
    }
    // The section headers keep their own layout.
    const sec = await book.locator(".rulebook__sec > header").first().evaluate((h) => { const s = getComputedStyle(h); const t = getComputedStyle(h.querySelector("h3")!); return `${s.justifyContent} ${s.alignItems} ${t.fontSize} ${t.textDecorationLine}`; });
    expect(sec).toBe("space-between baseline 22px underline");
    await book.locator(".btn", { hasText: "Close" }).click();
    await expect(book).toHaveCount(0);
  }
});

test("the bell tip in the gallery at every launch width (board 4b) @infotip", async ({ page }) => {
  test.setTimeout(90_000);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/dev/gallery");
    const bell = page.getByRole("button", { name: "About Bell" }).first();
    await bell.scrollIntoViewIfNeeded();
    await bell.click();
    await expect(pop(page)).toContainText(TIPS.bell.text);
    const t = (await pop(page).boundingBox())!;
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width).toBeLessThanOrEqual(width);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shot(page, `gallery-${width}-belltip`);
  }
});
