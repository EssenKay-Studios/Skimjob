// End of game: the final ranking, role scoring, tie-breaks and winners.
// design §3 (winning and losing), §8 (role scoring), §13 (the reveal)
//
// Pure: the round loop and the final meeting call `gameEnded` with the events
// they have produced so far, which are folded first, so the ranking sees the
// last round's splits and the final meeting's shakedown.
import type { FailureReason, RoleDef } from "@skimjob/content";
import type { GameEnded, GameEvent, GameState, Outcome, PlayerId, PlayerState, RankEntry } from "./types";
import { PUBLIC } from "./types";
import { applyEvent } from "./reduce";
import { checkpointTarget } from "./job";
import { jobFor, roleDefIn, rolesFor, winsOn, type RoleTable } from "./overrides";

/**
 * extension.md "One crew, and how you win": stash plus any Fence safe, plus
 * one point for every `lootPerPointOverFinalTarget` loot the Haul ends above
 * the final target (Inside Man: 5). Whole numbers only. A role id with no
 * definition scores its stash.
 */
export function scoreFor(player: PlayerState, def: RoleDef | undefined, surplus: number): number {
  const stash = player.stash + player.safe;
  const per = def?.scoring.lootPerPointOverFinalTarget ?? 0;
  return per > 0 ? stash + Math.floor(surplus / per) : stash;
}

/** design §3: higher score, then fewer shakedowns, then more handed in. 0 means a full tie. */
function compare(a: RankEntry, b: RankEntry): number {
  return b.score - a.score || a.timesShakenDown - b.timesShakenDown || b.totalHandedIn - a.totalHandedIn;
}

/** Everyone, best first; a full tie keeps seat order. design §3, §8 */
export function ranking(state: GameState, roles: RoleTable = rolesFor(state.config)): RankEntry[] {
  const job = jobFor(state.config);
  const finalAct = job.checkpoints.perPlayer.length as 1 | 2 | 3;
  const surplus = Math.max(0, state.haul - checkpointTarget(job, finalAct, state.playerOrder.length));
  const entries = state.playerOrder.map((id): RankEntry => {
    const p = state.players[id] as PlayerState;
    return {
      player: id,
      role: p.role,
      score: scoreFor(p, roleDefIn(roles, p.role), surplus),
      stash: p.stash + p.safe,
      safe: p.safe,
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
 * members whose role wins that ending (`winsOn`), else by nobody. Roles are
 * read as they are at the end (a Double-cross can hand over a failure win).
 * The full ranking is always kept.
 */
export function outcomeFor(state: GameState, failure: FailureReason | null, roles: RoleTable = rolesFor(state.config)): Outcome {
  const ranked = ranking(state, roles);
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
