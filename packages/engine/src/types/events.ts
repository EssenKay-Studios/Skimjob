// Game events. The game *is* the event log; state is a fold over it. design §17.2
//
// Each event type fixes its own visibility in the type system, so an event that
// must stay secret (a dealt role, a real split) cannot be constructed as public.
// When you add an event type: add it to GameEvent, add a sample to
// `samples.ts`, and make sure viewFor() tests cover it (CLAUDE.md).
import type { JobId, RoleId, RoomId } from "@skimjob/content";
import type { MoleSetting, PlayerId, PlayerSeat, VoteVisibility } from "./config";
import type { AbilityUse, Move, VoteChoice } from "./commands";
import type { PrivateVisibility, PublicVisibility, RevealVisibility, SecretVisibility } from "./visibility";

export type ActNumber = 1 | 2 | 3;
export type MeetingKind = "regular" | "emergency";

// ---------------------------------------------------------------- setup (§8.1, §6.2)

/** Public game setup. Deliberately excludes the seed. */
export interface GameCreated {
  readonly type: "gameCreated";
  readonly visibility: PublicVisibility;
  readonly players: readonly PlayerSeat[];
  readonly job: JobId;
  readonly mole: MoleSetting;
  readonly eventsEnabled: boolean;
  readonly voteVisibility: VoteVisibility;
  readonly starterMode: boolean;
}

/** The RNG seed, kept out of every player's view until the reveal. */
export interface RngSeeded {
  readonly type: "rngSeeded";
  readonly visibility: RevealVisibility;
  readonly seed: string;
}

/** Rooms in play for this player count. design §6.2 */
export interface RoomsSet {
  readonly type: "roomsSet";
  readonly visibility: PublicVisibility;
  readonly rooms: readonly RoomId[];
}

export interface RoleDealt {
  readonly type: "roleDealt";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly role: RoleId;
}

/**
 * The RNG state after the draws made while handling one command. Appended after
 * the events those draws produced, whenever a command consumed randomness, so
 * replaying the log restores `GameState.rng` without re-drawing. Reveal-only:
 * the state would let a player predict future draws. docs/decisions.md
 */
export interface RngAdvanced {
  readonly type: "rngAdvanced";
  readonly visibility: RevealVisibility;
  readonly words: readonly number[];
}

// ---------------------------------------------------------------- rounds (§5)

export interface RoundStarted {
  readonly type: "roundStarted";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly act: ActNumber;
}

/** A player's (re)submitted move. Only they see it. design §5.1 */
export interface MoveSubmitted {
  readonly type: "moveSubmitted";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly move: Move;
}

/** Missed the deadline: Lobby, hand everything in. design §5.1 */
export interface DefaultMoveAssigned {
  readonly type: "defaultMoveAssigned";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly move: Move;
}

/**
 * What a player actually got this round and where it went. Private to them;
 * the full set becomes the per-round breakdown in the reveal. design §5.2 step 3, §13
 */
export interface LootSplit {
  readonly type: "lootSplit";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly room: RoomId;
  readonly loot: number;
  readonly toHaul: number;
  readonly toStash: number;
}

/** An ability took effect. design §8 */
export interface AbilityResolved {
  readonly type: "abilityResolved";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly ability: AbilityUse;
}

/** Who else was in your room. design §5.2 step 5 */
export interface RoomSighting {
  readonly type: "roomSighting";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly room: RoomId;
  readonly others: readonly PlayerId[];
}

/** Everyone seen in a watched room, via Security or the Lookout power. design §6.1, §8 */
export interface RoomWatched {
  readonly type: "roomWatched";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly source: "security" | "lookout";
  readonly room: RoomId;
  readonly seen: readonly PlayerId[];
}

/** Server room: how many pocketed, not who. design §6.2 */
export interface PocketCount {
  readonly type: "pocketCount";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly pocketed: number;
}

/** The public round summary on the ledger. design §5.2 step 5 */
export interface RoundResolved {
  readonly type: "roundResolved";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly haulDelta: number;
  readonly haul: number;
  readonly heatDelta: number;
  readonly heat: number;
}

/** Heat reached 100. The heist fails immediately. design §5.2 step 6, §7 */
export interface CopsRaided {
  readonly type: "copsRaided";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly heat: number;
}

// ---------------------------------------------------------------- alibis (§5.4)

/** A formal, possibly false, claim of where you were. */
export interface AlibiPosted {
  readonly type: "alibiPosted";
  readonly visibility: PublicVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly room: RoomId;
}

// ---------------------------------------------------------------- meetings (§11)

export interface MeetingProposed {
  readonly type: "meetingProposed";
  readonly visibility: PublicVisibility;
  readonly proposalId: string;
  readonly by: PlayerId;
  readonly act: ActNumber;
  readonly slot: string;
}

export interface MeetingProposalAccepted {
  readonly type: "meetingProposalAccepted";
  readonly visibility: PublicVisibility;
  readonly proposalId: string;
  readonly by: PlayerId;
}

/** Locked in by majority, or chosen by the server if nobody did (`proposalId: null`). design §11.1 */
export interface MeetingScheduled {
  readonly type: "meetingScheduled";
  readonly visibility: PublicVisibility;
  /** Named later by `advance { deadline: { kind: "openMeeting", meetingId } }`. */
  readonly meetingId: string;
  readonly act: ActNumber;
  readonly slot: string;
  readonly proposalId: string | null;
}

