import { expect, type Page } from "@playwright/test";

/**
 * A meeting can fall due in a game that is not about meetings (a third of the bank gone, a raid): its vote window, then
 * its result card, sit over the page as modal dialogs until closed (design §9.6). Waits out the vote and closes the card.
 */
export async function clearMeeting(page: Page): Promise<void> {
  const card = page.getByRole("button", { name: "Back to the bank" });
  await expect
    .poll(
      async () => {
        if (await card.isVisible()) await card.click();
        return page.locator("dialog[open]").count();
      },
      { message: "a meeting's vote and result card close", timeout: 90_000 },
    )
    .toBe(0);
}
