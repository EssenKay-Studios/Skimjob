// The events deck: one card is flipped at the start of each round from
// `EVENTS_FROM_ROUND` on, and shown to everyone. Data only; the engine applies
// each kind of effect. design §10
import type { RoomId } from "./index";

/** An event card, e.g. "shiftChange". design §10 */
export type EventId = string;

/** What a card does. The engine has one small effect function per kind. design §10 */
export type EventEffect =
  /**
   * Shift change: the room's visitors can grab `extraCoins` more this round
   * (design §13: the Vault, +1). Skipped if the room isn't in play.
   */
  | { readonly kind: "roomSurge"; readonly room: RoomId; readonly extraCoins: number }
  /** Lockdown: one random room in play (never the default room) is closed this round, named on the flip. */
  | { readonly kind: "lockdown" }
  /** Audit: the round's shortfall (coins pocketed) is posted per room. */
  | { readonly kind: "audit" }
  /** Inside tip: one random player privately learns another random player's role. */
  | { readonly kind: "insideTip" };

export interface EventDef {
  readonly id: EventId;
  readonly name: string;
  readonly effect: EventEffect;
}

/** The four cards of design §13. */
export const EVENTS: Readonly<Record<EventId, EventDef>> = {
  shiftChange: { id: "shiftChange", name: "Shift change", effect: { kind: "roomSurge", room: "vault", extraCoins: 1 } },
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