export interface EmergencyMeetingCalled {
  readonly type: "emergencyMeetingCalled";
  readonly visibility: PublicVisibility;
  readonly by: PlayerId;
  readonly meetingId: string;
}

export interface MeetingOpened {
  readonly type: "meetingOpened";
  readonly visibility: PublicVisibility;
  readonly meetingId: string;
  readonly kind: MeetingKind;
  readonly act: ActNumber;
}

/**
 * Only the voter knows what they sealed. Private in "open" and
 * "hiddenThenRevealed" modes; secret in "secret" mode, so it stays hidden even
 * at the reveal. design §11.2
 */
export interface VoteSealed {
  readonly type: "voteSealed";
  readonly visibility: PrivateVisibility | SecretVisibility;
  readonly player: PlayerId;
  readonly vote: VoteChoice;
}

/**
 * Public as it's cast in "open" mode, private to the voter in
 * "hiddenThenRevealed" mode, and secret (never shown to anyone else, even at
 * the reveal) in "secret" mode. design §11.2
 */
export interface VoteCast {
  readonly type: "voteCast";
  readonly visibility: PublicVisibility | PrivateVisibility | SecretVisibility;
  readonly meetingId: string;
  readonly player: PlayerId;
  readonly vote: VoteChoice;
  /** True when this ballot came from an earlier sealed vote. */
  readonly sealed: boolean;
}

export type MeetingResult =
  | { readonly kind: "shakedown"; readonly target: PlayerId }
  | { readonly kind: "skipped" }
  | { readonly kind: "noMajority" }
  | { readonly kind: "noQuorum" };

/**
 * The window closed. `ballots` is filled in "hiddenThenRevealed" and "open"
 * modes and is null in "secret" mode, where only the tally is shown. design §11.2
 */
export interface MeetingClosed {
  readonly type: "meetingClosed";
  readonly visibility: PublicVisibility;
  readonly meetingId: string;
  /** Weighted votes (Smooth talker) are counted here. Skips are kept apart so no player id can collide with them. */
  readonly tally: { readonly skip: number; readonly targets: Readonly<Record<PlayerId, number>> };
  readonly ballots: Readonly<Record<PlayerId, VoteChoice>> | null;
  readonly result: MeetingResult;
}

/**
 * Stash revealed and taken into the Haul; the Fence safe is untouched and not
 * shown. If the target was clean, the crew pays compensation. design §11.3
 */
export interface ShakedownResolved {
  readonly type: "shakedownResolved";
  readonly visibility: PublicVisibility;
  readonly meetingId: string;
  readonly target: PlayerId;
  readonly stashRevealed: number;
  readonly taken: number;
  readonly clean: boolean;
  readonly compensation: number;
}

/** design §11.4, §11.5 */
export interface CheckpointChecked {
  readonly type: "checkpointChecked";
  readonly visibility: PublicVisibility;
  readonly act: ActNumber;
  readonly target: number;
  readonly haul: number;
  readonly met: boolean;
  /** Heat added for a missed Act 1/2 checkpoint; 0 if met or final. */
  readonly heatPenalty: number;
}

// ---------------------------------------------------------------- end of game (§3, §13)

export interface RankEntry {
  readonly player: PlayerId;
  /** Stash after role scoring (e.g. Rookie ×1.2, Insider surplus). design §8 */
  readonly score: number;
  /** Final stash before role scoring, including any Fence safe. design §8 */
  readonly stash: number;
  /** Tie-break 1: fewer is better. design §3 */
  readonly timesShakenDown: number;
  /** Tie-break 2: more is better. Only revealed at the end. design §3 */
  readonly totalHandedIn: number;
}

export type Outcome =
  | {
      readonly result: "success";
      readonly ranking: readonly RankEntry[];
      readonly winners: readonly PlayerId[];
    }
  | {
      readonly result: "failed";
      readonly reason: "heat" | "target";
      /** Ranking of the losers, for bragging rights (design §19 open question 1). */
      readonly ranking: readonly RankEntry[];
      /** Players whose role wins on failure (Mole, Driver). Empty in starter games. */
      readonly winners: readonly PlayerId[];
    };

export interface GameEnded {
  readonly type: "gameEnded";
  readonly visibility: PublicVisibility;
  readonly outcome: Outcome;
}

// ---------------------------------------------------------------- union

export type GameEvent =
  | GameCreated
  | RngSeeded
  | RoomsSet
  | RoleDealt
  | RngAdvanced
  | RoundStarted
  | MoveSubmitted
  | DefaultMoveAssigned
  | LootSplit
  | AbilityResolved
  | RoomSighting
  | RoomWatched
  | PocketCount
  | RoundResolved
  | CopsRaided
  | AlibiPosted
  | MeetingProposed
  | MeetingProposalAccepted
  | MeetingScheduled
  | EmergencyMeetingCalled
  | MeetingOpened
  | VoteSealed
  | VoteCast
  | MeetingClosed
  | ShakedownResolved
  | CheckpointChecked
  | GameEnded;

export type GameEventType = GameEvent["type"];
export type EventOfType<T extends GameEventType> = Extract<GameEvent, { type: T }>;
