import { TERMS, TIPS } from "@skimjob/content";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { settle } from "./setupGame";

// QA for the InfoTip (design §15.6 "Info on everything", §20.5, S3b.1): the tip
// placed at every edge and corner of the screen at the launch widths and on a
// landscape phone, the keyboard through a row of tips, touch, the screen-reader
// wiring, a scroll or a width change while open, and a tip in a GameShell column.

const SIZES = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 844, height: 390 }, // landscape phone
  { width: 568, height: 320 }, // small landscape phone
];

test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

const tipButton = (page: Page, name: string) => page.getByRole("button", { name: `About ${name}` }).first();
const popover = (page: Page) => page.locator(".infotip__pop:popover-open");

async function gallery(browser: Browser, viewport: { width: number; height: number }, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const p = await ctx.newPage();
  await p.goto("/dev/gallery");
  await p.getByRole("heading", { name: "InfoTip" }).scrollIntoViewIfNeeded();
  return p;
}

const inside = (t: { x: number; y: number; width: number; height: number }, v: { width: number; height: number }) => {
  expect(t.x).toBeGreaterThanOrEqual(0);
  expect(t.y).toBeGreaterThanOrEqual(0);
  expect(t.x + t.width).toBeLessThanOrEqual(v.width);
  expect(t.y + t.height).toBeLessThanOrEqual(v.height);
};

type Box = { x: number; y: number; width: number; height: number };
/** The tip hangs on its i: just under or just over it (within 8 px), and across from it. */
const attached = (t: Box, b: Box) => {
  expect(Math.min(Math.abs(t.y - (b.y + b.height)), Math.abs(b.y - (t.y + t.height)))).toBeLessThanOrEqual(8);
  expect(t.x).toBeLessThanOrEqual(b.x + b.width);
  expect(t.x + t.width).toBeGreaterThanOrEqual(b.x);
};
const boxes = async (p: Page, i: ReturnType<typeof tipButton>) => [(await popover(p).boundingBox())!, (await i.boundingBox())!] as const;

for (const v of SIZES) {
  test(`at ${v.width}x${v.height} the longest tip stays inside the screen at every edge and corner, clear of its i @infotip`, async ({ browser }, info) => {
    test.setTimeout(90_000); // nine placements on the long gallery page
    const p = await gallery(browser, v);
    // The Suspect tip has the longest line in the gallery; pin its i to each of nine spots of the screen.
    // Moved to the top of the app root, so no framed (transformed) ancestor holds its position: fixed.
    await p.locator(".g-infotips__edge .infotip").evaluate((el) => {
      (el as HTMLElement).dataset.qa = "moved";
      document.querySelector("#root")!.prepend(el);
    });
    const root = p.locator('[data-qa="moved"]');
    const btn = root.locator(".infotip__btn");
    for (const [x, y] of [
      ["0px", "0px"], ["calc(50% - 22px)", "0px"], ["calc(100% - 44px)", "0px"],
      ["0px", "calc(50% - 22px)"], ["calc(100% - 44px)", "calc(50% - 22px)"],
      ["0px", "calc(100% - 44px)"], ["calc(50% - 22px)", "calc(100% - 44px)"], ["calc(100% - 44px)", "calc(100% - 44px)"],
    ] as const) {
      await root.evaluate((el, [left, top]) => Object.assign((el as HTMLElement).style, { position: "fixed", left, top, zIndex: "5" }), [x, y]);
      await btn.click();
      await expect(popover(p), `${x} ${y}`).toContainText(TIPS.suspect.text);
      const t = (await popover(p).boundingBox())!;
      const b = (await btn.boundingBox())!;
      inside(t, v);
      // A tip may cover its i only when it fits neither under nor over it.
      if (b.y + b.height + t.height + 12 <= v.height || b.y - t.height - 12 >= 0) expect(t.y + t.height <= b.y || t.y >= b.y + b.height, `${x} ${y}`).toBe(true);
      if (x === "calc(100% - 44px)" && y === "calc(100% - 44px)") await p.screenshot({ path: info.outputPath(`infotip-qa-${v.width}x${v.height}-corner.png`) });
      await p.keyboard.press("Escape");
      await expect(popover(p)).toHaveCount(0);
    }
    const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(o).toBeLessThanOrEqual(0);
    await p.context().close();
  });
}

