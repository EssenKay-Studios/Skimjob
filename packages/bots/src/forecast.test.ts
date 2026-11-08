// The bot rules: the ending forecast, ★ roles leaning toward the failure they
// win on, the Mole's ring, the Fixer's reopen, and buying/spending tokens.
// extension.md Build notes "Bots", "Tokens and the perk shop"; design §5, §11.1
import { describe, expect, it } from "vitest";
import { viewFor, type GameState, type PlayerCommand } from "@skimjob/engine";
import { decide } from "./bot";
import { forecast, LEAN_AT, leaning } from "./forecast";
import { buyPerks, perkSpender } from "./perks";
import { PERSONALITIES, type Personality } from "./personalities";
import { closeAlibis, game, round } from "./testkit";

type Player = GameState["players"][string];
const exact: Personality = { ...PERSONALITIES.honest, noise: 0, misread: 0, hunch: 0 };
const as = (s: GameState, role: string, me: Partial<Player> = {}, roleState: Partial<Player["roleState"]> = {}): GameState => {
  const ana = s.players.ana as Player;
  return { ...s, players: { ...s.players, ana: { ...ana, role, ...me, roleState: { ...ana.roleState, ...roleState } } } };
};

/** Two rounds with everyone pocketing their whole Lobby grab: honesty 0, so the heist looks sunk by theft. */
const cold = (): GameState => {
  let s = game(5);
  for (let r = 0; r < 2; r++) s = round(s, Object.fromEntries(s.playerOrder.map((id) => [id, { room: "lobby", pocket: 2 }])));
  return closeAlibis(s);
};

describe("ending forecast and leaning — extension.md Build notes \"Bots\", design §5.5", () => {
  it("a fresh job forecasts no bust and no theft; honesty on the line, an even chance of theft; one raid short of the bust line, an even chance of a bust", () => {
    const s = game(5);
    expect(forecast(viewFor(s, "ana"))).toMatchObject({ bust: 0, theft: 0 });
    // design §7.5: 6 of 9 coins taken reached the duffel, exactly the two-thirds line.
    expect(forecast(viewFor({ ...s, reached: 6, bank: s.bank - 9 }, "ana")).theft).toBe(0.5);
    expect(forecast(viewFor({ ...s, wanted: 1 }, "ana")).bust).toBe(0);
    expect(forecast(viewFor({ ...s, wanted: 2 }, "ana")).bust).toBe(0.5);
  });

  it("only a ★ role that rates itself top leans toward its failure, once the forecast passes LEAN_AT", () => {
    const s = cold();
    expect(forecast(viewFor(s, "ana")).theft).toBeGreaterThanOrEqual(LEAN_AT);
    expect(leaning(viewFor(as(s, "mole", { stash: 10 }), "ana"))).toBe("theft");
    expect(leaning(viewFor(as(s, "rookie", { stash: 10 }), "ana"))).toBeNull(); // team player: always success
    expect(leaning(viewFor(as(s, "mole", { stash: 0 }), "ana"))).toBeNull(); // not top
    expect(leaning(viewFor(as(game(5), "mole", { stash: 10 }), "ana"))).toBeNull(); // honest so far: nothing to lean on
    // design §5.5: no role wins a bust, so a near-bust is never leaned on.
    expect(leaning(viewFor(as({ ...game(5), wanted: 2 }, "mole", { stash: 10 }), "ana"))).toBeNull();
  });
});

