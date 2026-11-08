// Job definitions: rooms by player count, the bank, the alarm (bells, tape and
// Wanted), the round cap and honesty line. design §3.1, §5, §6, §8
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
  /** The game ends after this round, if the bank hasn't emptied first [tunable]. design §6.2 */
  readonly roundCap: number;
  /** A game ending by the bank or the round cap succeeds at or above this honesty; below it, it is sunk by theft. design §7.5, §8.1, §8.4 */
  readonly honestyLine: number;
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
  // design §6.2, §7.5
  roundCap: 12,
  honestyLine: 2 / 3,
};

export const JOBS: Readonly<Record<JobId, JobDef>> = { bank: BANK_JOB };
