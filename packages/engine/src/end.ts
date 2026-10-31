// End of game: the final ranking, role scoring, tie-breaks and winners.
// design §3 (winning and losing), §8 (role scoring), §13 (the reveal)
//
// Pure: the round loop and the final meeting call `gameEnded` with the events
// they have produced so far, which are folded first, so the ranking sees the
// last round's splits and the final meeting's shakedown.
import { SCORE_DECIMALS, type FailureReason, type RoleDef, type RoleId } from "@skimjob/content";
import type { GameEnded, GameEvent, GameState, Outcome, PlayerId, PlayerState, RankEntry } from "./types";
import { PUBLIC } from "./types";
import { applyEvent } from "./reduce";
import { checkpointTarget } from "./job";
import { jobFor, rolesFor, type RoleTable } from "./overrides";

const roleIn = (roles: RoleTable, role: RoleId): RoleDef | undefined => (Object.hasOwn(roles, role) ? roles[role] : undefined);

const roundScore = (n: number): number => {
  const f = 10 ** SCORE_DECIMALS;
  return Math.round(n * f) / f;
};

/**
 * design §8: stash (Fence safe included) × the role's multiplier, plus its
 * points for every loot the Haul ends above the final target. Roles with no
 * definition yet (the Mole) score their stash.
 */
export function scoreFor(player: PlayerState, def: RoleDef | undefined, surplus: number): number {
  const stash = player.stash + player.safe;
  if (!def) return stash;
  return roundScore(stash * def.scoring.stashMultiplier + def.scoring.perLootOverFinalTarget * surplus);
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
      score: scoreFor(p, roleIn(roles, p.role), surplus),
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
 * design §3: on success the biggest stash wins (after role scoring and
 * tie-breaks). On failure every crew member loses, and only roles whose
 * `winsOnFailure` names the reason win (Driver also needs the top stash). The
 * ranking is kept on failure too, as a loss (design §19.1, provisional).
 */
export function outcomeFor(state: GameState, failure: FailureReason | null, roles: RoleTable = rolesFor(state.config)): Outcome {
  const ranked = ranking(state, roles);
  const leaders = leadersOf(ranked);
  if (failure === null) return { result: "success", ranking: ranked, winners: leaders };
  const winners = ranked
    .filter((e) => {
      const wins = roleIn(roles, e.role)?.winsOnFailure;
      return !!wins && wins.reasons.includes(failure) && (!wins.needsTopStash || leaders.includes(e.player));
    })
    .map((e) => e.player);
  return { result: "failed", reason: failure, ranking: ranked, winners };
}

/** The `gameEnded` event after `events` (this command's events so far) are folded into `state`. */
export function gameEnded(state: GameState, events: readonly GameEvent[], failure: FailureReason | null, roles: RoleTable = rolesFor(state.config)): GameEnded {
  const final = events.reduce(applyEvent, state);
  return { type: "gameEnded", visibility: PUBLIC, outcome: outcomeFor(final, failure, roles) };
}
