// Game events. The game *is* the event log; state is a fold over it. design §17.2
//
// Each event type fixes its own visibility in the type system, so an event that
// must stay secret (a dealt role, a real split) cannot be constructed as public.
// When you add an event type: add it to GameEvent, add a sample to
// `samples.ts`, and make sure viewFor() tests cover it (CLAUDE.md).
import type { EventId, FailureReason, JobId, RoleId, RoomId } from "@skimjob/content";
import type { ContentOverrides, MoleSetting, PlayerId, PlayerSeat, VoteVisibility } from "./config";
import type { AbilityUse, Move, VoteChoice } from "./commands";
import type { PrivateVisibility, PublicVisibility, RevealVisibility, SecretVisibility } from "./visibility";
import type { RoleState } from "./state";

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
  /** Duel mode: call-outs instead of meetings and votes. design §16.1 */
  readonly duel: boolean;
  /** `CONTENT_VERSION` the game was set up with, so an old log can be replayed against the right numbers. design §17.4 */
  readonly contentVersion: string;
  /** The config's content overrides (public: they are the rules everyone plays by), or null. design §17.4 */
  readonly contentOverrides: ContentOverrides | null;
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

/** The Snitch's secret target, drawn at setup from the other players. design §8 */
export interface SnitchTargetAssigned {
  readonly type: "snitchTargetAssigned";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly target: PlayerId;
}

/**
 * design §8.1: when two Moles are dealt, each is told privately who the other
 * is (`allies`: the other Moles). Not sent to a lone Mole.
 */
