// Host setup for one game. design §15 (setup), §8.1, §11.2.
//
// Only settings that change the *rules* live here. Anything about wall-clock
// time — session length, round deadlines, meeting window length, quiet hours,
// pause/extend — belongs to the server's scheduler, because the engine has no
// clock (CLAUDE.md "Engine rules"; design §4.1).
import type { JobId, RoleId } from "@skimjob/content";

/** Stable id for a seat. Unique within a game. */
export type PlayerId = string;

export interface PlayerSeat {
  readonly id: PlayerId;
  readonly name: string;
  /** Bots and humans play by the same rules; this is informational. design §17.3 */
  readonly isBot: boolean;
}

/** design §8.1: none / always / 50% chance ("maybe a Mole"). Player-count limits are content rules. */
export type MoleSetting = "off" | "maybe" | "on";

/** design §11.2 */
export type VoteVisibility = "hiddenThenRevealed" | "open" | "secret";

export interface GameConfig {
  /** Seeds the engine RNG. Never sent to players before the reveal. design §17.2 */
  readonly seed: string;
  /** Seat order is significant only for determinism, never for rules. 2–12 seats. */
  readonly players: readonly PlayerSeat[];
  readonly job: JobId;
  /**
   * Roles that may be dealt. Empty means "use the content default for this
   * player count". Ignored in starter mode. design §8.1
   */
  readonly rolePool: readonly RoleId[];
  readonly mole: MoleSetting;
  readonly eventsEnabled: boolean;
  readonly voteVisibility: VoteVisibility;
  /** First game in a group: Rookie/Lookout/Insider/Fence only, no Mole, no events. design §8.1 */
  readonly starterMode: boolean;
}
