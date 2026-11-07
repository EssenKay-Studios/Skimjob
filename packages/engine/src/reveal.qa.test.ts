// QA (PR #55, M2-11): the reveal's ending against the engine's own
// `outcomeFor` on ties with ★ roles (extension.md "Winning and losing":
// a failure is won only by top-group members whose role wins that ending).
import { describe, expect, it } from "vitest";
import { ROLES, type RoleId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { privateTo } from "./types";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { viewFor } from "./view";
import { handleThroughAlibis } from "./alibis.testkit";
import { outcomeFor } from "./end";
import { revealSummary } from "./reveal";

const TABLES = { roles: ROLES };

/** A finished-looking 4-seat game with these roles and stashes (nothing else to break the tie). */
function game(roles: RoleId[], stashes: number[]): GameState {
  const cfg: GameConfig = {
    seed: "qa55-tie",
    players: roles.map((_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
    job: "bank",
    rolePool: [],
    eventsEnabled: true,
    voteVisibility: "secret",
  };
  const base = createGame(cfg);
  const players = Object.fromEntries(
    base.playerOrder.map((id, i) => [id, { ...(base.players[id] as PlayerState), role: roles[i] as RoleId, stash: stashes[i] ?? 0, safe: 0, timesShakenDown: 0, totalHandedIn: 0 }]),
  );
  const log: GameEvent[] = base.playerOrder.map((id, i) => ({ type: "roleDealt", visibility: privateTo(id), player: id, role: roles[i] as RoleId }));
  return { ...base, players, log };
}

describe("QA #55 reveal ending vs outcomeFor on ties — extension.md \"Winning and losing\"", () => {
  const roles: RoleId[] = ["rookie", "hacker", "mole", "lookout"];
  const stashes = [3, 9, 9, 1];

  for (const [failure, star] of [
    ["heat", "p1"],
    ["target", "p2"],
  ] as const) {
  }

  it("the same tie on a success: both win, and nobody's ★ is needed", () => {
    const state = game(roles, stashes);
    const s = revealSummary(state.log, outcomeFor(state, null), TABLES);
    expect(s.ending).toEqual({ result: "success", reason: null, topGroup: ["p1", "p2"], winners: ["p1", "p2"], why: "success" });
    expect(s.seats.filter((x) => x.winner).map((x) => x.player)).toEqual(["p1", "p2"]);
  });

  it("a ★ role just below the top wins nothing on a failure (failedNobody)", () => {
    const state = game(["rookie", "mole", "lookout", "auditor"], [9, 8, 2, 1]);
    const outcome = outcomeFor(state, "target");
    const s = revealSummary(state.log, outcome, TABLES);
    expect(s.ending).toMatchObject({ topGroup: ["p0"], winners: [], why: "failedNobody" });
    expect(s.seats.find((x) => x.player === "p1")).toMatchObject({ topGroup: false, winner: false, winsOn: ROLES.mole?.winsOn });
  });
});

