// Log-derived rules of the wildcard and lone-wolf roles (role deck v2 §2, R3b):
// the Blackmailer's stolen votes, the Embezzler's "always dirty" stash and the
// players a Forger planted. design §8, §11.3
//
// extension.md Build notes "Reveals": every automatic ally reveal is gone;
// nobody is told anyone's role except through a power they choose to use.
import type { GameState, PlayerId, PlayerState } from "./types";

/**
 * Blackmailer (v2 §2): the votes stolen at `meetingId`, victim → Blackmailer.
 * A right guess steals the victim's vote at the first meeting that opens
 * after it (meeting ids are unique, so this reads the log).
 */
export function stolenVotes(state: GameState, meetingId: string): Map<PlayerId, PlayerId> {
  const out = new Map<PlayerId, PlayerId>();
  const log = state.log;
  log.forEach((e, i) => {
    if (e.type !== "abilityResolved" || e.ability.kind !== "blackmail" || !e.ability.correct) return;
    const next = log.slice(i + 1).find((x) => x.type === "meetingOpened");
    if (next?.type === "meetingOpened" && next.meetingId === meetingId) out.set(e.ability.target, e.player);
  });
  return out;
}

/** Embezzler (v2 §2): what `player` has taken from the Haul since its last shakedown (that shakedown returned the rest). */
export function heldTake(state: GameState, player: PlayerId): number {
  let take = 0;
  for (const e of state.log) {
    if (e.type === "shakedownResolved" && e.target === player) take = 0;
    if (e.type === "abilityResolved" && e.player === player && e.ability.kind === "embezzle") take += e.ability.amount;
  }
  return take;
}

/**
 * Whether `target` isn't clean at `threshold`: stash plus any Fence safe at or
 * above it (owner answers, 1 Nov), or an Embezzler holding a take (v2 §2: its
 * stash is always dirty). The shakedown, the Detective and the Muscle read this. design §11.3
 */
export function holdsDirty(state: GameState, target: PlayerId, threshold: number): boolean {
  const { stash, safe } = state.players[target] as PlayerState;
  return stash + safe >= threshold || heldTake(state, target) > 0;
}

/** Forger (v2 §2): the players `forger` has planted in a watch feed so far this game. */
export const forgedBy = (state: GameState, forger: PlayerId): PlayerId[] =>
  state.log.flatMap((e) => (e.type === "abilityResolved" && e.player === forger && e.ability.kind === "forge" ? [e.ability.target] : []));
