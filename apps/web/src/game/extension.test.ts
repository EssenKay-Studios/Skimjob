// Role facts (design §11, §20.2), the black market in the rulebook (§12, §20.3)
// and endings, from real engine views.
import { PERKS, PERK_IDS, PERK_TEXT, ROLES, ROLE_TEXT, ROLE_WIN } from "@skimjob/content";
import { privateTo, viewFor, type GameConfig } from "@skimjob/engine";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EndingNote, RulebookSheet } from "../components/Extension";
import { describeEvent } from "./describeEvent";
import { KIND_LABEL, endingText, roleInfo, roleListInfo, rolesByKind } from "./extension";
import { createGame } from "./deal.testkit";

const config = (extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "ext-test",
  players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, name: i === 0 ? "Ana" : `Bot · ${i}`, isBot: i > 0 })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});

describe("role facts — design §11.1, §20.2", () => {
  it("gives every role its kind, its §20.2 power line and its How you win line; ★ marks the Mole and the Fixer", () => {
    for (const id of Object.keys(ROLES)) {
      const info = roleInfo(id);
      expect(info.kindLabel, id).toBe(KIND_LABEL[ROLES[id]!.kind]);
      expect(info.power, id).toBe(ROLE_TEXT[id]!.power);
      expect(info.howYouWin, id).toBe(ROLE_WIN[ROLE_TEXT[id]!.win]);
      expect(info.star, id).toBe(id === "mole" || id === "fixer");
    }
    expect(roleInfo("hacker")).toMatchObject({ kind: "shadows", kindLabel: "Shadows", star: false });
    expect(roleInfo("priest")).toMatchObject({ kind: "eyes", kindLabel: "Eyes" });
  });

  it("groups roles by kind, eyes first, in content order", () => {
    expect(rolesByKind(Object.keys(ROLES)).map((g) => [g.kind, g.roles])).toEqual([
      ["eyes", ["lookout", "detective", "auditor", "smoothTalker", "priest"]],
      ["shadows", ["locksmith", "hacker", "electrician", "mole", "fixer"]],
    ]);
  });

  it("shows the role list: exact by default, hidden when the host hides it", () => {
    const exact = viewFor(createGame(config()), "p1");
    expect(roleListInfo(exact)).toEqual({ title: "Roles in play", roles: exact.roleList!.roles });
    const hidden = viewFor(createGame(config({ roleList: "hidden" })), "p1");
    expect(roleListInfo(hidden)).toEqual({ title: "The role list is hidden in this game.", roles: [] });
  });
});

describe("the black market in the rulebook — design §12, §20.3", () => {
  const sheet = (view: Parameters<typeof RulebookSheet>[0]["view"]) => renderToStaticMarkup(createElement(RulebookSheet, { open: true, onClose: () => {}, view }));

  it("lists this game's three perks with their costs and §20.3 lines; outside a game, all seven", () => {
    const game = sheet(viewFor({ ...createGame(config()), shop: ["tail", "softShoes", "bail"] }, "p1"));
    for (const p of ["tail", "softShoes", "bail"] as const) expect(game).toContain(PERK_TEXT[p]!.name);
    expect(game).not.toContain(PERK_TEXT.plantEvidence!.name);
    expect(game).toContain(`(${PERKS.bail.cost})`);
    const content = sheet(null);
    for (const p of PERK_IDS) expect(content).toContain(PERK_TEXT[p]!.name);
    expect(content).not.toMatch(/token/i);
  });
});

describe("no tells — design §11.1", () => {
  it("reads a blacked-out room's feed as cameras offline, with no source", () => {
    const ctx = { me: "p1", name: (p: string) => p };
    const feed = { type: "roomWatched", visibility: privateTo("p1"), player: "p1", round: 3, source: "security", room: "vault", seen: [], offline: true } as const;
    // A dark Security takes its own cameras offline too: never claim the watched room is dark (#173 review).
    expect(describeEvent(feed, ctx)).toBe("Round 3, on the cameras: cameras offline (Security or the Vault is dark), nobody seen.");
    expect(describeEvent({ ...feed, source: "lookout" }, ctx)).toBe("Round 3, on lookout: cameras offline (the Vault is dark), nobody seen.");
  });
});

describe("endings — design §8", () => {
  it("says how it ended and marks a failure with no qualified winner as a loss", () => {
    expect(endingText({ result: "success", winners: ["p1"] })).toEqual({ title: "Job done: honest enough, and no bust", badge: "Biggest stash", loss: false });
    expect(endingText({ result: "failed", reason: "bust", winners: [] })).toMatchObject({ badge: "Wins over the Rooftop", loss: true });
    expect(endingText({ result: "failed", reason: "theft", winners: [] })).toMatchObject({ badge: "Wins a heist sunk by theft", loss: true });
  });

  it("doesn't call a failure with a winner a loss", () => {
    expect(endingText({ result: "failed", reason: "bust", winners: ["p2"] })).toMatchObject({ title: "Busted. On a bust, only the Rooftop gets away", badge: "Wins over the Rooftop", loss: false });
    expect(endingText({ result: "failed", reason: "theft", winners: ["p3"] }).loss).toBe(false);
    const note = (winners: string[]) => renderToStaticMarkup(createElement(EndingNote, { outcome: { result: "failed", reason: "bust", winners }, name: (id: string) => (id === "p1" ? "You" : id === "p2" ? "Ben" : "Cy") }));
    expect(note(["p2"])).toContain("Ben wins over the Rooftop.");
    expect(note(["p2"])).not.toContain("loss");
    expect(note(["p1", "p3"])).toContain("You and Cy win over the Rooftop.");
    expect(note([])).toContain("The ranking is marked as a loss.");
  });
});
