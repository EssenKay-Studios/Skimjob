import { expect, test, type Page } from "@playwright/test";
import { startGame } from "./setupGame";

// S4.1 board art (design §5.1, §5.3, §6.1, §15.6): the bells, the tape and siren on a
// raided room, the Vault's pile and door, at every launch width with a full crew. The art
// harness (e2e/art-harness.qa.tsx) places 12 crooks in 8 rooms (9–12 seats) and the bank
// states; no numbers are asserted, only what must never break: fit, overlap and motion.
const WIDTHS = [360, 390, 768, 1024, 1280];

test.describe.configure({ timeout: 60_000 });

const harness = (page: Page, query: string) => page.goto(`/e2e/art-harness.qa.html?${query}`).then(() => page.locator(".bank__svg").waitFor());

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}
const meets = (a: Box, b: Box) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;

for (const width of WIDTHS) {
  for (const bells of ["lit", "preview", "hidden"]) {
    test(`board art at ${width}px, 12 crooks and ${bells} bells: no overflow, each bell inside its room's width, none over a room name @board`, async ({ page }, info) => {
      test.skip(info.project.name !== "mobile", "viewports are set per test");
      await page.setViewportSize({ width, height: 900 });
      await harness(page, `tier=big&n=12&spread=all&bells=${bells}&taped=1&pile=0.5`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      const rooms = await page.evaluate(() => {
        const box = (el: Element): Box => {
          const r = el.getBoundingClientRect();
          return { l: r.left, t: r.top, r: r.right, b: r.bottom };
        };
        return [...document.querySelectorAll<SVGGElement>(".bank-room")].map((room) => {
          const id = room.dataset.room!;
          const bell = document.querySelector(`[data-bell="${id}"] .bell`);
          return {
            id,
            room: box(room),
            bell: bell ? box(bell) : null,
            tag: box(room.querySelector(".bank-tag")!),
            closed: room.classList.contains("is-closed"),
          };
        });
      });
      expect(rooms).toHaveLength(8);
      for (const r of rooms) {
        if (r.closed) {
          expect(r.bell, `${r.id}: a taped-off room has no bell`).toBeNull();
          continue;
        }
        expect(r.bell, `${r.id}: has a bell`).not.toBeNull();
        expect(r.bell!.l, `${r.id}: bell left of its room`).toBeGreaterThanOrEqual(r.room.l - 1);
        expect(r.bell!.r, `${r.id}: bell right of its room`).toBeLessThanOrEqual(r.room.r + 1);
        expect(r.bell!.r, `${r.id}: bell past the viewport`).toBeLessThanOrEqual(width);
        expect(meets(r.bell!, r.tag), `${r.id}: the bell covers the room's name`).toBe(false);
      }
      // Bells of different rooms never touch.
      const bellBoxes = rooms.filter((r) => r.bell).map((r) => ({ id: r.id, ...r.bell! }));
      for (const [i, a] of bellBoxes.entries()) for (const b of bellBoxes.slice(i + 1)) expect(meets(a, b), `${a.id} and ${b.id} bells overlap`).toBe(false);
    });
  }
}

for (const width of WIDTHS) {
  for (const [label, query] of [
    ["12 in the Vault", "n=12&spread=one"],
    ["12 across 8 rooms", "n=12&spread=all"],
    ["9 across 5 rooms", "n=9&spread=all&tier=small"],
  ] as const) {
    test(`a bell never covers a crook: ${label} at ${width}px @board`, async ({ page }, info) => {
      test.skip(info.project.name !== "mobile", "viewports are set per test");
      await page.setViewportSize({ width, height: 900 });
      await harness(page, `${query}&bells=lit`);
      const hits = await page.evaluate(() => {
        const bells = [...document.querySelectorAll<HTMLElement>("[data-bell] .bell")].map((b) => ({ id: b.closest<HTMLElement>("[data-bell]")!.dataset.bell!, r: b.getBoundingClientRect() }));
        return bells.flatMap(({ id, r }) =>
          [...document.querySelectorAll(".crook-fig")]
            .map((c) => c.getBoundingClientRect())
            .filter((c) => c.left < r.right - 0.5 && r.left < c.right - 0.5 && c.top < r.bottom - 0.5 && r.top < c.bottom - 0.5)
            .map(() => id),
        );
      });
      expect(hits, "bells over crooks").toEqual([]);
    });
  }
}

for (const width of WIDTHS) {
  test(`the selected room's pin covers no name tag: 12 in the Vault at ${width}px @board`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "viewports are set per test");
    await page.setViewportSize({ width, height: 900 });
    await harness(page, "tier=big&n=12&spread=one&bells=lit");
    await page.locator('.bank-room[data-room="vault"]').click();
    await expect(page.locator('.bank-room[data-room="vault"]')).toHaveAttribute("aria-label", /selected/);
    const hits = await page.evaluate(() => {
      const el = document.querySelector(".bank-pin");
      if (!el) return []; // a crowded room shows no pin
      const pin = el.getBoundingClientRect();
      return [...document.querySelectorAll(".crook-tag")]
        .map((t) => ({ r: t.getBoundingClientRect(), name: t.textContent }))
        .filter(({ r }) => r.width > 0 && r.left < pin.right - 0.5 && pin.left < r.right - 0.5 && r.top < pin.bottom - 0.5 && pin.top < r.bottom - 0.5)
        .map(({ name }) => name);
    });
    expect(hits, "name tags under the pin").toEqual([]);
  });
}

