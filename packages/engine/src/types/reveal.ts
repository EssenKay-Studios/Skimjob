// The end-of-game reveal, worked out from the log (design §8, §15.5). Only in a
// view once the game has ended (`PlayerView.reveal.summary`), and built from
// the same events as `reveal.log`, so it never holds anything that log doesn't.
import type { PerkId, RoleId, RoomId } from "@skimjob/content";
import type { PlayerId } from "./config";
import type { DuffelSplit, GameEvent, Outcome, RoundResolved } from "./events";

/** One player's line in the reveal, best first (the final ranking's order). */
export interface RevealSeat {
  readonly player: PlayerId;
  /** 1-based place in the final ranking (tie-broken; a full tie keeps seat order). design §3 */
  readonly place: number;
  /** The role dealt at setup. */
  readonly dealtRole: RoleId;
  /** The role at the end; the one scored and judged. design §10 */
  readonly role: RoleId;
  readonly stash: number;
  /** Tied for the biggest stash (no tie-break, design §8.5). */
  readonly topGroup: boolean;
  readonly winner: boolean;
  /** Every perk bought, in order. design §12, §15.5 */
  readonly perksBought: readonly PerkId[];
}

/** Why the game ended the way it did, and who that makes the winners. design §8 */
export interface RevealEnding {
  readonly result: Outcome["result"];
  /** Null on a success. */
  readonly reason: "bust" | "theft" | null;
  readonly topGroup: readonly PlayerId[];
  readonly winners: readonly PlayerId[];
  /**
   * `success`: the top group wins. `failedTopWins`: someone won the failure
   * (a Rooftop escapee on a bust, a Mole or Fixer at the top on a heist sunk by
   * theft). `failedNobody`: nobody did, so the ranking is a loss.
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
  /** The room in their posted alibi for this round, or null if they posted none. design §11.3 */
  readonly alibi: RoomId | null;
}

/**
 * A line of the timeline. Most hidden actions come as the event itself
 * (`event`: powers used or already done, absolves, perks bought, Bail
 * choices, Inside tips) next to the public ones that matter (meetings,
 * shakedowns, raids, power cuts). The rest are worked out, because one event
 * alone can't say them.
 */
export type RevealItem =
  | { readonly kind: "event"; readonly event: GameEvent }
  /** A public role claim next to the truth (the claimer's role when they claimed). design §11.3 */
  | { readonly kind: "claim"; readonly player: PlayerId; readonly claimed: RoleId; readonly real: RoleId };

/**
 * Round `round` of the timeline (0: setup), with the meeting that follows it.
 * `stashes` is each player's stash once the round and its
 * meeting are done: the stash over time. design §13
 */
export interface RevealRound {
  readonly round: number;
  /** The event card flipped this round, if any. design §13 */
  readonly card: { readonly id: string; readonly room: RoomId | null } | null;
  /** Everyone's real move, in seat order. */
  readonly moves: readonly RevealMove[];
  /** Who sat the round out (a missed move into a taped-off default room): no entry in `moves`. design §3.3 */
  readonly satOut: readonly PlayerId[];
  /** The public round summary (taken and missing), if the round resolved. design §7.4 */
  readonly resolved: Pick<RoundResolved, "taken" | "missing"> | null;
  /** This round's cut and the share after it, if the duffel was split (not on a bust). design §7.2, §7.3 */
  readonly split: Pick<DuffelSplit, "cut" | "share"> | null;
  readonly items: readonly RevealItem[];
  readonly stashes: Readonly<Record<PlayerId, number>>;
}

export interface RevealSummary {
  readonly ending: RevealEnding;
  /** Every player, in final ranking order. */
  readonly seats: readonly RevealSeat[];
  readonly rounds: readonly RevealRound[];
}