export interface MoleAllies {
  readonly type: "moleAllies";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly allies: readonly PlayerId[];
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

/**
 * What a used power did. Move powers as submitted (the Fence's `amount` is
 * what actually moved), plus the Blackmailer's verdict and the Muscle's cancel.
 * design §8
 */
export type ResolvedAbility =
  | Exclude<AbilityUse, { readonly kind: "blackmail" | "tipOff" }>
  /** `stolen` is 0 for a wrong guess, and at most what the target's stash held for a right one. */
  | { readonly kind: "blackmail"; readonly target: PlayerId; readonly role: RoleId; readonly correct: boolean; readonly stolen: number }
  /** Muscle: the pending shakedown of `meetingId` will be cancelled when its window ends. design §11.3 */
  | { readonly kind: "cancelShakedown"; readonly meetingId: string; readonly target: PlayerId }
  /** Mole: the tip-off added `heat` to this round's Heat. Nobody else is told; it's inside the round's total. design §8 */
  | { readonly kind: "tipOff"; readonly heat: number };

/** An ability took effect. Private to its user; `round` is the latest round started. design §8 */
export interface AbilityResolved {
  readonly type: "abilityResolved";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly ability: ResolvedAbility;
}

/**
 * Blackmail: someone guessed your role and took `stolen` from your stash.
 * Only sent when something was taken; it doesn't say who. design §8
 */
export interface Blackmailed {
  readonly type: "blackmailed";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly stolen: number;
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

// ---------------------------------------------------------------- events deck (§10)

/**
 * The round's event card, flipped for everyone at the start of the round
 * (from round 2, when events are on). `room` is the room Lockdown closes, else null. design §10
 */
export interface EventFlipped {
  readonly type: "eventFlipped";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly card: EventId;
  readonly room: RoomId | null;
}

/** Double-cross: you and `partner` are offered a role swap this round. Sent to each of the two. design §10 */
export interface DoubleCrossOffered {
  readonly type: "doubleCrossOffered";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly partner: PlayerId;
}

/** Your (changeable until the round deadline) answer to a Double-cross offer. design §10 */
export interface DoubleCrossAnswered {
  readonly type: "doubleCrossAnswered";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly accept: boolean;
}

/**
 * Double-cross outcome at the round's resolution, to each of the two. `swap`
 * is null unless both accepted; then it is your new role and its uses so far
 * (they travel with the role card). design §10, §5.2 step 1
 */
export interface DoubleCrossResolved {
  readonly type: "doubleCrossResolved";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly partner: PlayerId;
  readonly swap: { readonly role: RoleId; readonly roleState: RoleState } | null;
}

/** Raid rumour: you had the biggest stash and lost `lost` from it. Only you are told. design §10 */
export interface RaidRumourHit {
  readonly type: "raidRumourHit";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly lost: number;
}

/** Inside tip: you learn `subject`'s role. design §10 */
export interface InsideTip {
  readonly type: "insideTip";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly subject: PlayerId;
  readonly role: RoleId;
}

/** Audit: the round's shortfall (loot pocketed) per room in play, 0 where none. design §10 */
export interface AuditReport {
  readonly type: "auditReport";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly shortfalls: Readonly<Record<RoomId, number>>;
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
  /**
   * One per ballot. The Smooth talker's extra weight decides `result` but is
   * not shown here, so the tally never singles them out next to public
   * ballots (provisional). Skips are kept apart so no player id can collide with them.
   */
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

/**
 * The vote passed a shakedown on `target`; it is applied when the window ends
 * (`advance { resolveShakedown }`), unless the Muscle cancels it. Only opened
 * when the role pool holds the Muscle. design §8, §11.3
 */
export interface ShakedownPending {
  readonly type: "shakedownPending";
  readonly visibility: PublicVisibility;
  readonly meetingId: string;
  readonly kind: MeetingKind;
  readonly act: ActNumber;
  readonly target: PlayerId;
}

/** The Muscle blocked the shakedown. It doesn't say who did. design §8 */
export interface ShakedownCancelled {
  readonly type: "shakedownCancelled";
  readonly visibility: PublicVisibility;
  readonly meetingId: string;
  readonly target: PlayerId;
}

/** The Snitch's target was shaken down and wasn't clean: `amount` goes into the Snitch's stash. design §8 */
export interface SnitchPaid {
  readonly type: "snitchPaid";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly meetingId: string;
  readonly target: PlayerId;
  readonly amount: number;
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

// ---------------------------------------------------------------- Duel mode (§16.1)

/**
 * A Duel player called out their opponent for this act. Private until the
 * act's last round resolves, when `callOutResolved` settles it. design §16.1
 */
export interface CallOutMade {
  readonly type: "callOutMade";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly act: ActNumber;
}

/**
 * design §16.1, at the end of the act (before the checkpoint): if `target`
 * pocketed anything this act (`caught`), `amount` moves from their stash to
 * the caller's (everything they pocketed this act, capped by the stash; never
 * the Fence safe); otherwise `amount` (the job's wrong-call-out × act, capped
 * by the caller's stash) moves from the caller to `target`.
 */
export interface CallOutResolved {
  readonly type: "callOutResolved";
  readonly visibility: PublicVisibility;
  readonly act: ActNumber;
  readonly caller: PlayerId;
  readonly target: PlayerId;
  readonly caught: boolean;
  readonly amount: number;
}

// ---------------------------------------------------------------- end of game (§3, §13)

/**
 * One player's line in the final ranking, which the reveal shows (design §13).
 * Ranked by score, then fewer shakedowns, then more handed in, then seat order.
 */
export interface RankEntry {
  readonly player: PlayerId;
  /** Revealed at the end. design §13 */
  readonly role: RoleId;
  /** Stash after role scoring (e.g. Rookie ×1.2, Insider surplus), rounded to SCORE_DECIMALS. design §8 */
  readonly score: number;
  /** Final stash before role scoring, including any Fence safe. design §8 */
  readonly stash: number;
  /** The part of `stash` hidden in the Fence safe (0 for other roles). design §8 */
  readonly safe: number;
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
      readonly reason: FailureReason;
      /**
       * "Best of the losers": the same ranking, shown as a loss. Nobody wins by
       * it (design §19.1, provisional).
       */
      readonly ranking: readonly RankEntry[];
      /** Players whose role wins on failure (`RoleDef.winsOnFailure`: Mole, Driver). Empty in starter games. */
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
  | SnitchTargetAssigned
  | MoleAllies
  | RngAdvanced
  | RoundStarted
  | MoveSubmitted
  | DefaultMoveAssigned
  | LootSplit
  | AbilityResolved
  | Blackmailed
  | RoomSighting
  | RoomWatched
  | PocketCount
  | RoundResolved
  | CopsRaided
  | EventFlipped
  | DoubleCrossOffered
  | DoubleCrossAnswered
  | DoubleCrossResolved
  | RaidRumourHit
  | InsideTip
  | AuditReport
  | AlibiPosted
  | MeetingProposed
  | MeetingProposalAccepted
  | MeetingScheduled
  | EmergencyMeetingCalled
  | MeetingOpened
  | VoteSealed
  | VoteCast
  | MeetingClosed
  | ShakedownPending
  | ShakedownCancelled
  | ShakedownResolved
  | SnitchPaid
  | CheckpointChecked
  | CallOutMade
  | CallOutResolved
  | GameEnded;

export type GameEventType = GameEvent["type"];
export type EventOfType<T extends GameEventType> = Extract<GameEvent, { type: T }>;