describe("the Mole's ring — design §5.2, §11.1", () => {
  const rings = (s: GameState) => {
    const move = decide(viewFor(s, "ana"), exact, () => 0.5, "test-crew").find((c) => c.type === "submitMove");
    return move?.type === "submitMove" ? move.move.ability : undefined;
  };
  /** A Mole on top of a thieving crew (leaning toward theft), with the Office and Deposit boxes lit. */
  const leaningMole = (): GameState => {
    const s = as(cold(), "mole", { stash: 10 });
    return { ...s, bells: { ...s.bells, lobby: 0, office: 2, depositBoxes: 1 } };
  };
  it("rings the loudest lit bell elsewhere, once between meetings; never the Rooftop; nothing when every bell is dark", () => {
    const lit = leaningMole();
    expect(rings(lit)).toEqual({ kind: "ring", room: "office" });
    expect(rings(as(lit, "mole", {}, { usedThisAct: 1 }))).toBeUndefined();
    const dark = Object.fromEntries(Object.keys(lit.bells).map((r) => [r, 0]));
    expect(rings({ ...lit, bells: dark })).toBeUndefined();
  });

  // design §8.4, §19.3: the Mole plays to its own win, a heist sunk by theft.
  it("rings only while it leans toward theft: not on an honest job, not when it isn't top", () => {
    const lit = leaningMole();
    expect(rings({ ...as(game(5), "mole", { stash: 10 }), bells: lit.bells })).toBeUndefined();
    expect(rings(as(lit, "mole", { stash: 0 }))).toBeUndefined();
  });

  // design §5.5: one raid from the bust line any ring could bust the crew, and off the Rooftop the Mole loses a bust.
  it("keeps quiet one raid from the bust line", () => {
    expect(rings({ ...leaningMole(), wanted: 1 })).toEqual({ kind: "ring", room: "office" });
    expect(rings({ ...leaningMole(), wanted: 2 })).toBeUndefined();
  });
});

describe("the Fixer's reopen — design §5.3, §11.1", () => {
  it("reopens the richest taped-off room, once a game", () => {
    const s = as(game(5), "fixer");
    const { vault: _v, office: _o, ...bells } = s.bells;
    const taped = { ...s, bells, taped: { vault: 3, office: 3 } };
    const ability = (st: GameState) => {
      const move = decide(viewFor(st, "ana"), exact, () => 0.5, "test-crew").find((c) => c.type === "submitMove");
      return move?.type === "submitMove" ? move.move.ability : undefined;
    };
    expect(ability(taped)).toEqual({ kind: "reopen", room: "vault" });
    expect(ability(as(taped, "fixer", {}, { usedThisGame: 1 }))).toBeUndefined();
  });
});

describe("buying and spending perks — extension.md \"Tokens and the perk shop\", Build notes \"Bots\"", () => {
  const shop = (s: GameState): GameState => ({ ...s, shop: ["peek", "shield", "extraVote"] });
  const bought = (cmds: PlayerCommand[]) => cmds.flatMap((c) => (c.type === "buyPerk" ? [c.perk] : []));

  it("buys by priority as tokens allow, one of each, and never what it holds", () => {
    const s = shop(game(5));
    expect(bought(buyPerks(viewFor(as(s, "rookie", {}, { tokens: 1 }), "ana")))).toEqual(["extraVote"]); // Shield and Peek cost 2
    expect(bought(buyPerks(viewFor(as(s, "rookie", {}, { tokens: 4 }), "ana")))).toEqual(["shield", "peek"]);
    expect(bought(buyPerks(viewFor(as(s, "rookie", {}, { tokens: 2, perks: ["shield"] }), "ana")))).toEqual(["peek"]);
    expect(bought(buyPerks(viewFor(as(s, "rookie", {}, { tokens: 0 }), "ana")))).toEqual([]);
  });

  it("spends every token in the last round: unspent tokens are worth nothing", () => {
    const s = shop(game(5));
    const last: GameState = { ...s, round: 12, phase: { kind: "planning", round: 12 } }; // the round cap (design §6.2)
    expect(bought(buyPerks(viewFor(as(last, "rookie", {}, { tokens: 3, perks: ["shield", "peek", "extraVote"] }), "ana")))).toEqual(["extraVote", "extraVote", "extraVote"]);
  });

  it("uses at most one chosen perk a round; Shield and Emergency go off by themselves", () => {
    const use = (kind: string): PlayerCommand => ({ type: "useAbility", player: "ana", ability: { kind } } as unknown as PlayerCommand);
    const move: PlayerCommand = { type: "submitMove", player: "ana", move: { room: "lobby", duffel: 1, pocket: 0 } };
    const spend = perkSpender(viewFor(game(5), "ana"));
    expect(spend([use("peek"), move, use("tail")])).toEqual([use("peek"), move]);
    expect(spend([use("alibi")])).toEqual([]); // already used one this round
  });
});
