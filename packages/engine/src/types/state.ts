// Full, authoritative game state. Server-side only: it contains every secret.
// Clients and bots only ever receive a PlayerView. design §17.2
//
// State is a fold over `log`; every field other than `config` and `log` must be
// derivable by replaying the log from the start. `rng` is set from the seed by
// `rngSeeded` and then by each reveal-only `rngAdvanced` (docs/decisions.md).
import type { EventId, PerkId, RoleId, RoomId } from "@skimjob/content";
import type { GameConfig, PlayerId } from "./config";
import type { Move, VoteChoice } from "./commands";
import type { GameEvent, MeetingKind, Outcome } from "./events";

/**
 * Seeded RNG state: the four unsigned 32-bit words of sfc32 (see `rng.ts`).
 * Plain numbers so state can be stored, replayed and compared. Empty until
 * `rngSeeded` is applied.
 */
export interface RngState {
  readonly words: readonly number[];
}

/**
 * Resting phases of the state machine: Setup → Planning → Resolving (with the
 * end check, design §4.2) → Alibis → (a regular meeting or a briefing) →
 * the result window (an emergency) → Planning … → Reveal. design §4.1
 * Resolving and the end check happen inside a single `advance()` and leave
 * only events behind, so they are not resting phases here.
 * A scheduled-but-not-open meeting is not a phase either: it can coexist with
 * planning, so it lives in `GameState.scheduledMeeting` / `pendingEmergency`.
 */
export type Phase =
  | { readonly kind: "setup" }
  /** Players are submitting moves for `round` (1 up to the round cap, design §6.2). */
  | { readonly kind: "planning"; readonly round: number }
  /**
   * `round` has resolved; players post their alibis for it until the alibi
   * deadline (`advance { kind: "alibis", round }`). Then the meeting the round
   * called for is awaited, else the result window or the next round follows.
   * design §5.4
   */
  | { readonly kind: "alibis"; readonly round: number }
  /**
   * The round crossed a third of the bank (a regular meeting, §9.1) or had a
   * raid (a police briefing, §9.2); waiting for meeting `meetingId` to open.
   * Both due after one round: one regular meeting.
   */
  | { readonly kind: "awaitingMeeting"; readonly meeting: "regular" | "briefing"; readonly meetingId: string }
  /**
   * The result window after `round`'s result (and any meeting it called): any
   * player may spend an emergency from the crew's pool until it closes
   * (`advance { kind: "result", round }`). Skipped when the pool is empty;
   * once an emergency is called, the next round starts when its meeting
   * closes. design §4.2 step 10, §9.3
   */
  | { readonly kind: "result"; readonly round: number }
  /** A vote window is open. Rounds are paused. design §4.1 */
  | { readonly kind: "meeting"; readonly meetingId: string }
  /**
   * The vote passed a shakedown on `target`; its Bail choice window is open
   * until this deadline passes. Opens after every passed shakedown when Bail
   * is in the shop, so it never tells anyone who holds one. design §9.6, §12
   */
  | { readonly kind: "shakedownPending"; readonly meetingId: string; readonly target: PlayerId }
  /** Game over; everything is revealed. design §13 */
  | { readonly kind: "ended"; readonly outcome: Outcome };

export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly isBot: boolean;
  readonly role: RoleId;
  /** Private: share received + coins pocketed − coins taken back − coins spent on perks. design §7.6 */
  readonly stash: number;
  /** Uses of the role's power so far (all roles share the shape). design §11 */
  readonly roleState: RoleState;
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
 * and a held Bail. Private to the player; each holder of a role has their
 * own (design §11.3, §19.2 seam 9).
 */
export interface RoleState {
  /**
   * Uses this stretch ("once between meetings"): reset as a regular meeting
   * opens; briefings and emergencies never reset it (design §9.1, §11.2).
   * Audits (Auditor), hidden bells (Hacker), blackouts (Electrician),
   * absolves (Priest), rings (Mole).
   */
  readonly usedThisStretch: number;
  /** Uses this game: reopened rooms (Fixer). */
  readonly usedThisGame: number;
  /** Holding a Bail (at most one at a time). design §12 */
  readonly bail: boolean;
}

export const NO_ROLE_STATE: RoleState = { usedThisStretch: 0, usedThisGame: 0, bail: false };

/** A shakedown the vote passed, waiting for its Bail choice window to end. design §9.6 */
export interface PendingShakedown {
  readonly meetingId: string;
  readonly kind: MeetingKind;
  readonly target: PlayerId;
  /** The target's latest Bail choice (hidden); no answer means don't use. */
  readonly useBail: boolean;
}

/** The event card flipped for `round`; cleared when the round resolves. design §13 */
export interface ActiveCard {
  readonly round: number;
  readonly id: EventId;
  /** The room Lockdown closes; null for other cards. Public. */
  readonly room: RoomId | null;
}

export interface MeetingProposal {
  readonly id: string;
  readonly by: PlayerId;
  readonly slot: string;
  /** The proposer counts as accepting. Locked in once more than half the people back it. design §9.4 */
  readonly acceptedBy: readonly PlayerId[];
}

export interface ScheduledMeeting {
  readonly meetingId: string;
  readonly slot: string;
}

export interface PendingEmergency {
  readonly meetingId: string;
  readonly by: PlayerId;
}

