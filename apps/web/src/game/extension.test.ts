// Extension helpers (docs/extension.md), from real engine views: role facts,
// the shop and perk uses, endings.
import { DECKS, PERKS, ROLES } from "@skimjob/content";
import {
  PUBLIC,
  applyEvent,
  createGame,
  handleCommand,
  privateTo,
  viewFor,
  type GameConfig,
  type GameState,
  type PlayerCommand,
  type SystemCommand,
} from "@skimjob/engine";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EndingNote } from "../components/Extension";
import { describeEvent } from "./describeEvent";
import { endingText, howYouWin, perkUses, roleInfo, roleListInfo, shopState, usedPerkThisRound } from "./extension";
import { abilityOffers } from "./meeting";
import { deckPatch, deckRoles, rolePatch } from "../components/DeckSettings";
import type { LobbySettings } from "../api";

const config = (extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "ext-test",
  players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, name: i === 0 ? "Ana" : `Bot · ${i}`, isBot: i > 0 })),
  job: "bank",
  rolePool: ["rookie"],
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  uniqueRoles: false,
  ...extra,
});

function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const round = (r: number): SystemCommand => ({ type: "advance", deadline: { kind: "round", round: r } });
const alibis = (r: number): SystemCommand => ({ type: "advance", deadline: { kind: "alibis", round: r } });
const tokens = (s: GameState, n: number, player = "p1") => {
  for (let i = 0; i < n; i++) s = applyEvent(s, { type: "tokenEarned", visibility: privateTo(player), player, trigger: "watchedShakenDirty" });
  return s;
};

