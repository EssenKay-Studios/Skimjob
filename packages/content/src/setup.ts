// Content needed to set up a game: player-count limits, the roles that can be
// dealt, and how many Moles to deal. Rooms by player count live on the job
// (jobs.ts). design §8.1, §16
import type { RoleId } from "./index";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;

/** A game is 3 acts of this many rounds (9 rounds in all). design §2, §4 */
export const ROUNDS_PER_ACT = 3;

/** The powerless role. Fills any seat the pool can't cover. design §8 */
export const FILLER_ROLE: RoleId = "rookie";

/** The Mole is dealt by the Mole setting, never from the pool. design §8.1 */
export const MOLE_ROLE: RoleId = "mole";

/** Starter mode: these roles only, no Mole, no events. design §8.1 */
export const STARTER_ROLES: readonly RoleId[] = ["rookie", "lookout", "insider", "fence"];

/** The info and vote roles (M1 task 12). design §8 */
export const INFO_VOTE_ROLES: readonly RoleId[] = ["hacker", "smoothTalker", "muscle", "blackmailer", "snitch"];

/** The win-condition pool role (M1 task 13); the Mole is dealt by the Mole setting instead. design §8 */
export const WIN_CONDITION_ROLES: readonly RoleId[] = ["driver"];

/** Roles used when the host leaves the pool empty: every pool role. */
export const DEFAULT_ROLE_POOL: readonly RoleId[] = [...STARTER_ROLES, ...INFO_VOTE_ROLES, ...WIN_CONDITION_ROLES];

/** Every role id the engine accepts in a pool (the Mole is not a pool role). */
export const POOL_ROLES: readonly RoleId[] = DEFAULT_ROLE_POOL;

/**
 * How many Moles to deal, by player count and the host's Mole setting.
 * Each entry lists equally likely counts; a single entry means no draw.
 * design §8.1: none at 2–4; optional at 5–8 ("maybe" = 50%); 1 or 2 at 9–12.
 * (provisional, see docs/decisions.md)
 */
export interface MoleRule {
  readonly minPlayers: number;
  readonly off: readonly number[];
  readonly maybe: readonly number[];
  readonly on: readonly number[];
}

/** Ordered by `minPlayers`; the last rule at or below the player count applies. */
export const MOLE_RULES: readonly MoleRule[] = [
  { minPlayers: 2, off: [0], maybe: [0], on: [0] },
  { minPlayers: 5, off: [0], maybe: [0, 1], on: [1] },
  { minPlayers: 9, off: [0], maybe: [1, 2], on: [2] },
];
