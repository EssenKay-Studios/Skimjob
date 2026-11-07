// Game events. The game *is* the event log; state is a fold over it. design §17.2
//
// Each event type fixes its own visibility in the type system, so an event that
// must stay secret (a dealt role, a real split) cannot be constructed as public.
// When you add an event type: add it to GameEvent, add a sample to
// `samples.ts`, and make sure viewFor() tests cover it (CLAUDE.md).
import type { DeckId, EventId, FailureReason, JobId, PerkId, RoleId, RoomId, TokenTrigger } from "@skimjob/content";
import type { ContentOverrides, DealStyle, PlayerId, PlayerSeat, RoleListSetting, VoteVisibility } from "./config";
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
  /** The deck preset. extension.md "Decks" */
  readonly deck: DeckId;
  readonly deal: DealStyle;
  readonly roleList: RoleListSetting;
  readonly eventsEnabled: boolean;
  readonly voteVisibility: VoteVisibility;
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

/** Rooms in play for this player count. design §3.1 */
export interface RoomsSet {
  readonly type: "roomsSet";
  readonly visibility: PublicVisibility;
  readonly rooms: readonly RoomId[];
}

/** The bank's starting pile of coins: coins per player × crew size. Public. design §6.1 */
export interface BankFilled {
  readonly type: "bankFilled";
  readonly visibility: PublicVisibility;
  readonly coins: number;
}

export interface RoleDealt {
  readonly type: "roleDealt";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly role: RoleId;
}

/**
 * The role list shown to players (extension.md "Host settings"): with "exact",
 * every role dealt (one entry per seat); with "possible", every role this game
 * could deal. Sorted in content order, so it never tells seats apart. Not
 * emitted when the list is hidden.
 */
export interface RoleListShown {
  readonly type: "roleListShown";
  readonly visibility: PublicVisibility;
  readonly list: "exact" | "possible";
  readonly roles: readonly RoleId[];
}

