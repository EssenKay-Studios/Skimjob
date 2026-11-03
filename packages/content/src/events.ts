// The events deck: one card is flipped at the start of each round from
// `EVENTS_FROM_ROUND` on, and shown to everyone. Data only; the engine applies
// each kind of effect. design §10
import type { RoomId } from "./index";

/** An event card, e.g. "quietNight". design §10 */
export type EventId = string;

/** What a card does. The engine has one small effect function per kind. design §10 */
export type EventEffect =
  /** Quiet night (−5 since the R6 balance pass): added to the round's Heat before the clamp. design §7 */
  | { readonly kind: "heat"; readonly amount: number }
  /**
   * Shift change (Vault: loot ×1.5, Heat ×2 since the R6 balance pass) / Payday (Lobby: loot ×2, so 4):
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

/** The nine cards of design §10. extension.md "Police activity": the Police patrol left the deck. */
export const EVENTS: Readonly<Record<EventId, EventDef>> = {
  quietNight: { id: "quietNight", name: "Quiet night", effect: { kind: "heat", amount: -5 } },
  shiftChange: { id: "shiftChange", name: "Shift change", effect: { kind: "roomSurge", room: "vault", lootMultiplier: 1.5, heatMultiplier: 2 } },
  powerCut: { id: "powerCut", name: "Power cut", effect: { kind: "blackout" } },
  payday: { id: "payday", name: "Payday", effect: { kind: "roomSurge", room: "lobby", lootMultiplier: 2, heatMultiplier: 1 } },
  lockdown: { id: "lockdown", name: "Lockdown", effect: { kind: "lockdown" } },
  audit: { id: "audit", name: "Audit", effect: { kind: "audit" } },
  raidRumour: { id: "raidRumour", name: "Raid rumour", effect: { kind: "raidRumour", loss: 3 } },
  insideTip: { id: "insideTip", name: "Inside tip", effect: { kind: "insideTip" } },
  doubleCross: { id: "doubleCross", name: "Double-cross", effect: { kind: "doubleCross" } },
};

/**
 * The deck: one of each card. Every flip draws from the whole deck, so a card
 * can repeat (owner answers, 1 Nov). design §10
 */
export const EVENT_DECK: readonly EventId[] = Object.keys(EVENTS);

/** The first round that flips a card. design §10 */
export const EVENTS_FROM_ROUND = 2;

/**
 * Event-card Heat (Heat cards, and the extra Heat of a surge) is scaled by
 * min(1, crew size ÷ this) for small crews, so one Vault visitor in a crew of
 * 3 doesn't turn a card into a bust. design §10
 */
export const EVENT_HEAT_FULL_CREW = 5;

/**
 * Hidden background police activity (extension.md "Police activity", owner
 * 3 Nov option A). It runs only when a Mole could be in the game. The engine
 * draws a hidden schedule of police moments: each gap is drawn uniformly from
 * [gapMin, gapMax] × the preset's round length (in thousandths, so the draw
 * stays whole), and at each moment a background patrol fires with chance
 * `chancePercent`%. A patrol and a Mole's tip-off add the same `heat`, scaled
 * by min(1, crew ÷ EVENT_HEAT_FULL_CREW). Tuned in the R6 balance pass (r6-balance.md).
 */
export const POLICE_ACTIVITY = {
  chancePercent: 30,
  heat: 4,
  gapMinPermille: 500,
  gapMaxPermille: 1500,
} as const;
