// End of game: the end check after a round, the final ranking and the winners.
// design §6.2 (how the game ends), §8 (winning), §15.5 (the reveal)
//
// Pure: the round loop calls `gameEnded` with the events it has produced so
// far, which are folded first, so the ranking sees the last round's coins.
import type { GameEnded, GameEvent, GameState, Outcome, Phase, PlayerId, PlayerState, RankEntry } from "./types";
import { PUBLIC } from "./types";
import { applyEvent } from "./reduce";
import { jobFor } from "./overrides";
import { roleHandler } from "./roles";
import { honesty, honestyOf } from "./shares";

/** The game is finished: it ended (design §6.2) or the host ended it early (§16). */
export const isOver = (phase: Phase): boolean => phase.kind === "ended" || phase.kind === "aborted";

/** Why a heist failed: a bust (Wanted 3, design §5.5), or sunk by theft (honesty below the line at the end, §8.4). */
type Failure = "bust" | "theft";

/** Everyone, biggest stash first; equal stashes keep seat order (no tie-break, design §8.5). design §8.6 */
export function ranking(state: GameState): RankEntry[] {
  const entries = state.playerOrder.map((id): RankEntry => {
    const p = state.players[id] as PlayerState;
    return { player: id, role: p.role, stash: p.stash };
  });
  return entries.sort((a, b) => b.stash - a.stash); // stable: seat order for equal stashes
}

/** Every player tied for the biggest stash: all of them win (design §8.5), the whole crew when every stash is equal (§8.2). */
export function leadersOf(ranked: readonly RankEntry[]): PlayerId[] {
  const first = ranked[0];
  return first ? ranked.filter((e) => e.stash === first.stash).map((e) => e.player) : [];
}

/**
 * design §8.5 "Who can win, by ending": a success is won by every player tied
 * for the biggest stash (the whole crew when every stash is equal, §8.2). A
 * heist sunk by theft is won only by the players whose role handler's own rule
 * wins it (the Mole and the Fixer, each copy on its own, §11.3), else by
 * nobody. A bust is won by the escapees tied for the biggest stash among them,
 * any role (§5.5). The full ranking is always kept (§8.6). Unless the game
 * busted, the kitty and any unsplit duffel pay for the getaway car (§6.3).
 */
export function outcomeFor(state: GameState, failure: Failure | null, escapees: readonly PlayerId[] = []): Outcome {
  const ranked = ranking(state);
  const top = leadersOf(ranked);
  const getaway = state.kitty + state.setAside;
  if (failure === null) return { result: "success", ranking: ranked, winners: top, getaway };
  if (failure === "bust") {
    // design §5.5, §8.3, §8.5: the escapees tied for the biggest stash among them win, whatever their role.
    const best = Math.max(...escapees.map((id) => (state.players[id] as PlayerState).stash));
    const winners = state.playerOrder.filter((id) => escapees.includes(id) && (state.players[id] as PlayerState).stash === best);
    return { result: "failed", reason: "bust", escapees: [...escapees], ranking: ranked, winners };
  }
  const winners = state.playerOrder.filter((id) => roleHandler((state.players[id] as PlayerState).role).winsSunk?.(state, id) ?? false);
  return { result: "failed", reason: failure, ranking: ranked, winners, getaway };
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
  return gameEnded(state, events, honesty(honestyOf(after)) >= job.honestyLine ? null : "theft");
}

/**
 * The `gameEnded` event after `events` (this command's events so far) are
 * folded into `state`. On a bust, `escapees` are the round's Rooftop players (design §5.5).
 */
export function gameEnded(state: GameState, events: readonly GameEvent[], failure: Failure | null, escapees: readonly PlayerId[] = []): GameEnded {
  const final = events.reduce(applyEvent, state);
  return { type: "gameEnded", visibility: PUBLIC, outcome: outcomeFor(final, failure, escapees) };
}
