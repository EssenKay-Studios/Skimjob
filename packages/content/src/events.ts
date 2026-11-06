// The events deck: one card is flipped at the start of each round from
// `EVENTS_FROM_ROUND` on, and shown to everyone. Data only; the engine applies
// each kind of effect. design §10
import type { RoomId } from "./index";

/** An event card, e.g. "shiftChange". design §10 */
export type EventId = string;

/** What a card does. The engine has one small effect function per kind. design §10 */
export type EventEffect =
  /**
   * Shift change (Vault: loot ×1.5, Heat ×2 since the R6 balance pass):
   * the room's loot and Heat pressure are multiplied this round. Skipped if the
   * room isn't in play.
   */
  | { readonly kind: "roomSurge"; readonly room: RoomId; readonly lootMultiplier: number; readonly heatMultiplier: number }
  /** Lockdown: one random room in play (never the default room) is closed this round, named on the flip. */
  | { readonly kind: "lockdown" }
  /** Audit: the round's shortfall (loot pocketed) is posted per room. */
  | { readonly kind: "audit" }
  /** Inside tip: one random player privately learns another random player's role. */
  | { readonly kind: "insideTip" };

export interface EventDef {
  readonly id: EventId;
  readonly name: string;
  readonly effect: EventEffect;
}

/** The four cards of design §10. extension.md "Police activity": the Police patrol left the deck. */
export const EVENTS: Readonly<Record<EventId, EventDef>> = {
  shiftChange: { id: "shiftChange", name: "Shift change", effect: { kind: "roomSurge", room: "vault", lootMultiplier: 1.5, heatMultiplier: 2 } },
  lockdown: { id: "lockdown", name: "Lockdown", effect: { kind: "lockdown" } },
  audit: { id: "audit", name: "Audit", effect: { kind: "audit" } },
  insideTip: { id: "insideTip", name: "Inside tip", effect: { kind: "insideTip" } },
};

/**
 * The deck: one of each card. Every flip draws from the whole deck, so a card
 * can repeat (owner answers, 1 Nov). design §10
 */
export const EVENT_DECK: readonly EventId[] = Object.keys(EVENTS);

/** The first round that flips a card. design §10 */
export const EVENTS_FROM_ROUND = 2;

/**
 * Event-card Heat (the extra Heat of a surge) is scaled by
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
