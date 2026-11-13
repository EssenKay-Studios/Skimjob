// QA (PR #201, S4.2; #232): the move panel by keyboard alone (pick a coin up,
// drop it), the coins conserved through taps and drags, and no R6 words. design §3.2, §20.1
import { expect, test, type Page } from "@playwright/test";
import { openPanel, startGame } from "./setupGame";
import { dragTo, grabAll, pickRoom, pileCoins, tapMove } from "./move";

/** Tabs forward until `match` holds for the focused element (at most `max` presses). */
async function tabTo(
  page: Page,
  match: (el: {
    label: string;
    bag: string | null;
    pressed: string | null;
  }) => boolean,
  max = 80,
): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const el = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return {
        label: a?.getAttribute("aria-label") ?? a?.textContent ?? "",
        bag: a?.closest("[data-pile]")?.getAttribute("data-pile") ?? null,
        pressed: a?.getAttribute("aria-pressed") ?? null,
      };
    });
    if (match(el)) return;
  }
  throw new Error("tabTo: never reached the target");
}

const count = async (page: Page) => ({
  room: await pileCoins(page, "room").count(),
  duffel: await pileCoins(page, "duffel").count(),
  pocket: await pileCoins(page, "pocket").count(),
});

test("the grab and the split work by keyboard alone, and taps and drags keep every coin @move", async ({
  page,
}) => {
  const game = await startGame(page.request, { bots: 5, sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "This round"); // below 1024 px the move panel is in this sheet
  await expect(
    page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 }),
  ).toBeVisible();

  // The room by keyboard: Tab to the Vault button, Enter.
  await page.locator("body").focus();
  await tabTo(page, (el) => el.label.trim() === "Vault" && el.pressed !== null);
  await page.keyboard.press("Enter");
  await expect(page.locator(".move__room-name")).toHaveText("Vault");
  expect(await count(page)).toEqual({ room: 3, duffel: 0, pocket: 0 }); // a fresh move holds nothing
  await grabAll(page);
  expect(await count(page)).toEqual({ room: 0, duffel: 3, pocket: 0 });

  // Grab 2 of 3 by keyboard: Enter picks a duffel coin up (it lifts), Space on the Grab row's drop place leaves it in the room.
  await tabTo(page, (el) => el.bag === "duffel" && el.label.startsWith("Coin"));
  await page.keyboard.press("Enter");
  await expect(pileCoins(page, "duffel").first()).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Drop the coin in the room" }).focus();
  await page.keyboard.press("Space");
  expect(await count(page)).toEqual({ room: 1, duffel: 2, pocket: 0 });

  // Esc puts a picked-up coin down again (and doesn't close the sheet).
  await pileCoins(page, "duffel").first().focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.locator('.coin-btn[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Round 1 · Pick your room", level: 2 })).toBeVisible();

  // The room's coin into the pocket, by keyboard: Enter on it, Tab on to the pocket's drop place, Enter.
  await pileCoins(page, "room").first().focus();
  await page.keyboard.press("Enter");
  await tabTo(page, (el) => el.label === "Drop the coin in your pocket");
  await page.keyboard.press("Enter");
  expect(await count(page)).toEqual({ room: 0, duffel: 2, pocket: 1 });

  // Drags: into the room, a drop on the same bag, a drop outside every pile, out of the room; never a coin lost or made.
  await dragTo(page, pileCoins(page, "duffel").first(), page.locator("[data-pile=room]"));
  expect(await count(page)).toEqual({ room: 1, duffel: 1, pocket: 1 });
  await dragTo(page, pileCoins(page, "pocket").first(), page.locator("[data-pile=pocket]"));
  await dragTo(page, pileCoins(page, "duffel").first(), page.locator(".move__room-name"));
  expect(await count(page)).toEqual({ room: 1, duffel: 1, pocket: 1 });
  await dragTo(page, pileCoins(page, "room").first(), page.locator("[data-pile=duffel]"));
  expect(await count(page)).toEqual({ room: 0, duffel: 2, pocket: 1 });

  // Lock it in by keyboard; the status line agrees with the bags.
  await page.getByRole("button", { name: "Lock it in" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".move__status")).toHaveText(
    /Locked in: Vault, pocket 1\./,
  );

  // No R6 money words on the move panel.
  await expect(page.locator(".move")).not.toContainText(/\bloot\b|\bhaul\b/i);
});

