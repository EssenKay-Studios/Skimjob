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

export type Visibility = PublicVisibility | PrivateVisibility | RevealVisibility;

export const PUBLIC: PublicVisibility = { kind: "public" };
export const REVEAL: RevealVisibility = { kind: "reveal" };
export const privateTo = (player: PlayerId): PrivateVisibility => ({ kind: "private", player });

/**
 * Can `viewer` see an event with this visibility?
 * After the game has ended, everything is visible to everyone (design §13 reveal).
 */
export function canSee(visibility: Visibility, viewer: PlayerId, gameOver: boolean): boolean {
  if (gameOver) return true;
  switch (visibility.kind) {
    case "public":
      return true;
    case "private":
      return visibility.player === viewer;
    case "reveal":
      return false;
  }
}