export interface MeetingState {
  readonly id: string;
  readonly kind: MeetingKind;
  /** Who called it (emergency meetings); null for a regular meeting or a briefing. */
  readonly calledBy: PlayerId | null;
  /**
   * Ballots so far; a later ballot from the same player replaces the earlier one.
   * Sealed votes are cast into it as the window opens. design §11.2
   * (No resume point is stored: the game goes on to the result window, design §4.2.)
   */
  readonly votes: Readonly<Record<PlayerId, VoteChoice>>;
  /** Check ballots for this meeting: viewer → the players whose ballots they see (hidden). design §12 */
  readonly ballotGrants: Readonly<Record<PlayerId, readonly PlayerId[]>>;
}

export interface GameState {
  readonly config: GameConfig;
  readonly rng: RngState;
  readonly phase: Phase;
  /** The latest round started (1 up to the round cap); 0 before round 1. Set by `roundStarted`. */
  readonly round: number;
  /** Rooms in play for this player count. design §3.1 */
  readonly rooms: readonly RoomId[];
  /** Coins left in the bank (public). design §6.1 */
  readonly bank: number;
  /** The bank's starting pile (public): its thirds call the regular meetings. design §6.1, §9.1 */
  readonly bankStart: number;
  /** Thirds of the bank gone so far (0–2) that have called their regular meeting. design §9.1 */
  readonly thirds: number;
  /** The stretch between regular meetings: 1 until the first regular meeting opens (public). design §9.1, §11.2 */
  readonly stretch: number;
  /**
   * The meeting the latest round called (a raid calls a briefing, a third of
   * the bank a regular meeting), until it opens. design §4.2 step 9
   */
  readonly meetingDue: "regular" | "briefing" | null;
  /** Emergency meetings left in the crew's pool (public). design §9.3 */
  readonly emergencies: number;
  /** Players a shakedown passed against since the last regular meeting opened (public), in that order. design §9.7 */
  readonly protected: readonly PlayerId[];
  /** Seat order, matching config.players. */
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  /** The share: each player's equal cut of every split so far (public). design §7.3 */
  readonly share: number;
  /** Leftover change from the last split, carried into the next (public). design §7.2 */
  readonly kitty: number;
  /** Coins set aside in the duffel for the next split: shakedown returns (public). design §7.1, §9.6 */
  readonly setAside: number;
  /** Coins that reached the duffel this game, each counted once (public): honesty's numerator. design §7.5 */
  readonly reached: number;
  /**
   * Lit bulbs on each open room's bell (public). A taped-off room's bell is
   * off, so it has no entry; it comes back at 0 when the room reopens. design §5.1, §5.3
   */
  readonly bells: Readonly<Record<RoomId, number>>;
  /** Taped-off rooms (public): each stays closed through this round. design §5.3 */
  readonly taped: Readonly<Record<RoomId, number>>;
  /**
   * Rooms whose bell a Hacker hid as this round resolved (public: they show "?"); their real bulbs
   * stay in `bells`. Cleared as the next round starts. design §5.1, §11.1
   */
  readonly hidden: readonly RoomId[];
  /** Rooms blacked out this round (public, announced as it started). design §11.1 */
  readonly dark: readonly RoomId[];
  /** Rooms an Electrician blacked out for the next round, not yet announced (hidden). design §11.1 */
  readonly cutsPending: readonly RoomId[];
  /** Wanted stars (public); never goes down. design §5.4 */
  readonly wanted: number;
  /** Coins the police have seized this game (public): they left the game. design §5.3, §7.7 */
  readonly seized: number;
  /** Coins spent on perks this game (public: every purchase is logged with its cost): they left the game. design §7.7, §12 */
  readonly spent: number;
  /** This round's event card, if one was flipped (cleared when the round resolves). design §13 */
  readonly card: ActiveCard | null;
  /** Moves submitted so far for the current round (cleared when it resolves). */
  readonly moves: Readonly<Record<PlayerId, Move>>;
  /** The latest round resolved; 0 before any. Alibis are posted for this round. design §5.4 */
  readonly resolvedRound: number;
  /** Alibis for `resolvedRound` may still be posted (its alibi deadline hasn't passed). design §5.4 */
  readonly alibisOpen: boolean;
  /** Players who already posted an alibi for `resolvedRound` (one each). design §5.4 */
  readonly alibisPosted: readonly PlayerId[];
  /** Check ballots bought for the next meeting that opens, in order (hidden). design §12 */
  readonly ballotChecks: readonly { readonly player: PlayerId; readonly target: PlayerId }[];
  /** Open slot proposals for the next regular meeting or briefing; cleared once a slot is locked. design §9.4 */
  readonly proposals: readonly MeetingProposal[];
  /** The next regular meeting or briefing's locked slot, not yet open. design §9.4 */
  readonly scheduledMeeting: ScheduledMeeting | null;
  /** An emergency meeting that has been called and is in its notice period. design §9.3 */
  readonly pendingEmergency: PendingEmergency | null;
  /** The open vote window, if any; set exactly when `phase.kind === "meeting"`. */
  readonly meeting: MeetingState | null;
  /** Set exactly when `phase.kind === "shakedownPending"`. */
  readonly pendingShakedown: PendingShakedown | null;
  /** The black market's three perks (public), dealt at setup. design §12 */
  readonly shop: readonly PerkId[];
  readonly log: readonly GameEvent[];
}
