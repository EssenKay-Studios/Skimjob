// Equal shares, the kitty and honesty: the split step of the end-of-round
// order (round.ts) and the counts the round summary and the end check read.
// design §4.2 step 5, §6.3, §7
import type { DuffelSplit, GameState, Honesty } from "./types";
import { factVisibility } from "./bells";
import { jobFor } from "./overrides";

/**
 * design §4.2 step 5, §7.1–§7.3: the duffel (this round's `handedIn`, the
 * coins set aside since the last split and the kitty) split equally among all
 * players; the change that doesn't divide evenly is the next kitty.
 */
export function splitDuffel(state: GameState, round: number, handedIn: number): DuffelSplit {
  const duffel = handedIn + state.setAside + state.kitty;
  const crew = state.playerOrder.length;
  const cut = Math.floor(duffel / crew);
  return {
    type: "duffelSplit",
    visibility: factVisibility("duffel"),
    round,
    handedIn,
    setAside: state.setAside,
    kittyIn: state.kitty,
    cut,
    kitty: duffel - cut * crew,
    share: state.share + cut,
  };
}

/** design §7.5: honesty's counts so far. Coins taken are the bank's start less what is left and what was seized. */
export function honestyOf(state: GameState): Honesty {
  return { reached: state.reached, taken: jobFor(state.config).bank.coinsPerPlayer * state.playerOrder.length - state.bank - state.seized };
}

/** design §7.5: coins that reached the duffel ÷ coins taken; full before any coin is taken. */
export const honesty = ({ reached, taken }: Honesty): number => (taken === 0 ? 1 : reached / taken);
