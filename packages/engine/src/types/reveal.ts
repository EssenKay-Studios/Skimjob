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
  /** The role at the end (differs after a Double-cross swap); the one scored and judged. design §10 */
  readonly role: RoleId;
  /** The failure endings `role` also wins from the top group (★ roles). extension.md "Winning and losing" */
  readonly winsOn: readonly FailureReason[];
  readonly score: number;
  /** Stash with any Fence safe. */
  readonly stash: number;
  readonly safe: number;
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

/** One player's real move in a round: room, loot and split, and the alibi they posted. design §13 */
export interface RevealMove {
  readonly player: PlayerId;
  readonly room: RoomId;
  readonly loot: number;
  readonly toHaul: number;
  readonly toStash: number;
  /** Missed the deadline and got the default move. design §5.1 */
  readonly missed: boolean;
  /** The room in their posted alibi for this round, or null if they posted none. design §5.4 */
  readonly alibi: RoomId | null;
}

/**
 * A line of the timeline. Most hidden actions come as the event itself
 * (`event`: powers used, perks bought and used, Rigs, foreseen cards, forged
 * sightings, Inside tips, Raid rumours, Snitch targets) next to the
 * public ones that matter (meetings, shakedowns, checkpoints, raids). The rest
 * are worked out, because one event alone can't say them.
 */
export type RevealItem =
  | { readonly kind: "event"; readonly event: GameEvent }
  /** A token earned, and why. extension.md "Tokens and the perk shop" */
  | { readonly kind: "token"; readonly player: PlayerId; readonly trigger: TokenTrigger }
  /** Police activity, now told apart: a background patrol, or `mole`'s tip-off landing. extension.md "Police activity" */
  | { readonly kind: "police"; readonly heatAdded: number; readonly heat: number; readonly cause: "patrol" | "tipOff"; readonly mole: PlayerId | null }
  /**
   * A watch feed that read "camera offline", now told apart: a Power cut (the
   * card blinded every feed) or the Hacker loop of `hackers`. extension.md "Situations"
   */
  | {
      readonly kind: "cameraOffline";
      readonly watcher: PlayerId;
      readonly room: RoomId;
      readonly source: "security" | "lookout" | "tail";
      readonly cause: "powerCut" | "hackerLoop";
      readonly hackers: readonly PlayerId[];
    }
  /** A Blackmailer's right guess took `victim`'s vote at `meetingId`; `decided`: it decided a shakedown (ruling 5). */
  | { readonly kind: "voteStolen"; readonly blackmailer: PlayerId; readonly victim: PlayerId; readonly meetingId: string; readonly decided: boolean }
  /** A public role claim next to the truth (the claimer's role when they claimed). design §12.1 */
  | { readonly kind: "claim"; readonly player: PlayerId; readonly claimed: RoleId; readonly real: RoleId }
  /** A Double-cross offer between the two, and whether they swapped. design §10 */
  | { readonly kind: "doubleCross"; readonly players: readonly [PlayerId, PlayerId]; readonly swapped: boolean };

/**
 * Round `round` of the timeline (0: setup), with the meeting that follows it.
 * `stashes` is each player's stash (safe included) once the round and its
 * meeting are done: the stash over time. design §13
 */
export interface RevealRound {
  readonly round: number;
  /** The event card flipped this round, if any. design §10 */
  readonly card: { readonly id: string; readonly room: RoomId | null } | null;
  /** Everyone's real move, in seat order. */
  readonly moves: readonly RevealMove[];
  /** The public round summary (Haul and Heat), if the round resolved. */
  readonly resolved: Pick<RoundResolved, "haulDelta" | "haul" | "heatDelta" | "heat"> | null;
  readonly items: readonly RevealItem[];
  readonly stashes: Readonly<Record<PlayerId, number>>;
}

export interface RevealSummary {
  readonly ending: RevealEnding;
  /** Every player, in final ranking order. */
  readonly seats: readonly RevealSeat[];
  readonly rounds: readonly RevealRound[];
}
