// The events deck: one card is flipped at the start of each round from
// `EVENTS_FROM_ROUND` on, and shown to everyone. Data only; the engine applies
// each kind of effect. design §10
import type { RoomId } from "./index";

/** An event card, e.g. "policePatrol". design §10 */
export type EventId = string;

/** What a card does. The engine has one small effect function per kind. design §10 */
export type EventEffect =
  /** Police patrol (+5, balance pass 2) / Quiet night (−10): added to the round's Heat before the clamp. design §7 */
  | { readonly kind: "heat"; readonly amount: number }
  /**
   * Shift change (Vault: loot ×2, Heat ×1.5 since balance pass 2) / Payday (Lobby: loot ×2, so 4):
   * the room's loot and Heat pressure are multiplied this round. Skipped if the
   * room isn't in play.
   */
  | { readonly kind: "roomSurge"; readonly room: RoomId; readonly lootMultiplier: number; readonly heatMultiplier: number }
  /** Power cut: no room sightings, no Security or Lookout results this round. */
  | { readonly kind: "blackout" }
  /** Lockdown: one random room in play (never the default room) is closed this round, named on the flip. */
  | { readonly kind: "lockdown" }
  /** Audit: the round's shortfall (loot pocketed) is posted per room. */
  | { readonly kind: "audit" }
  /** Raid rumour: the biggest stash (not the safe) loses `loss`; only that player is told. */
  | { readonly kind: "raidRumour"; readonly loss: number }
  /** Inside tip: one random player privately learns another random player's role. */
  | { readonly kind: "insideTip" }
  /** Double-cross: two random players are privately offered a role swap; it happens only if both accept. */
  | { readonly kind: "doubleCross" };

export interface EventDef {
  readonly id: EventId;
  readonly name: string;
  readonly effect: EventEffect;
}

/** The ten cards of design §10. */
export const EVENTS: Readonly<Record<EventId, EventDef>> = {
  policePatrol: { id: "policePatrol", name: "Police patrol", effect: { kind: "heat", amount: 5 } },
  quietNight: { id: "quietNight", name: "Quiet night", effect: { kind: "heat", amount: -10 } },
  shiftChange: { id: "shiftChange", name: "Shift change", effect: { kind: "roomSurge", room: "vault", lootMultiplier: 2, heatMultiplier: 1.5 } },
  powerCut: { id: "powerCut", name: "Power cut", effect: { kind: "blackout" } },
  payday: { id: "payday", name: "Payday", effect: { kind: "roomSurge", room: "lobby", lootMultiplier: 2, heatMultiplier: 1 } },
  lockdown: { id: "lockdown", name: "Lockdown", effect: { kind: "lockdown" } },
  audit: { id: "audit", name: "Audit", effect: { kind: "audit" } },
  raidRumour: { id: "raidRumour", name: "Raid rumour", effect: { kind: "raidRumour", loss: 3 } },
  insideTip: { id: "insideTip", name: "Inside tip", effect: { kind: "insideTip" } },
  doubleCross: { id: "doubleCross", name: "Double-cross", effect: { kind: "doubleCross" } },
};

/**
 * The deck: one of each card. Each flip draws at random from the cards not yet
 * flipped this game, so no card repeats (8 of the 10 are seen in 9 rounds).
 * (provisional, docs/decisions.md)
 */
export const EVENT_DECK: readonly EventId[] = Object.keys(EVENTS);

/** The first round that flips a card. design §10 */
export const EVENTS_FROM_ROUND = 2;
