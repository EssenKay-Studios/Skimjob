import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { clearMeeting } from "./meetingCards";
import { openPanel, settle, startGame } from "./setupGame";

// QA (S4.7, #108): the black market sheet in real bot games, Open and Secret
// vote modes. Every websocket frame is kept: no frame may tie a purchase to its
// buyer (another player's perkBought) or announce a round's sales while it is
// still planned (design §12, §18). Open mode never offers the Check ballot
// (#187). The sales list carries no name. QA_SHOTS=… saves screenshots per width.
const SHOTS = process.env.QA_SHOTS;
const WIDTHS = [360, 390, 768, 1024, 1280];

interface Frame {
  readonly view?: {
    readonly me: { readonly id: string };
    readonly players: readonly { readonly id: string; readonly name: string }[];
    readonly phase: { readonly kind: string; readonly round?: number };
    readonly ledger: readonly { readonly event: { readonly type: string; readonly round?: number; readonly player?: string } }[];
    readonly caseFile: readonly { readonly event: { readonly type: string; readonly player?: string } }[];
  };
}

function watch(page: Page): Frame[] {
  const frames: Frame[] = [];
  page.on("websocket", (ws) => ws.on("framereceived", (f) => typeof f.payload === "string" && frames.push(JSON.parse(f.payload) as Frame)));
  return frames;
}

/** Every leak the frames could carry, as strings (empty when clean). */
function leaks(frames: readonly Frame[]): string[] {
  return frames.flatMap(({ view: v }) => {
    if (!v || v.phase.kind === "ended") return [];
    const bought = [...v.ledger, ...v.caseFile].filter((x) => x.event.type === "perkBought" && x.event.player !== v.me.id).map((x) => `perkBought of ${x.event.player}`);
    const early = v.phase.kind === "planning" ? v.ledger.filter((x) => x.event.type === "perkSold" && x.event.round === v.phase.round).map(() => `perkSold during round ${v.phase.round}`) : [];
    return [...bought, ...early];
  });
}

