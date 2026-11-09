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

// QA round 2 (PR #199 at d4f22f6): the three fixes hold across crowd sizes and widths.
const harness = (page: import("@playwright/test").Page, q: string) =>
  page
    .goto(`/e2e/art-harness.qa.html?${q}`)
    .then(() => page.locator(".bank__svg").waitFor());

test("the Vault pin covers no name tag, the room name or the bell for 1 to 12 crooks at every width @board", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  test.setTimeout(180_000);
  for (const width of WIDTHS)
    for (let n = 1; n <= 12; n++) {
      await page.setViewportSize({ width, height: 900 });
      await harness(page, `tier=big&n=${n}&spread=one&bells=lit`);
      await page.locator('.bank-room[data-room="vault"]').click();
      await expect(
        page.locator('.bank-room[data-room="vault"]'),
      ).toHaveAttribute("aria-label", /selected/);
      const hits = await page.evaluate(() => {
        const pin = document.querySelector(".bank-pin")?.getBoundingClientRect();
        if (!pin) return [];
        const meets = (r: DOMRect) =>
          r.width > 0 &&
          r.left < pin.right - 0.5 &&
          pin.left < r.right - 0.5 &&
          r.top < pin.bottom - 0.5 &&
          pin.top < r.bottom - 0.5;
        const room = document.querySelector('.bank-room[data-room="vault"]')!;
        return [
          ...[...room.querySelectorAll(".crook-tag")]
            .filter((t) => meets(t.getBoundingClientRect()))
            .map((t) => `tag ${t.textContent}`),
          ...(meets(room.querySelector(".bank-tag")!.getBoundingClientRect())
            ? ["room name"]
            : []),
          ...(meets(
            document
              .querySelector('[data-bell="vault"] .bell')!
              .getBoundingClientRect(),
          )
            ? ["bell"]
            : []),
        ];
      });
      expect(hits, `${width}px, ${n} crooks`).toEqual([]);
    }
});

test("the CLOSED card is on top where it is drawn: nothing paints over its text, 12 crooks, every width @board", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await harness(page, "tier=big&n=12&spread=all&taped=1&bells=lit");
    const covered = await page.evaluate(() => {
      const text = document.querySelector(".bank-closed__text")!;
      const r = text.getBoundingClientRect();
      const out: string[] = [];
      for (const fx of [0.15, 0.5, 0.85]) {
        const el = document.elementFromPoint(
          r.left + r.width * fx,
          r.top + r.height / 2,
        );
        if (!el?.closest(".bank-room__closed-sign"))
          out.push(`${fx}: ${el?.getAttribute("class") ?? el?.tagName}`);
      }
      return { text: text.textContent, out };
    });
    expect(covered.text).toBe("CLOSED 2");
    expect(covered.out, `${width}px`).toEqual([]);
  }
});

test("the crowded Vault's bell, moved over the top edge, covers no crook or name anywhere @board", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await harness(page, "tier=big&n=12&spread=one&bells=lit");
    await expect(async () => {
      const bad = await page.evaluate(() => {
        const bell = document
          .querySelector('[data-bell="vault"] .bell')!
          .getBoundingClientRect();
        const meets = (r: DOMRect) =>
          r.width > 0 &&
          r.left < bell.right - 0.5 &&
          bell.left < r.right - 0.5 &&
          r.top < bell.bottom - 0.5 &&
          bell.top < r.bottom - 0.5;
        return [
          ...document.querySelectorAll(".crook-fig, .crook-tag, .bank-tag"),
        ]
          .filter((e) => meets(e.getBoundingClientRect()))
          .map((e) => e.textContent || e.getAttribute("class"));
      });
      expect(bad, `${width}px`).toEqual([]);
    }).toPass({ timeout: 5_000 });
  }
});

test("HUD with 12 seats and a 24-character name: Bank lines up with Share and the i stays 44 px, every width @board", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  test.setTimeout(90_000);
  const game = await startGame(page.request, { bots: 11, nickname: LONG });
  await page.goto(`/game/${game.id}`);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const bank = await page.locator(".hud__bank .hud__big").boundingBox();
    const share = await page.locator(".hud__share .hud__big").boundingBox();
    expect(Math.abs(bank!.y - share!.y), `${width}px`).toBeLessThanOrEqual(2);
    for (const tip of await page.locator(".hud .infotip").all()) {
      const b = await tip.boundingBox();
      expect(Math.min(b!.width, b!.height), `${width}px i`).toBeGreaterThanOrEqual(44);
    }
    // The negative margin must not let the i spill over the HUD's round line or out of the card.
    const spill = await page.evaluate(() => {
      const hud = document.querySelector(".hud")!.getBoundingClientRect();
      return [...document.querySelectorAll(".hud .infotip")].some((t) => {
        const r = t.getBoundingClientRect();
        return r.left < hud.left || r.right > hud.right || r.top < hud.top;
      });
    });
    expect(spill, `${width}px i outside the HUD`).toBe(false);
  }
});
