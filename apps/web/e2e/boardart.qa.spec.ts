import { expect, test } from "@playwright/test";
import { startGame } from "./setupGame";

// QA (PR #199, S4.1): the board in a real 12-seat game with a 24-character name, at every
// launch width: no overflow, each bell inside its room and clear of the room's name and of
// your crook, and the preview follows your pick (design §5.1, §5.2; ui-style responsive).
const WIDTHS = [360, 390, 768, 1024, 1280];
const LONG = "Bartholomew Longname 24c";

test("a 12-seat game with a 24-character name: bells fit at every width, the preview follows the pick @board", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  test.setTimeout(120_000);
  expect(LONG).toHaveLength(24);
  const game = await startGame(page.request, { bots: 11, nickname: LONG });
  await page.goto(`/game/${game.id}`);
  await page.locator(".bank-room").first().waitFor();
  const rooms = await page.locator(".bank-room").count();
  // Pick the Office (a ring unless you're the Locksmith), then the Lobby (1 quiet coin: no
  // ring for anyone): only the room you picked may preview, never another.
  const previewed = () =>
    page
      .locator("[data-bell]")
      .filter({ has: page.locator(".bulb--pv") })
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.bell));
  await page.locator('.bank-room[data-room="office"]').click();
  await expect(page.locator('.bank-room[data-room="office"]')).toHaveAttribute(
    "aria-label",
    /selected/,
  );
  expect((await previewed()).filter((r) => r !== "office")).toEqual([]);
  await page.locator('.bank-room[data-room="lobby"]').click();
  await expect(page.locator('.bank-room[data-room="lobby"]')).toHaveAttribute(
    "aria-label",
    /selected/,
  );
  expect(await previewed()).toEqual([]);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator("[data-bell] .bell")).toHaveCount(rooms);
    // The sketch frames redraw a moment after a resize.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          ),
        { message: `${width}px overflow` },
      )
      .toBeLessThanOrEqual(0);
    await expect(async () => {
      const bad = await page.evaluate(() => {
        const meets = (a: DOMRect, b: DOMRect) =>
          a.left < b.right - 0.5 &&
          b.left < a.right - 0.5 &&
          a.top < b.bottom - 0.5 &&
          b.top < a.bottom - 0.5;
        const out: string[] = [];
        for (const room of document.querySelectorAll<SVGGElement>(
          ".bank-room",
        )) {
          const id = room.dataset.room!;
          const bell = document
            .querySelector(`[data-bell="${id}"] .bell`)
            ?.getBoundingClientRect();
          if (!bell) continue;
          const r = room.getBoundingClientRect();
          if (bell.left < r.left - 1 || bell.right > r.right + 1)
            out.push(`${id}: bell outside its room`);
          if (bell.right > window.innerWidth)
            out.push(`${id}: bell past the viewport`);
          if (
            meets(
              bell,
              room.querySelector(".bank-tag")!.getBoundingClientRect(),
            )
          )
            out.push(`${id}: bell over the room name`);
          for (const c of room.querySelectorAll(".crook-fig"))
            if (meets(bell, c.getBoundingClientRect()))
              out.push(`${id}: bell over a crook`);
        }
        return out;
      });
      expect(bad, `${width}px`).toEqual([]);
    }).toPass({ timeout: 5_000 });
    // Bell and star targets: the HUD Wanted stars are visible and the Vault stays a 44 px target.
    await expect(
      page.getByRole("img", { name: /^Wanted 0 of \d+$/ }),
    ).toBeVisible();
    const vault = await page
      .locator('.bank-room[data-room="vault"]')
      .boundingBox();
    expect(
      Math.min(vault!.width, vault!.height),
      `${width}px vault target`,
    ).toBeGreaterThanOrEqual(44);
  }
});
