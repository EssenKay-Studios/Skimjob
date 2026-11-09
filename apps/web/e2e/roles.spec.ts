import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// The role card, "Roles in play" and the "This game" rulebook (design §11, §12,
// §15.6, §20) on the gallery at the five launch widths and in a real game, the
// round cap and the Wanted stars and the bank count (design §5.4, §6.1), and the
// lobby's role-list setting (design §11.3). Numbers are never asserted: the balance
// pass tunes them in packages/content. SHOTS_DIR=… saves screenshots per viewport.
const SHOTS = process.env.SHOTS_DIR;

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Every button in `scope` is at least 44 px each way (the 44 px "i" and Close included). */
async function smallTargets(scope: ReturnType<Page["locator"]>) {
  return scope.evaluate((el) =>
    [...el.querySelectorAll("button")].flatMap((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && (r.height < 43.5 || r.width < 43.5) ? [`${b.textContent || b.ariaLabel} ${r.width}×${r.height}`] : [];
    }),
  );
}

test("gallery role card, roles in play and rulebook fit every launch width @roles", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  test.setTimeout(180_000);
  for (const width of [360, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dev/gallery");
    const panel = page.locator('section[aria-labelledby="g-role-card"]');
    await panel.scrollIntoViewIfNeeded();
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // The role card dialog: Lookout, with the three lines and the two buttons.
    await panel.getByRole("button", { name: "Role card", exact: true }).click();
    const card = page.getByRole("dialog", { name: "Lookout" });
    await expect(card).toBeVisible();
    for (const h of ["Power", "How you win", "How to spot it"]) await expect(card.getByText(h, { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Claim role" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Use power" })).toBeVisible();
    expect(await smallTargets(card)).toEqual([]);
    expect((await card.boundingBox())!.width).toBeLessThanOrEqual(width);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/s45-role-card-${width}.png` });
    }
    // design §11.1: a move power (the Lookout's) closes the card and points back at the move.
    await card.getByRole("button", { name: "Use power" }).click();
    await expect(card).toHaveCount(0);

    // Roles in play: a tap on a chip opens that role's card beneath, pressed chip.
    const mole = panel.getByRole("button", { name: "Mole", exact: true });
    await mole.click();
    await expect(mole).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByText("A bell rang more than the people in the room can explain.")).toBeVisible();
    expect(await smallTargets(panel.locator(".rolesinplay"))).toEqual([]);

    // The rulebook: only this game's roles, a column per ~280 px.
    await page.locator('section[aria-labelledby="g-rulebook"]').getByRole("button", { name: "Open the rulebook" }).click();
    const book = page.getByRole("dialog", { name: "This game" });
    await expect(book).toBeVisible();
    for (const h of ["Roles in play", "Black market", "Rooms", "Events", "Numbers", "Terms"]) await expect(book.getByRole("heading", { name: h, level: 3 })).toBeVisible();
    await expect(book.getByRole("list", { name: "This game's black market" }).getByRole("listitem")).toHaveCount(3);
    await expect(book.getByText("More in This game")).toHaveCount(0);
    expect((await book.boundingBox())!.width).toBeLessThanOrEqual(width);
    expect(await smallTargets(book)).toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (SHOTS) {
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/s45-rulebook-${width}.png` });
    }
    await book.locator(".btn", { hasText: "Close" }).click();
    await expect(book).toHaveCount(0);
  }
});

