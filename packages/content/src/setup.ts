// Content needed to set up a game: player-count limits, rooms in play by
// player count, the roles that can be dealt, and how many Moles to deal.
// Room yields/effects and role powers arrive with the bank-job content task
// (STATUS.md task 3). design §6.2, §8.1, §16
import type { JobId, RoleId, RoomId } from "./index";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;

/** Rooms added once the crew reaches `minPlayers`. Tiers are cumulative. design §6.2 */
export interface RoomTier {
  readonly minPlayers: number;
  readonly rooms: readonly RoomId[];
}

export interface JobSetup {
  readonly id: JobId;
  /** Ordered by `minPlayers`; the first tier is the core rooms. */
  readonly roomTiers: readonly RoomTier[];
}

/** First National Bank. design §6.1, §6.2 */
export const BANK_SETUP: JobSetup = {
  id: "bank",
  roomTiers: [
    { minPlayers: 2, rooms: ["vault", "office", "lobby", "security", "rooftop"] },
    { minPlayers: 5, rooms: ["depositBoxes", "serverRoom"] },
    { minPlayers: 9, rooms: ["tellerLine", "managersOffice"] },
  ],
};

export const JOB_SETUPS: Readonly<Record<JobId, JobSetup>> = { bank: BANK_SETUP };

/** The powerless role. Fills any seat the pool can't cover. design §8 */
export const FILLER_ROLE: RoleId = "rookie";

/** The Mole is dealt by the Mole setting, never from the pool. design §8.1 */
export const MOLE_ROLE: RoleId = "mole";

/** Starter mode: these roles only, no Mole, no events. design §8.1 */
export const STARTER_ROLES: readonly RoleId[] = ["rookie", "lookout", "insider", "fence"];

/**
 * Roles used when the host leaves the pool empty. Only the starter roles exist
 * so far; the remaining roles join this list as they are implemented.
 */
export const DEFAULT_ROLE_POOL: readonly RoleId[] = STARTER_ROLES;

/** Every role id the engine accepts in a pool (the Mole is not a pool role). */
export const POOL_ROLES: readonly RoleId[] = STARTER_ROLES;

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
