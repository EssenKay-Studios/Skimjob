// Perk spending for bots: minimal and sensible (docs/roles-v2.md §1 perks, §4
// "Play"; design §8.3). Bot settings, not game rules.
//
// - Peek: while planning, its top suspect whose role it doesn't know yet (Inside Man, Lookout, Hacker).
// - Tail: while planning, the richest looting room other than its own (Rookie: "the biggest-shortfall room").
// - +Vote: in a meeting, when it votes to shake someone down (Cleaner).
// - Alibi: right after posting a true alibi, if the crew could suspect it (Bagman).
// - Recharge: once its power is used up (Muscle).
// - Rig: while planning, then pick the most Heat-calming of the two cards (Mastermind).
// - Ballot is kept: bots don't read others' ballots (they don't talk). The Shield spends itself.
import { EVENTS, ROUNDS_PER_ACT, type EventId, type PerkId, type RoomId } from "@skimjob/content";
import { overrideEvents, roomDef, type PlayerCommand, type PlayerView, type VoteChoice } from "@skimjob/engine";
import { createdOf, lastResolvedRound, ofType, roleOf, roomsWhere, totalRounds } from "./read";
import { mostSuspicious, knownRoles, suspicion } from "./suspicion";
import { publicSuspicion } from "./claims";
import { jobThisRound } from "./heat";

const has = (view: PlayerView, perk: PerkId): boolean => view.me.roleState.perks.includes(perk);

/** Public suspicion of me at or above this makes a true alibi worth stamping (bot setting). */
const STAMP_ALIBI_AT = 0.5;

/** How much a card would heat the job (lower is calmer; v2 §4 Mastermind "Rigs Heat-calming cards"). */
export function cardHeatScore(view: PlayerView, card: EventId): number {
  const cards = overrideEvents(EVENTS, createdOf(view).contentOverrides);
  const effect = Object.hasOwn(cards, card) ? cards[card]?.effect : undefined;
  if (!effect) return 0;
  if (effect.kind === "heat") return effect.amount;
  if (effect.kind === "roomSurge") return effect.heatMultiplier > 1 ? 2 : 0;
  return 0;
}

/** Perks to spend while a round is being planned. */
export function planningPerks(view: PlayerView, room: RoomId | undefined = view.me.move?.room): PlayerCommand[] {
  if (view.phase.kind !== "planning") return [];
  const player = view.me.id;
  const out: PlayerCommand[] = [];
  if (has(view, "peek")) {
    const known = knownRoles(view);
    const scores = new Map([...suspicion(view)].filter(([id]) => !known.has(id)));
    const top = mostSuspicious(scores);
    if (top !== null && top.score > 0) out.push({ type: "useAbility", player, ability: { kind: "peek", target: top.player } });
  }
  if (has(view, "tail") && view.me.roleState.tail === null) {
    const job = jobThisRound(view);
    const target = roomsWhere(view, job, (d) => d.loot > 0)
      .filter((r) => r !== room)
      .sort((a, b) => roomDef(job, b).loot - roomDef(job, a).loot)[0];
    if (target !== undefined) out.push({ type: "useAbility", player, ability: { kind: "tail", room: target } });
  }
  if (has(view, "recharge") && usedUp(view)) out.push({ type: "useAbility", player, ability: { kind: "recharge" } });
  if (has(view, "rig") && createdOf(view).eventsEnabled && view.round < totalRounds(jobThisRound(view))) {
    const next = view.round + 1;
    if (!ofType(view.caseFile, "perkUsed").some((e) => e.perk.kind === "rig" && e.perk.round === next)) {
      out.push({ type: "useAbility", player, ability: { kind: "rig" } });
    }
  }
  // Pick the calmest of a Rig's cards for the next round (the first flips unless picked).
  const rigged = ofType(view.caseFile, "perkUsed").find((e) => e.perk.kind === "rig" && e.perk.round === view.round + 1)?.perk;
  if (rigged?.kind === "rig" && !ofType(view.caseFile, "rigPicked").some((e) => e.round === rigged.round)) {
    const best = [...rigged.cards].sort((a, b) => cardHeatScore(view, a) - cardHeatScore(view, b))[0];
    if (best !== undefined && best !== rigged.cards[0] && cardHeatScore(view, best) < cardHeatScore(view, rigged.cards[0] as EventId)) {
      out.push({ type: "useAbility", player, ability: { kind: "rigPick", card: best } });
    }
  }
  return out;
}

/** v2 §1 Recharge: the power's uses this act (or its one use this game) are spent. Never the Fence's safe. */
function usedUp(view: PlayerView): boolean {
  const { power } = roleOf(view);
  const { usedThisAct, usedThisGame } = view.me.roleState;
  if ("perAct" in power && power.kind !== "fenceSafe") return usedThisAct >= power.perAct;
  if ("perGame" in power) return usedThisGame >= power.perGame;
  return false;
}

/** +Vote with a shakedown ballot, once per meeting. design §8.3 */
export function meetingPerks(view: PlayerView, vote: VoteChoice | null): PlayerCommand[] {
  if (view.phase.kind !== "meeting" || vote?.kind !== "shakedown" || !has(view, "extraVote")) return [];
  const meetingId = view.phase.meetingId;
  if (ofType(view.caseFile, "perkUsed").some((e) => e.perk.kind === "extraVote" && e.perk.meetingId === meetingId)) return [];
  return [{ type: "useAbility", player: view.me.id, ability: { kind: "extraVote" } }];
}

/** Alibi perk: stamp the alibi just posted, if it is true and the crew could suspect me. design §8.3, §5.4 */
export function alibiPerk(view: PlayerView, posted: RoomId): PlayerCommand[] {
  if (!has(view, "alibi")) return [];
  const round = lastResolvedRound(view);
  const real = ofType(view.caseFile, "lootSplit").find((e) => e.round === round)?.room;
  if (real !== posted) return [];
  // Worth it when the crew could suspect me, or just before the act's meeting.
  if ((publicSuspicion(view).get(view.me.id) ?? 0) < STAMP_ALIBI_AT && round % ROUNDS_PER_ACT !== 0) return [];
  return [{ type: "useAbility", player: view.me.id, ability: { kind: "alibi" } }];
}
