// The bots' Heat projection: event cards and the police activity still to
// come where a Mole could be in the game. design §7, §10; extension.md "Police activity"
import { describe, expect, it } from "vitest";
import { EVENTS, POLICE_ACTIVITY, STARTER_ROLES } from "@skimjob/content";
import { createGame, viewFor, type GameConfig, type GameState, type PlayerView } from "@skimjob/engine";
import { heatDanger, jobThisRound, policeHeat, policeInPlay, policeToCome } from "./heat";
import { seats } from "./testkit";

function heatGame(n: number, extra: Partial<GameConfig> = {}, seed = "heat"): GameState {
  const config: GameConfig = { seed, players: seats(n), job: "bank", rolePool: [...STARTER_ROLES], eventsEnabled: false, voteVisibility: "hiddenThenRevealed", ...extra };
  return createGame(config);
}

const withActivity = (view: PlayerView, round: number): PlayerView => ({
  ...view,
  ledger: [...view.ledger, { seq: view.ledger.length, event: { type: "policeActivity", visibility: { kind: "public" }, round, heatAdded: 4, heat: view.heat + 4 } } as PlayerView["ledger"][number]],
});

describe("bot Heat projection — design §7, §10; extension.md \"Police activity\"", () => {
  it("expects police activity only when a Mole could be in the game (role list, else the deck)", () => {
    expect(policeInPlay(viewFor(heatGame(6), "ana"))).toBe(false);
    expect(policeInPlay(viewFor(heatGame(6, { rolePool: ["rookie", "mole"], roleList: "possible" }), "ana"))).toBe(true);
    // Hidden: the deck preset (Standard has the Mole; Starter doesn't).
    expect(policeInPlay(viewFor(heatGame(6, { rolePool: [], roleList: "hidden" }), "ana"))).toBe(true);
    expect(policeInPlay(viewFor(heatGame(6, { rolePool: [], roleList: "hidden", deck: "starter" }), "ana"))).toBe(false);
    expect(policeToCome(viewFor(heatGame(6), "ana"))).toBe(0);
  });

  it("expects the background chance per round left, or the rate seen so far if higher", () => {
    const s = heatGame(6, { rolePool: ["rookie", "mole"], roleList: "possible" });
    const view = viewFor(s, "ana");
    expect(policeHeat(view)).toBe(POLICE_ACTIVITY.heat);
    expect(policeToCome(view)).toBeCloseTo((POLICE_ACTIVITY.chancePercent / 100) * 9 * 4);
    // Two activities before any round resolved read as at least one per round.
    expect(policeToCome(withActivity(withActivity(view, 1), 1))).toBeCloseTo(2 * 9 * 4);
    expect(heatDanger(withActivity(withActivity(view, 1), 1))).toBeGreaterThan(heatDanger(view));
  });

  it("Shift change surges the Vault (design §10, scaled ×4/5 at 4 players)", () => {
    const s = heatGame(4);
    const scale = 4 / 5;
    const withCard = (id: string): GameState => ({ ...s, card: { round: 1, id, room: null } });
    const vault = jobThisRound(viewFor(withCard("shiftChange"), "ana")).rooms.vault;
    expect(vault?.coins).toBe(4); // 3 + 1, design §13
    expect(vault?.heatPressure).toBeCloseTo(20 * (1 + ((EVENTS.shiftChange?.effect as { heatMultiplier: number }).heatMultiplier - 1) * scale));
  });
});
