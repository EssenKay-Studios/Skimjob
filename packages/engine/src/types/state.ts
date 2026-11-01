// Full, authoritative game state. Server-side only: it contains every secret.
// Clients and bots only ever receive a PlayerView. design §17.2
//
// State is a fold over `log`; every field other than `config` and `log` must be
// derivable by replaying the log from the start. `rng` is set from the seed by
// `rngSeeded` and then by each reveal-only `rngAdvanced` (docs/decisions.md).
import type { RoleId, RoomId } from "@skimjob/content";
import type { GameConfig, PlayerId } from "./config";
import type { Move, VoteChoice } from "./commands";
import type { ActNumber, GameEvent, MeetingKind, Outcome } from "./events";

/**
 * Seeded RNG state: the four unsigned 32-bit words of sfc32 (see `rng.ts`).
 * Plain numbers so state can be stored, replayed and compared. Empty until
 * `rngSeeded` is applied.
 */
export interface RngState {
  readonly words: readonly number[];
}

/**
 * Resting phases of the state machine. design §17.2 lists
 * Setup → Planning → Resolving → (MeetingScheduled → MeetingOpen) → Checkpoint → … → FinalCheck → Reveal.
 * Resolving, Checkpoint and FinalCheck happen inside a single `advance()` and
 * leave only events behind, so they are not resting phases here.
 * A scheduled-but-not-open meeting is not a phase either: it can coexist with
 * planning, so it lives in `GameState.scheduledMeeting` / `pendingEmergency`.
 */
export type Phase =
  | { readonly kind: "setup" }
  /** Players are submitting moves for `round` (1–9). */
  | { readonly kind: "planning"; readonly round: number }
  /** The act's last round has resolved; waiting for its regular meeting to open. */
  | { readonly kind: "awaitingMeeting"; readonly act: ActNumber }
  /** A vote window is open. Rounds are paused. design §4.1 */
  | { readonly kind: "meeting"; readonly meetingId: string }
  /**
   * The vote passed a shakedown on `target`; it is applied when this window's
   * deadline passes, unless the Muscle cancels it. Opens after every passed
   * shakedown when the role pool holds the Muscle, so it never tells anyone a
   * Muscle was dealt. design §8, §11.3
   */
  | { readonly kind: "shakedownPending"; readonly meetingId: string; readonly target: PlayerId }
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
  /** Uses of the role's power so far (all roles share the shape). design §8 */
  readonly roleState: RoleState;
  readonly totalHandedIn: number;
  readonly timesShakenDown: number;
  readonly emergencyMeetingUsed: boolean;
  /** For the host's "replace with a bot" prompt after 2 missed rounds. design §15 */
  readonly consecutiveMissedMoves: number;
  /**
   * Vote left in advance. It is cast into the next meeting that opens, regular
   * or emergency, and is then used up. Sealing again replaces it. design §11.2
   */
  readonly sealedVote: VoteChoice | null;
}

/**
 * Generic per-player role state: once-per-act and once-per-game uses and the
 * Snitch's target. Private to the player. design §8
 */
export interface RoleState {
  /**
   * Uses this act, reset when an act starts: loot moved into the safe (Fence),
   * camera loops (Hacker), role guesses (Blackmailer), tip-offs (Mole).
   */
  readonly usedThisAct: number;
  /** Uses this game: cancelled shakedowns (Muscle). */
  readonly usedThisGame: number;
  /** The Snitch's secret target; null for every other role. */
  readonly target: PlayerId | null;
  /** A Mole's fellow Moles (design §8.1); empty for everyone else and for a lone Mole. */
  readonly allies: readonly PlayerId[];
}

export const NO_ROLE_STATE: RoleState = { usedThisAct: 0, usedThisGame: 0, target: null, allies: [] };

/** A shakedown the vote passed, waiting for its window to end. Hidden: whether it was cancelled. design §11.3 */
export interface PendingShakedown {
  readonly meetingId: string;
  readonly kind: MeetingKind;
  readonly act: ActNumber;
  readonly target: PlayerId;
  /** The Muscle cancelled it. Never in a view: the cancel is only announced when the window ends. */
  readonly cancelled: boolean;
}

export interface MeetingProposal {
  readonly id: string;
  readonly by: PlayerId;
  readonly act: ActNumber;
  readonly slot: string;
  /** The proposer counts as accepting. Locked in once more than half the crew is here. design §11.1 */
  readonly acceptedBy: readonly PlayerId[];
}

export interface ScheduledMeeting {
  readonly meetingId: string;
  readonly act: ActNumber;
  readonly slot: string;
}

export interface PendingEmergency {
  readonly meetingId: string;
  readonly by: PlayerId;
}

export interface MeetingState {
  readonly id: string;
  readonly kind: MeetingKind;
  readonly act: ActNumber;
  /** Who called it (emergency meetings); null for the act's regular meeting. */
  readonly calledBy: PlayerId | null;
  /**
   * Ballots so far; a later ballot from the same player replaces the earlier one.
   * Sealed votes are cast into it as the window opens. design §11.2
   * (No resume point is stored: the game goes back to planning `round`, or to
   * awaiting the act's meeting if `round` has already resolved.)
   */
  readonly votes: Readonly<Record<PlayerId, VoteChoice>>;
}

export interface GameState {
  readonly config: GameConfig;
  readonly rng: RngState;
  readonly phase: Phase;
  /** The latest round started (1–9); 0 before round 1. Set by `roundStarted`. */
  readonly round: number;
  /** Rooms in play for this player count. design §6.2 */
  readonly rooms: readonly RoomId[];
  /** Seat order, matching config.players. */
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly haul: number;
  /** 0–100. design §7 */
  readonly heat: number;
  /** Moves submitted so far for the current round (cleared when it resolves). */
  readonly moves: Readonly<Record<PlayerId, Move>>;
  /** The latest round resolved; 0 before any. Alibis are posted for this round. design §5.4 */
  readonly resolvedRound: number;
  /** Players who already posted an alibi for `resolvedRound` (one each). design §5.4 */
  readonly alibisPosted: readonly PlayerId[];
  /** Open proposals for the current act's regular meeting; cleared once a slot is locked. design §11.1 */
  readonly proposals: readonly MeetingProposal[];
  /** The regular meeting locked in for the current act, not yet open. design §11.1 */
  readonly scheduledMeeting: ScheduledMeeting | null;
  /** An emergency meeting that has been called and is in its notice period. design §11.1 */
  readonly pendingEmergency: PendingEmergency | null;
  /** The open vote window, if any; set exactly when `phase.kind === "meeting"`. */
  readonly meeting: MeetingState | null;
  /** Set exactly when `phase.kind === "shakedownPending"`. */
  readonly pendingShakedown: PendingShakedown | null;
  readonly log: readonly GameEvent[];
}