test("keyboard: Tab walks the row of tips with only one open at a time, Space pins and Esc closes @infotip", async ({ browser }) => {
  const p = await gallery(browser, { width: 1280, height: 800 });
  const duffel = tipButton(p, "Duffel");
  await duffel.focus();
  await p.keyboard.press("Shift+Tab");
  await p.keyboard.press("Tab");
  await expect(popover(p)).toContainText(TERMS.duffel.text);
  await p.keyboard.press("Tab"); // the Duffel tip's close button
  await expect(popover(p).getByRole("button", { name: "Close" })).toBeFocused();
  await p.keyboard.press("Tab"); // on to the Stash i: the Duffel tip goes
  await expect(tipButton(p, "Stash")).toBeFocused();
  await expect(popover(p)).toHaveCount(1);
  await expect(popover(p)).toContainText(TERMS.stash.text);
  await p.keyboard.press("Space");
  await expect(tipButton(p, "Stash")).toHaveAttribute("aria-expanded", "true");
  await p.keyboard.press("Space"); // a second press unpins and closes
  await expect(popover(p)).toHaveCount(0);
  await p.keyboard.press("Space");
  await expect(popover(p)).toHaveCount(1);
  await p.keyboard.press("Escape");
  await expect(popover(p)).toHaveCount(0);
  await expect(tipButton(p, "Stash")).toBeFocused();
  await p.keyboard.press("Shift+Tab"); // back to the Duffel i: its preview opens again
  await expect(popover(p)).toContainText(TERMS.duffel.text);
  await p.context().close();
});

test("touch: a tap opens, a second tap on the same i closes, a tap on another i swaps them @infotip", async ({ browser }) => {
  const p = await gallery(browser, { width: 390, height: 844 }, true);
  await tipButton(p, "Vault").tap();
  await expect(popover(p)).toContainText("Up to 3 coins");
  await tipButton(p, "Vault").tap();
  await expect(popover(p)).toHaveCount(0);
  await tipButton(p, "Vault").tap();
  await tipButton(p, "Mole").tap();
  await expect(popover(p)).toHaveCount(1);
  await expect(popover(p)).toContainText("ring any room once");
  await expect(tipButton(p, "Vault")).toHaveAttribute("aria-expanded", "false");
  await p.context().close();
});

test("screen reader: a button named About <name> that controls a note named <name> holding the line @infotip", async ({ browser }) => {
  const p = await gallery(browser, { width: 390, height: 844 }, true);
  const bell = tipButton(p, "Bell");
  await expect(bell).toHaveAttribute("aria-expanded", "false");
  const id = await bell.getAttribute("aria-controls");
  expect(id).toBeTruthy();
  await bell.tap();
  await expect(bell).toHaveAttribute("aria-expanded", "true");
  const note = p.getByRole("note", { name: "Bell" });
  await expect(note).toHaveAttribute("id", id!);
  await expect(note).toContainText(TIPS.bell.text);
  // The i itself shows only a decorative "i"; its name is the label, not the letter.
  await expect(bell).toHaveAccessibleName("About Bell");
  await p.context().close();
});

test("a scroll keeps an open tip until its i leaves the screen; a resize keeps it inside the screen @infotip", async ({ browser }) => {
  const p = await gallery(browser, { width: 390, height: 844 }, true);
  await tipButton(p, "Duffel").tap();
  await expect(popover(p)).toHaveCount(1);
  await p.evaluate(() => window.scrollBy(0, -120));
  await settle(p);
  await expect(popover(p)).toHaveCount(1);
  attached(...(await boxes(p, tipButton(p, "Duffel"))));
  await p.evaluate(() => window.scrollTo(0, 0));
  await expect(popover(p)).toHaveCount(0);
  await tipButton(p, "Duffel").tap();
  // A window just taller than the i (where a tap leaves it depends on the gallery's length), so the tip must flip above it.
  const height = Math.ceil((await tipButton(p, "Duffel").boundingBox())!.y) + 80;
  await p.setViewportSize({ width: 390, height });
  await expect(popover(p)).toHaveCount(1);
  // The tip follows a resize once a frame, and a long page reflows slowly on a busy machine: wait for it to settle inside the window.
  await expect.poll(async () => ((await popover(p).boundingBox())?.y ?? 0) + ((await popover(p).boundingBox())?.height ?? 0)).toBeLessThanOrEqual(height);
  attached(...(await boxes(p, tipButton(p, "Duffel"))));
  await p.setViewportSize({ width: 430, height });
  await expect(popover(p)).toHaveCount(1);
  // The tip follows a resize once a frame, and a long page reflows slowly on a busy machine: wait for it to settle inside the window.
  await expect.poll(async () => ((await popover(p).boundingBox())?.y ?? 0) + ((await popover(p).boundingBox())?.height ?? 0)).toBeLessThanOrEqual(height);
  const [t, b] = await boxes(p, tipButton(p, "Duffel"));
  inside(t, { width: 430, height });
  attached(t, b);
  await p.context().close();
});

