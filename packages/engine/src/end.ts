// End of game: the end check after a round, the final ranking and the winners.
// design §6.2 (how the game ends), §8 (winning), §15.5 (the reveal)
//
// Pure: the round loop calls `gameEnded` with the events it has produced so
// far, which are folded first, so the ranking sees the last round's coins.
import type { FailureReason } from "@skimjob/content";
import type { GameEnded, GameEvent, GameState, Outcome, PlayerId, PlayerState, RankEntry } from "./types";
import { PUBLIC } from "./types";
import { applyEvent } from "./reduce";
import { jobFor, rolesFor, winsOn, type RoleTable } from "./overrides";

/** Everyone, biggest stash first; equal stashes keep seat order (no tie-break, design §8.5). design §8.6 */
export function ranking(state: GameState): RankEntry[] {
  const entries = state.playerOrder.map((id): RankEntry => {
    const p = state.players[id] as PlayerState;
    return {
      player: id,
      role: p.role,
      score: p.stash,
      stash: p.stash,
    };
  });
  return entries.sort((a, b) => b.score - a.score); // stable: seat order for equal stashes
}

/** Every player tied for the biggest stash: all of them win (design §8.5), the whole crew when every stash is equal (§8.2). */
export function leadersOf(ranked: readonly RankEntry[]): PlayerId[] {
  const first = ranked[0];
  return first ? ranked.filter((e) => e.score === first.score).map((e) => e.player) : [];
}

/**
 * design §8.5 "Who can win, by ending": a success is won by every player tied
 * for the biggest stash. A heist sunk by theft is won only by those of them
 * whose role wins it (`winsOn`: the Mole and the Fixer, each copy on its own, until S3a.6 moves
 * it into their handlers), else by nobody. A bust is won by the escapees tied for the biggest
 * stash among them, any role (§5.5). The full ranking is always kept (§8.6).
 */
export function outcomeFor(state: GameState, failure: FailureReason | null, roles: RoleTable = rolesFor(state.config), escapees: readonly PlayerId[] = []): Outcome {
  const ranked = ranking(state);
  const top = leadersOf(ranked);
  if (failure === null) return { result: "success", ranking: ranked, winners: top };
  if (failure === "bust") {
    // design §5.5, §8.3, §8.5: the escapees tied for the biggest stash among them win, whatever their role.
    const best = Math.max(...escapees.map((id) => (state.players[id] as PlayerState).stash));
    const winners = state.playerOrder.filter((id) => escapees.includes(id) && (state.players[id] as PlayerState).stash === best);
    return { result: "failed", reason: "bust", escapees: [...escapees], ranking: ranked, winners };
  }
  const role = new Map(ranked.map((e) => [e.player, e.role]));
  return { result: "failed", reason: failure, ranking: ranked, winners: top.filter((id) => winsOn(roles, role.get(id) ?? "", failure)) };
}

/**
 * design §7.5: coins that reached the duffel ÷ coins taken from the bank, over
 * the whole game; seized coins count neither way, and before any coin is taken
 * it reads full. The coins that reached the duffel are the Haul until S3a.4
 * builds the duffel.
 */
export const honesty = (reached: number, taken: number): number => (taken === 0 ? 1 : reached / taken);

/** Coins taken from the bank so far, seized ones left out (design §7.5): the bank's start less what is left and what was seized. */
function coinsTaken(state: GameState): number {
  return jobFor(state.config).bank.coinsPerPlayer * state.playerOrder.length - state.bank - state.seized;
}

/**
 * design §4.2 step 8, §6.2: the end check after a round that didn't bust. The
 * game ends once the bank is empty or `round` is the round cap; the heist then
 * succeeds at or above the honesty line (§8.1) and is sunk by theft below it
 * (§8.4). `events` are this command's events so far; null means play on.
 */
export function endCheck(state: GameState, events: readonly GameEvent[], round: number): GameEnded | null {
  const after = events.reduce(applyEvent, state);
  const job = jobFor(state.config);
  if (after.bank > 0 && round < job.roundCap) return null;
  return gameEnded(state, events, honesty(after.haul, coinsTaken(after)) >= job.honestyLine ? null : "theft");
}

/**
 * The `gameEnded` event after `events` (this command's events so far) are
 * folded into `state`. On a bust, `escapees` are the round's Rooftop players (design §5.5).
 */
export function gameEnded(state: GameState, events: readonly GameEvent[], failure: FailureReason | null, escapees: readonly PlayerId[] = []): GameEnded {
  const final = events.reduce(applyEvent, state);
  return { type: "gameEnded", visibility: PUBLIC, outcome: outcomeFor(final, failure, rolesFor(state.config), escapees) };
}
