// QA (S4.7, #108): attacks on the black market sheet's data. Prices from
// content overrides, the last-round warning reached by play at an overridden
// cap, Open mode never dealing the Check ballot (#187), self-targets and a
// second perk refused even past the UI, and a bystander's sheet that can't tell
// who bought. design §11.1, §12, §18
import { describe, expect, it } from "vitest";
import { PERK_IDS, type PerkId } from "@skimjob/content";
import { handleCommand, viewFor, type GameConfig, type GameEvent, type GameState, type PlayerState } from "@skimjob/engine";
import { createGame } from "./deal.testkit";
import { latestSales, marketOf, perkUse } from "./market";

const config = (extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "market-qa",
  players: ["p1", "p2", "p3", "p4"].map((id) => ({ id, name: id.toUpperCase(), isBot: false })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});

function game(shop: readonly PerkId[], stash = 9, extra: Partial<GameConfig> = {}): GameState {
  const s = createGame(config(extra));
  const log = s.log.map((e): GameEvent => (e.type === "shopDealt" ? { ...e, perks: shop } : e));
  const fresh = { ...s, log, shop: [...shop] };
  return { ...fresh, players: Object.fromEntries(Object.entries(fresh.players).map(([id, p]) => [id, { ...(p as PlayerState), stash }])) };
}
const step = (s: GameState, c: unknown) => handleCommand(s, c as never);
const run = (s: GameState, ...cmds: unknown[]): GameState =>
  cmds.reduce<GameState>((st, c) => {
    const r = step(st, c);
    if (!r.ok) throw new Error(r.reason);
    return r.state;
  }, s);
const buy = (player: string, perk: unknown) => ({ type: "buyPerk", player, perk });
const endRound = (round: number) => [
  { type: "advance", deadline: { kind: "round", round } },
  { type: "advance", deadline: { kind: "alibi", round } },
  { type: "advance", deadline: { kind: "result", round } },
];

describe("QA: black market sheet — design §12", () => {
  it("prices come from content overrides, and the stash check uses them", () => {
    const m = marketOf(viewFor(game(["tail", "softShoes", "bail"], 2, { contentOverrides: { perks: { tail: { cost: 3 }, bail: { cost: 1 } } } }), "p1"));
    expect(m.offers.map((o) => [o.perk, o.cost])).toEqual([
      ["tail", 3],
      ["softShoes", 2],
      ["bail", 1],
    ]);
    expect(m.offers.map((o) => o.blocked)).toEqual(["It costs 3 coins; your stash holds 2.", null, null]);
  });

  it("the last-round warning: reached by play at an overridden cap of 3, for exactly the five perks that would be wasted", () => {
    let s = game(PERK_IDS, 9, { contentOverrides: { roundCap: 3 } });
    const flagged = () => marketOf(viewFor(s, "p1")).offers.filter((o) => o.wasted).map((o) => o.perk);
    expect(flagged()).toEqual([]);
    s = run(s, ...endRound(1));
    expect(flagged()).toEqual([]);
    s = run(s, ...endRound(2));
    expect(viewFor(s, "p1").phase).toEqual({ kind: "planning", round: 3 });
    expect(flagged().sort()).toEqual(["bail", "ballot", "blackout", "softShoes", "tail"]);
    for (const o of marketOf(viewFor(s, "p1")).offers.filter((x) => x.wasted)) expect(o.wasted).toContain(o.name);
  });

  it("Open vote mode never deals or offers the Check ballot; Secret mode can (owner ruling #187)", () => {
    const tier1 = (voteVisibility: GameConfig["voteVisibility"]) =>
      new Set(Array.from({ length: 80 }, (_, i) => marketOf(viewFor(createGame(config({ seed: `qa-${i}`, voteVisibility })), "p1")).offers.map((o) => o.perk)).flat());
    expect(tier1("open").has("ballot")).toBe(false);
    expect(tier1("secret").has("ballot")).toBe(true);
  });

  it("past the UI: a self-target is refused for Check ballot and Plant evidence, and a second perk in one round is refused", () => {
    const s = game(["ballot", "softShoes", "plantEvidence"]);
    const [ballot, , plant] = marketOf(viewFor(s, "p1")).offers;
    expect(step(s, buy("p1", perkUse(ballot!, { player: "p1", room: null }))).ok).toBe(false);
    expect(step(s, buy("p1", perkUse(plant!, { player: "p1", room: "vault" }))).ok).toBe(false);
    const once = run(s, buy("p1", { kind: "softShoes" }));
    expect(step(once, buy("p1", { kind: "ballot", target: "p2" })).ok).toBe(false);
    expect(step(once, buy("p1", { kind: "softShoes" })).ok).toBe(false);
  });

  it("a bystander's sheet is the same whoever bought, before and after the round resolves", () => {
    const base = game(["tail", "softShoes", "bail"]);
    const by = (buyer: string) => run(base, buy(buyer, { kind: "softShoes" }));
    for (const viewer of ["p1", "p4"]) {
      expect(marketOf(viewFor(by("p2"), viewer))).toEqual(marketOf(viewFor(by("p3"), viewer)));
      expect(marketOf(viewFor(by("p2"), viewer))).toEqual(marketOf(viewFor(base, viewer)));
      const after = (buyer: string) => latestSales(viewFor(run(by(buyer), endRound(1)[0]), viewer));
      expect(after("p2")).toEqual(after("p3"));
      expect(after("p2").map((e) => e.perk)).toEqual(["softShoes"]);
    }
  });
});
