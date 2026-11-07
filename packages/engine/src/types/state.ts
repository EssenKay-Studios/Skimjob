// Full, authoritative game state. Server-side only: it contains every secret.
// Clients and bots only ever receive a PlayerView. design §17.2
//
// State is a fold over `log`; every field other than `config` and `log` must be
// derivable by replaying the log from the start. `rng` is set from the seed by
// `rngSeeded` and then by each reveal-only `rngAdvanced` (docs/decisions.md).
import type { EventId, PerkId, RoleId, RoomId } from "@skimjob/content";
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
  /**
   * `round` has resolved; players post their alibis for it until the alibi
   * deadline (`advance { kind: "alibis", round }`). Then the next round's
   * planning starts, or after an act's last round its meeting is awaited.
   * design §5.4
   */
  | { readonly kind: "alibis"; readonly round: number }
  /** The act's last round has resolved; waiting for its regular meeting to open. */
  | { readonly kind: "awaitingMeeting"; readonly act: ActNumber }
  /** A vote window is open. Rounds are paused. design §4.1 */
  | { readonly kind: "meeting"; readonly meetingId: string }
  /**
   * The vote passed a shakedown on `target`; it is applied when this window's
   * deadline passes, unless a Shield cancels it. Opens after every passed
   * shakedown when the shop holds the Shield, so it never tells anyone who
   * holds one. design §8.3, §11.3
   */
  | { readonly kind: "shakedownPending"; readonly meetingId: string; readonly target: PlayerId }
  /** Game over; everything is revealed. design §13 */
  | { readonly kind: "ended"; readonly outcome: Outcome };

export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly isBot: boolean;
  readonly role: RoleId;
  readonly stash: number;
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
 * Generic per-player role state: once-between-meetings and once-per-game uses,
 * tokens and perks. Private to the player. design §8
 */
export interface RoleState {
  /**
   * Uses this stretch (extension.md "between meetings"; acts internally):
   * reset as the next stretch's first round starts, which is right after a
   * regular meeting closes with its target check;
   * emergency meetings never reset it. Camera loops (Hacker), tip-offs (Mole),
   * audits (Auditor), stash checks (Detective), blessings (Priest).
   */
  readonly usedThisAct: number;
  /** Uses this game: raid stops (Fixer). */
  readonly usedThisGame: number;
  /** Unspent tokens (extension.md "Tokens and the perk shop"). */
  readonly tokens: number;
  /** Perks bought and not yet used, in the order bought. design §8.3 */
  readonly perks: readonly PerkId[];
  /** The room a spent Tail watches when the round being planned resolves; null otherwise. design §8.3 */
  readonly tail: RoomId | null;
}

export const NO_ROLE_STATE: RoleState = { usedThisAct: 0, usedThisGame: 0, tokens: 0, perks: [], tail: null };

/**
 * The hidden police schedule (extension.md "Police activity"). Never in a
 * view. `moment` is the next police moment's number, `gapPermille` how long
 * after the previous one it falls (thousandths of a round length, game time),
 * `patrol` whether a background patrol fires there; `queue` the Moles whose
 * tip-offs wait for a moment, oldest first; `tipOffs` each player's tip-offs
 * this game (queued or landed; Recharge never gives one back).
 */
export interface PoliceState {
  readonly moment: number;
  readonly gapPermille: number;
  readonly patrol: boolean;
  readonly queue: readonly PlayerId[];
  readonly tipOffs: Readonly<Record<PlayerId, number>>;
}

/** A spent Rig: `player` picks which of `cards` flips at the start of `round`. Hidden from everyone else. design §8.3 */
export interface RiggedCard {
  readonly player: PlayerId;
  readonly round: number;
  readonly cards: readonly EventId[];
  readonly pick: EventId;
}

/** A shakedown the vote passed, waiting for its window to end. design §11.3 */
export interface PendingShakedown {
  readonly meetingId: string;
  readonly kind: MeetingKind;
  readonly act: ActNumber;
  readonly target: PlayerId;
}

/** The event card flipped for `round`; cleared when the round resolves. design §10 */
export interface ActiveCard {
  readonly round: number;
  readonly id: EventId;
  /** The room Lockdown closes; null for other cards. Public. */
  readonly room: RoomId | null;
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
  /** Players who spent a +Vote in this meeting (hidden). design §8.3 */
  readonly extraVotes: readonly PlayerId[];
  /** Ballot perks spent in this meeting: viewer → the players whose ballots they see (hidden). design §8.3 */
  readonly ballotGrants: Readonly<Record<PlayerId, readonly PlayerId[]>>;
}

export interface GameState {
  readonly config: GameConfig;
  readonly rng: RngState;
  readonly phase: Phase;
  /** The latest round started (1–9); 0 before round 1. Set by `roundStarted`. */
  readonly round: number;
  /** Rooms in play for this player count. design §3.1 */
  readonly rooms: readonly RoomId[];
  /** Coins left in the bank (public). design §6.1 */
  readonly bank: number;
  /** Seat order, matching config.players. */
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly haul: number;
  /** 0–100. design §7 */
  readonly heat: number;
  /** This round's event card, if one was flipped (cleared when the round resolves). design §10 */
  readonly card: ActiveCard | null;
  /** Every card flipped so far this game, in order (public); every flip draws from the full deck. design §10 */
  readonly cardsFlipped: readonly EventId[];
  /** Moves submitted so far for the current round (cleared when it resolves). */
  readonly moves: Readonly<Record<PlayerId, Move>>;
  /** The latest round resolved; 0 before any. Alibis are posted for this round. design §5.4 */
  readonly resolvedRound: number;
  /** Alibis for `resolvedRound` may still be posted (its alibi deadline hasn't passed). design §5.4 */
  readonly alibisOpen: boolean;
  /** Players who already posted an alibi for `resolvedRound` (one each). design §5.4 */
  readonly alibisPosted: readonly PlayerId[];
  /** Players whose alibi for `resolvedRound` is stamped Verified (public, Alibi perk). design §8.3 */
  readonly alibisVerified: readonly PlayerId[];
  /**
   * Rigs spent for coming rounds, oldest first, at most one per player per
   * round (hidden). The oldest for a round flips its pick. design §8.3
   */
  readonly rigs: readonly RiggedCard[];
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
  /** The shop's perks (public), dealt at setup. extension.md "Tokens and the perk shop" */
  readonly shop: readonly PerkId[];
  /** Hidden police schedule; null when no Mole could be in the game (or the game is over). */
  readonly police: PoliceState | null;
  readonly log: readonly GameEvent[];
}
