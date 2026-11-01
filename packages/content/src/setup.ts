// Content needed to set up a game: player-count limits, the roles that can be
// dealt, and the dark side (saboteurs and accomplices) to deal. Rooms by player count live on the job
// (jobs.ts). design §8.1, §16
import type { RoleId } from "./index";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;

/**
 * Longest meeting `slot` a command may name (an opaque label, e.g. an ISO
 * time, ~24 characters). It is stored in the log and sent to every seat. design §11.1, §17.2
 */
export const MAX_SLOT_LENGTH = 64;

/** A game is 3 acts of this many rounds (9 rounds in all). design §2, §4 */
export const ROUNDS_PER_ACT = 3;

/** The powerless role. Fills any seat the pool can't cover. design §8 */
export const FILLER_ROLE: RoleId = "rookie";

/** The Mole (a saboteur) is dealt by the saboteur setting, never from the pool. design §8.1 */
export const MOLE_ROLE: RoleId = "mole";

/** Every saboteur (role deck v2 §2): the Mole and, since R3b, the Embezzler. Dealt by the saboteur setting, never pool roles. design §8.1 */
export const SABOTEUR_ROLES: readonly RoleId[] = [MOLE_ROLE, "embezzler"];

/** Starter mode: these crew roles only, no dark side, no events (role deck v2 §3: the Fence left). design §8.1 */
export const STARTER_ROLES: readonly RoleId[] = ["rookie", "insideMan", "lookout", "bagman", "cleaner"];

/** The accomplices (role deck v2 §2, R3a and R3b). Dealt only with a saboteur. design §8, §8.1 */
export const ACCOMPLICE_V2_ROLES: readonly RoleId[] = ["getawayDriver", "fence", "hacker", "blackmailer", "forger"];

/** The info and vote roles still crew (M1 task 12; the Hacker and Blackmailer are accomplices since R3a/R3b). design §8 */
export const INFO_VOTE_ROLES: readonly RoleId[] = ["smoothTalker", "muscle", "snitch"];

/** Crew roles new in role deck v2 (docs/roles-v2.md §2, steps R2a/R2b; the Fixer is the Driver's crew half). design §8 */
export const CREW_V2_ROLES: readonly RoleId[] = ["auditor", "detective", "priest", "fixer", "mastermind"];

/** Roles used when the host leaves the pool empty: every pool role. */
export const DEFAULT_ROLE_POOL: readonly RoleId[] = [...STARTER_ROLES, ...ACCOMPLICE_V2_ROLES, ...INFO_VOTE_ROLES, ...CREW_V2_ROLES];

/** Every role id the engine accepts in a pool (saboteurs, such as the Mole, are not pool roles). */
export const POOL_ROLES: readonly RoleId[] = DEFAULT_ROLE_POOL;

/**
 * One possible dark side for a crew: how many saboteurs and accomplices, and
 * its weight among the options for that crew size. Role deck v2 §3 (docs/roles-v2.md).
 */
export interface DarkSideMix {
  readonly saboteurs: number;
  readonly accomplices: number;
  readonly weight: number;
}

export interface DarkSideRule {
  readonly minPlayers: number;
  readonly options: readonly DarkSideMix[];
}

/**
 * The dark side rolled with the saboteur setting "on", by crew size. Ordered
 * by `minPlayers`; the last rule at or below the player count applies.
 * design §8.1 (role deck v2 §3): crew only at 2–3, one saboteur at 4, then
 * weighted mixes. The hard limits (`DARK_SIDE_LIMITS`) still apply after the roll.
 */
export const DARK_SIDE_RULES: readonly DarkSideRule[] = [
  { minPlayers: 2, options: [{ saboteurs: 0, accomplices: 0, weight: 1 }] },
  { minPlayers: 4, options: [{ saboteurs: 1, accomplices: 0, weight: 1 }] },
  {
    minPlayers: 5,
    options: [
      { saboteurs: 1, accomplices: 0, weight: 50 },
      { saboteurs: 1, accomplices: 1, weight: 50 },
    ],
  },
  {
    minPlayers: 7,
    options: [
      { saboteurs: 1, accomplices: 1, weight: 60 },
      { saboteurs: 2, accomplices: 0, weight: 20 },
      { saboteurs: 1, accomplices: 2, weight: 20 },
    ],
  },
  {
    minPlayers: 9,
    options: [
      { saboteurs: 2, accomplices: 1, weight: 60 },
      { saboteurs: 1, accomplices: 2, weight: 20 },
      { saboteurs: 2, accomplices: 2, weight: 20 },
    ],
  },
  {
    minPlayers: 11,
    options: [
      { saboteurs: 2, accomplices: 2, weight: 60 },
      { saboteurs: 2, accomplices: 1, weight: 20 },
      { saboteurs: 3, accomplices: 1, weight: 20 },
    ],
  },
];

/**
 * Hard limits on any dark side (role deck v2 §3): at most ⌊n ÷ seatDivisor⌋
 * dark seats, no accomplices without a saboteur, and at most
 * saboteurs + `accomplicesOverSaboteurs` accomplices.
 */
export const DARK_SIDE_LIMITS = { seatDivisor: 3, accomplicesOverSaboteurs: 1 } as const;

/** Saboteur setting "maybe": a `nonePercent`% chance of no dark side at all at minPlayers–maxPlayers; elsewhere like "on". */
export const DARK_SIDE_MAYBE = { minPlayers: 4, maxPlayers: 8, nonePercent: 50 } as const;
