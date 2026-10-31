// What one player is allowed to know: the output of viewFor(state, playerId).
// Clients and bots receive only this. design §13, §17.2, §17.3
import type { RoleId, RoomId } from "@skimjob/content";
import type { PlayerId, PlayerSeat, VoteVisibility } from "./config";
import type { Move, VoteChoice } from "./commands";
import type { ActNumber, GameEvent, Outcome } from "./events";
import type { Phase } from "./state";

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

/** What everyone can see about another player. No stash, role or moves. */
export interface OtherPlayerView extends PlayerSeat {
  readonly emergencyMeetingUsed: boolean;
}

export interface PlayerView {
  readonly me: SelfView;
  readonly players: readonly OtherPlayerView[];
  readonly phase: PhaseView;
  readonly round: number;
  readonly act: ActNumber;
  readonly rooms: readonly RoomId[];
  readonly haul: number;
  readonly heat: number;
  readonly voteVisibility: VoteVisibility;
  /** Public events, oldest first. design §13 */
  readonly ledger: readonly GameEvent[];
  /** Events private to this player, oldest first. design §13 */
  readonly caseFile: readonly GameEvent[];
  /**
   * Null until the game ends; then the complete log (every role, every real
   * room and split, every ability) for the reveal timeline. design §13
   */
  readonly reveal: { readonly outcome: Outcome; readonly log: readonly GameEvent[] } | null;
}
