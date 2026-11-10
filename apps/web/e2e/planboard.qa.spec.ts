import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect as baseExpect, test, type APIRequestContext, type Page } from "@playwright/test";
import { clearMeeting } from "./meetingCards";
import { pickRoom } from "./move";
import { openPanel } from "./setupGame";

const expect = baseExpect.configure({ timeout: 20_000 });

// QA (S4.3, design §10, §11.3): the plan board in a real bot game at 6 and 12 seats with
// 24-character names, at every launch width. A private move never shows on the board, two
// players editing at once end up on the same board, the round's snapshot history has no wall
// time and is ordered by time left (bots first), and the alibi is offered for the latest
// resolved round, in the result window and through the next round's planning.

test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "viewports are set per test"));

const WIDTHS = [360, 390, 768, 1024, 1280] as const;
const HOST = "Hieronymus Q Bartholomew";
const GUESTS: [string, string] = ["Guinevere Montgomery-Ray", "Maximiliano Fitzgerald-O"];
const SHOTS = process.env.QA_SHOTS ?? join(homedir(), "Documents/Misc/skimjob-wt/qa206-shots");

const panel = (p: Page) => p.getByRole("region", { name: "Plan board" });

async function ok(res: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<{ id: string; inviteCode: string }> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as { id: string; inviteCode: string };
}

/** Host + guests with 24-character names, bots to fill `seats`, the 3-hour preset (102 s rounds at TIME_SCALE 0.1: a loaded runner needs the room). */
async function start(host: APIRequestContext, guests: APIRequestContext[], seats: number): Promise<string> {
  await ok(await host.post("/api/auth/guest", { data: { nickname: HOST } }));
  const game = await ok(await host.post("/api/games", { data: { settings: { sessionLength: "3h" } } }));
  for (const [i, g] of guests.entries()) await ok(await g.post(`/api/invites/${game.inviteCode}/join`, { data: { nickname: GUESTS[i] } }));
  for (let i = 0; i < seats - 1 - guests.length; i++) await ok(await host.post(`/api/games/${game.id}/bots`, { data: {} }));
  await ok(await host.post(`/api/games/${game.id}/start`, { data: {} }));
  // No teaching pop-up (design §15.6) over the plan board.
  for (const who of [host, ...guests]) await ok(await who.patch("/api/me", { data: { tips: false } }));
  return game.id;
}

/** Each width: no sideways scroll, every plan-panel target at least 44 px, a panel and a page shot. */
/** Crossing 1024 px swaps the phone and laptop layouts and remounts the plan board, which closes its pop-ups: `reopen` opens them again, as a person would. */
async function sweep(page: Page, label: string, reopen?: () => Promise<void>) {
  mkdirSync(SHOTS, { recursive: true });
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w < 700 ? 800 : 900 });
    await clearMeeting(page); // a meeting can fall due between widths; its modal cards cover the panel buttons
    await openPanel(page, "This round");
    await reopen?.();
    // The sheet and the pop-up spring in (0.55 s): measure once they have landed.
    await page.waitForTimeout(700);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `${label} @${w}: horizontal overflow`).toBeLessThanOrEqual(0);
    const small = await panel(page).evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>("button, summary")]
        .map((b) => ({ b, r: b.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
        .map(({ b, r }) => `${b.getAttribute("aria-label") ?? b.textContent} ${Math.round(r.width)}x${Math.round(r.height)}`),
    );
    expect(small, `${label} @${w}: small targets`).toEqual([]);
    // Text clipped inside the panel (an ellipsis or a cut-off line) shows as scrollWidth > clientWidth.
    const clipped = await panel(page).evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>("*")].filter((n) => n.children.length === 0 && n.textContent!.trim() && n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow !== "visible").map((n) => n.textContent),
    );
    expect(clipped, `${label} @${w}: clipped text`).toEqual([]);
    await panel(page).screenshot({ path: join(SHOTS, `${label}-${w}-panel.png`) });
    await page.screenshot({ path: join(SHOTS, `${label}-${w}-page.png`), fullPage: w >= 1024 });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await openPanel(page, "This round");
  await reopen?.();
}