test("the selected room's pin shows on an uncrowded room and stays clear of its name and the bell @board", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await harness(page, "tier=small&n=2&spread=one&bells=lit");
    await page.locator('.bank-room[data-room="vault"]').click();
    await expect(page.locator('.bank-room[data-room="vault"] .bank-pin')).toHaveCount(1);
    const [pin, tag, bell] = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const f = (r: DOMRect) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
      return [f(box(".bank-pin")), f(box('.bank-room[data-room="vault"] .bank-tag')), f(box('[data-bell="vault"] .bell'))];
    });
    expect(meets(pin!, tag!), `${width}px: pin over the room name`).toBe(false);
    expect(meets(pin!, bell!), `${width}px: pin over the bell`).toBe(false);
  }
});

test("a crook never hides the CLOSED card of a taped room @board", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  await page.setViewportSize({ width: 390, height: 900 });
  await harness(page, "tier=big&n=12&spread=all&taped=1&bells=lit");
  // The card is drawn after the crooks, so it is the last thing painted in its room.
  const order = await page.evaluate(() => {
    const room = document.querySelector('.bank-room[data-room="depositBoxes"]')!;
    const kids = [...room.querySelectorAll(".bank-room__closed-sign, .crook-fig")];
    return kids.map((k) => k.classList.contains("bank-room__closed-sign"));
  });
  expect(order.lastIndexOf(true)).toBe(order.length - 1);
});

