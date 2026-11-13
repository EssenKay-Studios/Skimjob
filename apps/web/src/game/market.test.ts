// The black market sheet's data, from a real engine game's view. design §11.1, §12, §18, §20.3
import { describe, expect, it } from "vitest";
import { PERKS, PERK_TEXT, type PerkId } from "@skimjob/content";
import { handleCommand, viewFor, type GameConfig, type GameEvent, type GameState, type PlayerState } from "@skimjob/engine";
import { createGame } from "./deal.testkit";
import { latestSales, marketOf, perkUse } from "./market";

const config = (extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "market",
  players: ["p1", "p2", "p3"].map((id) => ({ id, name: id.toUpperCase(), isBot: false })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});

/** A game on round 1 with `shop` as its black market and every stash at `stash`. */
function game(shop: readonly PerkId[], stash = 9, extra: Partial<GameConfig> = {}): GameState {
  const s = createGame(config(extra));
  const log = s.log.map((e): GameEvent => (e.type === "shopDealt" ? { ...e, perks: shop } : e));
  const fresh = { ...s, log, shop: [...shop] };
  return { ...fresh, players: Object.fromEntries(Object.entries(fresh.players).map(([id, p]) => [id, { ...(p as PlayerState), stash }])) };
}

const run = (s: GameState, ...cmds: unknown[]): GameState =>
  cmds.reduce<GameState>((st, c) => {
    const r = handleCommand(st, c as never);
    if (!r.ok) throw new Error(r.reason);
    return r.state;
  }, s);
const buy = (player: string, perk: unknown) => ({ type: "buyPerk", player, perk });
const resolve = { type: "advance", deadline: { kind: "round", round: 1 } };