/** The ledger as one string per line, from the accessible names (seat order). */
const ledger = (p: Page) => panel(p).getByRole("list", { name: "Claims this round" }).getByRole("button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
/** Who sits on which room of the proposed plan. */
const heads = (p: Page) => panel(p).locator(".plan__room").evaluateAll((rs) => rs.map((r) => `${r.getAttribute("data-room")}:${[...r.querySelectorAll(".plan__heads button")].map((b) => b.getAttribute("aria-label")!.replace(" (you)", "").split(".")[0]).join(",")}`));

for (const seats of [6, 12]) {
  test(`plan board at ${seats} seats: live, private moves stay off it, edits at once converge, snapshot and alibi @plan`, async ({ page, browser }) => {
    test.setTimeout(240_000);
    const guestCount = seats === 12 ? 2 : 1;
    const guests = await Promise.all(Array.from({ length: guestCount }, async () => (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()));
    // Every frame the host's page receives, to read the round's `said` plan snapshot as the server sent it.
    const frames: string[] = [];
    page.on("websocket", (ws) => ws.on("framereceived", (f) => typeof f.payload === "string" && frames.push(f.payload)));
    const id = await start(page.request, guests.map((g) => g.request), seats);
    const guest = guests[0]!;
    for (const p of [page, ...guests]) await p.goto(`/game/${id}`);
    for (const p of [page, ...guests]) await openPanel(p, "This round");
    for (const p of [page, ...guests]) await expect(panel(p)).toBeVisible();
    // Bots took their spot and agreed as the round started.
    await expect(panel(page).getByText(`${seats - 1 - guestCount} of ${seats} agreed`)).toBeVisible();
    // Re-check bug 1: every head on the mini bank shows its own tag (no shared "B·" for bots).
    const tags = await panel(page).locator(".plan__heads button, .plan__tray button").evaluateAll((bs) => bs.map((b) => b.textContent!.replace("✓", "").trim()));
    expect(tags.length).toBe(seats);
    expect(new Set(tags).size, `head tags: ${tags.join(" ")}`).toBe(seats);

    // design §10 / visibility: the guest locks in a private move (Vault); the host's board never shows it.
    await pickRoom(guest, "Vault");
    await guest.getByRole("button", { name: "Lock it in" }).click();
    await expect(guest.getByRole("button", { name: "Locked in" })).toBeDisabled();
    await page.waitForTimeout(1000);
    await expect(panel(page).getByRole("button", { name: new RegExp(`^${GUESTS[0]}: no claims\\.`) })).toBeVisible();
    await expect(panel(page).getByRole("group", { name: "Crew not on the plan" }).getByRole("button", { name: new RegExp(`^${GUESTS[0]}\\. Show claims`) })).toBeVisible();
    expect((await heads(page)).join(" ")).not.toContain(GUESTS[0]);

    // Two players at once: the host puts the guest on the Office while the guest claims the Lobby and agrees.
    await panel(page).getByRole("group", { name: "Crew not on the plan" }).getByRole("button", { name: new RegExp(`^${GUESTS[0]}\\. Show claims`) }).click();
    await Promise.all([
      panel(page).getByRole("button", { name: new RegExp(`^Office: put ${GUESTS[0]} here`) }).click(),
      panel(guest).getByRole("button", { name: /^Lobby: claim as your spot/ }).click(),
      panel(guest).getByRole("button", { name: "I agree", exact: true }).click(),
    ]);
    // ...then both move the same bot to different rooms at once: whichever lands last wins, on both screens.
    const botHead = (p: Page) => panel(p).getByRole("button", { name: /^Bot · Riya[,.]/ }).first();
    await botHead(page).click();
    await botHead(guest).click();
    await Promise.all([panel(page).getByRole("button", { name: /^Vault: put Bot · Riya here/ }).click(), panel(guest).getByRole("button", { name: /^Rooftop: put Bot · Riya here/ }).click()]);
    await expect(panel(page).getByRole("button", { name: new RegExp(`^${GUESTS[0]}: Lobby\\.`) })).toBeVisible();
    await expect(panel(page).getByText(`${seats - guestCount} of ${seats} agreed`)).toBeVisible();
    // Both screens are read inside the poll: the guest's last frame can land a moment after the host's.
    const shown = async (p: Page) => JSON.stringify([await ledger(p), await heads(p)]);
    await expect.poll(async () => ((await shown(page)) === (await shown(guest)) ? "same" : `${await shown(page)}\n≠\n${await shown(guest)}`)).toBe("same");
    const officeHeads = (await heads(page)).find((h) => h.startsWith("office:"))!;
    expect(officeHeads).toContain(GUESTS[0]);

    // The host claims the Security room and pledges Detective → the guest; selects the guest's line (pop-up, marked head).
    await panel(page).getByRole("button", { name: /^Security: claim as your spot/ }).click();
    await panel(page).getByRole("button", { name: "Claim a power" }).click();
    await panel(page).getByRole("group", { name: "Role to pledge" }).getByRole("button", { name: "Detective" }).click();
    // §11.1: no power can target yourself, so your own seat is no pledge target (the server refuses it).
    await expect(panel(page).getByRole("group", { name: "Player to pledge on" }).getByRole("button", { name: HOST })).toHaveCount(0);
    await sweep(page, `s${seats}-pledge-picker`, async () => {
      if (await panel(page).getByRole("group", { name: "Role to pledge" }).isVisible()) return;
      await panel(page).getByRole("button", { name: "Claim a power" }).click();
      await panel(page).getByRole("group", { name: "Role to pledge" }).getByRole("button", { name: "Detective" }).click();
    });
    await panel(page).getByRole("group", { name: "Player to pledge on" }).getByRole("button", { name: GUESTS[0] }).click();
    await panel(page).getByRole("button", { name: "Pledge", exact: true }).click();
    await expect(panel(guest).getByRole("button", { name: new RegExp(`^${HOST}: Security, Detective on ${GUESTS[0]}\\.`) })).toBeVisible();
    await sweep(page, `s${seats}-live`);
    await panel(page).getByRole("button", { name: new RegExp(`^${GUESTS[0]}: Lobby\\.`) }).click();
    await expect(panel(page).getByRole("group", { name: `${GUESTS[0]}'s claims` })).toBeVisible();
    await sweep(page, `s${seats}-live-popup`, async () => {
      if (await panel(page).getByRole("group", { name: `${GUESTS[0]}'s claims` }).isVisible()) return;
      await panel(page).getByRole("button", { name: new RegExp(`^${GUESTS[0]}: Lobby\\.`) }).click();
    });

    // Everyone human locks in; the round resolves and the snapshot shows.
    await pickRoom(page, "Vault");
    await page.getByRole("button", { name: "Lock it in" }).click();
    for (const g of guests.slice(1)) {
      await pickRoom(g, "Office");
      await g.getByRole("button", { name: "Lock it in" }).click();
    }
    const summary = panel(page).getByText("Round 1 plan", { exact: true });
    await expect(summary).toBeVisible({ timeout: 60_000 });
    // The alibi is offered for round 1 in the result window (and stays through round 2's planning, below).
    await expect(panel(page).getByText("Round 1 alibi: where were you?")).toBeVisible();
    await clearMeeting(page);
    await summary.click();
    const history = panel(page).getByRole("list", { name: "How the round 1 plan changed" });
    await expect(history).toBeVisible();
    const rows = await history.getByRole("listitem").allInnerTexts();

    // No wall time anywhere in the panel: no clock reading, no date, no "ago".
    const text = await panel(page).innerText();
    expect(text).not.toMatch(/\b\d{1,2}:\d{2}\b|\b(AM|PM)\b|\b20\d\d\b|\bago\b|\btoday\b|\byesterday\b/i);

    // The history matches the logged snapshot: most time left first, every null (bot) edit leading and saying "bot".
    const said = frames.map((f) => JSON.parse(f)).flatMap((m) => JSON.stringify(m).match(/"statement":\{"kind":"plan".*?"history":(\[.*?\])\}/)?.slice(1) ?? []);
    expect(said.length, "the round's said plan snapshot reached the client").toBeGreaterThan(0);
    const logged = JSON.parse(said.at(-1) as string) as { actor: string; msBeforeDeadline: number | null }[];
    expect(JSON.stringify(logged)).not.toMatch(/"at"/);
    expect(rows).toHaveLength(logged.length);
    const ms = [...logged].sort((a, b) => (b.msBeforeDeadline ?? Infinity) - (a.msBeforeDeadline ?? Infinity)).map((e) => e.msBeforeDeadline);
    rows.forEach((r, i) => expect(r.endsWith("· bot"), `row ${i} "${r}" (ms ${ms[i]})`).toBe(ms[i] === null));
    // design §10: "Bots take a sensible spot": every bot edit is marked as a bot's.
    const botRows = rows.filter((r) => r.startsWith("Bot ·") && !r.includes(HOST) && !r.includes(GUESTS[0]));
    test.info().annotations.push({ type: "history", description: JSON.stringify({ rows, logged }) });
    expect(botRows.length).toBeGreaterThan(0);
    expect(botRows.every((r) => r.endsWith("· bot")), `bot rows: ${botRows.join(" | ")}`).toBe(true);
    await sweep(page, `s${seats}-snapshot`);

    // Round 2's planning: the live board is fresh and the round 1 alibi is still on offer; post one (a lie).
    // A meeting that fell due first (chance) sits over the panels as modal cards: close them as a player would, then look.
    await clearMeeting(page);
    await expect(panel(page).getByText(/ of \d+ agreed/)).toBeVisible({ timeout: 60_000 });
    // The offer is for the latest resolved round: a meeting that held the game up (the player idles through it) moves it past
    // round 1, and the round can tick again before the post lands, so the round number is not pinned.
    await expect(panel(page).getByText(/^Round \d+ alibi: where were you\?$/)).toBeVisible();
    await expect(panel(page).getByRole("button", { name: new RegExp(`^${GUESTS[0]}: no claims\\.`) })).toBeVisible();
    await sweep(page, `s${seats}-round2-alibi`);
    await panel(page).getByRole("group", { name: "Alibi room" }).getByRole("button", { name: "Lobby" }).click();
    await panel(page).getByRole("button", { name: "Post alibi" }).click();
    await expect(panel(page).getByText(/You told the crew you were in the\s*Lobby\s*in round \d+/)).toBeVisible();
    // Re-check bug 2: the posted alibi is one inline sentence, not a grid of rows.
    expect(await panel(page).locator("p.plan__alibi").evaluate((el) => getComputedStyle(el).display)).toBe("block");
    await sweep(page, `s${seats}-alibi-posted`);
  });
}
