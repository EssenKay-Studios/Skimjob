import { expect as baseExpect, test } from "@playwright/test";
import { grabAll, pickRoom } from "./move";
import { openPanel, startGame } from "./setupGame";

const expect = baseExpect.configure({ timeout: 15_000 });

// #294 (design §10): after a round the alibi pop-up asks the host where they were; a pick posts the
// alibi (here a lie). Once the window closes, the round's snapshot card in "This round" shows the host
// dashed (says) and the guest, who never answered, solid (no alibi: a fact in their real room). Tapping
// the guest opens the trust-mark pop-over: Trusted badges them; reopened, Escape closes it with no change.
// The case board's round picker then shows the same card for round 1.

test("the alibi pop-up posts an alibi, the snapshot card shows says and facts, and marks stay yours @alibi", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const guest = await browser.newContext();
  // 1-hour preset: 30 s rounds, so the card stays up long enough to mark. The guest never opens the game: a missed move, no alibi.
  const game = await startGame(page.request, { bots: 1, guests: [guest.request], sessionLength: "1h" });
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "This round");
  await pickRoom(page, "Lobby");
  await grabAll(page);
  await page.getByRole("button", { name: "Lock it in" }).click();

  // The round resolves: the pop-up, with its countdown and a tile per room.
  const popup = page.getByRole("dialog", { name: "Psst. Where were you?" });
  await expect(popup).toBeVisible({ timeout: 60_000 });
  await expect(popup).toContainText("closes in");
  const tiles = popup.getByRole("group", { name: "Where you say you were" });
  await tiles.getByRole("button", { name: /^Office/ }).click();
  await popup.getByRole("button", { name: "I was in the Office" }).click();
  await expect(popup).toBeHidden();

  // The window closes: the card is out, the host said the Office (dashed), the guest is a fact in the Lobby (solid).
  await openPanel(page, "This round");
  const card = page.getByRole("region", { name: "Round 1, as told" });
  await expect(card).toBeVisible();
  await expect(card.locator('[data-room="office"] span.snap__crook--says')).toHaveCount(1);
  const crook = card.locator('[data-room="lobby"]').getByRole("button", { name: "Guest 1 gave no alibi: in the Lobby. Mark Guest 1" });
  await expect(crook).toHaveClass(/snap__crook--fact/);
  await expect(page.locator(".cardkey__btn")).toHaveAttribute("aria-expanded", "false");

  // Mark the guest Trusted from the pop-over.
  await crook.click();
  const pop = page.getByRole("group", { name: "Your mark on Guest 1" });
  await expect(pop.getByRole("button")).toHaveCount(2);
  await pop.getByRole("button", { name: "Mark Guest 1 Trusted" }).click();
  await expect(pop).toBeHidden();
  await expect(card.getByRole("button", { name: /^Guest 1 gave no alibi: in the Lobby, marked Trusted/ })).toBeVisible();

  // Reopened, it offers the other two states; Escape closes it and changes nothing (the panel stays open).
  await card.getByRole("button", { name: /^Guest 1 gave no alibi/ }).click();
  await expect(pop.getByRole("button", { name: "Clear your mark on Guest 1" })).toBeVisible();
  await expect(pop.getByRole("button", { name: "Mark Guest 1 Liar" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await expect(card.getByRole("button", { name: /marked Trusted/ })).toBeVisible();

  // The case board's round picker: square buttons, unplayed rounds dashed and disabled; the picked round gold, with its card.
  await openPanel(page, "Case");
  const board = page.getByRole("region", { name: "Case board" });
  const picker = board.getByRole("group", { name: "Round" });
  const r1 = picker.getByRole("button", { name: "1 latest" }); // the latest round, picked on open (#245)
  const r12 = picker.getByRole("button", { name: "12", exact: true });
  const box = (await r1.boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(1);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await expect(r12).toBeDisabled();
  expect(await r12.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
  await r1.click();
  await expect(r1).toHaveAttribute("aria-pressed", "true");
  const gold = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.background = "var(--gold)";
    document.body.append(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  });
  expect(await r1.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(gold);
  await expect(board.getByRole("region", { name: "Round 1", exact: true })).toBeVisible();
  await guest.close();
});