/** The shop's three perks, one per column, dealt at setup. extension.md "Tokens and the perk shop" */
export interface ShopDealt {
  readonly type: "shopDealt";
  readonly visibility: PublicVisibility;
  readonly perks: readonly PerkId[];
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

/**
 * Public: a player has locked in a move this round (their first `submitMove`
 * of the round; a later change emits nothing new). Never the room or split.
 * Owner decision (2 Nov): lock-ins are public. design §5.1
 */
export interface MoveLocked {
  readonly type: "moveLocked";
  readonly visibility: PublicVisibility;
  readonly player: PlayerId;
  readonly round: number;
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
 * The coins a player really grabbed this round and which bag each went into
 * (after any short-bank cut, design §3.2). In a raided room the police seize
 * the whole grab before the split: `seized` holds it and both bags are 0
 * (§5.3). Private to them; the full set becomes the per-round breakdown in
 * the reveal. design §3.2, §5.3, §18
 */
export interface CoinsGrabbed {
  readonly type: "coinsGrabbed";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly room: RoomId;
  readonly duffel: number;
  readonly pocket: number;
  readonly seized: number;
}

/** What a used power did. Move powers as submitted, plus what each instant power answered. design §8 */
export type ResolvedAbility =
  | AbilityUse
  /** Auditor: `room` came up `shortfall` short in `round` (its visitors' pockets; 0 if none). design §8 (v2 §2) */
  | { readonly kind: "audit"; readonly round: number; readonly room: RoomId; readonly shortfall: number }
  /**
   * Detective: whether `target`'s stash is at or above `threshold`, the current act's clean threshold. design §8 (v2 §2)
   */
  | { readonly kind: "checkStash"; readonly target: PlayerId; readonly threshold: number; readonly dirty: boolean }
  /** Priest: `target` is blessed for `act` (a clean shakedown of them that act is paid by the bank). design §8 (v2 §2) */
  | { readonly kind: "bless"; readonly target: PlayerId; readonly act: ActNumber };

/** An ability took effect. Private to its user; `round` is the latest round started. design §8 */
export interface AbilityResolved {
  readonly type: "abilityResolved";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly ability: ResolvedAbility;
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

/** Everyone seen in a watched room, via Security, the Lookout power or a Tail perk. design §6.1, §8, §8.3 */
export interface RoomWatched {
  readonly type: "roomWatched";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly source: "security" | "lookout" | "tail";
  readonly room: RoomId;
  readonly seen: readonly PlayerId[];
  /**
   * "Camera offline": a Hacker's loop blinded this feed (`seen`
   * is empty). extension.md "Situations"
   */
  readonly offline: boolean;
}

/** The public round summary on the ledger. design §5.2 step 5 */
export interface RoundResolved {
  readonly type: "roundResolved";
  readonly visibility: PublicVisibility;
  readonly round: number;
  /** Coins left in the bank after this round's grabs: public. design §6.1 */
  readonly bank: number;
  readonly haulDelta: number;
  readonly haul: number;
}

/**
 * design §5.2 (§4.2 step 2): the round's rings have lit their bulbs. `bells`
 * is every open room's lit bulbs now (at most the bell's size; a taped-off
 * room's bell is off, so it isn't listed). Public through the fact catalogue
 * (§19 seam 1).
 */
export interface BellsRung {
  readonly type: "bellsRung";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly bells: Readonly<Record<RoomId, number>>;
}

/**
 * design §5.3 (§4.2 step 3): `room`'s last bulb lit. Its visitors' grabs
 * (`seized` coins in all) left the game, it is taped off through round
 * `closedThrough` with its bell off, and Wanted is now `wanted`. Public; it
 * never says who was inside.
 */
export interface RoomRaided {
  readonly type: "roomRaided";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly room: RoomId;
  readonly seized: number;
  readonly closedThrough: number;
  readonly wanted: number;
}

/**
 * design §5.6 (§4.2 step 6): every room turned off a bulb, then each Rooftop
 * player cooled the hottest. `bells` is every open room's lit bulbs after it.
 * Public.
 */
export interface BellsCooled {
  readonly type: "bellsCooled";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly bells: Readonly<Record<RoomId, number>>;
}

/**
 * design §5.3, §11.1: a Fixer tore the tape off `room` in `round`; it is open
 * again from the next round, its bell at 0. Public, without a name.
 */
export interface RoomReopened {
  readonly type: "roomReopened";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly room: RoomId;
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

/**
 * A formal, possibly false, claim of your role (design §8, §12.1): public talk
 * that changes no rule. Once per player per act (`act`, the act it was made in).
 */
export interface RoleClaimed {
  readonly type: "roleClaimed";
  readonly visibility: PublicVisibility;
  readonly player: PlayerId;
  readonly role: RoleId;
  readonly act: ActNumber;
}

/** The alibi deadline for `round` passed: no more alibis for it. design §5.4 */
export interface AlibisClosed {
  readonly type: "alibisClosed";
  readonly visibility: PublicVisibility;
  readonly round: number;
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
 * Stash revealed and taken into the Haul. If the target was clean, the crew pays compensation. design §11.3
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
 * (`advance { resolveShakedown }`), unless a Shield cancels it. Only opened
 * when the shop holds the Shield. design §8.3, §11.3
 */
export interface ShakedownPending {
  readonly type: "shakedownPending";
  readonly visibility: PublicVisibility;
  readonly meetingId: string;
  readonly kind: MeetingKind;
  readonly act: ActNumber;
  readonly target: PlayerId;
}

/** A Shield blocked the shakedown. design §8.3 */
export interface ShakedownCancelled {
  readonly type: "shakedownCancelled";
  readonly visibility: PublicVisibility;
  readonly meetingId: string;
  readonly target: PlayerId;
}

/**
 * The shakedown of `target` was clean and they were blessed this act: the
 * bank pays their compensation, so `amount` goes back into the Haul. It
 * doesn't say who blessed them. design §8 (v2 §2: Priest)
 */
export interface BlessingPaid {
  readonly type: "blessingPaid";
  readonly visibility: PublicVisibility;
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
}

// ---------------------------------------------------------------- perks (§8.3)

/** Your role earned you one token, for `trigger`. Only you are told. extension.md "Tokens and the perk shop" */
export interface TokenEarned {
  readonly type: "tokenEarned";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly trigger: TokenTrigger;
}

/** You bought `perk` from the shop for `cost` tokens. Private until used. extension.md "Tokens and the perk shop" */
export interface PerkBought {
  readonly type: "perkBought";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly perk: PerkId;
  readonly cost: number;
}

/** What a spent perk did. `kind` is the perk spent. design §8.3 */
export type ResolvedPerk =
  /** `role` is `target`'s role when it was spent. */
  | { readonly kind: "peek"; readonly target: PlayerId; readonly role: RoleId }
  /** Spent by itself: the shakedown of you in `meetingId` was cancelled (the ledger says only that it was). */
  | { readonly kind: "shield"; readonly meetingId: string }
  | { readonly kind: "extraVote"; readonly meetingId: string }
  /** You see `target`'s ballot in `meetingId` while it's open (in your view, not in an event). */
  | { readonly kind: "ballot"; readonly meetingId: string; readonly target: PlayerId }
  /** `room`'s visitors this round come as a `roomWatched` (source "tail") when it resolves. */
  | { readonly kind: "tail"; readonly room: RoomId }
  /** Your true alibi for `round` was stamped (`alibiVerified`). */
  | { readonly kind: "alibi"; readonly round: number; readonly room: RoomId }
  | { readonly kind: "recharge" }
  /** The cards you may pick from for `round`'s flip; the first flips unless you pick (`rigPicked`). */
  | { readonly kind: "rig"; readonly round: number; readonly cards: readonly EventId[] }
  /** Spent by calling `meetingId`, an emergency meeting beyond your one per game (Smooth Talker's reward). */
  | { readonly kind: "emergency"; readonly meetingId: string };

/** You spent a perk token. Private to you; `round` is the latest round started. design §8.3 */
export interface PerkUsed {
  readonly type: "perkUsed";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly perk: ResolvedPerk;
}

/** Your Rig's choice for `round`'s card (changeable until that round starts). design §8.3 */
export interface RigPicked {
  readonly type: "rigPicked";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly card: EventId;
}

/** Alibi perk: the app stamps `player`'s alibi for `round` (their real room) as Verified. design §8.3, §5.4 */
export interface AlibiVerified {
  readonly type: "alibiVerified";
  readonly visibility: PublicVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly room: RoomId;
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
  /** The final stash; a whole number. extension.md "Winning and losing" */
  readonly score: number;
  /** Final stash. design §8 */
  readonly stash: number;
  /** Tie-break 1: fewer is better. design §3 */
  readonly timesShakenDown: number;
  /** Tie-break 2: more is better. Only revealed at the end. design §3 */
  readonly totalHandedIn: number;
}

/**
 * extension.md "Winning and losing": one crew. The top group is everyone level
 * with the first place after the tie-breaks. A success is won by the top
 * group; a failure by the top-group members whose role (as it is at the end)
 * wins that ending (`RoleDef.winsOn`), and by nobody otherwise. The full
 * ranking is always kept, shown as a loss unless someone qualified.
 */
export type Outcome =
  | {
      readonly result: "success";
      readonly ranking: readonly RankEntry[];
      readonly winners: readonly PlayerId[];
    }
  | {
      readonly result: "failed";
      readonly reason: Exclude<FailureReason, "bust">;
      readonly ranking: readonly RankEntry[];
      readonly winners: readonly PlayerId[];
    }
  /**
   * design §5.5: Wanted reached the bust line. Only `escapees` (on the Rooftop
   * that round) get away; `winners` are the escapees tied for the biggest stash
   * among them, any role, and nobody if nobody escaped.
   */
  | {
      readonly result: "failed";
      readonly reason: "bust";
      readonly escapees: readonly PlayerId[];
      readonly ranking: readonly RankEntry[];
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
  | BankFilled
  | RoleDealt
  | RoleListShown
  | ShopDealt
  | RngAdvanced
  | RoundStarted
  | MoveLocked
  | MoveSubmitted
  | DefaultMoveAssigned
  | CoinsGrabbed
  | AbilityResolved
  | RoomSighting
  | RoomWatched
  | RoundResolved
  | BellsRung
  | RoomRaided
  | BellsCooled
  | RoomReopened
  | EventFlipped
  | InsideTip
  | AuditReport
  | AlibiPosted
  | AlibisClosed
  | RoleClaimed
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
  | BlessingPaid
  | CheckpointChecked
  | TokenEarned
  | PerkBought
  | PerkUsed
  | RigPicked
  | AlibiVerified
  | GameEnded;

export type GameEventType = GameEvent["type"];
export type EventOfType<T extends GameEventType> = Extract<GameEvent, { type: T }>;
