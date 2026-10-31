// Job definitions: rooms by player count, Heat formula numbers and checkpoint
// targets. design §6, §7, §9, §11.5
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
}

/** First National Bank, the starter job. design §6.1, §6.2, §7, §11.5 */
export const BANK_JOB: JobDef = {
  id: "bank",
  name: "First National Bank",
  roomTiers: [
    { minPlayers: 2, rooms: ["vault", "office", "lobby", "security", "rooftop"] },
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
    // 5–8 players. design §6.2
    depositBoxes: {
      id: "depositBoxes",
      name: "Deposit boxes",
      loot: 5,
      heatPressure: 0,
      capacity: { max: 2, crowdedLoot: 3 },
      info: "none",
    },
    serverRoom: { id: "serverRoom", name: "Server room", loot: 0, heatPressure: 0, capacity: null, info: "pocketCount" },
    // 9–12 players. design §6.2; Manager's office adds half the vault pressure (§7).
    tellerLine: { id: "tellerLine", name: "Teller line", loot: 3, heatPressure: 0, capacity: null, info: "none" },
    managersOffice: {
      id: "managersOffice",
      name: "Manager's office",
      loot: 5,
      heatPressure: 10,
      capacity: null,
      info: "none",
    },
  },
  defaultRoom: "lobby",
  heat: { max: 100, perRound: 4, missedCheckpoint: 15 },
  checkpoints: { perPlayer: [6, 14, 22] },
};

export const JOBS: Readonly<Record<JobId, JobDef>> = { bank: BANK_JOB };