// QA (#232): the edges of tap to pick. design §3.2 steps 2-3
test("a 1-coin room, a tap on a coin in another pile, a held coin let go on a room change, and the split kept after a reload @move", async ({ page }) => {
  const game = await startGame(page.request, { bots: 3, sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "This round");

  // The Lobby's 1 coin starts in the Grab row; grabbed, it can go to the pocket or back to the room.
  await pickRoom(page, "Lobby");
  await expect.poll(() => count(page)).toEqual({ room: 1, duffel: 0, pocket: 0 });
  await grabAll(page);
  await expect.poll(() => count(page)).toEqual({ room: 0, duffel: 1, pocket: 0 });
  await pileCoins(page, "duffel").first().click();
  await expect(page.getByText("Tap the Pocket to drop it, or the Grab row to leave it.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Drop the coin in/ })).toHaveCount(2);
  await page.locator("[data-pile=room] .coin-bags__label").click(); // the room takes the last coin back too
  await expect.poll(() => count(page)).toEqual({ room: 1, duffel: 0, pocket: 0 });
  await tapMove(page, "room", "pocket");
  await expect.poll(() => count(page)).toEqual({ room: 0, duffel: 0, pocket: 1 });

  // The Vault keeps the 1-coin grab (2 left in the room). A held room coin dropped by a tap on a pocket coin.
  await pickRoom(page, "Vault");
  await expect.poll(() => count(page)).toEqual({ room: 2, duffel: 0, pocket: 1 });
  await pileCoins(page, "room").first().click();
  await pileCoins(page, "pocket").first().click();
  await expect.poll(() => count(page)).toEqual({ room: 1, duffel: 0, pocket: 2 });
  await expect(page.locator('.coin-btn[aria-pressed="true"]')).toHaveCount(0);
  // A tap on the held coin puts it down.
  const coin = pileCoins(page, "pocket").last();
  await coin.click();
  await expect(coin).toHaveAttribute("aria-pressed", "true");
  await coin.click();
  await expect(page.locator('.coin-btn[aria-pressed="true"]')).toHaveCount(0);

  // A coin held when the room changes is let go: nothing lifted in the new room, and a bag tap moves nothing.
  await pileCoins(page, "pocket").first().click();
  await pickRoom(page, "Office");
  await expect(page.locator('.coin-btn[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByText("Tap a coin to pick it up, or drag it.")).toBeVisible();
  const before = await count(page);
  await page.locator("[data-pile=duffel] .bag__name").click();
  expect(await count(page)).toEqual(before);

  // Put one back in the room, lock in, reload: the bags come back as locked in.
  await tapMove(page, "pocket", "room");
  const locked = await count(page);
  expect(locked.room).toBe(1);
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page.locator(".move__status")).toHaveText(/Locked in: Office/);
  await page.reload();
  await openPanel(page, "This round");
  await expect.poll(() => count(page)).toEqual(locked);
});

// #288: a dragged coin hovers on top of both bags, whichever way it goes. design §15.6
test("a dragged coin is the topmost thing over the Duffel and the Pocket, in both directions and from the Grab row @move", async ({ page }) => {
  const game = await startGame(page.request, { bots: 3, sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "This round");
  await pickRoom(page, "Vault");
  await tapMove(page, "room", "duffel");
  await tapMove(page, "room", "pocket");

  /** Holds a coin of `from` over the middle of `to`'s box and says whether the coin is what's painted there. */
  const topAt = async (from: "room" | "duffel" | "pocket", to: "room" | "duffel" | "pocket") => {
    const a = (await pileCoins(page, from).first().boundingBox())!;
    const b = (await page.locator(`[data-pile=${to}]`).boundingBox())!;
    const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 });
    const onTop = await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.closest(".coin-btn.is-dragging") !== null, [x, y]);
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 4 }); // back to where it came from: dropped on its own pile, nothing moves
    await page.mouse.up();
    return onTop;
  };
  expect(await topAt("duffel", "pocket")).toBe(true);
  expect(await topAt("pocket", "duffel")).toBe(true);
  expect(await topAt("room", "duffel")).toBe(true);
  expect(await topAt("room", "pocket")).toBe(true);
  expect(await topAt("duffel", "room")).toBe(true);
  expect(await topAt("pocket", "room")).toBe(true);
});