describe("the black market's offers — design §12, §20.3", () => {
  it("lists this game's perks in shop order, with content names, texts and prices", () => {
    const m = marketOf(viewFor(game(["tail", "softShoes", "bail"]), "p1"));
    expect(m.offers.map((o) => [o.perk, o.name, o.text, o.cost])).toEqual(
      (["tail", "softShoes", "bail"] as const).map((p) => [p, PERK_TEXT[p]!.name, PERK_TEXT[p]!.text, PERKS[p].cost]),
    );
    expect(m.stash).toBe(9);
    expect(m.offers.every((o) => o.blocked === null)).toBe(true);
  });

  it("the target picker never offers yourself (design §11.1 Readings)", () => {
    const m = marketOf(viewFor(game(["ballot", "blackout", "plantEvidence"]), "p2"));
    expect(m.players.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(m.offers.map((o) => [o.perk, o.player, o.room])).toEqual([
      ["ballot", true, false],
      ["blackout", false, true],
      ["plantEvidence", true, true],
    ]);
    expect(m.rooms.map((r) => r.id)).toEqual(viewFor(game(["tail", "softShoes", "bail"]), "p2").rooms);
  });

  it("you pay from your stash: a perk you can't afford is blocked, with its price", () => {
    const m = marketOf(viewFor(game(["tail", "softShoes", "bail"], 1), "p1"));
    expect(m.offers.map((o) => o.blocked)).toEqual([null, "It costs 2 coins; your stash holds 1.", "It costs 3 coins; your stash holds 1."]);
  });

  it("one perk a round: after a purchase every offer is blocked until the next round", () => {
    const s = run(game(["tail", "softShoes", "bail"]), buy("p1", { kind: "softShoes" }));
    const m = marketOf(viewFor(s, "p1"));
    expect(m.bought).toBe("softShoes");
    expect(m.offers.every((o) => o.blocked === "You bought Soft shoes this round. One perk a round.")).toBe(true);
    // Another player's purchase never shows on your sheet.
    expect(marketOf(viewFor(s, "p2")).bought).toBeNull();
  });

  it("Bail is the one held item: holding one blocks a second (design §12)", () => {
    let s = run(game(["tail", "softShoes", "bail"]), buy("p1", { kind: "bail" }), resolve);
    s = run(s, { type: "advance", deadline: { kind: "alibi", round: 1 } }, { type: "advance", deadline: { kind: "result", round: 1 } });
    const v = viewFor(s, "p1");
    expect(v.phase).toEqual({ kind: "planning", round: 2 });
    expect(marketOf(v).offers.find((o) => o.perk === "bail")?.blocked).toBe("You already hold a Bail.");
    expect(marketOf(v).offers.find((o) => o.perk === "tail")?.blocked).toBeNull();
  });

  it("in the last round, a perk that would do nothing says why before paying (design §12)", () => {
    const LAST = { contentOverrides: { roundCap: 1 } };
    const wasted = (shop: readonly PerkId[], extra = LAST) => marketOf(viewFor(game(shop, 9, extra), "p1")).offers.map((o) => o.wasted);
    // Not the last round: nothing flagged.
    expect(wasted(["tail", "softShoes", "plantEvidence"], {} as typeof LAST)).toEqual([null, null, null]);
    expect(wasted(["ballot", "blackout", "bail"], {} as typeof LAST)).toEqual([null, null, null]);
    // "Next round" perks have no next round.
    expect(wasted(["tail", "softShoes", "plantEvidence"])).toEqual([
      "This is the last round: Tail works next round, so it would do nothing.",
      "This is the last round: Soft shoes works next round, so it would do nothing.",
      null,
    ]);
    // Check ballot and Bail need a meeting, and none follows the last round.
    expect(wasted(["ballot", "blackout", "bail"])).toEqual([
      "This is the last round: Check ballot needs a meeting, and none follows, so it would do nothing.",
      "This is the last round: Blackout works next round, so it would do nothing.",
      "This is the last round: Bail needs a meeting, and none follows, so it would do nothing.",
    ]);
  });

  it("no meeting can follow the last round: the game ends as it resolves (design §6.2, §9.3)", () => {
    const s = run(game(["ballot", "softShoes", "bail"], 9, { contentOverrides: { roundCap: 1 } }), resolve);
    expect(handleCommand(s, { type: "callEmergency", player: "p1" } as never).ok).toBe(false);
    expect(viewFor(s, "p1").phase.kind).not.toBe("result");
  });

  it("outside planning nothing can be bought", () => {
    const s = run(game(["tail", "softShoes", "bail"]), resolve);
    expect(marketOf(viewFor(s, "p1")).offers.every((o) => o.blocked === "Perks are bought while a round is planned.")).toBe(true);
  });
});

describe("perkUse: buyPerk carries the target, so a purchase is its use — design §12", () => {
  const offers = marketOf(viewFor(game(["tail", "softShoes", "plantEvidence"]), "p1")).offers;
  const [tail, shoes, plant] = offers as [(typeof offers)[0], (typeof offers)[0], (typeof offers)[0]];

  it("waits for every aim the perk needs", () => {
    expect(perkUse(tail, { player: null, room: null })).toBeNull();
    expect(perkUse(plant, { player: "p2", room: null })).toBeNull();
    expect(perkUse(plant, { player: null, room: "vault" })).toBeNull();
    expect(perkUse(shoes, { player: null, room: null })).toEqual({ kind: "softShoes" });
  });

  it("builds the commands the engine accepts", () => {
    const s = game(["tail", "softShoes", "plantEvidence"]);
    const uses = [perkUse(tail, { player: null, room: "vault" }), perkUse(shoes, { player: null, room: null }), perkUse(plant, { player: "p2", room: "office" })];
    expect(uses).toEqual([{ kind: "tail", room: "vault" }, { kind: "softShoes" }, { kind: "plantEvidence", target: "p2", room: "office" }]);
    for (const u of uses) expect(handleCommand(s, buy("p1", u) as never).ok).toBe(true);
    expect(perkUse(marketOf(viewFor(game(["ballot", "blackout", "bail"]), "p1")).offers[0]!, { player: "p3", room: null })).toEqual({ kind: "ballot", target: "p3" });
  });
});

describe("the 'Someone bought' notices, as the engine releases them — design §12, §18", () => {
  it("held while planning, then the round's notices together, in the shop's order, never in buy order, with no name", () => {
    const shop = ["tail", "softShoes", "bail"] as const;
    let s = run(game(shop), buy("p3", { kind: "bail" }), buy("p1", { kind: "softShoes" }), buy("p2", { kind: "softShoes" }));
    // Bought, but nothing public yet: the notices wait for the round to resolve.
    expect(latestSales(viewFor(s, "p2"))).toEqual([]);
    s = run(s, resolve);
    for (const p of ["p1", "p2", "p3"]) {
      const sales = latestSales(viewFor(s, p));
      expect(sales.map((e) => [e.round, e.perk, e.cost])).toEqual([
        [1, "softShoes", 2],
        [1, "softShoes", 2],
        [1, "bail", 3],
      ]);
      expect(JSON.stringify(sales)).not.toMatch(/p[123]/);
    }
  });

  it("shows only the latest round that had purchases", () => {
    let s = run(game(["tail", "softShoes", "bail"]), buy("p1", { kind: "bail" }), resolve, { type: "advance", deadline: { kind: "alibi", round: 1 } }, { type: "advance", deadline: { kind: "result", round: 1 } });
    s = run(s, buy("p2", { kind: "tail", room: "vault" }), { type: "advance", deadline: { kind: "round", round: 2 } });
    expect(latestSales(viewFor(s, "p1")).map((e) => [e.round, e.perk])).toEqual([[2, "tail"]]);
  });
});
