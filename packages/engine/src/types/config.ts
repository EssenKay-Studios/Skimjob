// Host setup for one game. design §15 (setup), §8.1, §11.2.
//
// Only settings that change the *rules* live here. Anything about wall-clock
// time — session length, round deadlines, meeting window length, quiet hours,
// pause/extend — belongs to the server's scheduler, because the engine has no
// clock (CLAUDE.md "Engine rules"; design §4.1).
import type { DeckId, EventId, JobId, PerkId, RoleId, RoomId } from "@skimjob/content";

/** Stable id for a seat. Unique within a game. */
export type PlayerId = string;

export interface PlayerSeat {
  readonly id: PlayerId;
  readonly name: string;
  /** Bots and humans play by the same rules; this is informational. design §17.3 */
  readonly isBot: boolean;
}

/** How seats are dealt: a fixed mix per crew size, or uniformly from the deck. extension.md "Host settings" */
export type DealStyle = "balanced" | "random";

/** The role list shown to players: every role dealt, every role that could be, or nothing. extension.md "Host settings" */
export type RoleListSetting = "exact" | "possible" | "hidden";

/** design §11.2 */
export type VoteVisibility = "hiddenThenRevealed" | "open" | "secret";

export interface GameConfig {
  /** Seeds the engine RNG. Never sent to players before the reveal. design §17.2 */
  readonly seed: string;
  /** Seat order is significant only for determinism, never for rules. 2–12 seats. */
  readonly players: readonly PlayerSeat[];
  readonly job: JobId;
  /**
   * The host's per-role picks: when not empty, exactly these roles make the
   * deck (any of the 20; the preset is ignored). Empty means the `deck`
   * preset. extension.md "Decks"
   */
  readonly rolePool: readonly RoleId[];
  /** Deck preset; absent means Standard. extension.md "Decks" */
  readonly deck?: DeckId;
  /** Absent means Balanced. extension.md "Host settings" */
  readonly deal?: DealStyle;
  /** Absent means Exact (owner ruling 8). extension.md "Host settings" */
  readonly roleList?: RoleListSetting;
  readonly eventsEnabled: boolean;
  readonly voteVisibility: VoteVisibility;
  /**
   * Each deck role is dealt at most once, Rookies filling the rest (true, the
   * default when absent); false draws with replacement, so roles may repeat
   * (never more than one Mole). design §8.1, §15
   */
  readonly uniqueRoles?: boolean;
  /**
   * Simulator / playtest tuning: replaces some of the job's and roles' numbers
   * for this game only. Absent or null plays the content as shipped. Numbers
   * only; it can't add or remove rooms or roles. Checked by `validateConfig`
   * (configs are untrusted JSON). design §17.4 "config overrides"
   */
  readonly contentOverrides?: ContentOverrides | null;
}

/** New numbers for one coin room: `coins` (1 or more) and `quietCoins`. design §3.1, §5.2 */
export interface RoomOverride {
  readonly coins?: number;
  readonly quietCoins?: number;
}

/**
 * New numbers for one role. A role may only set its own power's numbers
 * (`extraRooms`, `perStretch`, `weight`, …) and, for a role with a
 * reward, `rewardCount` (tokens per trigger). design §8, §8.3
 */
export interface RoleOverride {
  readonly extraRooms?: number;
  readonly perStretch?: number;
  readonly weight?: number;
  /** Tokens each reward trigger grants. design §8.3 */
  readonly rewardCount?: number;
}

/** Every field is optional; whatever is left out keeps the content value. design §17.4 */
export interface ContentOverrides {
  readonly rooms?: Readonly<Record<RoomId, RoomOverride>>;
  /** design §6.1 */
  readonly bank?: { readonly coinsPerPlayer?: number };
  /** Bells, tape and Wanted. design §5 */
  readonly alarm?: { readonly bulbs?: number; readonly tapedRounds?: number; readonly bustStars?: number };
  /** design §6.2 */
  readonly roundCap?: number;
  /** Shop costs (extension.md "Tokens and the perk shop"). */
  readonly perks?: Readonly<Partial<Record<PerkId, { readonly cost?: number }>>>;
  readonly roles?: Readonly<Record<RoleId, RoleOverride>>;
  /** Event card numbers (balance pass 2). design §10 */
  readonly events?: Readonly<Record<EventId, EventOverride>>;
}

/**
 * New numbers for one event card. A card may only set its own effect's
 * numbers: `extraCoins` (Shift change). design §13
 */
export interface EventOverride {
  readonly extraCoins?: number;
}