test("the HUD's Bank value lines up with Share's @board", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "one run is enough");
  test.setTimeout(90_000);
  const game = await startGame(page.request, { bots: 4 });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/game/${game.id}`);
    const bank = await page.locator(".hud__bank .hud__big").boundingBox();
    const share = await page.locator(".hud__share .hud__big").boundingBox();
    expect(Math.abs(bank!.y - share!.y), `${width}px: Bank and Share values`).toBeLessThanOrEqual(2);
  }
});

test("the taped room reads CLOSED with its rounds, a siren spins and its bell is off @board", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  await page.setViewportSize({ width: 390, height: 900 });
  await harness(page, "tier=big&taped=1&bells=lit");
  const room = page.locator('.bank-room[data-room="depositBoxes"]');
  await expect(room).toHaveAttribute("aria-disabled", "true");
  await expect(room.locator(".bank-room__closed-sign")).toContainText("CLOSED 2");
  await expect(page.locator('[data-bell="depositBoxes"]')).toHaveCount(0);
  const spinning = await page.evaluate(() => document.getAnimations().some((a) => a.playState === "running" && (a.effect as KeyframeEffect).target?.classList.contains("bank-beams")));
  expect(spinning).toBe(true);
});

test("the hidden bell shows ? and the preview bulbs are dashed @board", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  await page.setViewportSize({ width: 390, height: 900 });
  await harness(page, "tier=big&bells=hidden");
  await expect(page.locator('[data-bell="vault"] .bell')).toHaveAccessibleName("Bell: hidden");
  await expect(page.locator('[data-bell="vault"] .bell__q')).toHaveText("?");
  await harness(page, "tier=big&bells=preview");
  const style = await page.locator('[data-bell="office"] .bulb--pv').first().evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(style).toBe("dashed");
});

test("the bank pile shrinks as the bank empties @board", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  const bars: number[] = [];
  for (const pile of [1, 0.5, 0.1, 0]) {
    await harness(page, `tier=small&pile=${pile}`);
    bars.push(await page.locator(".gold-bar").count());
  }
  expect(bars[0]).toBeGreaterThan(bars[1]!);
  expect(bars[1]).toBeGreaterThan(bars[2]!);
  expect(bars[2]).toBe(1);
  expect(bars[3]).toBe(0);
});

test("the Vault door swings thick: its edge shows at every angle between open and shut @board", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  await page.setViewportSize({ width: 1280, height: 900 });
  await harness(page, "tier=small");
  const at = (pct: number) =>
    page.evaluate((p) => {
      const door = document.querySelector<SVGGElement>(".bank-vd")!;
      const a = door.getAnimations().find((x) => (x as CSSAnimation).animationName === "bank-vd")!;
      a.pause();
      a.currentTime = (p / 100) * 10_000;
      const w = (sel: string) => door.querySelector(sel)!.getBoundingClientRect().width;
      return { angle: getComputedStyle(door).getPropertyValue("--vd-a").trim(), face: w(".bank-vd__near"), band: w(".bank-vd__band") };
    }, pct);
  const open = await at(10);
  const swing = await at(36);
  const shut = await at(60);
  expect(open.angle).toBe("115deg");
  expect(shut.angle).toBe("0deg");
  // The angle really interpolates (a registered property), not flips.
  expect(["115deg", "0deg"]).not.toContain(swing.angle);
  // Shut: a full round face, no edge. Open and mid-swing: a squeezed face with a visible edge band.
  expect(shut.face).toBeGreaterThan(open.face * 1.5);
  expect(shut.band).toBeLessThan(0.5);
  expect(open.band).toBeGreaterThan(2);
  expect(swing.band).toBeGreaterThan(2);
});

test("reduced motion: door open, lamp on, camera still, screen on one page, siren still @board", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "viewports are set per test");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await harness(page, "tier=big&taped=1&bells=lit");
  const running = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => (a.effect as KeyframeEffect).target?.getAttribute("class")),
  );
  expect(running).toEqual([]);
  const angle = await page.locator(".bank-vd").evaluate((el) => getComputedStyle(el).getPropertyValue("--vd-a").trim());
  expect(angle).toBe("115deg");
  await expect(page.locator(".bank-lamp")).toHaveCSS("opacity", "1");
  await expect(page.locator(".bank-scr > :nth-child(1)")).toHaveCSS("opacity", "1");
  await expect(page.locator(".bank-scr > :nth-child(2)")).toHaveCSS("opacity", "0");
});

test("a real game: bells on every room, the bank count and the Wanted stars @board", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "one run is enough");
  test.setTimeout(90_000);
  const game = await startGame(page.request, { bots: 4 });
  await page.goto(`/game/${game.id}`);
  await page.locator(".bank-room").first().waitFor();
  const rooms = await page.locator(".bank-room").count();
  expect(rooms).toBeGreaterThan(4);
  await expect(page.locator("[data-bell] .bell")).toHaveCount(rooms);
  await expect(page.locator("[data-bell] .bell").first()).toHaveAccessibleName(/^Bell: 0 of \d+ lit$/);
  await expect(page.getByRole("img", { name: /^Wanted 0 of \d+$/ })).toBeVisible();
  await expect(page.locator(".hud__bank .hud__big")).toHaveText(/^(\d+)\/\1$/);
  // Picking a room previews its rings on that room's bell only. A Locksmith's coins ring nothing (design §11.1),
  // so with that random role the vault stays silent: the preview may only be missing, never on another room.
  await page.locator('.bank-room[data-room="vault"]').click();
  await expect(page.locator('.bank-room[data-room="vault"]')).toHaveAttribute("aria-label", /selected/);
  const previewed = await page.locator("[data-bell]").filter({ has: page.locator(".bulb--pv") }).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.bell));
  expect(previewed.filter((r) => r !== "vault")).toEqual([]);
  if (previewed.length) await expect(page.locator('[data-bell="vault"] .bell')).toHaveAccessibleName(/your grab adds \d+/);
});
