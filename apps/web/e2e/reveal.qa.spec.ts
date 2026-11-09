import { expect, test } from "@playwright/test";

// QA (PR #219, S4.9): the reveal demo page's three endings, round by round (design §3.3, §5.4, §15.5, §18):
// the bust story's raids climb to Wanted 3 in order, Dot's sat-out round is told in every ending,
// no ballot ever opens, and every round chip is a 44 px target at 360 px.

const ENDINGS = ["Job done", "Busted (Rooftop)", "Sunk by theft (nobody)"] as const;

test.describe("the reveal demo, every ending", () => {
  test.use({ viewport: { width: 360, height: 800 }, hasTouch: true });

  test("raids reach Wanted 3 only on the bust, the sat-out round shows, no ballot opens @reveal", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "the viewport is set here");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/dev/gallery/reveal");
    const reveal = page.getByRole("region", { name: "The reveal" });
    const sheet = reveal.locator(".reveal__round");
    for (const ending of ENDINGS) {
      await page.getByRole("radio", { name: ending }).or(page.getByRole("button", { name: ending })).first().click();
      const chips = reveal.getByRole("group", { name: "Rounds" }).getByRole("button");
      await expect(chips).toHaveCount(3);
      const wanted: number[] = [];
      for (let i = 0; i < 3; i++) {
        await chips.nth(i).click();
        await expect(sheet.getByRole("heading", { name: `Round ${i + 1}` })).toBeVisible();
        const box = await chips.nth(i).boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        const text = (await sheet.textContent()) ?? "";
        for (const m of text.matchAll(/Wanted (\d)/g)) wanted.push(Number(m[1]));
        // design §18: Secret-mode ballots never open; only the meeting's tally is told.
        expect(text).not.toMatch(/voted for|ballot/i);
        // design §3.3: Dot sat round 3 out (the Lobby was raided in round 2).
        if (i === 2) await expect(sheet.getByText("Bot · Dot sat the round out: the Lobby was taped off.")).toBeVisible();
        else expect(text).not.toContain("sat the round out");
      }
      // design §5.4: one Lobby raid in round 2 on every ending; the bust adds round 3's two, up to 3 stars.
      expect(wanted, ending).toEqual(ending.startsWith("Busted") ? [1, 2, 3] : [1]);
    }
    expect(errors).toEqual([]);
  });
});