test("in a scrolling GameShell column the tip is not clipped, and scrolling its i out of the column closes it @infotip", async ({ browser }) => {
  const v = { width: 1280, height: 800 };
  const p = await gallery(browser, v);
  // A wide shell's right column (overflow: auto) holding the Suspect tip at its right edge.
  await p.evaluate(() => {
    const shell = Object.assign(document.createElement("div"), { className: "shell shell--wide" });
    const col = Object.assign(document.createElement("div"), { className: "shell__right" });
    Object.assign(col.style, { position: "fixed", right: "0", top: "100px", width: "120px", height: "120px", overflow: "auto" });
    const filler = Object.assign(document.createElement("div"), { style: "flex: none; height: 600px" });
    col.append(document.querySelector(".g-infotips__edge .infotip")!, filler);
    shell.append(col);
    document.querySelector("#root")!.append(shell);
  });
  const btn = p.locator(".shell__right .infotip__btn");
  await btn.click();
  const t = (await popover(p).boundingBox())!;
  inside(t, v);
  expect(t.width).toBeGreaterThan(120); // wider than the column: the top layer, not clipped
  const hit = await p.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest(".infotip__pop"), [t.x + 10, t.y + t.height - 10]);
  expect(hit).toBe(true);
  await p.locator(".shell__right").evaluate((el) => el.scrollBy(0, 10));
  await settle(p);
  await expect(popover(p)).toHaveCount(1);
  attached(...(await boxes(p, btn)));
  await p.locator(".shell__right").evaluate((el) => el.scrollBy(0, 200));
  await expect(popover(p)).toHaveCount(0);
  await p.context().close();
});

test("inside a bottom sheet a tap elsewhere in the sheet closes the tip and keeps the sheet; the tip stays on the screen @infotip", async ({ browser }) => {
  const v = { width: 360, height: 740 };
  const p = await gallery(browser, v, true);
  await p.getByRole("button", { name: "Open a sheet with a tip" }).tap();
  const sheet = p.getByRole("dialog", { name: "Pocket" });
  await sheet.getByRole("button", { name: "About Pocket" }).tap();
  const t = (await popover(p).boundingBox())!;
  inside(t, v);
  // A spot in the sheet that the tip does not cover.
  const s = (await sheet.boundingBox())!;
  const spot = { x: s.x + 12, y: s.y + s.height - 12 };
  expect(spot.y > t.y + t.height || spot.x < t.x).toBe(true);
  await p.touchscreen.tap(spot.x, spot.y);
  await expect(popover(p)).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await p.context().close();
});

test("tabbing onto an i below the screen opens its preview right next to the scrolled-in i @infotip", async ({ browser }) => {
  const v = { width: 1280, height: 800 };
  const p = await gallery(browser, v);
  const duffel = tipButton(p, "Duffel");
  await duffel.focus();
  await p.keyboard.press("Shift+Tab");
  await duffel.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - window.innerHeight - 58));
  await p.keyboard.press("Tab");
  await expect(duffel).toBeFocused();
  await settle(p);
  await expect(popover(p)).toContainText(TERMS.duffel.text);
  const t = (await popover(p).boundingBox())!;
  const b = (await duffel.boundingBox())!;
  inside(t, v);
  // Placed for where the i is after the scroll: just under or just over it.
  expect(Math.min(Math.abs(t.y - (b.y + b.height)), Math.abs(b.y - (t.y + t.height)))).toBeLessThanOrEqual(8);
  await p.context().close();
});

test("Esc closes a hover preview with the focus elsewhere, and takes the Esc: the page stays put @infotip", async ({ browser }) => {
  const p = await gallery(browser, { width: 1280, height: 800 });
  await tipButton(p, "Vault").hover();
  await expect(popover(p)).toBeVisible();
  await p.keyboard.press("Escape");
  await expect(popover(p)).toHaveCount(0);
  await expect(p).toHaveURL(/\/dev\/gallery$/);
  await p.keyboard.press("Escape"); // with no tip open, the app's Esc goes back to the start
  await expect(p).not.toHaveURL(/\/dev\/gallery$/);
  await p.context().close();
});

test("in a sheet, Esc on a hover preview (focus elsewhere in the sheet) closes the tip first, then the sheet @infotip", async ({ browser }) => {
  const p = await gallery(browser, { width: 1280, height: 800 });
  await p.getByRole("button", { name: "Open a sheet with a tip" }).click();
  const sheet = p.getByRole("dialog", { name: "Pocket" });
  await sheet.getByRole("button", { name: "About Pocket" }).hover();
  await expect(popover(p)).toBeVisible();
  await p.keyboard.press("Escape");
  await expect(popover(p)).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await p.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await p.context().close();
});

