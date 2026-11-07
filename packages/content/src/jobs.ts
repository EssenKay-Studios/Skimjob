// Job definitions: rooms by player count, the bank, the alarm (bells, tape and
// Wanted), checkpoint targets and shakedown numbers. design §3.1, §5, §6.1
//
// The numbers live on the job, and engine helpers take a `JobDef` rather than
// reading these constants, so the simulator's content overrides (design §17.4)
// only need to swap the definition.
import type { JobId, RoomId } from "./index";
import type { RoomDef } from "./rooms";

/** Rooms added once the crew reaches `minPlayers`. Tiers are cumulative. design §3.1 */
export interface RoomTier {
  readonly minPlayers: number;
  readonly rooms: readonly RoomId[];
}

/** Bells, raids and Wanted. design §5 */
export interface AlarmRules {
  /** Bulbs on every room's bell; lighting the last one raids the room [tunable]. design §5.1, §5.3 */
  readonly bulbs: number;
  /** Rounds a raided room stays taped off [tunable]. design §5.3 */
  readonly tapedRounds: number;
  /** Wanted stars that make a bust [tunable]. design §5.4, §5.5 */
  readonly bustStars: number;
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
   * A shaken-down stash below this is declared clean. One
   * number shared with the Detective's "dirty" line (owner ruling 3, 3 Nov).
   */
  readonly cleanBelow: number;
  /** A clean target is paid this out of the Haul (or by the bank, if blessed). */
  readonly payout: number;
}

/** The bank the crew robs: a fixed pile of coins. design §6.1 */
export interface BankRules {
  /** Coins in the bank per player at the start [tunable]. design §6.1 */
  readonly coinsPerPlayer: number;
}

export interface JobDef {
  readonly id: JobId;
  readonly name: string;
  /** Ordered by `minPlayers`; the first tier is the core rooms. design §3.1 */
  readonly roomTiers: readonly RoomTier[];
  /** Every room that appears in `roomTiers`. design §3.1 */
  readonly rooms: Readonly<Record<RoomId, RoomDef>>;
  /** Where a player who misses the round deadline goes (1 coin, handed in). Must be a core coin room. design §3.3 */
  readonly defaultRoom: RoomId;
  readonly bank: BankRules;
  readonly alarm: AlarmRules;
  readonly checkpoints: CheckpointRules;
  /** Kept on the job so simulator content overrides can tune it with the rest (design §17.4, §19 Q4). */
  readonly shakedown: ShakedownRules;
}

/** First National Bank, the starter job. design §3.1, §6.1 */
export const BANK_JOB: JobDef = {
  id: "bank",
  name: "First National Bank",
  // 3–4 players 5 rooms, 5–8 players 7, 9–12 players 8. design §3.1
  roomTiers: [
    { minPlayers: 3, rooms: ["vault", "office", "lobby", "security", "rooftop"] },
    { minPlayers: 5, rooms: ["depositBoxes", "serverRoom"] },
    { minPlayers: 9, rooms: ["managersOffice"] },
  ],
  // Coins per visitor and noise [tunable]: the Lobby is silent, the Office-like rooms' 1st coin is silent,
  // every Vault coin rings (or its 1st is silent; the simulator picks). design §3.1
  rooms: {
    vault: { id: "vault", name: "Vault", coins: 3, quietCoins: 0, lieLow: false, info: "none" },
    office: { id: "office", name: "Office", coins: 2, quietCoins: 1, lieLow: false, info: "none" },
    lobby: { id: "lobby", name: "Lobby", coins: 1, quietCoins: 1, lieLow: false, info: "none" },
    security: { id: "security", name: "Security", coins: 0, quietCoins: 0, lieLow: false, info: "watchRoom" },
    rooftop: { id: "rooftop", name: "Rooftop", coins: 0, quietCoins: 0, lieLow: true, info: "none" },
    depositBoxes: { id: "depositBoxes", name: "Deposit boxes", coins: 2, quietCoins: 1, lieLow: false, info: "none" },
    serverRoom: { id: "serverRoom", name: "Server room", coins: 2, quietCoins: 1, lieLow: false, info: "none" },
    managersOffice: { id: "managersOffice", name: "Manager's office", coins: 2, quietCoins: 1, lieLow: false, info: "none" },
  },
  defaultRoom: "lobby",
  bank: { coinsPerPlayer: 16 },
  // design §5.1, §5.3, §5.5
  alarm: { bulbs: 4, tapedRounds: 2, bustStars: 3 },
  // R6's coin-measured numbers, scaled to R7's smaller grabs and 16-a-player bank (S3a.1, provisional) until
  // S3a.3 (endings) and S3a.5 (shakedowns) replace them: checkpoints were [7, 15, 23], the clean line 6 and payout 8.
  // With these the sim's success rate and shakedown accuracy stay near R6's.
  checkpoints: { perPlayer: [3, 7, 11] },
  shakedown: { cleanBelow: 3, payout: 4 },
};

export const JOBS: Readonly<Record<JobId, JobDef>> = { bank: BANK_JOB };