describe("role facts (extension.md Roles)", () => {
  it("gives every role a tag and a How you win line; ★ roles name the failures they win", () => {
    expect(roleInfo("rookie")).toMatchObject({ tagLabel: "Team player", star: false, howYouWin: "Have the biggest stash when the job succeeds." });
    expect(roleInfo("hacker")).toMatchObject({ tagLabel: "Wildcard", star: false, howYouWin: "Have the biggest stash when the job succeeds." });
    expect(roleInfo("mole")).toMatchObject({ tagLabel: "Lone wolf", star: true, howYouWin: "Have the biggest stash when the job succeeds, or the biggest of all when the heist is sunk by theft." });
    expect(howYouWin(["theft"])).toMatch(/when the heist is sunk by theft\.$/);
    expect(howYouWin(["theft"])).toBe(howYouWin(ROLES.mole!.winsOn));
  });

  it("reads powers and rewards between meetings, with numbers from content", () => {
    const priest = roleInfo("priest");
    expect(priest.power).toContain("between meetings");
    expect(priest.power).toContain("shaken down clean, you earn a token");
    expect(priest.earns).toMatch(/^A token when: /);
    // design §5.2, §11.1: the Mole rings a bell; the Fixer reopens a taped-off room.
    expect(roleInfo("mole").power).toMatch(/^Once between meetings: rings one room's bell once \(not the Rooftop or a taped-off room\)/);
    expect(roleInfo("fixer").power).toMatch(/^Once a game: tears the tape off a raided room/);
    expect(roleInfo("rookie").power).toBe("No power.");
  });

  it("shows the role list: exact by default, hidden when the host hides it", () => {
    const exact = viewFor(createGame(config()), "p1");
    expect(roleListInfo(exact)).toEqual({ title: "Roles in play", roles: exact.roleList!.roles });
    const hidden = viewFor(createGame(config({ roleList: "hidden" })), "p1");
    expect(roleListInfo(hidden)).toEqual({ title: "The role list is hidden in this game.", roles: [] });
  });
});

describe("tokens and the perk shop (extension.md)", () => {
  const withShop = (shop: GameState["shop"]) => ({ ...createGame(config()), shop });

  it("the Starter deck keeps the shop", () => {
    expect(shopState(viewFor(createGame(config({ deck: "starter", rolePool: [...DECKS.starter] })), "p1")).open).toBe(true);
  });

  it("prices perks from the view, buys with tokens and keeps them private", () => {
    let s = withShop(["peek", "shield", "rig"]);
    expect(shopState(viewFor(s, "p1")).items.map((i) => [i.perk, i.cost, i.column, i.affordable])).toEqual([
      ["peek", PERKS.peek.cost, "learn", false],
      ["shield", PERKS.shield.cost, "protect", false],
      ["rig", PERKS.rig.cost, "sway", false],
    ]);
    s = tokens(s, PERKS.peek.cost);
    expect(shopState(viewFor(s, "p1")).items[0]!.affordable).toBe(true);
    s = run(s, { type: "buyPerk", player: "p1", perk: "peek" });
    const mine = shopState(viewFor(s, "p1"));
    expect(mine.tokens).toBe(0);
    expect(mine.items[0]!.owned).toBe(1);
    expect(shopState(viewFor(s, "p2")).items[0]!.owned).toBe(0);
    expect(shopState(viewFor(s, "p2")).items[1]!.auto).toBe(true);
  });

  it("offers one perk use per round; after a use the rest wait for the next round", () => {
    let s = withShop(["peek", "alibi", "extraVote"]);
    s = tokens(s, PERKS.peek.cost * 2);
    s = run(s, { type: "buyPerk", player: "p1", perk: "peek" }, { type: "buyPerk", player: "p1", perk: "peek" });
    expect(perkUses(viewFor(s, "p1")).map((u) => u.kind)).toEqual(["peek"]);
    s = run(s, { type: "useAbility", player: "p1", ability: { kind: "peek", target: "p2" } });
    const v = viewFor(s, "p1");
    expect(usedPerkThisRound(v)).toBe(true);
    expect(shopState(v).usedThisRound).toBe(true);
    expect(perkUses(v)).toEqual([]);
    expect(handleCommand(s, { type: "useAbility", player: "p1", ability: { kind: "peek", target: "p3" } }).ok).toBe(false);
  });

  it("hides the meeting perks after a perk use this round", () => {
    let s = tokens(withShop(["peek", "alibi", "extraVote"]), PERKS.peek.cost + PERKS.extraVote.cost);
    s = run(
      s,
      { type: "buyPerk", player: "p1", perk: "peek" },
      { type: "buyPerk", player: "p1", perk: "extraVote" },
      // design §9.3: the emergency in round 1's result window.
      { type: "advance", deadline: { kind: "round", round: 1 } },
      { type: "advance", deadline: { kind: "alibis", round: 1 } },
      { type: "callEmergency", player: "p2" },
      { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-1" } },
    );
    const offered = (st: GameState) => abilityOffers(viewFor(st, "p1")).some((o) => o.kind === "extraVote");
    expect(offered(s)).toBe(true);
    expect(offered(run(s, { type: "useAbility", player: "p1", ability: { kind: "peek", target: "p2" } }))).toBe(false);
  });
});

describe("no tells (extension.md Situations)", () => {
  it("reads a Hacker's loop as camera offline", () => {
    const ctx = { me: "p1", name: (p: string) => p };
    const feed = { type: "roomWatched", visibility: privateTo("p1"), player: "p1", round: 3, source: "security", room: "vault", seen: [], offline: true } as const;
    expect(describeEvent(feed, ctx)).toBe("Round 3, on the cameras: camera offline in the Vault.");
  });
});

describe("endings (extension.md Winning and losing)", () => {
  it("says how it ended and marks a failure with no qualified winner as a loss", () => {
    expect(endingText({ result: "success", winners: ["p1"] })).toEqual({ title: "Job done: honest enough, and no bust", badge: "Biggest stash", loss: false });
    expect(endingText({ result: "failed", reason: "bust", winners: [] })).toMatchObject({ badge: "Wins over the Rooftop", loss: true });
    expect(endingText({ result: "failed", reason: "theft", winners: [] })).toMatchObject({ badge: "Wins a heist sunk by theft", loss: true });
  });

  it("doesn't call a failure with a ★ winner a loss", () => {
    expect(endingText({ result: "failed", reason: "bust", winners: ["p2"] })).toMatchObject({ title: "Busted. On a bust, only the Rooftop gets away", badge: "Wins over the Rooftop", loss: false });
    expect(endingText({ result: "failed", reason: "theft", winners: ["p3"] }).loss).toBe(false);
    const note = (winners: string[]) => renderToStaticMarkup(createElement(EndingNote, { outcome: { result: "failed", reason: "bust", winners }, name: (id: string) => (id === "p1" ? "You" : id === "p2" ? "Ben" : "Cy") }));
    expect(note(["p2"])).toContain("Ben wins over the Rooftop.");
    expect(note(["p2"])).not.toContain("loss");
    expect(note(["p1", "p3"])).toContain("You and Cy win over the Rooftop.");
    expect(note([])).toContain("The ranking is marked as a loss.");
  });
});

describe("lobby deck settings (extension.md Host settings)", () => {
  const base: LobbySettings = {
    sessionLength: "1h",
    voteVisibility: "hiddenThenRevealed",
    deck: "standard",
    roles: [],
    deal: "balanced",
    roleList: "exact",
    eventsEnabled: true,
    dmNotices: true,
    uniqueRoles: true,
  };

  it("plays the host's deck at every session length", () => {
    expect(deckRoles({ ...base, sessionLength: "15m" })).toEqual(DECKS.standard);
  });

  it("makes Starter only the no-events deck", () => {
    expect(deckPatch("starter")).toEqual({ deck: "starter", roles: [], eventsEnabled: false });
    expect(deckPatch("everything")).toEqual({ deck: "everything", roles: [] });
  });

  it("toggles roles one by one, back to the preset when they match, never to none", () => {
    const off = rolePatch(base, "hacker")!;
    expect(off.roles).toEqual(DECKS.standard.filter((r) => r !== "hacker"));
    expect(rolePatch({ ...base, roles: off.roles! }, "hacker")).toEqual({ roles: [] });
    expect(rolePatch({ ...base, roles: ["rookie"] }, "rookie")).toBeNull();
  });
});
