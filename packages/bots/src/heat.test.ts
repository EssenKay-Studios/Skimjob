// The bots' Heat projection: event cards and tip-offs seen in the public Heat.
// design §7, §8 (Mole tip-off), §10 (Heat cards); balance pass 2 (task 16)
import { describe, expect, it } from "vitest";
import { EVENTS, ROLES, STARTER_ROLES } from "@skimjob/content";
import { createGame, viewFor, type GameConfig, type GameState, type MoleSetting } from "@skimjob/engine";
import { cardHeatNow, expectedMoles, heatDanger, jobThisRound, suspectedTipOffRounds, tipOffsToCome } from "./heat";
import { run, seats } from "./testkit";

const TIP = (ROLES.mole?.power as { heat: number }).heat;

function moleGame(n: number, mole: MoleSetting, seed = "heat"): GameState {
  const config: GameConfig = { seed, players: seats(n), job: "bank", rolePool: [...STARTER_ROLES], mole, eventsEnabled: false, voteVisibility: "hiddenThenRevealed", starterMode: false };
  return createGame(config);
}

/** Round 1 with everyone in the Lobby and truthful alibis; the Mole tips off if `tip`. */
function lobbyRound(s: GameState, tip: boolean): GameState {
  const moves = s.playerOrder.map((player) => {
    const ability = tip && s.players[player]?.role === "mole" ? { ability: { kind: "tipOff" } } : {};
    return { type: "submitMove", player, move: { room: "lobby", pocket: 0, ...ability } };
  });
  const after = run(s, ...moves, { type: "advance", deadline: { kind: "round", round: 1 } });
  return run(after, ...s.playerOrder.map((player) => ({ type: "postAlibi", player, room: "lobby" })));
}

const crew = (s: GameState) => s.playerOrder.find((id) => s.players[id]?.role !== "mole") as string;

describe("bot Heat projection — design §7, §8, §10", () => {
  it("expects Moles from the public Mole setting and crew size (design §8.1)", () => {
    expect(expectedMoles(viewFor(moleGame(4, "on"), "ana"))).toBe(0);
    expect(expectedMoles(viewFor(moleGame(6, "off"), "ana"))).toBe(0);
    expect(expectedMoles(viewFor(moleGame(6, "maybe"), "ana"))).toBe(0.5);
    expect(expectedMoles(viewFor(moleGame(6, "on"), "ana"))).toBe(1);
  });

  it("a round's Heat above what the alibis and the card explain reads as a tip-off; the bot then expects more (design §8)", () => {
    const s = moleGame(6, "on");
    const tipped = viewFor(lobbyRound(s, true), crew(s));
    const quiet = viewFor(lobbyRound(s, false), crew(s));
    expect(suspectedTipOffRounds(tipped)).toEqual([1]);
    expect(suspectedTipOffRounds(quiet)).toEqual([]);
    // One tip-off seen in act 1: one per act expected for acts 2 and 3; none if none was seen.
    expect(tipOffsToCome(tipped)).toBe(TIP * 2);
    expect(tipOffsToCome(quiet)).toBe(0);
    expect(heatDanger(tipped)).toBeGreaterThan(heatDanger(quiet));
  });

  it("with no Mole possible there is nothing to detect", () => {
    const s = moleGame(4, "on");
    expect(suspectedTipOffRounds(viewFor(lobbyRound(s, false), "ana"))).toEqual([]);
  });

  it("this round's Heat card counts toward danger, and Shift change surges the Vault (design §10, scaled ×4/5 at 4 players)", () => {
    const s = moleGame(4, "off");
    const scale = 4 / 5;
    const withCard = (id: string): GameState => ({ ...s, card: { round: 1, id, room: null, offer: null } });
    const patrol = Math.round((EVENTS.policePatrol?.effect as { amount: number }).amount * scale);
    expect(cardHeatNow(viewFor(withCard("policePatrol"), "ana"))).toBe(patrol);
    expect(cardHeatNow(viewFor(withCard("quietNight"), "ana"))).toBe(-8);
    expect(cardHeatNow(viewFor(withCard("audit"), "ana"))).toBe(0);
    expect(heatDanger(viewFor(withCard("policePatrol"), "ana"))).toBeCloseTo(heatDanger(viewFor(s, "ana")) + patrol / 100);
    const vault = jobThisRound(viewFor(withCard("shiftChange"), "ana")).rooms.vault;
    expect(vault?.loot).toBe(12);
    expect(vault?.heatPressure).toBeCloseTo(20 * (1 + ((EVENTS.shiftChange?.effect as { heatMultiplier: number }).heatMultiplier - 1) * scale));
  });
});
