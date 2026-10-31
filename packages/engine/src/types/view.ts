// What one player is allowed to know: the output of viewFor(state, playerId).
// Clients and bots receive only this. design §13, §17.2, §17.3
import type { RoleId, RoomId } from "@skimjob/content";
import type { PlayerId, PlayerSeat, VoteVisibility } from "./config";
import type { Move, VoteChoice } from "./commands";
import type { ActNumber, GameEvent, Outcome } from "./events";
import type { PendingEmergency, Phase, ScheduledMeeting } from "./state";

/**
 * Phase as a player sees it. Identical to Phase today; kept as its own name so
 * a hidden detail added to Phase later doesn't leak by default.
 */
export type PhaseView = Phase;

export interface SelfView {
  readonly id: PlayerId;
  readonly role: RoleId;
  readonly stash: number;
  readonly safe: number;
  readonly emergencyMeetingUsed: boolean;
  /** Your current move for this round, if submitted. */
  readonly move: Move | null;
  readonly sealedVote: VoteChoice | null;
  /** Your ballot in the open meeting, if cast. */
  readonly vote: VoteChoice | null;
}

/**
 * An event with its position in the full log. Views filter the log, so `seq`
 * keeps the global position for "since seq N" recaps and for evidence cards that
 * point at one case-file entry. design §12.1, §13
 */
export interface LoggedEvent {
  /** Index of the event in `GameState.log`. */
  readonly seq: number;
  readonly event: GameEvent;
}

/** What everyone can see about another player. No stash, role or moves. */
export interface OtherPlayerView extends PlayerSeat {
  readonly emergencyMeetingUsed: boolean;
}

export interface PlayerView {
  readonly me: SelfView;
  /** Every *other* player, in seat order. You are in `me`. */
  readonly players: readonly OtherPlayerView[];
  readonly phase: PhaseView;
  /** The latest round started (1–9); 0 during setup. Kept because not every phase carries it. */
  readonly round: number;
  /** The act of `round`; 1 during setup. */
  readonly act: ActNumber;
  readonly rooms: readonly RoomId[];
  readonly haul: number;
  readonly heat: number;
  readonly voteVisibility: VoteVisibility;
  /** Both are public (design §11.1); null when nothing is pending. */
  readonly scheduledMeeting: ScheduledMeeting | null;
  readonly pendingEmergency: PendingEmergency | null;
  /** Public events, oldest first. design §13 */
  readonly ledger: readonly LoggedEvent[];
  /** Events private to this player, oldest first. design §13 */
  readonly caseFile: readonly LoggedEvent[];
  /**
   * Null until the game ends; then every event this player may see after the
   * game (every role, every real room and split, every ability) for the reveal
   * timeline. Other players' secret-mode ballots are left out (design §11.2),
   * so entries carry their `seq`. design §13
   */
  readonly reveal: { readonly outcome: Outcome; readonly log: readonly LoggedEvent[] } | null;
}
