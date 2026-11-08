// What one player is allowed to know: the output of viewFor(state, playerId).
// Clients and bots receive only this. design §13, §17.2, §17.3
import type { PerkId, RoleId, RoomId } from "@skimjob/content";
import type { PlayerId, PlayerSeat, VoteVisibility } from "./config";
import type { Move, VoteChoice } from "./commands";
import type { GameEvent, Honesty, Outcome } from "./events";
import type { RevealSummary } from "./reveal";
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
  /** Your power's uses this stretch / game. design §8 */
  readonly roleState: RoleState;
  /** Your current move for this round, if submitted. */
  readonly move: Move | null;
  readonly sealedVote: VoteChoice | null;
  /** Your ballot in the open meeting, if cast. */
  readonly vote: VoteChoice | null;
  /**
   * Ballot perk: the current ballot (null: none yet) of each player whose
   * ballot you paid to see in the open meeting, also in Secret mode (the one
   * exception to secret ballots, owner decision on role deck v2). Empty
   * outside a meeting. design §8.3, §11.2
   */
  readonly seenBallots: Readonly<Record<PlayerId, VoteChoice | null>>;
}

/**
 * An event with its position in what this player can see, for "since seq N"
 * recaps and for evidence cards that point at one case-file entry. design §12.1, §13
 *
 * `seq` is *not* the index in the full log: gaps there would let a player count
 * hidden events (e.g. a Hacker looping a camera, or who sat in Security). It is
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
export type OtherPlayerView = PlayerSeat;

export interface PlayerView {
  readonly me: SelfView;
  /** Every *other* player, in seat order. You are in `me`. */
  readonly players: readonly OtherPlayerView[];
  readonly phase: PhaseView;
  /** The latest round started; 0 during setup. Kept because not every phase carries it. */
  readonly round: number;
  /** The stretch between regular meetings: 1 until the first regular meeting opens (public). design §9.1 */
  readonly stretch: number;
  /** The round whose alibis may still be posted, or null. design §5.4 */
  readonly alibiRound: number | null;
  readonly rooms: readonly RoomId[];
  /** Coins left in the bank (public). design §6.1 */
  readonly bank: number;
  /** The share: each player's equal cut of every split so far (public). design §7.3 */
  readonly share: number;
  /** The kitty: leftover change carried into the next split (public). design §7.2 */
  readonly kitty: number;
  /** Honesty so far, the meter against the two-thirds line (public). design §7.5 */
  readonly honesty: Honesty;
  /** Lit bulbs on each open room's bell; a taped-off room's bell is off (no entry). Public. design §5.1, §5.3 */
  readonly bells: Readonly<Record<RoomId, number>>;
  /** Taped-off rooms, each closed through this round (public). design §5.3 */
  readonly taped: Readonly<Record<RoomId, number>>;
  /** Wanted stars (public). design §5.4 */
  readonly wanted: number;
  /** This round's event card (public): its id and the room Lockdown closes. design §10 */
  readonly card: { readonly round: number; readonly id: string; readonly room: RoomId | null } | null;
  readonly voteVisibility: VoteVisibility;
  /** Both are public (design §9.3, §9.4); null when nothing is pending. */
  readonly scheduledMeeting: ScheduledMeeting | null;
  readonly pendingEmergency: PendingEmergency | null;
  /** Emergency meetings left in the crew's pool (public). design §9.3 */
  readonly emergencies: number;
  /** Players protected from shakedowns until the next regular meeting (public). design §9.7 */
  readonly protected: readonly PlayerId[];
  /**
   * Players who have locked in a move for the round being planned, in seat
   * order, you included; empty otherwise.
   * Public: the same as this round's `moveLocked` events (owner decision, 2 Nov). design §5.1
   */
  readonly lockedIn: readonly PlayerId[];
  /** Open slot proposals for the next regular meeting or briefing (public, design §9.4). */
  readonly proposals: readonly MeetingProposal[];
  /** This game's perk shop (public), with each perk's cost in tokens. extension.md "Tokens and the perk shop" */
  readonly shop: readonly { readonly perk: PerkId; readonly cost: number }[];
  /** The roles shown at setup (public): exactly those dealt, or every role that could be; null when Hidden. extension.md "Settings" */
  readonly roleList: { readonly list: "exact" | "possible"; readonly roles: readonly RoleId[] } | null;
  /** Public events, oldest first. design §13 */
  readonly ledger: readonly LoggedEvent<PublicEvent>[];
  /** Events private (or secret) to this player, oldest first. design §13 */
  readonly caseFile: readonly LoggedEvent<CaseFileEvent>[];
  /**
   * Null until the game ends; then every event this player may see after the
   * game (every role, every real room and split, every ability) for the reveal
   * timeline. Other players' secret-mode ballots are left out (design §11.2).
   * `seq` numbers this stream (see `LoggedEvent`). `summary` is worked out
   * from this same log (engine `revealSummary`). design §13
   */
  readonly reveal: { readonly outcome: Outcome; readonly log: readonly LoggedEvent[]; readonly summary: RevealSummary } | null;
}
