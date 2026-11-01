// What one player is allowed to know: the output of viewFor(state, playerId).
// Clients and bots receive only this. design §13, §17.2, §17.3
import type { RoleId, RoomId } from "@skimjob/content";
import type { PlayerId, PlayerSeat, VoteVisibility } from "./config";
import type { Move, VoteChoice } from "./commands";
import type { ActNumber, GameEvent, Outcome } from "./events";
import type { MeetingProposal, PendingEmergency, Phase, RoleState, ScheduledMeeting } from "./state";
import type { PrivateVisibility, PublicVisibility, SecretVisibility, Visibility } from "./visibility";

/**
 * `E` with its visibility narrowed to `V`, or never if `E` can't have it. Lets
 * the ledger hold only public events and the case file only owned ones, by type.
 */
export type WithVisibility<E extends GameEvent, V extends Visibility> = E extends GameEvent
  ? [Extract<E["visibility"], V>] extends [never]
    ? never
    : E & { readonly visibility: Extract<E["visibility"], V> }
  : never;

/** Events that can appear in the public ledger. design §13 */
export type PublicEvent = WithVisibility<GameEvent, PublicVisibility>;
/** Events that can appear in a case file: private to you, or your own secret-mode ballots. design §13, §11.2 */
export type CaseFileEvent = WithVisibility<GameEvent, PrivateVisibility | SecretVisibility>;

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
  /** Your power's uses this act / game, and the Snitch's target. design §8 */
  readonly roleState: RoleState;
  readonly emergencyMeetingUsed: boolean;
  /** Your current move for this round, if submitted. */
  readonly move: Move | null;
  readonly sealedVote: VoteChoice | null;
  /** Your ballot in the open meeting, if cast. */
  readonly vote: VoteChoice | null;
}

/**
 * An event with its position in what this player can see, for "since seq N"
 * recaps and for evidence cards that point at one case-file entry. design §12.1, §13
 *
 * `seq` is *not* the index in the full log: gaps there would let a player count
 * hidden events (e.g. a Fence using the safe, or who sat in Security). It is
 * the index among the events this player can see during the game (public, plus
 * private or secret to them), so ledger and case file share one numbering and
 * new events always get higher numbers. The reveal log numbers its own,
 * larger stream the same way. docs/decisions.md
 */
export interface LoggedEvent<E extends GameEvent = GameEvent> {
  readonly seq: number;
  readonly event: E;
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
  /** This round's event card (public): its id and the room Lockdown closes. design §10 */
  readonly card: { readonly round: number; readonly id: string; readonly room: RoomId | null } | null;
  readonly voteVisibility: VoteVisibility;
  /** Both are public (design §11.1); null when nothing is pending. */
  readonly scheduledMeeting: ScheduledMeeting | null;
  readonly pendingEmergency: PendingEmergency | null;
  /** Open proposals for the act's regular meeting (public, design §11.1). */
  readonly proposals: readonly MeetingProposal[];
  /** Public events, oldest first. design §13 */
  readonly ledger: readonly LoggedEvent<PublicEvent>[];
  /** Events private (or secret) to this player, oldest first. design §13 */
  readonly caseFile: readonly LoggedEvent<CaseFileEvent>[];
  /**
   * Null until the game ends; then every event this player may see after the
   * game (every role, every real room and split, every ability) for the reveal
   * timeline. Other players' secret-mode ballots are left out (design §11.2).
   * `seq` numbers this stream (see `LoggedEvent`). design §13
   */
  readonly reveal: { readonly outcome: Outcome; readonly log: readonly LoggedEvent[] } | null;
}
