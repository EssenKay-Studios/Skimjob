import { expect, test } from "@playwright/test";
import { openPanel, startGame } from "./setupGame";

// QA (#202): editing your private note on a seat from the case board's Players
// strip (design §15.3, §15.4): the keyboard, the 280 code-point cap, a blank save
// clearing the note, switching seats mid-edit, and a bot seat.

const API = (id: string) => `/api/games/${id}/notes`;

test("Enter saves, Escape cancels, a blank save clears, 280 emoji fit, a switched seat drops the draft @caseboard", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one viewport is enough for the flow");
  test.setTimeout(60_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const game = await startGame(page.request, { bots: 3, sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  const board = page.getByRole("region", { name: "Case board" });
  await openPanel(page, "Case");
  const seats = board.getByRole("list", { name: "Players" }).getByRole("button");
  await expect(seats).toHaveCount(3);
  const a = seats.nth(0);
  const b = seats.nth(1);
  const nameOf = async (btn: typeof a) => (await btn.getAttribute("aria-label"))!.split(",")[0]!;

  // Enter saves (a note on a bot seat is fine).
  await a.click();
  const aName = await nameOf(a);
  const note = board.getByRole("group", { name: `Your note on ${aName}` });
  await note.getByRole("button", { name: "Add note" }).click();
  await note.getByLabel(`Note on ${aName}`).fill("  took the Vault twice  ");
  await note.getByLabel(`Note on ${aName}`).press("Enter");
  await expect(note.locator(".cb__note-text")).toHaveText("took the Vault twice");
  const saved = (await (await page.request.get(API(game.id))).json()) as { board: Record<string, string> };
  expect(Object.values(saved.board)).toEqual(["took the Vault twice"]);

  // Escape cancels the edit and keeps the saved note.
  await note.getByRole("button", { name: "Edit note" }).click();
  await note.getByLabel(`Note on ${aName}`).fill("never mind");
  await note.getByLabel(`Note on ${aName}`).press("Escape");
  await expect(note.locator(".cb__note-text")).toHaveText("took the Vault twice");
  await expect(note.getByRole("button", { name: "Edit note" })).toBeVisible();

  // Switching seats mid-edit drops the draft; nothing is saved for either seat.
  await note.getByRole("button", { name: "Edit note" }).click();
  await note.getByLabel(`Note on ${aName}`).fill("half a thought");
  await b.click();
  const bName = await nameOf(b);
  await expect(board.getByRole("group", { name: `Your note on ${bName}` }).getByRole("button", { name: "Add note" })).toBeVisible();
  await a.click();
  await expect(note.locator(".cb__note-text")).toHaveText("took the Vault twice");

  // 300 emoji are cut to 280 code points (the server's count) and saved whole.
  const other = board.getByRole("group", { name: `Your note on ${bName}` });
  await b.click();
  await other.getByRole("button", { name: "Add note" }).click();
  await other.getByLabel(`Note on ${bName}`).fill("🕵️".replace("️", "").repeat(300));
  await expect(other.getByText("280/280")).toBeVisible();
  await other.getByRole("button", { name: "Save note" }).click();
  await expect(other.locator(".cb__note-text")).toHaveText("🕵".repeat(280));

  // Saving only spaces clears the note: Add note again, and the server row is gone.
  await other.getByRole("button", { name: "Edit note" }).click();
  await other.getByLabel(`Note on ${bName}`).fill("    ");
  await other.getByRole("button", { name: "Save note" }).click();
  await expect(other.getByRole("button", { name: "Add note" })).toBeVisible();
  await expect(other.locator(".cb__note-text")).toHaveCount(0);
  const after = (await (await page.request.get(API(game.id))).json()) as { board: Record<string, string> };
  expect(Object.values(after.board)).toEqual(["took the Vault twice"]);

  // Tapping the open seat again closes its note card.
  await b.click();
  await expect(other).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test("on the sheet layout, Escape cancels the note edit and keeps the Case sheet open @caseboard", async ({ browser }, info) => {
  test.skip(info.project.name !== "mobile", "the Case sheet is the < 1024 px layout");
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const game = await startGame(page.request, { bots: 3, sessionLength: "1w" });
  await page.goto(`/game/${game.id}`);
  await openPanel(page, "Case");
  const board = page.getByRole("region", { name: "Case board" });
  const seat = board.getByRole("list", { name: "Players" }).getByRole("button").first();
  await seat.click();
  const name = (await seat.getAttribute("aria-label"))!.split(",")[0]!;
  const note = board.getByRole("group", { name: `Your note on ${name}` });
  await note.getByRole("button", { name: "Add note" }).click();
  await note.getByLabel(`Note on ${name}`).fill("draft");
  await note.getByLabel(`Note on ${name}`).press("Escape");
  await expect(note.getByRole("button", { name: "Add note" })).toBeVisible();
  await expect(page.locator("dialog.bsheet[open] .bsheet__head h2")).toHaveText("Case");
  await ctx.close();
});
