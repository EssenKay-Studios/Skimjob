import { expect, test, type Page } from "@playwright/test";

// S4.9: the end-of-game reveal (design §15.5) on its own demo page
// (/dev/gallery/reveal: a small hand-made game, no server, so it loads in a blink):
// every role, who won and why, and each round's card told true against what everyone really did,
// with a lie, a sat-out round and the Hacker's hidden bell in the last round.
// Then the same game with 24-character names at every launch width: nothing past the edge.

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).then((wide) => expect(wide).toBeLessThanOrEqual(1));

test.describe("the reveal demo", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("every role, the card told true, a sat-out round and each ending @reveal", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the viewport is set here");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/dev/gallery/reveal");
    const reveal = page.getByRole("region", { name: "The reveal" });
    await expect(reveal).toBeVisible();

    // Job done: the top of the ranking wins; four envelopes in ranking order, the Mole's ★, no VOID, no tokens.
    const cards = reveal.locator(".reveal__card");
    await expect(cards.locator(".reveal__who b")).toHaveText(["Ben", "Cy", "Bot · Dot", "You"]);
    await expect(cards.locator(".reveal__score b")).toHaveText(["12", "5", "2", "0"]);
    await expect(reveal.locator(".reveal__why")).toContainText("Job done, so the top of the ranking wins: Ben.");
    await expect(cards.nth(0)).toContainText("★ Also wins if the heist is sunk by theft");
    await expect(cards.nth(3).locator(".reveal__perks")).toContainText("Tail");
    await expect(reveal.locator(".reveal__void")).toHaveCount(0);
    await expect(reveal).not.toContainText(/token/i);

    // Round 1: Ben went to the Vault but said the Lobby: the card told true stamps it a LIE.
    const sheet = reveal.locator(".reveal__round");
    const moves = sheet.getByRole("list", { name: "What everyone really did" });
    const truth = sheet.locator(".snap");
    await expect(sheet.getByRole("heading", { name: "Round 1", exact: true })).toBeVisible();
    await expect(moves.locator("li")).toHaveCount(4);
    await expect(moves.locator("li").filter({ hasText: "Ben" })).toContainText("Went: Vault");
    await expect(truth).toContainText("Round 1, the truth");
    await expect(truth.locator('[data-room="lobby"] .snap__stamp--lie')).toHaveText("LIE");
    await expect(truth.locator('[data-room="vault"] .snap__really .snap__liar')).toHaveCount(1);
    await expect(sheet.locator(".reveal__lies")).toContainText("Lies in round 1");
    await expect(sheet.locator(".reveal__lies")).toContainText("Ben said the Lobby; really the Vault.");

    // Round 2: the Lobby raid is in the timeline.
    await reveal.getByRole("button", { name: "Next round" }).click();
    await expect(sheet.getByRole("heading", { name: "Round 2", exact: true })).toBeVisible();
    await expect(moves.locator("li").filter({ hasText: "Dot" })).toContainText("Went:");
    await expect(sheet).toContainText("Raid! The police hit the Lobby in round 2");
    await expect(sheet).toContainText("Ben claimed Lookout, but was really the Mole.");

    // Round 3, the last: Dot's missed move into the taped-off Lobby is a sat-out round; the Hacker's hidden bell has its real result.
    const r3 = reveal.getByRole("group", { name: "Rounds" }).getByRole("button", { name: "Round 3" });
    await r3.click();
    await expect(r3).toHaveAttribute("aria-pressed", "true");
    await expect(moves.locator("li")).toHaveCount(4);
    await expect(moves).toContainText("Bot · Dot sat the round out: the Lobby was taped off.");
    await expect(sheet).toContainText("Round 3: Cy hid the Vault's bell; it really shows 2 lit.");
    await expect(sheet).toContainText("you bought Tail");
    await expect(reveal.getByRole("button", { name: "Next round" })).toBeDisabled();
    await noSidewaysScroll(page);

    // Busted: the bust story's raids are there, only you (on the Rooftop) win, the rest are VOID.
    await page.getByRole("button", { name: "Busted (Rooftop)" }).click();
    await expect(reveal.locator(".reveal__why")).toContainText("Busted. On a bust, only the Rooftop gets away. The biggest stash up there wins: you.");
    await expect(reveal.locator(".reveal__void")).toHaveCount(3);
    await reveal.getByRole("group", { name: "Rounds" }).getByRole("button", { name: "Round 3" }).click();
    await expect(sheet).toContainText("Raid! The police hit the Vault in round 3");
    await expect(sheet).toContainText("Wanted 3.");

    // Sunk by theft, nobody wins: the Hacker (no ★) is on top, every envelope VOID.
    await page.getByRole("button", { name: "Sunk by theft (nobody)" }).click();
    await expect(reveal.locator(".reveal__why")).toContainText("nobody wins: the ranking is a loss");
    await expect(reveal.locator(".reveal__void")).toHaveCount(4);
    await expect(cards.nth(0)).toContainText("Top of the ranking");
    expect(errors).toEqual([]);
  });
});

for (const width of [360, 390, 768, 1024, 1280]) {
  test.describe(`the reveal demo at ${width}`, () => {
    test.use({ viewport: { width, height: 800 }, hasTouch: width < 1024 });
    test("24-character names: no line pushes the page sideways, in any ending or round; 44 px scrub targets @reveal", async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "the viewport is set here");
      await page.goto("/dev/gallery/reveal");
      await page.getByRole("button", { name: "24 characters" }).click();
      const reveal = page.getByRole("region", { name: "The reveal" });
      await expect(reveal.locator(".reveal__why")).toContainText("WWWWWWWWWWWWWWWWWWWWWWWW");
      for (const ending of ["Job done", "Busted (Rooftop)", "Sunk by theft (nobody)"]) {
        await page.getByRole("button", { name: ending }).click();
        const rounds = reveal.getByRole("group", { name: "Rounds" }).getByRole("button");
        for (let i = 0; i < (await rounds.count()); i++) {
          await rounds.nth(i).click();
          await expect(rounds.nth(i)).toHaveAttribute("aria-pressed", "true");
          const box = (await rounds.nth(i).boundingBox())!;
          expect(box.height, `${ending}, round chip ${i + 1}`).toBeGreaterThanOrEqual(44);
          const out = await page.evaluate((w) => {
            const xs: string[] = [];
            if (document.documentElement.scrollWidth > w) xs.push("page wider than the viewport");
            for (const x of document.querySelectorAll<HTMLElement>(".reveal *")) {
              if (x.closest(".reveal__rounds, .seg")) continue;
              const r = x.getBoundingClientRect();
              if (r.width > 0 && (r.right > w || r.left < 0)) xs.push(`${x.getAttribute("class") ?? x.tagName} ${r.left.toFixed(1)}..${r.right.toFixed(1)}`);
            }
            return xs;
          }, width);
          expect(out, `${ending}, round chip ${i + 1}`).toEqual([]);
        }
      }
    });
  });
}
