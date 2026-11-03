// The R6a bot rules: the ending forecast, ★ roles leaning toward the failure
// they win on, the Mole's tip-off, and buying/spending tokens.
// extension.md Build notes "Bots", "Tokens and the perk shop", "Police activity"
import { describe, expect, it } from "vitest";
import { viewFor, type GameState, type PlayerCommand } from "@skimjob/engine";
import { decide, MOLE_TIP_AT } from "./bot";
import { forecast, leaning } from "./forecast";
import { buyPerks, perkSpender } from "./perks";
import { PERSONALITIES, type Personality } from "./personalities";
import { game } from "./testkit";

type Player = GameState["players"][string];
const exact: Personality = { ...PERSONALITIES.honest, noise: 0, misread: 0, hunch: 0 };
const as = (s: GameState, role: string, me: Partial<Player> = {}, roleState: Partial<Player["roleState"]> = {}): GameState => {
  const ana = s.players.ana as Player;
  return { ...s, players: { ...s.players, ana: { ...ana, role, ...me, roleState: { ...ana.roleState, ...roleState } } } };
};

describe("ending forecast and leaning — extension.md Build notes \"Bots\"", () => {
  it("a fresh job forecasts no raid and an even chance on the target; a hot one forecasts a raid", () => {
    const s = game(5);
    expect(forecast(viewFor(s, "ana"))).toMatchObject({ heat: 0, target: 0.5 });
    expect(forecast(viewFor({ ...s, heat: 95 }, "ana")).heat).toBe(1);
  });

  it("only a ★ role that rates itself top leans toward its failure, once the forecast passes LEAN_AT", () => {
    const hot = { ...game(5), heat: 95 };
    expect(leaning(viewFor(as(hot, "mole", { stash: 10 }), "ana"))).toBe("heat");
    expect(leaning(viewFor(as(hot, "rookie", { stash: 10 }), "ana"))).toBeNull(); // team player: always success
    expect(leaning(viewFor(as(hot, "mole", { stash: 0 }), "ana"))).toBeNull(); // not top
    expect(leaning(viewFor(as(game(5), "mole", { stash: 10 }), "ana"))).not.toBe("heat"); // cool job: no raid to lean on
  });
});

describe("the Mole's tip-off — extension.md \"Police activity\", Build notes \"Bots\"", () => {
  const tips = (s: GameState) => decide(viewFor(s, "ana"), exact, () => 0.5).filter((c) => c.type === "useAbility" && c.ability.kind === "tipOff");
  it(`tips off when Heat within about two rounds would pass ${MOLE_TIP_AT * 100}% of the raid level, once between meetings`, () => {
    const s = game(5);
    expect(tips(as({ ...s, heat: 20 }, "mole"))).toEqual([]);
    expect(tips(as({ ...s, heat: 66 }, "mole"))).toEqual([{ type: "useAbility", player: "ana", ability: { kind: "tipOff" } }]);
    expect(tips(as({ ...s, heat: 66 }, "mole", {}, { usedThisAct: 1 }))).toEqual([]);
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
    const last: GameState = { ...s, round: 9, phase: { kind: "planning", round: 9 } };
    expect(bought(buyPerks(viewFor(as(last, "rookie", {}, { tokens: 3, perks: ["shield", "peek", "extraVote"] }), "ana")))).toEqual(["extraVote", "extraVote", "extraVote"]);
  });

  it("uses at most one chosen perk a round; Shield and Emergency go off by themselves", () => {
    const use = (kind: string): PlayerCommand => ({ type: "useAbility", player: "ana", ability: { kind } } as unknown as PlayerCommand);
    const move: PlayerCommand = { type: "submitMove", player: "ana", move: { room: "lobby", pocket: 0 } };
    const spend = perkSpender(viewFor(game(5), "ana"));
    expect(spend([use("peek"), move, use("tail")])).toEqual([use("peek"), move]);
    expect(spend([use("alibi")])).toEqual([]); // already used one this round
  });
});
