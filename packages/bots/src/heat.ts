// How much Heat a bot expects before the job ends: Heat now, this round's
// event card, the baseline still to come and, when a Mole may be in play, the
// tip-offs still to come. design §7, §8 (Mole), §10 (Heat cards, Shift change)
//
// Everything comes from the view: the public card, the public round summaries,
// the alibis and the bot's own room. A tip-off leaves no trail to a player, so
// the bots don't blame anyone for it; they lay low sooner instead (task 16).
import { EVENTS, MOLE_ROLE, ROLES, ROUNDS_PER_ACT, type JobDef, type RoomId } from "@skimjob/content";
import { darkSideOdds, overrideEvents, overrideRoles, roundHeatDelta, roundJob, scaledCardHeat, type EventTable, type PlayerView } from "@skimjob/engine";
import { createdOf, crewSize, jobOf, ofType, totalRounds } from "./read";

/** The event cards with the game's public content overrides. design §10 */
const cardsOf = (view: PlayerView): EventTable => overrideEvents(EVENTS, createdOf(view).contentOverrides);

/** The job as it plays this round: Shift change / Payday surge their room (design §10). */
export function jobThisRound(view: PlayerView, job: JobDef = jobOf(view)): JobDef {
  return view.card && view.card.round === view.round ? roundJob(job, { ...view.card, offer: null }, cardsOf(view), crewSize(view)) : job;
}

/** Heat the current round's card adds (Police patrol +5, Quiet night −10, scaled for small crews), else 0. design §10 */
export function cardHeatNow(view: PlayerView): number {
  const card = view.card;
  const cards = cardsOf(view);
  if (!card || card.round !== view.round || !Object.hasOwn(cards, card.id)) return 0;
  const effect = cards[card.id]?.effect;
  return effect?.kind === "heat" ? scaledCardHeat(effect.amount, crewSize(view)) : 0;
}

/**
 * Moles expected in this game from the public saboteur setting and crew size:
 * the chance a saboteur is dealt (design §8.1). Only one Mole is dealt with
 * unique roles (the default), and the Mole is the only saboteur so far.
 */
export function expectedMoles(view: PlayerView): number {
  const created = createdOf(view);
  return darkSideOdds(crewSize(view), created.mole, created.starterMode).reduce((sum, o) => sum + o.chance * Math.min(1, o.saboteurs), 0);
}

/** The Mole's tip-off Heat in this game (content plus overrides), or 0 without a tip-off power. */
export function tipOffHeat(view: PlayerView): number {
  const power = overrideRoles(ROLES, createdOf(view).contentOverrides)[MOLE_ROLE]?.power;
  return power?.kind === "tipOff" ? power.heat : 0;
}

/**
 * Rounds whose public Heat change came out well above what the claimed rooms,
 * the bot's own room and the card explain: likely a tip-off (design §8). Lies
 * about rooms also move the sum, so only a gap of at least 60% of a tip-off
 * counts. Rounds that hit the 0 floor are skipped (the gap can't show).
 */
export function suspectedTipOffRounds(view: PlayerView): number[] {
  const tip = tipOffHeat(view);
  if (tip <= 0 || expectedMoles(view) === 0) return [];
  const job = jobOf(view);
  const crew = crewSize(view);
  const flipped = new Map(ofType(view.ledger, "eventFlipped").map((e) => [e.round, e]));
  const cards = cardsOf(view);
  const out: number[] = [];
  for (const r of ofType(view.ledger, "roundResolved")) {
    if (r.heat === 0) continue;
    const mine = ofType(view.caseFile, "lootSplit").find((e) => e.round === r.round);
    if (!mine) continue;
    const counts: Record<RoomId, number> = { [mine.room]: 1 };
    for (const a of ofType(view.ledger, "alibiPosted")) {
      if (a.round === r.round && a.player !== view.me.id) counts[a.room] = (counts[a.room] ?? 0) + 1;
    }
    const card = flipped.get(r.round);
    const played = card ? roundJob(job, { round: card.round, id: card.card, room: card.room, offer: null }, cards, crew) : job;
    const effect = card && Object.hasOwn(cards, card.card) ? cards[card.card]?.effect : undefined;
    const expected = roundHeatDelta(played, crew, counts) + (effect?.kind === "heat" ? scaledCardHeat(effect.amount, crew) : 0);
    if (r.heatDelta - expected >= tip * 0.6) out.push(r.round);
  }
  return out;
}

/**
 * Tip-off Heat the bot still expects, extrapolated from the tip-offs that have
 * shown in the Heat so far (design §8: at most one per Mole per act): the
 * observed rate per act for the acts still to come, plus this act's share not
 * yet seen. Nothing seen, nothing expected: bots react to Heat swings rather
 * than fearing a Mole that may not be there (assuming the worst made 10–12
 * player crews lay low until they missed every target; task 16).
 */
export function tipOffsToCome(view: PlayerView): number {
  const tip = tipOffHeat(view);
  if (tip === 0 || expectedMoles(view) === 0) return 0;
  const acts = totalRounds(jobOf(view)) / ROUNDS_PER_ACT;
  const firstRound = (view.act - 1) * ROUNDS_PER_ACT + 1;
  const seen = suspectedTipOffRounds(view);
  const perAct = seen.length / view.act;
  const seenThisAct = seen.filter((r) => r >= firstRound).length;
  return tip * (perAct * (acts - view.act) + Math.max(0, perAct - seenThisAct));
}

/** Heat of the next round's card if a Mastermind foresaw it (v2 §2, §4: it feeds its Heat forecast), else 0. */
export function foreseenCardHeat(view: PlayerView): number {
  const foreseen = ofType(view.caseFile, "cardForeseen").find((e) => e.round === view.round + 1);
  const cards = cardsOf(view);
  const effect = foreseen && Object.hasOwn(cards, foreseen.card) ? cards[foreseen.card]?.effect : undefined;
  return effect?.kind === "heat" ? scaledCardHeat(effect.amount, crewSize(view)) : 0;
}

/** (Heat now + this round's card + a foreseen next card + the baseline still to come + tip-offs to come) ÷ the raid level. design §7 */
export function heatDanger(view: PlayerView, job: JobDef = jobOf(view)): number {
  const roundsLeft = totalRounds(job) - view.round + 1;
  return (view.heat + cardHeatNow(view) + foreseenCardHeat(view) + job.heat.perRound * roundsLeft + tipOffsToCome(view)) / job.heat.max;
}
