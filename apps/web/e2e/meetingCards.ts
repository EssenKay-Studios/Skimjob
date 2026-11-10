import { expect, type Locator, type Page } from "@playwright/test";

/**
 * A meeting can fall due in a game that is not about meetings (a third of the bank gone, a raid): its vote window, then
 * its result card, sit over the page as modal dialogs until closed (design §9.6). Waits out the vote and closes the card (a phone's panel sheet is a dialog too, and stays).
 */
export async function clearMeeting(page: Page): Promise<void> {
  const card = page.getByRole("button", { name: "Back to the bank" });
  await expect
    .poll(
      async () => {
        if (await card.isVisible()) await card.click();
        return page.locator("dialog[open]:not(.bsheet)").count();
      },
      { message: "a meeting's vote and result card close", timeout: 90_000 },
    )
    .toBe(0);
}

/**
 * Waits for `target` to show, closing any meeting result card that comes up meanwhile (a card can land after the vote and the
 * Bail window, so "no dialog open" is not the same as "no card coming").
 */
export async function showsAfterCards(page: Page, target: Locator, timeout: number): Promise<void> {
  const card = page.getByRole("button", { name: "Back to the bank" });
  await expect
    .poll(
      async () => {
        if (await card.isVisible()) await card.click();
        return target.isVisible();
      },
      { message: "the target shows once a meeting's result card is closed", timeout },
    )
    .toBe(true);
}

/** Clicks `target`, closing any meeting result card that covers it first and waiting out a vote window (modal too). */
export async function clickAfterCards(page: Page, target: Locator, timeout: number): Promise<void> {
  const card = page.getByRole("button", { name: "Back to the bank" });
  await expect
    .poll(
      async () => {
        if (await card.isVisible()) await card.click();
        return target.click({ timeout: 1_500 }).then(
          () => true,
          () => false,
        );
      },
      { message: "the click lands once a meeting's cards are out of the way", timeout },
    )
    .toBe(true);
}
