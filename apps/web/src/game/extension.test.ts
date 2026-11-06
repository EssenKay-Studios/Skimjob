// Extension helpers (docs/extension.md), from real engine views: role facts,
// the target bar, Heat breakdown, gap box, shop and perk uses, endings.
import { BANK_JOB, DECKS, PERKS, POLICE_ACTIVITY, ROLES } from "@skimjob/content";
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
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EndingNote } from "../components/Extension";
import { describeEvent } from "./describeEvent";
import { endingText, gapInfo, heatRound, heatRounds, howYouWin, perkUses, roleInfo, roleListInfo, shopState, targetBar, usedPerkThisRound } from "./extension";
import { abilityOffers } from "./meeting";
import { deckPatch, deckRoles, rolePatch } from "../components/DeckSettings";
import type { LobbySettings } from "../api";

const config = (extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "ext-test",
  players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, name: i === 0 ? "Ana" : `Bot · ${i}`, isBot: i > 0 })),
  job: "bank",
  rolePool: ["rookie"],
  mole: "off",
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
  for (let i = 0; i < n; i++) s = applyEvent(s, { type: "tokenEarned", visibility: privateTo(player), player, trigger: "checkpointMade" });
  return s;
};

describe("role facts (extension.md Roles)", () => {
  it("gives every role a tag and a How you win line; ★ roles name the failures they win", () => {
    expect(roleInfo("rookie")).toMatchObject({ tagLabel: "Team player", star: false, howYouWin: "Have the biggest stash when the job succeeds." });
    expect(roleInfo("fence")).toMatchObject({ tagLabel: "Wildcard", star: true, howYouWin: "Have the biggest stash when the job succeeds, or when it fails either way." });
    expect(roleInfo("getawayDriver").howYouWin).toMatch(/or when the cops raid\.$/);
    expect(roleInfo("embezzler").howYouWin).toMatch(/or when the final target is missed\.$/);
    expect(howYouWin(["heat", "target"])).toBe(howYouWin(ROLES.mole!.winsOn));
  });

  it("reads powers and rewards between meetings, with numbers from content", () => {
    const priest = roleInfo("priest");
    expect(priest.power).toContain("between meetings");
    expect(priest.power).toContain(`pays the ${BANK_JOB.shakedown.payout}`);
    expect(priest.earns).toMatch(/^A token when: /);
    expect(roleInfo("mole").power).toContain(`+${POLICE_ACTIVITY.heat} Heat`);
    expect(roleInfo("rookie").power).toBe("No power.");
  });

  it("shows the role list: exact by default, hidden when the host hides it", () => {
    const exact = viewFor(createGame(config()), "p1");
    expect(roleListInfo(exact)).toEqual({ title: "Roles in play", roles: exact.roleList!.roles });
    const hidden = viewFor(createGame(config({ roleList: "hidden" })), "p1");
    expect(roleListInfo(hidden)).toEqual({ title: "The role list is hidden in this game.", roles: [] });
  });
});

describe("the target bar, Heat breakdown and gap box (extension.md: What the app works out for you)", () => {
  it("shows the Haul against the next meeting's target", () => {
    const v = viewFor(createGame(config()), "p1");
    const t = targetBar(v);
    expect(t.text).toBe(`Haul 0 / ${BANK_JOB.checkpoints.perPlayer[0]! * 4} needed by the next meeting`);
    expect(t.ifMissed).toBe(`+${BANK_JOB.heat.missedCheckpoint} Heat if missed`);
  });

  it("breaks one round's Heat into the baseline, rooms and police activity, never saying who caused it", () => {
    let s = run(createGame(config()), round(1));
    s = applyEvent(s, { type: "policeActivity", visibility: PUBLIC, round: 1, heatAdded: POLICE_ACTIVITY.heat, heat: s.heat + POLICE_ACTIVITY.heat });
    const h = heatRound(viewFor(s, "p1"), 1)!;
    expect(h.lines[0]).toEqual({ label: "every round", value: BANK_JOB.heat.perRound, kind: "base" });
    expect(h.lines.at(-1)).toEqual({ label: "police activity", value: POLICE_ACTIVITY.heat, kind: "police" });
    expect(h.text).toMatch(new RegExp(`^\\+${BANK_JOB.heat.perRound} every round, .*\\+${POLICE_ACTIVITY.heat} police activity$`));
    expect(heatRounds(viewFor(s, "p1")).map((x) => x.round)).toEqual([1]);
  });

  it("shows what the 0 floor took back, so the lines add up to the real change (extension.md: Heat never drops below 0)", () => {
    const move = (player: string): PlayerCommand => ({ type: "submitMove", player, move: { room: "rooftop", pocket: 0 } });
    const s = run(createGame(config()), move("p1"), move("p2"), move("p3"), move("p4"), round(1));
    expect(s.heat).toBe(0);
    const h = heatRound(viewFor(s, "p1"), 1)!;
    expect(h.lines.find((l) => l.kind === "clamp")).toMatchObject({ label: "Heat can't go below 0" });
    expect(h.total).toBe(0);
  });

  it("police activity at Heat 99 still reads +4, with a line for what the top took back (extension.md \"Police activity\")", () => {
    let s = run(createGame(config()), round(1));
    const top = BANK_JOB.heat.max;
    s = applyEvent(s, { type: "policeActivity", visibility: PUBLIC, round: 1, heatAdded: top - 1 - s.heat, heat: top - 1 });
    s = applyEvent(s, { type: "policeActivity", visibility: PUBLIC, round: 2, heatAdded: POLICE_ACTIVITY.heat, heat: top });
    const h = heatRound(viewFor(s, "p1"), 2)!;
    expect(h.lines).toEqual([
      { label: "police activity", value: POLICE_ACTIVITY.heat, kind: "police" },
      { label: "Heat is at the top", value: 1 - POLICE_ACTIVITY.heat, kind: "clamp" },
    ]);
    expect(h.total).toBe(1);
  });

  it("adds up the alibis against the Haul's growth", () => {
    let s = run(createGame(config()), round(1));
    const v0 = viewFor(s, "p1");
    expect(gapInfo(v0)!.text).toBe(`No alibis yet for round 1; the Haul grew ${v0.gap!.haulGrowth}.`);
    s = run(s, { type: "postAlibi", player: "p1", room: "vault" });
    const g = gapInfo(viewFor(s, "p1"))!;
    const raw = viewFor(s, "p1").gap!;
    expect(g.posted).toBe(1);
    expect(g.text.startsWith(`Alibis say +${raw.alibis}, the Haul grew ${raw.haulGrowth}`)).toBe(true);
    expect(g.text).toMatch(raw.unaccounted > 0 ? /unaccounted for\.$/ : raw.unaccounted < 0 ? /more than the alibis claim\.$/ : /it adds up\.$/);
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
      { type: "callEmergency", player: "p2" },
      { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-p2" } },
    );
    const offered = (st: GameState) => abilityOffers(viewFor(st, "p1")).some((o) => o.kind === "extraVote");
    expect(offered(s)).toBe(true);
    expect(offered(run(s, { type: "useAbility", player: "p1", ability: { kind: "peek", target: "p2" } }))).toBe(false);
  });
});

