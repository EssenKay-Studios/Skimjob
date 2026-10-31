// Full, authoritative game state. Server-side only: it contains every secret.
// Clients and bots only ever receive a PlayerView. design §17.2
//
// State is a fold over `log`; every field other than `config` and `log` must be
// derivable by replaying the log from the start.
import type { RoleId, RoomId } from "@skimjob/content";
import type { GameConfig, PlayerId } from "./config";
import type { Move, VoteChoice } from "./commands";
import type { ActNumber, GameEvent, MeetingKind, Outcome } from "./events";

/**
 * Seeded RNG state. The algorithm (and so the word count) is chosen in the
 * seeded-RNG task; it must be plain serialisable numbers so state can be
 * stored, replayed and compared.
 */
export interface RngState {
  readonly words: readonly number[];
}

/**
 * Resting phases of the state machine. design §17.2 lists
 * Setup → Planning → Resolving → (MeetingScheduled → MeetingOpen) → Checkpoint → … → FinalCheck → Reveal.
 * Resolving, Checkpoint and FinalCheck happen inside a single `advance()` and
 * leave only events behind, so they are not resting phases here.
 */
export type Phase =
  | { readonly kind: "setup" }
  /** Players are submitting moves for `round` (1–9). */
  | { readonly kind: "planning"; readonly round: number }
  /** The act's last round has resolved; waiting for its regular meeting to open. */
  | { readonly kind: "awaitingMeeting"; readonly act: ActNumber }
  /** A vote window is open. Rounds are paused. design §4.1 */
  | { readonly kind: "meeting"; readonly meetingId: string }
  /** Game over; everything is revealed. design §13 */
  | { readonly kind: "ended"; readonly outcome: Outcome };

export type PhaseKind = Phase["kind"];

export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly isBot: boolean;
  readonly role: RoleId;
  readonly stash: number;
  /** Fence's hidden safe: survives shakedowns. design §8 */
  readonly safe: number;
  /** Loot moved into the safe this act (capped per act by content). */
  readonly safeDepositedThisAct: number;
  readonly totalHandedIn: number;
  readonly timesShakenDown: number;
  readonly emergencyMeetingUsed: boolean;
  /** For the host's "replace with a bot" prompt after 2 missed rounds. design §15 */
  readonly consecutiveMissedMoves: number;
  /** Vote left in advance for the next meeting. design §11.2 */
  readonly sealedVote: VoteChoice | null;
}

export interface MeetingProposal {
  readonly id: string;
  readonly by: PlayerId;
  readonly act: ActNumber;
  readonly slot: string;
  readonly acceptedBy: readonly PlayerId[];
}

export interface MeetingState {
  readonly id: string;
  readonly kind: MeetingKind;
  readonly act: ActNumber;
  readonly calledBy: PlayerId | null;
  /** For emergency meetings: the round to resume planning afterwards. */
  readonly resumeRound: number | null;
  readonly votes: Readonly<Record<PlayerId, VoteChoice>>;
}

export interface GameState {
  readonly config: GameConfig;
  readonly rng: RngState;
  readonly phase: Phase;
  /** Rooms in play for this player count. design §6.2 */
  readonly rooms: readonly RoomId[];
  /** Seat order, matching config.players. */
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly haul: number;
  /** 0–100. design §7 */
  readonly heat: number;
  /** Moves submitted so far for the current round. */
  readonly moves: Readonly<Record<PlayerId, Move>>;
  /** Players who already posted an alibi for the last resolved round (one each). design §5.4 */
  readonly alibisPosted: readonly PlayerId[];
  readonly proposals: readonly MeetingProposal[];
  /** The regular meeting slot locked in for the current act, if any. */
  readonly scheduledMeeting: { readonly act: ActNumber; readonly slot: string } | null;
  readonly meeting: MeetingState | null;
  readonly log: readonly GameEvent[];
}
