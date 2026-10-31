// Commands in, events out. design §17.2
//
// Player commands are what a client (human or bot) sends. `advance` is sent by
// the server scheduler or the simulator when a deadline passes; the engine
// itself never decides that time is up.
import type { RoomId } from "@skimjob/content";
import type { PlayerId } from "./config";

/** Role powers used as part of a move. Grows as roles are added. design §8 */
export type AbilityUse =
  /** Lookout: also see who was in one extra room this round. */
  | { readonly kind: "lookout"; readonly room: RoomId }
  /** Fence: move loot from stash into the hidden safe (cap per act is content). */
  | { readonly kind: "fenceSafe"; readonly amount: number };

/**
 * One player's secret move for a round. design §5.1
 *
 * The split is expressed as how much to *pocket*; everything else goes to the
 * Haul. The room's actual yield can change after submission (shared Deposit
 * boxes, events), so pocket is clamped to the real yield at resolution, and
 * "hand everything in" is simply `pocket: 0`. See docs/decisions.md.
 */
export interface Move {
  readonly room: RoomId;
  readonly pocket: number;
  /** Required when `room` is a watcher room (Security): which room to watch. design §6.1 */
  readonly watch?: RoomId;
  readonly ability?: AbilityUse;
}

/** A vote in a crew meeting: shake someone down, or skip. design §11.2 */
export type VoteChoice =
  | { readonly kind: "shakedown"; readonly target: PlayerId }
  | { readonly kind: "skip" };

export type PlayerCommand =
  | { readonly type: "submitMove"; readonly player: PlayerId; readonly move: Move }
  | { readonly type: "postAlibi"; readonly player: PlayerId; readonly room: RoomId }
  /**
   * `slot` is an opaque label for the proposed time (e.g. an ISO timestamp).
   * The engine stores and compares it but never interprets it as a time.
   */
  | { readonly type: "proposeMeeting"; readonly player: PlayerId; readonly slot: string }
  | { readonly type: "acceptMeeting"; readonly player: PlayerId; readonly proposalId: string }
  | { readonly type: "callEmergency"; readonly player: PlayerId }
  | { readonly type: "castVote"; readonly player: PlayerId; readonly vote: VoteChoice }
  /** Leave a vote in advance for the next meeting you might miss. design §11.2 */
  | { readonly type: "sealVote"; readonly player: PlayerId; readonly vote: VoteChoice };

/**
 * Sent by the scheduler/simulator: the current deadline has passed.
 * Depending on phase this resolves a round, opens a scheduled meeting,
 * or closes a meeting window (then runs checkpoint / final check).
 */
export interface AdvanceCommand {
  readonly type: "advance";
}

export type Command = PlayerCommand | AdvanceCommand;
export type CommandType = Command["type"];