test("hover grace: a quick out-and-back keeps the tip, staying out closes it, and moving to the next i leaves only that one @infotip", async ({ browser }) => {
  const p = await gallery(browser, { width: 1280, height: 800 });
  const vault = tipButton(p, "Vault");
  const b = (await vault.boundingBox())!;
  const away = { x: b.x + b.width / 2, y: b.y - 40 };
  await vault.hover();
  await expect(popover(p)).toBeVisible();
  await p.mouse.move(away.x, away.y);
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await settle(p);
  await expect(popover(p)).toHaveCount(1);
  await p.mouse.move(away.x, away.y);
  await settle(p);
  await expect(popover(p)).toHaveCount(0);
  await vault.hover();
  await tipButton(p, "Mole").hover();
  await settle(p);
  await expect(popover(p)).toHaveCount(1);
  await expect(popover(p)).toContainText("ring any room once");
  await p.context().close();
});

test("screen reader: the i's description is its line @infotip", async ({ browser }) => {
  const p = await gallery(browser, { width: 390, height: 844 }, true);
  for (const [name, text] of [["Duffel", TERMS.duffel.text], ["Suspect", TIPS.suspect.text]] as const) await expect(tipButton(p, name)).toHaveAccessibleDescription(text);
  await p.context().close();
});

test("fast wheel scrolling keeps the tip on its i in every frame, and scrolling the i off the screen closes it @infotip", async ({ browser }) => {
  const p = await gallery(browser, { width: 1280, height: 800 });
  const i = tipButton(p, "Mole");
  await i.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await i.click();
  await p.mouse.move(40, 400); // off the tip and the i: the tip stays pinned
  await expect(popover(p)).toHaveCount(1);
  // Each frame, just before paint (a ResizeObserver runs after every animation-frame callback and layout):
  // how far the tip is from where it hangs on the i.
  await p.evaluate(() => {
    const w = window as unknown as { drift: number[] };
    w.drift = [];
    const probe = document.body.appendChild(document.createElement("div"));
    let n = 0;
    new ResizeObserver(() => {
      const t = document.querySelector(".infotip__pop:popover-open")?.getBoundingClientRect();
      const b = document.querySelector('[aria-label="About Mole"]')!.getBoundingClientRect();
      if (t) w.drift.push(Math.min(Math.abs(t.top - b.bottom), Math.abs(b.top - t.bottom)));
    }).observe(probe);
    const tick = () => {
      probe.style.width = `${++n % 2}px`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const y0 = await p.evaluate(() => window.scrollY);
  const ys: number[] = [];
  for (const dy of [-120, -120, 120, 120, -120, 120, -90, 90, -200]) {
    await p.mouse.wheel(0, dy);
    await p.waitForTimeout(60); // sleep: paces mouse-wheel steps
    ys.push(await p.evaluate(() => window.scrollY));
  }
  await settle(p);
  expect(await p.evaluate(() => window.scrollY)).not.toBe(y0);
  await expect(popover(p)).toHaveCount(1);
  const drift = await p.evaluate(() => (window as unknown as { drift: number[] }).drift);
  expect(drift.length).toBeGreaterThan(5);
  expect(Math.max(...drift)).toBeLessThanOrEqual(8);
  attached(...(await boxes(p, i)));
  await p.mouse.wheel(0, -900); // the i leaves the bottom of the screen
  await expect(popover(p)).toHaveCount(0);
  await p.context().close();
});

test("on a phone a touch scroll that starts off the tip closes it, like any tap elsewhere @infotip", async ({ browser }) => {
  const p = await gallery(browser, { width: 390, height: 844 }, true);
  const i = tipButton(p, "Mole");
  await i.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await i.tap();
  await expect(popover(p)).toHaveCount(1);
  const y0 = await p.evaluate(() => window.scrollY);
  // A quick flick down the left margin: touch start, ten fast moves, release.
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 30, y: 300 }] });
  for (let k = 1; k <= 10; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 30, y: 300 + k * 30 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => p.evaluate(() => window.scrollY)).toBeLessThan(y0);
  await expect(popover(p)).toHaveCount(0);
  await p.context().close();
});

test("pinning during the hover grace keeps the tip: Enter on a focused i just after the mouse left it @infotip", async ({ browser }) => {
  const p = await gallery(browser, { width: 1280, height: 800 });
  const duffel = tipButton(p, "Duffel");
  await duffel.focus();
  await p.keyboard.press("Shift+Tab");
  await p.keyboard.press("Tab"); // the focus preview
  const b = (await duffel.boundingBox())!;
  await p.mouse.move(b.x + 22, b.y + 22);
  await p.mouse.move(b.x + 22, b.y - 40); // the grace starts
  await p.keyboard.press("Enter"); // pinned within it
  await settle(p);
  await expect(popover(p)).toHaveCount(1);
  await expect(duffel).toHaveAttribute("aria-expanded", "true");
  await p.context().close();
});