async function shoot(page: Page, name: string, target?: Locator, prep?: () => Promise<void>) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow at ${width}`).toBeLessThanOrEqual(0);
    if (target) await target.scrollIntoViewIfNeeded();
    await prep?.();
    await page.screenshot({ path: `${SHOTS}/${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

const sheetOf = (page: Page) => page.getByRole("dialog", { name: /^Black market/ });

/** Opens the sheet in each planning round until the stash holds `coins`; leaves it open. */
async function waitForStash(page: Page, coins: number) {
  const sheet = sheetOf(page);
  for (let round = 1; ; round++) {
    expect(round, `a stash of ${coins} by round 8`).toBeLessThan(9);
    await expect(page.getByRole("heading", { name: `Round ${round} · Pick your room`, level: 2 })).toBeVisible({ timeout: 90_000 });
    await clearMeeting(page); // a meeting between rounds leaves its modal result card up until closed (design §9.6)
    await page.getByRole("button", { name: "Black market", exact: true }).click();
    if (Number(await sheet.locator(".market__stash .num").textContent()) >= coins) return round;
    await page.keyboard.press("Escape");
  }
}

test.describe("QA black market, real games", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "viewports are set per test"));

  test("Open mode: no Check ballot; buy with a target; no frame or DOM ties a purchase to its buyer @shop", async ({ page }) => {
    test.setTimeout(420_000);
    const frames = watch(page);
    const game = await startGame(page.request, { bots: 3, sessionLength: "1h", voteVisibility: "open" });
    await page.goto(`/game/${game.id}`);
    const sheet = sheetOf(page);
    const round = await waitForStash(page, 1);
    await expect(sheet.locator(".perk__name")).toHaveCount(3);
    await expect(sheet.locator(".perk__name")).not.toContainText(["Check ballot"]);
    await shoot(page, "open-sheet");
    const first = sheet.locator(".perk").first();
    const name = (await first.locator(".perk__name").textContent())!;
    await first.getByRole("button", { name: `Buy ${name}` }).click();
    for (const group of ["Player", "Room"]) {
      const g = first.getByRole("group", { name: group });
      if (await g.count()) {
        await expect(g.getByRole("button", { name: "Host", exact: true })).toHaveCount(0); // never yourself
        await g.getByRole("button").first().click();
      }
    }
    await shoot(page, "open-picker", first);
    await first.getByRole("button", { name: "Pay 1 coin" }).click();
    await expect(sheet.getByRole("status")).toContainText(`You bought ${name} this round`);
    // A second perk in the same round: every Buy is disabled.
    for (const b of await sheet.getByRole("button", { name: /^Buy / }).all()) await expect(b).toBeDisabled();
    await shoot(page, "open-bought");
    await page.keyboard.press("Escape");

    await expect(page.getByRole("heading", { name: `Round ${round + 1} · Pick your room`, level: 2 })).toBeVisible({ timeout: 90_000 });
    await clearMeeting(page); // a meeting between rounds leaves its modal result card up until closed (design §9.6)
    await page.getByRole("button", { name: "Black market", exact: true }).click();
    const sales = sheet.locator(".market__sale");
    await expect(sales.first()).toBeVisible();
    await expect(sales.filter({ hasText: `Someone bought ${name}` })).not.toHaveCount(0);
    const view = [...frames].reverse().find((f) => f.view)!.view!;
    for (const p of [...view.players, { id: view.me.id, name: "Host" }]) {
      for (const html of await sales.evaluateAll((els) => els.map((e) => e.outerHTML))) {
        expect(html).not.toContain(p.id);
        expect(html).not.toContain(p.name);
      }
    }
    await shoot(page, "open-notices", sheet.locator(".market__sales"));
    const perkNames = await sheet.locator(".perk__name").allTextContents();
    await page.keyboard.press("Escape");
    // After the rebase onto the move (#201) and the rulebook (#207): the market button sits in the
    // move panel, and the rulebook's black market lists the sheet's perks.
    await shoot(page, "open-movepanel", page.getByRole("button", { name: "Black market", exact: true }));
    await page.getByRole("button", { name: "Rules", exact: true }).click();
    const book = page.getByRole("list", { name: "This game's black market" });
    await expect(book.locator(".rulebook__name b")).toHaveText(perkNames);
    await shoot(page, "open-rulebook", book);
    expect(leaks(frames)).toEqual([]);
  });

  test("Secret mode: buy Bail; its chip and tip on the role card; no frame leaks a buyer @shop", async ({ page }) => {
    test.setTimeout(600_000);
    const frames = watch(page);
    const sheet = sheetOf(page);
    // The deal is seeded: this seed's shop sells Bail (tier 3 is Bail or Plant evidence).
    const game = await startGame(page.request, { bots: 2, sessionLength: "1h", voteVisibility: "secret", seed: "market-bail-1" });
    await page.goto(`/game/${game.id}`);
    frames.length = 0;
    await page.reload();
    await waitForStash(page, 3);
    await shoot(page, "secret-sheet");
    const bail = sheet.locator(".perk", { hasText: "Bail" });
    await bail.getByRole("button", { name: "Buy Bail" }).click();
    await bail.getByRole("button", { name: "Pay 3 coins" }).click();
    await expect(sheet.getByRole("status")).toContainText("You bought Bail this round");
    await page.keyboard.press("Escape");

    const perks = page.getByRole("list", { name: "Your perks" });
    await expect(perks).toContainText("Bail", { timeout: 5_000 });
    const openTip = async () => {
      if ((await page.locator(".infotip__pop:popover-open").count()) === 0) await perks.getByRole("button").click();
      await expect(page.locator(".infotip__pop:popover-open")).toContainText(/shakedown/i);
    };
    await openTip();
    await page.keyboard.press("Escape");
    await shoot(page, "secret-bail-tip", perks, async () => {
      await openTip();
      await settle(page);
    });
    await page.keyboard.press("Escape");

    await clearMeeting(page); // a meeting between rounds leaves its modal result card up until closed (design §9.6)

    await page.getByRole("button", { name: "Black market", exact: true }).click();
    await expect(sheet.getByRole("button", { name: "Buy Bail" })).toBeDisabled();
    await expect(sheet.getByText(/already hold a Bail|You bought Bail/).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await openPanel(page, "Case");
    await expect(page.getByRole("region", { name: "Case board" })).toContainText("Someone bought Bail", { timeout: 90_000 });
    expect(leaks(frames)).toEqual([]);
  });

  test("the gallery's last round: the warning on every wasted perk at every width @shop", async ({ page }) => {
    await page.goto("/dev/gallery");
    const last = page.getByRole("group", { name: "The last round" });
    await last.getByRole("button", { name: "Buy Tail" }).click();
    await last.getByRole("group", { name: "Room" }).getByRole("button").first().click();
    await expect(last.locator(".perk__warn")).toHaveText(/last round: Tail works next round, so it would do nothing/);
    await shoot(page, "gallery-last-round", last.locator(".perk__warn"));
  });
});
