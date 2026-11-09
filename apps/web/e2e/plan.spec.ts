import { expect as baseExpect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

const expect = baseExpect.configure({ timeout: 15_000 });

// S4.3 acceptance (design §10): the plan board on the game screen. Two players and a bot: one
// claims a room, the other puts that player's head on another room, both agree and one pledges
// a power; each sees the other's edits live, in the ledger and on the board, with 44 px targets.

const board = (p: Page) => p.getByRole("region", { name: "Plan board" });

test("two players plan together on the board, live, with the ledger linked to the heads @plan", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const guest = await (await browser.newContext({ viewport: page.viewportSize()! })).newPage();
  // One-week preset: nothing moves on while we plan.
  const game = await startGame(page.request, { bots: 1, guests: [guest.request], sessionLength: "1w" });
  for (const p of [page, guest]) {
    await p.goto(`/game/${game.id}`);
    await expect(board(p)).toBeVisible();
  }
  // The bot took its spot and agreed as the round started.
  await expect(board(page).getByText("1 of 3 agreed")).toBeVisible();

  // The host claims the Office as their spot; the guest sees the line.
  await board(page).getByRole("button", { name: /^Office: claim as your spot/ }).click();
  await expect(board(guest).getByRole("button", { name: /^Host: Office\./ })).toBeVisible();

  // The guest taps the host's head, then the Vault: the host's head is on the proposed plan, their claim untouched.
  await board(guest).getByRole("group", { name: "Crew not on the plan" }).getByRole("button", { name: /^Host\. Show claims/ }).click();
  await board(guest).getByRole("button", { name: /^Vault: put Host here/ }).click();
  await expect(board(page).locator('.plan__room[data-room="vault"]').getByRole("button", { name: /^Host \(you\)/ })).toBeVisible();
  await expect(board(page).getByRole("button", { name: /^Host: Office\./ })).toBeVisible();

  // Agreeing counts up for everyone; the host pledges a power on the guest.
  await board(guest).getByRole("button", { name: "I agree", exact: true }).click();
  await expect(board(page).getByText("2 of 3 agreed")).toBeVisible();
  await board(page).getByRole("button", { name: "Claim a power" }).click();
  await board(page).getByRole("group", { name: "Role to pledge" }).getByRole("button", { name: "Detective" }).click();
  await board(page).getByRole("group", { name: "Player to pledge on" }).getByRole("button", { name: "Guest 1" }).click();
  await board(page).getByRole("button", { name: "Pledge", exact: true }).click();
  await expect(board(guest).getByRole("button", { name: /^Host: Office, Detective on Guest 1\./ })).toBeVisible();

  // Tapping a ledger line shows that player's claims and marks their head.
  await board(guest).getByRole("button", { name: /^Host: Office, Detective/ }).click();
  await expect(board(guest).getByRole("group", { name: "Host's claims" })).toContainText("Detective → Guest 1");
  await expect(board(guest).getByRole("button", { name: /^Host\. Show claims/ })).toHaveAttribute("aria-pressed", "true");

  // Every target is at least 44 px.
  const small = await board(page).evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>("button, summary")]
      .map((b) => ({ b, r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ b, r }) => `${b.getAttribute("aria-label") ?? b.textContent} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );
  expect(small).toEqual([]);
});