// QA #288: a locked move reopens as locked; pulling every coin back leaves nothing to lock (design §3.2: at
// least 1 coin), with the bags and the bell still on screen; a room switch keeps the grab within the new room; a
// room with no coins locks in with nothing grabbed.
test("a locked move reopens as locked; emptied it can't lock at 0; a room switch keeps the coins; no-coin rooms lock empty @move", async ({ page }) => {
  const game = await startGame(page.request, { bots: 3, sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "This round");
  const lock = page.locator(".move__lock");
  await pickRoom(page, "Vault");
  await tapMove(page, "room", "duffel");
  await tapMove(page, "room", "pocket");
  await lock.click();
  await expect(page.getByText("Locked in: Vault, pocket 1.", { exact: false })).toBeVisible();

  await page.reload();
  await openPanel(page, "This round");
  await expect.poll(() => count(page)).toEqual({ room: 1, duffel: 1, pocket: 1 });
  await expect(lock).toHaveText("Locked in");
  await expect(lock).toBeDisabled();

  // Every coin back in the Grab row: the bags and the bell stay, no raid warning, and 0 coins can't be locked in.
  await tapMove(page, "duffel", "room");
  await tapMove(page, "pocket", "room");
  await expect.poll(() => count(page)).toEqual({ room: 3, duffel: 0, pocket: 0 });
  await expect(page.locator("[data-pile=duffel]")).toBeVisible();
  await expect(page.locator("[data-pile=pocket]")).toBeVisible();
  await expect(page.locator(".coin-bags .bell")).toBeVisible();
  await expect(page.locator(".move__warn")).toHaveCount(0);
  await expect(lock).toBeDisabled();
  await expect(page.getByText("Locked in: Vault, pocket 1.", { exact: false })).toBeVisible(); // the locked move still stands

  // 3 grabbed in the Vault, then the Office (2 coins): the grab stays within the room and no coin is lost or made.
  await grabAll(page);
  await pickRoom(page, "Office");
  await expect.poll(() => count(page)).toEqual({ room: 0, duffel: 2, pocket: 0 });
  await expect(lock).toBeEnabled();

  // The Rooftop has no coins: nothing to grab, and it locks in empty.
  await pickRoom(page, "Rooftop");
  await expect(page.getByText("No coins to grab here.")).toBeVisible();
  await expect(page.locator("[data-pile]")).toHaveCount(0);
  await lock.click();
  await expect(page.getByText("Locked in: Rooftop", { exact: false })).toBeVisible();
});

// QA #288: the same layering with a finger: a coin dragged by touch hovers over the other bag both ways. design §15.6
test.describe("touch", () => {
  test.use({ hasTouch: true });
  test("a coin dragged by touch is the topmost thing over the other bag, Duffel to Pocket and back @move", async ({ page }) => {
    const game = await startGame(page.request, { bots: 3, sessionLength: "1w" });
    await page.goto(`/game/${game.id}`);
    await openPanel(page, "This round");
    await pickRoom(page, "Vault");
    await tapMove(page, "room", "duffel");
    await tapMove(page, "room", "pocket");

    const topAt = async (from: "duffel" | "pocket", to: "duffel" | "pocket") => {
      const coin = pileCoins(page, from).first();
      await coin.scrollIntoViewIfNeeded();
      const a = (await coin.boundingBox())!;
      const b = (await page.locator(`[data-pile=${to}]`).boundingBox())!;
      const [ax, ay, bx, by] = [a.x + a.width / 2, a.y + a.height / 2, b.x + b.width / 2, b.y + b.height / 2];
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: ax, y: ay }] });
      for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: ax + ((bx - ax) * i) / 8, y: ay + ((by - ay) * i) / 8 }] });
      // The last touch move renders a frame later, so wait for the coin to arrive.
      const onTop = await expect
        .poll(() => page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.closest(".coin-btn.is-dragging") !== null, [bx, by]), { timeout: 3000 })
        .toBe(true)
        .then(() => true, () => false);
      for (let i = 1; i <= 4; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: bx + ((ax - bx) * i) / 4, y: by + ((ay - by) * i) / 4 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); // back on its own pile: nothing moves
      await cdp.detach();
      return onTop;
    };
    expect(await topAt("duffel", "pocket")).toBe(true);
    expect(await topAt("pocket", "duffel")).toBe(true);
    await expect.poll(() => count(page)).toEqual({ room: 1, duffel: 1, pocket: 1 });
  });
});
