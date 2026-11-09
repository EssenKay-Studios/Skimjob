// QA (PR #55, M2-11): the reveal's ending against the engine's own
// `outcomeFor` on ties (design §8: a heist sunk by theft is won only by a Mole
// or Fixer at the top, a bust only by the Rooftop).
import { describe, expect, it } from "vitest";
import type { RoleId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { privateTo } from "./types";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { viewFor } from "./view";
import { handleThroughResult } from "./result.testkit";
import { outcomeFor } from "./end";
import { revealSummary } from "./reveal";


/** A finished-looking 4-seat game with these roles and stashes (nothing else to break the tie). */
function game(roles: RoleId[], stashes: number[]): GameState {
  const cfg: GameConfig = {
    seed: "qa55-tie",
    players: roles.map((_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
    job: "bank",
    eventsEnabled: true,
    voteVisibility: "secret",
  };
  const base = createGame(cfg);
  const players = Object.fromEntries(
    base.playerOrder.map((id, i) => [id, { ...(base.players[id] as PlayerState), role: roles[i] as RoleId, stash: stashes[i] ?? 0, safe: 0 }]),
  );
  const log: GameEvent[] = base.playerOrder.map((id, i) => ({ type: "roleDealt", visibility: privateTo(id), player: id, role: roles[i] as RoleId }));
  return { ...base, players, log };
}

describe("QA #55 reveal ending vs outcomeFor on ties — design §8", () => {
  const roles: RoleId[] = ["lookout", "hacker", "mole", "lookout"];
  const stashes = [3, 9, 9, 1];

  it("sunk by theft on a tie: only the Mole of the top group wins (failedTopWins)", () => {
    const state = game(roles, stashes);
    const s = revealSummary(state.log, outcomeFor(state, "theft"));
    expect(s.ending).toEqual({ result: "failed", reason: "theft", topGroup: ["p1", "p2"], winners: ["p2"], why: "failedTopWins" });
  });

  // design §5.5: on a bust only the Rooftop gets away; the biggest stash up there wins, whatever its role.
  it("a bust: the escapee with the biggest stash wins, not the tied top group", () => {
    const state = game(roles, stashes);
    const s = revealSummary(state.log, outcomeFor(state, "bust", ["p0", "p3"]));
    expect(s.ending).toMatchObject({ result: "failed", reason: "bust", topGroup: ["p1", "p2"], winners: ["p0"] });
    expect(s.seats.filter((x) => x.winner).map((x) => x.player)).toEqual(["p0"]);
  });

  it("the same tie on a success: both win, whatever their roles", () => {
    const state = game(roles, stashes);
    const s = revealSummary(state.log, outcomeFor(state, null));
    expect(s.ending).toEqual({ result: "success", reason: null, topGroup: ["p1", "p2"], winners: ["p1", "p2"], why: "success" });
    expect(s.seats.filter((x) => x.winner).map((x) => x.player)).toEqual(["p1", "p2"]);
  });

  it("a Mole just below the top wins nothing on a failure (failedNobody)", () => {
    const state = game(["lookout", "mole", "lookout", "auditor"], [9, 8, 2, 1]);
    const outcome = outcomeFor(state, "theft");
    const s = revealSummary(state.log, outcome);
    expect(s.ending).toMatchObject({ topGroup: ["p0"], winners: [], why: "failedNobody" });
    expect(s.seats.find((x) => x.player === "p1")).toMatchObject({ topGroup: false, winner: false });
  });
});

