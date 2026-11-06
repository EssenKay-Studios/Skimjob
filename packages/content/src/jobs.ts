// Job definitions: rooms by player count, Heat formula numbers and checkpoint
// targets and shakedown numbers. design §6, §7, §9, §11.3, §11.5
//
// Heat and targets live on the job because jobs may change them (the Casino's
// baseline Heat is +5, design §9). Engine helpers take a `JobDef` rather than
// reading these constants, so the simulator's content overrides (design §17.4)
// only need to swap the definition.
import type { JobId, RoomId } from "./index";
import type { RoomDef } from "./rooms";

/** Rooms added once the crew reaches `minPlayers`. Tiers are cumulative. design §6.2 */
export interface RoomTier {
  readonly minPlayers: number;
  readonly rooms: readonly RoomId[];
}

/** design §7 */
export interface HeatRules {
  /** Heat at which the cops raid and the heist fails. */
  readonly max: number;
  /** Added every round, whatever the crew does. */
  readonly perRound: number;
  /** Added when the Act 1 or Act 2 checkpoint is missed. design §11.5 */
  readonly missedCheckpoint: number;
}

/** design §11.5 */
export interface CheckpointRules {
  /**
   * Cumulative Haul target per crew member at the end of Acts 1, 2 and 3.
   * The Act 3 entry is the final target.
   */
  readonly perPlayer: readonly [number, number, number];
}

/** design §11.3 (extension.md "Shakedowns (fixed numbers)") */
export interface ShakedownRules {
  /**
   * A shaken-down stash (plus any Fence safe) below this is declared clean. One
   * number shared with the Detective's "dirty" line (owner ruling 3, 3 Nov).
   */
  readonly cleanBelow: number;
  /** A clean target is paid this out of the Haul (or by the bank, if blessed). */
  readonly payout: number;
}

export interface JobDef {
  readonly id: JobId;
  readonly name: string;
  /** Ordered by `minPlayers`; the first tier is the core rooms. design §6.2 */
  readonly roomTiers: readonly RoomTier[];
  /** Every room that appears in `roomTiers`. design §6 */
  readonly rooms: Readonly<Record<RoomId, RoomDef>>;
  /** Where a player who misses the round deadline goes (handing everything in). Must be a core room. design §5.1 */
  readonly defaultRoom: RoomId;
  readonly heat: HeatRules;
  readonly checkpoints: CheckpointRules;
  /** Kept on the job so simulator content overrides can tune it with the rest (design §17.4, §19 Q4). */
  readonly shakedown: ShakedownRules;
}

/** First National Bank, the starter job. design §6.1, §6.2, §7, §11.5 */
export const BANK_JOB: JobDef = {
  id: "bank",
  name: "First National Bank",
  roomTiers: [
    { minPlayers: 3, rooms: ["vault", "office", "lobby", "security", "rooftop"] },
    { minPlayers: 5, rooms: ["depositBoxes", "serverRoom"] },
    { minPlayers: 9, rooms: ["tellerLine", "managersOffice"] },
  ],
  rooms: {
    // Core rooms. design §6.1
    vault: { id: "vault", name: "Vault", loot: 6, heatPressure: 20, capacity: null, info: "none" },
    office: { id: "office", name: "Office", loot: 4, heatPressure: 0, capacity: null, info: "none" },
    lobby: { id: "lobby", name: "Lobby", loot: 2, heatPressure: 0, capacity: null, info: "none" },
    security: { id: "security", name: "Security", loot: 0, heatPressure: 0, capacity: null, info: "watchRoom" },
    rooftop: { id: "rooftop", name: "Rooftop", loot: 0, heatPressure: -20, capacity: null, info: "none" },
    // 5–8 players. design §6.2; Deposit boxes add half the vault pressure (§7, balance pass 1).
    // Crowded loot 3 → 4 in R5 (balance-3.md): with accomplices dealt, 5–8p crews succeeded well under the fair rate.
    depositBoxes: {
      id: "depositBoxes",
      name: "Deposit boxes",
      loot: 5,
      heatPressure: 10,
      capacity: { max: 2, crowdedLoot: 4 },
      info: "none",
    },
    serverRoom: { id: "serverRoom", name: "Server room", loot: 0, heatPressure: 0, capacity: null, info: "pocketCount" },
    // 9–12 players. design §6.2 (Teller line 3, Manager's office 4 since the owner-answers pass, 1 Nov: the
    // ⅓-plurality shakedowns made big crews succeed ~85%); Manager's office adds half the vault pressure (§7).
    // Teller line back to 4 in R5 (balance-3.md): two saboteurs and up to two accomplices sank 9–12p crews to 17–31%.
    // R6 balance (r6-balance.md): Teller line 5, Manager's office 3 — 9–12p sat below the band with events off.
    tellerLine: { id: "tellerLine", name: "Teller line", loot: 6, heatPressure: 10, capacity: null, info: "none" },
    managersOffice: {
      id: "managersOffice",
      name: "Manager's office",
      loot: 3,
      heatPressure: 10,
      capacity: null,
      info: "none",
    },
  },
  defaultRoom: "lobby",
  heat: { max: 100, perRound: 4, missedCheckpoint: 15 },
  // Final 24 → 23 per player in R5 (balance-3.md): toward the fair success rate (crew seats ÷ n).
  checkpoints: { perPlayer: [7, 15, 23] },
  // extension.md: fixed clean line 6 and payout 8 (were 3 × and 5 × the act); starting values for the balance pass.
  shakedown: { cleanBelow: 6, payout: 8 },
};

export const JOBS: Readonly<Record<JobId, JobDef>> = { bank: BANK_JOB };
