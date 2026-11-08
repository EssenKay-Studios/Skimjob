// The events deck: from `EVENTS_FROM_ROUND` on, each round has an
// `EVENT_CHANCE` that one card flips at its start, shown to everyone. Data
// only; the engine applies each kind of effect. design §13
import type { RoomId } from "./index";

/** An event card, e.g. "shiftChange". design §13 */
export type EventId = string;

/** What a card does. The engine has one small effect function per kind. design §13 */
export type EventEffect =
  /** Shift change: the room's visitors can grab `extraCoins` more this round (the Vault, +1). */
  | { readonly kind: "roomSurge"; readonly room: RoomId; readonly extraCoins: number }
  /** Lockdown: one random open room (never the Lobby or the Rooftop) is closed this round, named on the flip. */
  | { readonly kind: "lockdown" }
  /** Audit: every room shows how many coins reached the duffel from it this round. */
  | { readonly kind: "audit" }
  /** Inside tip: one random player privately learns another player's role. */
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

/** The deck: one of each card. Every flip draws from the whole deck, so a card can repeat (owner, 6 Nov). design §13 */
export const EVENT_DECK: readonly EventId[] = Object.keys(EVENTS);

/** The first round that may flip a card. design §13 */
export const EVENTS_FROM_ROUND = 2;

/** The chance that a round flips a card: `in` in `of` [tunable]. design §13 */
export const EVENT_CHANCE = { in: 4, of: 10 } as const;
