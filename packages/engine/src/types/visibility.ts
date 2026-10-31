// Every event carries a visibility tag. viewFor() filters on it. design §17.2
import type { PlayerId } from "./config";

/** Everyone sees it as it happens: the ledger. */
export interface PublicVisibility {
  readonly kind: "public";
}

/** Only `player` sees it until the game ends: their case file. */
export interface PrivateVisibility {
  readonly kind: "private";
  readonly player: PlayerId;
}

/** Nobody sees it until the end-of-game reveal. */
export interface RevealVisibility {
  readonly kind: "reveal";
}

/**
 * Only `player` ever sees it, even after the game ends. Used for ballots in
 * "secret" vote mode, where only the tally is ever shown (design §11.2). A future
 * Informant role may be granted these by viewFor(); canSee() never does.
 */
export interface SecretVisibility {
  readonly kind: "secret";
  readonly player: PlayerId;
}

export type Visibility = PublicVisibility | PrivateVisibility | RevealVisibility | SecretVisibility;

export const PUBLIC: PublicVisibility = { kind: "public" };
export const REVEAL: RevealVisibility = { kind: "reveal" };
export const privateTo = (player: PlayerId): PrivateVisibility => ({ kind: "private", player });
export const secretTo = (player: PlayerId): SecretVisibility => ({ kind: "secret", player });

/**
 * Can `viewer` see an event with this visibility?
 * After the game ends, private and reveal-only events open up for the reveal
 * (design §13); secret events never do (design §11.2). Unknown kinds fail closed.
 */
export function canSee(visibility: Visibility, viewer: PlayerId, gameOver: boolean): boolean {
  switch (visibility.kind) {
    case "public":
      return true;
    case "private":
      return gameOver || visibility.player === viewer;
    case "reveal":
      return gameOver;
    case "secret":
      return visibility.player === viewer;
    default:
      return false;
  }
}
