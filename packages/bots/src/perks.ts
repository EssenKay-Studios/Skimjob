// Perks for bots: what a bot buys on the black market, and its Bail choice.
// Bot settings, not game rules. design §9.6, §12, §19.3
//
// A bot buys at most one perk a round, as it submits its move, with its
// personality's `shop` chance, when its stash covers the cost and the perk
// fits what it is doing:
// - Tail: the richest coin room other than its own.
// - Stamped alibi: when it hands everything in and the crew suspects it.
// - Check ballot: never (bots don't read others' ballots).
// - Soft shoes: once Wanted is up.
// - Blackout: when it skims, its own room next round.
// - Bail: when its stash is above the share and it holds none.
// - Plant evidence: when it skims, the crew's top public suspect into its own room's feeds.
import type { PerkId } from "@skimjob/content";
import { roomDef, type Move, type PerkUse, type PlayerCommand, type PlayerView } from "@skimjob/engine";
import type { Personality } from "./personalities";
import type { Random } from "./bot";
import { ofType, roomsWhere } from "./read";
import { publicSuspicion } from "./claims";
import { jobThisRound } from "./alarm";

/** Public suspicion of me at or above this makes a true alibi worth stamping (bot setting). */
const STAMP_ALIBI_AT = 0.5;

/** The use of `perk` that fits `move`, or null when the bot doesn't want it. */
function wanted(view: PlayerView, perk: PerkId, move: Move): PerkUse | null {
  const me = view.me.id;
  switch (perk) {
    case "tail": {
      const job = jobThisRound(view);
      const room = roomsWhere(view, job, (d) => d.coins > 0)
        .filter((r) => r !== move.room)
        .sort((a, b) => roomDef(job, b).coins - roomDef(job, a).coins)[0];
      return room === undefined ? null : { kind: "tail", room };
    }
    case "alibi":
      return move.pocket === 0 && (publicSuspicion(view).get(me) ?? 0) >= STAMP_ALIBI_AT ? { kind: "alibi" } : null;
    case "ballot":
      return null;
    case "softShoes":
      return view.wanted > 0 ? { kind: "softShoes" } : null;
    case "blackout":
      return move.pocket > 0 ? { kind: "blackout", room: move.room } : null;
    case "bail":
      return !view.me.roleState.bail && view.me.stash > view.share ? { kind: "bail" } : null;
    case "plantEvidence": {
      if (move.pocket === 0) return null;
      const top = [...publicSuspicion(view)].filter(([id]) => id !== me).sort((a, b) => b[1] - a[1])[0];
      return top === undefined ? null : { kind: "plantEvidence", target: top[0], room: move.room };
    }
  }
}

/** The perk to buy with this round's `move`: the first of this game's three it wants and can pay for. design §12 */
export function buyPerk(view: PlayerView, p: Personality, random: Random, move: Move): PlayerCommand[] {
  if (view.phase.kind !== "planning" || ofType(view.caseFile, "perkBought").some((e) => e.round === view.round)) return [];
  if (random() >= p.shop) return [];
  for (const { perk, cost } of view.shop) {
    if (cost > view.me.stash) continue;
    const use = wanted(view, perk, move);
    if (use) return [{ type: "buyPerk", player: view.me.id, perk: use }];
  }
  return [];
}

/**
 * design §9.6: the target of the shakedown waiting for its Bail choice, holding
 * Bail, uses it when the shakedown would take at least the personality's
 * `bailAt` coins; it answers once.
 */
export function bailChoice(view: PlayerView, p: Personality, random: Random): PlayerCommand[] {
  const phase = view.phase;
  if (phase.kind !== "shakedownPending" || phase.target !== view.me.id || !view.me.roleState.bail) return [];
  if (ofType(view.caseFile, "bailChosen").some((e) => e.meetingId === phase.meetingId)) return [];
  const loss = Math.max(0, view.me.stash - view.share);
  const use = random() < p.noise ? random() < 0.5 : p.bailAt !== null && loss >= p.bailAt;
  return [{ type: "chooseBail", player: view.me.id, use }];
}