test("a real game: the role card, roles in play, Rules, and More in This game from a tip @roles", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  test.setTimeout(90_000);
  const game = await startGame(page.request, { bots: 4 });
  await page.goto(`/game/${game.id}`);
  const panel = page.locator(".role-card");
  await expect(panel).toContainText("only you see this", { timeout: 20_000 });
  await expect(panel).not.toContainText(/token/i);

  // The tip beside your role name is body text (Inter), not the heading's hand lettering.
  await panel.locator(".role-card__title").getByRole("button", { name: /^About / }).click();
  const tipFont = await page.locator(".infotip__pop:popover-open p").evaluate((el) => getComputedStyle(el).fontFamily);
  expect(tipFont).not.toMatch(/Pangolin/);
  await page.keyboard.press("Escape");

  // The card: Escape closes it and stays in the game.
  await panel.getByRole("button", { name: "Role card", exact: true }).click();
  const card = page.getByRole("dialog").filter({ hasText: "Your role · secret" });
  await expect(card).toBeVisible();
  await expect(card.getByText("How to spot it")).toBeVisible();
  await expect(card.getByText("On a bust, only the Rooftop gets away.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/game/${game.id}$`));

  // Roles in play: the exact list, "(you)" on your own chip, another role's card on a tap.
  const chips = panel.getByRole("list", { name: "Roles in play" }).getByRole("button");
  await expect(chips).toHaveCount(5);
  await expect(panel.getByRole("button", { name: /\(you\)$/ })).toHaveCount(1);
  await chips.filter({ hasNotText: "(you)" }).first().click();
  await expect(panel.getByText("How to spot it")).toBeVisible();

  // Rules: the rulebook lists this game's three perks and the numbers from content.
  await panel.getByRole("button", { name: "Rules", exact: true }).click();
  const book = page.getByRole("dialog", { name: "This game" });
  await expect(book.getByRole("list", { name: "This game's black market" }).getByRole("listitem")).toHaveCount(3);
  await expect(book.getByText(/^\d bulbs; the \d(st|nd|rd|th) is a raid$/)).toBeVisible();
  await expect(book.getByText(/\bact(s|ed)?\b/i)).toHaveCount(0);
  // A tip title inside the rulebook is as big, and as plain, as one outside it.
  const titleStyle = () => page.locator(".infotip__pop:popover-open h3").evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).textDecorationLine]);
  await book.getByRole("button", { name: /^About / }).first().click();
  const inside = await titleStyle();
  await page.keyboard.press("Escape");
  await book.locator(".btn", { hasText: "Close" }).click();
  await expect(book).toHaveCount(0);
  await page.getByRole("button", { name: "About Bank" }).click();
  expect(await titleStyle()).toEqual(inside);
  expect(inside[1]).toBe("none");
  await page.keyboard.press("Escape");

  // Every tip ends with "More in This game", which opens the rulebook.
  await page.getByRole("button", { name: "About Bank" }).click();
  await page.getByRole("button", { name: "More in This game" }).click();
  await expect(page.getByRole("dialog", { name: "This game" })).toBeVisible();
});

test("a real game shows the round cap, the Wanted stars and the bank count @shop", async ({ page }) => {
  test.setTimeout(90_000);
  const game = await startGame(page.request, { bots: 4 });
  await page.goto(`/game/${game.id}`);
  // design §6.2: 12 rounds at most.
  await expect(page.locator(".hud__kicker")).toContainText(/^Round 1 of 12$/);
  // design §5.4: Wanted is public from the start.
  await expect(page.getByRole("img", { name: /^Wanted \d of 3$/ })).toBeVisible();
  // design §6.1: the bank starts full, "N/total".
  await expect(page.locator(".hud__bank .hud__big")).toHaveText(/^(\d+)\/\1$/);
});

test("lobby: the role list persists, and there is no deck, deal or role picker (design §11.3, §16) @lobby", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  await page.goto("/");
  await page.getByRole("button", { name: "Plan a heist" }).click();
  await page.getByLabel("Your name in this game").fill("Mara");
  await page.getByRole("button", { name: "Open the lobby" }).click();
  await expect(page).toHaveURL(/\/lobby\//);
  const group = (name: string) => page.getByRole("group", { name, exact: true });
  await group("Session length").getByRole("button", { name: "1 hour" }).click();

  // design §11.3: every player gets a role by the standard deal; the host only picks what the crew is told.
  await expect(group("Deck")).toHaveCount(0);
  await expect(group("Deal")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pick roles one by one" })).toHaveCount(0);
  await group("Role list").getByRole("button", { name: "Possible" }).click();
  await expect(group("Role list").getByRole("button", { name: "Possible" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(group("Role list").getByRole("button", { name: "Possible" })).toHaveAttribute("aria-pressed", "true");
  // The 15-minute length keeps the host's role list.
  await group("Session length").getByRole("button", { name: "15 min" }).click();
  await expect(group("Session length").getByRole("button", { name: "15 min" })).toHaveAttribute("aria-pressed", "true");
  await expect(group("Role list").getByRole("button", { name: "Possible" })).toHaveAttribute("aria-pressed", "true");
});
