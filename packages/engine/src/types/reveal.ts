// The end-of-game reveal, worked out from the log (design §13; extension.md
// "Winning and losing", "Tokens and the perk shop", "Situations"). Only in a
// view once the game has ended (`PlayerView.reveal.summary`), and built from
// the same events as `reveal.log`, so it never holds anything that log doesn't.
import type { FailureReason, PerkId, RoleId, RoomId, TokenTrigger } from "@skimjob/content";
import type { PlayerId } from "./config";
import type { GameEvent, Outcome, RoundResolved } from "./events";

/** One player's line in the reveal, best first (the final ranking's order). */
export interface RevealSeat {
  readonly player: PlayerId;
  /** 1-based place in the final ranking (tie-broken; a full tie keeps seat order). design §3 */
  readonly place: number;
  /** The role dealt at setup. */
  readonly dealtRole: RoleId;
  /** The role at the end; the one scored and judged. design §10 */
  readonly role: RoleId;
  /** The failure endings `role` also wins from the top group (★ roles). extension.md "Winning and losing" */
  readonly winsOn: readonly FailureReason[];
  readonly score: number;
  readonly stash: number;
  readonly timesShakenDown: number;
  readonly totalHandedIn: number;
  /** Level with the first place after the tie-breaks. extension.md "Winning and losing" */
  readonly topGroup: boolean;
  readonly winner: boolean;
  /** Every token earned, in order, with what earned it. extension.md "Tokens and the perk shop" */
  readonly tokens: readonly TokenTrigger[];
  /** Every perk bought, in order. */
  readonly perksBought: readonly PerkId[];
  /** How many perks were used. */
  readonly perksUsed: number;
}

/** Why the game ended the way it did, and who that makes the winners. extension.md "Winning and losing" */
export interface RevealEnding {
  readonly result: Outcome["result"];
  /** Null on a success. */
  readonly reason: FailureReason | null;
  readonly topGroup: readonly PlayerId[];
  readonly winners: readonly PlayerId[];
  /**
   * `success`: the top group wins. `failedTopWins`: some of the top group hold
   * a role that wins this failure. `failedNobody`: nobody in the top group
   * does, so nobody wins and the ranking is a loss.
   */
  readonly why: "success" | "failedTopWins" | "failedNobody";
}

/** One player's real move in a round: room, the coins grabbed into each bag, and the alibi they posted. design §3.2, §15.5 */
export interface RevealMove {
  readonly player: PlayerId;
  readonly room: RoomId;
  readonly duffel: number;
  readonly pocket: number;
  /** Missed the deadline and got the default move. design §5.1 */
  readonly missed: boolean;
  /** The room in their posted alibi for this round, or null if they posted none. design §5.4 */
  readonly alibi: RoomId | null;
}

/**
 * A line of the timeline. Most hidden actions come as the event itself
 * (`event`: powers used, perks bought and used, Rigs, Inside tips, Raid
 * rumours) next to the
 * public ones that matter (meetings, shakedowns, checkpoints, raids). The rest
 * are worked out, because one event alone can't say them.
 */
export type RevealItem =
  | { readonly kind: "event"; readonly event: GameEvent }
  /** A token earned, and why. extension.md "Tokens and the perk shop" */
  | { readonly kind: "token"; readonly player: PlayerId; readonly trigger: TokenTrigger }
  /**
   * A watch feed that read "camera offline", now told apart: the Hacker loop of
   * `hackers`. extension.md "Situations"
   */
  | {
      readonly kind: "cameraOffline";
      readonly watcher: PlayerId;
      readonly room: RoomId;
      readonly source: "security" | "lookout" | "tail";
      readonly hackers: readonly PlayerId[];
    }
  /** A public role claim next to the truth (the claimer's role when they claimed). design §12.1 */
  | { readonly kind: "claim"; readonly player: PlayerId; readonly claimed: RoleId; readonly real: RoleId };

/**
 * Round `round` of the timeline (0: setup), with the meeting that follows it.
 * `stashes` is each player's stash once the round and its
 * meeting are done: the stash over time. design §13
 */
export interface RevealRound {
  readonly round: number;
  /** The event card flipped this round, if any. design §10 */
  readonly card: { readonly id: string; readonly room: RoomId | null } | null;
  /** Everyone's real move, in seat order. */
  readonly moves: readonly RevealMove[];
  /** The public round summary (the Haul), if the round resolved. */
  readonly resolved: Pick<RoundResolved, "haulDelta" | "haul"> | null;
  readonly items: readonly RevealItem[];
  readonly stashes: Readonly<Record<PlayerId, number>>;
}

export interface RevealSummary {
  readonly ending: RevealEnding;
  /** Every player, in final ranking order. */
  readonly seats: readonly RevealSeat[];
  readonly rounds: readonly RevealRound[];
}
