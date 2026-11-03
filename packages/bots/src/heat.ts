// How much Heat a bot expects before the job ends: Heat now, this round's
// event card, the baseline still to come and, when a Mole could be in play,
// the police activity still to come. design §7, §10; extension.md "Police activity"
//
// Everything comes from the view: the public card, the public round summaries
// and police activity, and the role list.
import { EVENTS, MOLE_ROLE, type JobDef } from "@skimjob/content";
import { overrideEvents, policeFor, roundJob, scaledCardHeat, type EventTable, type PlayerView } from "@skimjob/engine";
import { couldBeDealt, createdOf, crewSize, jobOf, lastResolvedRound, ofType, totalRounds } from "./read";

/** The event cards with the game's public content overrides. design §10 */
const cardsOf = (view: PlayerView): EventTable => overrideEvents(EVENTS, createdOf(view).contentOverrides);

/** The job as it plays this round: Shift change / Payday surge their room (design §10). */
export function jobThisRound(view: PlayerView, job: JobDef = jobOf(view)): JobDef {
  return view.card && view.card.round === view.round ? roundJob(job, { ...view.card, offer: null }, cardsOf(view), crewSize(view)) : job;
}

/** Heat the current round's card adds (Quiet night −10, scaled for small crews), else 0. design §10 */
export function cardHeatNow(view: PlayerView): number {
  const card = view.card;
  const cards = cardsOf(view);
  if (!card || card.round !== view.round || !Object.hasOwn(cards, card.id)) return 0;
  const effect = cards[card.id]?.effect;
  return effect?.kind === "heat" ? scaledCardHeat(effect.amount, crewSize(view)) : 0;
}

/**
 * Whether background police activity runs: only when a Mole could be in the
 * game (extension.md "Police activity"). The bots read it from the public role
 * list or, with a Hidden list, the deck.
 */
export const policeInPlay = (view: PlayerView): boolean => couldBeDealt(view, MOLE_ROLE);

/** One police activity's Heat in this game (content plus overrides, scaled for small crews). */
export function policeHeat(view: PlayerView): number {
  const created = createdOf(view);
  return scaledCardHeat(policeFor(created.contentOverrides ? { contentOverrides: created.contentOverrides } : {}).heat, crewSize(view));
}

/**
 * Police Heat the bot still expects: per round left, the background chance or
 * the rate seen so far if higher (a Mole's tip-offs show as extra activity).
 * A patrol and a tip-off read the same, so nobody is blamed for one; the bots
 * lay low sooner instead. extension.md "Police activity"
 */
export function policeToCome(view: PlayerView): number {
  if (!policeInPlay(view)) return 0;
  const created = createdOf(view);
  const { chancePercent } = policeFor(created.contentOverrides ? { contentOverrides: created.contentOverrides } : {});
  const seen = ofType(view.ledger, "policeActivity").length;
  const rate = Math.max(chancePercent / 100, seen / Math.max(1, lastResolvedRound(view)));
  return rate * (totalRounds(jobOf(view)) - view.round + 1) * policeHeat(view);
}

/** Heat of the next round's card if a Mastermind foresaw it (v2 §2, §4: it feeds its Heat forecast), else 0. */
export function foreseenCardHeat(view: PlayerView): number {
  const foreseen = ofType(view.caseFile, "cardForeseen").find((e) => e.round === view.round + 1);
  const cards = cardsOf(view);
  const effect = foreseen && Object.hasOwn(cards, foreseen.card) ? cards[foreseen.card]?.effect : undefined;
  return effect?.kind === "heat" ? scaledCardHeat(effect.amount, crewSize(view)) : 0;
}

/** (Heat now + this round's card + a foreseen next card + the baseline still to come + police activity to come) ÷ the raid level. design §7 */
export function heatDanger(view: PlayerView, job: JobDef = jobOf(view)): number {
  const roundsLeft = totalRounds(job) - view.round + 1;
  return (view.heat + cardHeatNow(view) + foreseenCardHeat(view) + job.heat.perRound * roundsLeft + policeToCome(view)) / job.heat.max;
}
