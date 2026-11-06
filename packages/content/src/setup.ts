// Content needed to set up a game: player-count limits, the decks and the
// Balanced deal's mix by crew size. Rooms by player count live on the job
// (jobs.ts). design §8.1, §16, extension.md "Decks", "Tags, decks and dealing"
import type { RoleId } from "./index";
import { ROLES } from "./roles";

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;

/**
 * Longest meeting `slot` a command may name (an opaque label, e.g. an ISO
 * time, ~24 characters). It is stored in the log and sent to every seat. design §11.1, §17.2
 */
export const MAX_SLOT_LENGTH = 64;

/** A game is 3 acts of this many rounds (9 rounds in all). design §2, §4 */
export const ROUNDS_PER_ACT = 3;

/** The powerless role. Fills any seat the deck can't cover. design §8 */
export const FILLER_ROLE: RoleId = "rookie";

/** The Mole: background police activity runs only when one could be in the game. extension.md "Police activity" */
export const MOLE_ROLE: RoleId = "mole";

/** A deck preset. extension.md "Decks" */
export type DeckId = "starter" | "standard" | "everything";

/** Starter (first game, no events): unchanged from role deck v2 §3. */
export const STARTER_ROLES: readonly RoleId[] = ["rookie", "insideMan", "lookout", "bagman", "cleaner"];

/** Standard, the default: 11 roles; Rookies fill any spare seats. */
export const STANDARD_ROLES: readonly RoleId[] = [
  "lookout",
  "auditor",
  "detective",
  "smoothTalker",
  "muscle",
  "cleaner",
  "hacker",
  "fence",
  "getawayDriver",
  "mole",
  "embezzler",
];

/** Everything: all 20 roles. */
export const EVERYTHING_ROLES: readonly RoleId[] = Object.keys(ROLES);

export const DECKS: Readonly<Record<DeckId, readonly RoleId[]>> = {
  starter: STARTER_ROLES,
  standard: STANDARD_ROLES,
  everything: EVERYTHING_ROLES,
};

export const DEFAULT_DECK: DeckId = "standard";

/** Every role id the host may toggle on (any role, on top of any preset outside Quick). */
export const POOL_ROLES: readonly RoleId[] = EVERYTHING_ROLES;

/** How many Lone wolf and Wildcard seats the Balanced deal fills; the rest are Team players. */
export interface BalancedMix {
  readonly loneWolves: number;
  readonly wildcards: number;
}

/**
 * The Balanced deal's fixed mix by crew size (index = players). Start values
 * from roles-v2 §3's most-weighted row under the round(n ÷ 3) cap (saboteurs →
 * Lone wolves, accomplices → Wildcards; at 5–6 the 50/50 tie takes the row
 * with a Wildcard, provisional). Tuned by the R6 balance pass (r6-balance.md:
 * 4p and 8p gained a seat over the cap); the host can't change it. extension.md Build notes "Tags, decks and dealing"
 */
export const BALANCED_MIX: Readonly<Record<number, BalancedMix>> = {
  3: { loneWolves: 0, wildcards: 0 },
  4: { loneWolves: 1, wildcards: 1 },
  5: { loneWolves: 1, wildcards: 1 },
  6: { loneWolves: 1, wildcards: 1 },
  7: { loneWolves: 1, wildcards: 1 },
  8: { loneWolves: 2, wildcards: 1 },
  9: { loneWolves: 2, wildcards: 1 },
  10: { loneWolves: 2, wildcards: 1 },
  11: { loneWolves: 2, wildcards: 2 },
  12: { loneWolves: 2, wildcards: 2 },
};

/** Truly random deals: at most this many of each of these roles. extension.md "Truly random" */
export const RANDOM_DEAL_SINGLETONS: readonly RoleId[] = ["mole", "embezzler"];

/** The host is offered "replace with a bot" for a player who missed this many rounds in a row. design §15 */
export const REPLACE_AFTER_MISSED_ROUNDS = 2;
