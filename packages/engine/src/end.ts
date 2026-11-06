// End of game: the final ranking, tie-breaks and winners.
// design §3 (winning and losing), §13 (the reveal)
//
// Pure: the round loop and the final meeting call `gameEnded` with the events
// they have produced so far, which are folded first, so the ranking sees the
// last round's splits and the final meeting's shakedown.
import type { FailureReason } from "@skimjob/content";
import type { GameEnded, GameEvent, GameState, Outcome, PlayerId, PlayerState, RankEntry } from "./types";
import { PUBLIC } from "./types";
import { applyEvent } from "./reduce";
import { rolesFor, winsOn, type RoleTable } from "./overrides";

/** design §3: higher score, then fewer shakedowns, then more handed in. 0 means a full tie. */
function compare(a: RankEntry, b: RankEntry): number {
  return b.score - a.score || a.timesShakenDown - b.timesShakenDown || b.totalHandedIn - a.totalHandedIn;
}

/** Everyone, best first, scored by final stash (extension.md "One crew, and how you win"); a full tie keeps seat order. design §3 */
export function ranking(state: GameState): RankEntry[] {
  const entries = state.playerOrder.map((id): RankEntry => {
    const p = state.players[id] as PlayerState;
    return {
      player: id,
      role: p.role,
      score: p.stash,
      stash: p.stash,
      timesShakenDown: p.timesShakenDown,
      totalHandedIn: p.totalHandedIn,
    };
  });
  return entries.sort(compare); // stable: seat order breaks full ties
}

/**
 * Players tied with the first place on every tie-break (joint winners,
 * provisional). Also the simulator's "leader" at a checkpoint. design §3
 */
export function leadersOf(ranked: readonly RankEntry[]): PlayerId[] {
  const first = ranked[0];
  return first ? ranked.filter((e) => compare(e, first) === 0).map((e) => e.player) : [];
}

/**
 * extension.md "One crew, and how you win" (Build notes "Win rule"): the top
 * group is everyone level at the top after the tie-breaks. A success is won by
 * the top group, whatever their roles. A failure is won only by top-group
 * members whose role wins that ending (`winsOn`), else by nobody.
 * The full ranking is always kept.
 */
export function outcomeFor(state: GameState, failure: FailureReason | null, roles: RoleTable = rolesFor(state.config)): Outcome {
  const ranked = ranking(state);
  const top = leadersOf(ranked);
  if (failure === null) return { result: "success", ranking: ranked, winners: top };
  const role = new Map(ranked.map((e) => [e.player, e.role]));
  return { result: "failed", reason: failure, ranking: ranked, winners: top.filter((id) => winsOn(roles, role.get(id) ?? "", failure)) };
}

/** The `gameEnded` event after `events` (this command's events so far) are folded into `state`. */
export function gameEnded(state: GameState, events: readonly GameEvent[], failure: FailureReason | null, roles: RoleTable = rolesFor(state.config)): GameEnded {
  const final = events.reduce(applyEvent, state);
  return { type: "gameEnded", visibility: PUBLIC, outcome: outcomeFor(final, failure, roles) };
}