describe("no tells (extension.md Situations)", () => {
  it("reads a Hacker's loop and a Power cut the same: camera offline", () => {
    const ctx = { me: "p1", name: (p: string) => p };
    const feed = { type: "roomWatched", visibility: privateTo("p1"), player: "p1", round: 3, source: "security", room: "vault", seen: [], offline: true } as const;
    expect(describeEvent(feed, ctx)).toBe("Round 3, on the cameras: camera offline in the Vault.");
  });
});

describe("endings (extension.md Winning and losing)", () => {
  it("says how it ended and marks a failure with no qualified winner as a loss", () => {
    expect(endingText({ result: "success", winners: ["p1"] })).toEqual({ title: "Final target met with Heat below 100", badge: "Biggest stash", loss: false });
    expect(endingText({ result: "failed", reason: "heat", winners: [] })).toMatchObject({ badge: "Wins on a raid", loss: true });
    expect(endingText({ result: "failed", reason: "target", winners: [] })).toMatchObject({ badge: "Wins on a missed target", loss: true });
  });

  it("doesn't call a failure with a ★ winner a loss", () => {
    expect(endingText({ result: "failed", reason: "heat", winners: ["p2"] })).toMatchObject({ title: "The cops raided: Heat hit 100", badge: "Wins on a raid", loss: false });
    expect(endingText({ result: "failed", reason: "target", winners: ["p3"] }).loss).toBe(false);
    const note = (winners: string[]) => renderToStaticMarkup(createElement(EndingNote, { outcome: { result: "failed", reason: "heat", winners }, name: (id: string) => (id === "p1" ? "You" : id === "p2" ? "Ben" : "Cy") }));
    expect(note(["p2"])).toContain("Ben wins on a raid.");
    expect(note(["p2"])).not.toContain("loss");
    expect(note(["p1", "p3"])).toContain("You and Cy win on a raid.");
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
    expect(deckRoles({ ...base, sessionLength: "quick" })).toEqual(DECKS.standard);
  });

  it("makes Starter only the no-events deck", () => {
    expect(deckPatch("starter")).toEqual({ deck: "starter", roles: [], eventsEnabled: false });
    expect(deckPatch("everything")).toEqual({ deck: "everything", roles: [] });
  });

  it("toggles roles one by one, back to the preset when they match, never to none", () => {
    const off = rolePatch(base, "fence")!;
    expect(off.roles).toEqual(DECKS.standard.filter((r) => r !== "fence"));
    expect(rolePatch({ ...base, roles: off.roles! }, "fence")).toEqual({ roles: [] });
    expect(rolePatch({ ...base, roles: ["rookie"] }, "rookie")).toBeNull();
  });
});

describe("extension.css uses theme tokens (CLAUDE.md UI rules)", () => {
  it("has no raw radii or shadows", () => {
    const css = readFileSync(new URL("../components/extension.css", import.meta.url), "utf8");
    for (const m of css.matchAll(/(border-radius|box-shadow):\s*([^;]+);/g)) expect(m[2], m[0]).toMatch(/^(var\(--[\w-]+\)|0|none)$/);
  });
});
