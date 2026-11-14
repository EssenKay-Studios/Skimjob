// Game events. The game *is* the event log; state is a fold over it. design §17.2
//
// Each event type fixes its own visibility in the type system, so an event that
// must stay secret (a dealt role, a real split) cannot be constructed as public.
// When you add an event type: add it to GameEvent, add a sample to
// `samples.ts`, and make sure viewFor() tests cover it (CLAUDE.md).
import type { EventId, JobId, PerkId, RoleId, RoomId, RulesetId } from "@skimjob/content";
import type { ContentOverrides, PlayerId, PlayerSeat, RoleListSetting, VoteVisibility } from "./config";
import type { AbilityUse, AlibiMark, Move, PerkUse, VoteChoice } from "./commands";
import type { PrivateVisibility, PublicVisibility, RevealVisibility, SecretVisibility } from "./visibility";
import type { RoleState } from "./state";

/**
 * A regular meeting each time a third of the bank is gone (§9.1), a police
 * briefing after a raid (§9.2), or an emergency from the crew's pool (§9.3).
 */
export type MeetingKind = "regular" | "briefing" | "emergency";

// ---------------------------------------------------------------- setup (§8.1, §6.2)

/** Public game setup. Deliberately excludes the seed. */
export interface GameCreated {
  readonly type: "gameCreated";
  readonly visibility: PublicVisibility;
  readonly players: readonly PlayerSeat[];
  readonly job: JobId;
  /** The game's ruleset (public: the content everyone plays). design §19.2 seam 3 */
  readonly ruleset: RulesetId;
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
 * The role list shown to players (design §11.3): with "exact", every role
 * dealt (one entry per seat, so a repeated role shows its count); with
 * "possible", every role this game could deal. Sorted in content order, so it
 * never tells seats apart. Not emitted when the list is hidden.
 */
export interface RoleListShown {
  readonly type: "roleListShown";
  readonly visibility: PublicVisibility;
  readonly list: "exact" | "possible";
  readonly roles: readonly RoleId[];
}

/** The black market's three perks, one per tier, dealt at setup with the game's seed. design §12 */
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

/**
 * Missed the deadline: Lobby, hand everything in; `null` when the Lobby is taped off and the
 * player sits the round out (owner, 7 Nov). design §3.3
 */
export interface DefaultMoveAssigned {
  readonly type: "defaultMoveAssigned";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly move: Move | null;
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

/** What a used power did: move powers as submitted, plus what a power learned. design §11.1 */
export type ResolvedAbility =
  | Exclude<AbilityUse, { readonly kind: "hide" | "absolve" }>
  /** Hacker: `room`'s bell, hidden from everyone else, really shows `bulbs` (null: raided, its bell is off). */
  | { readonly kind: "hide"; readonly room: RoomId; readonly bulbs: number | null }
  /** Priest: `taken` coins set aside from `target`'s stash (null: a bust ended the game first, §11.1). */
  | { readonly kind: "absolve"; readonly target: PlayerId; readonly taken: number | null }
  /** Auditor: `duffel` coins reached the duffel from `room` in `round`. */
  | { readonly kind: "audit"; readonly round: number; readonly room: RoomId; readonly duffel: number }
  /** Detective: `target` grabbed `grabbed` coins in `round` (seized ones included; not how many they kept). */
  | { readonly kind: "detect"; readonly round: number; readonly target: PlayerId; readonly grabbed: number };

/** An ability took effect. Private to its user; `round` is the latest round started. design §11 */
export interface AbilityResolved {
  readonly type: "abilityResolved";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly ability: ResolvedAbility;
}

/**
 * design §11.4: another copy of your role already did this to the same target
 * this round ("already done this round"), so your use had no effect and is not
 * spent. Private to you.
 */
export interface AbilityAlreadyDone {
  readonly type: "abilityAlreadyDone";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly ability: AbilityUse;
}

/**
 * design §11.1 Priest: "your sins were absolved". `taken` coins (what you held
 * above the share, maybe 0) left your stash and are set aside in the duffel for
 * the next split (§7.1). Private to the absolved player.
 */
export interface SinsAbsolved {
  readonly type: "sinsAbsolved";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly taken: number;
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

/**
 * Everyone seen in a watched room, via Security, the Lookout power or a Tail
 * perk; a player put there by Plant evidence shows too. design §3.4, §11.1, §12
 */
export interface RoomWatched {
  readonly type: "roomWatched";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly source: "security" | "lookout" | "tail";
  readonly room: RoomId;
  readonly seen: readonly PlayerId[];
  /**
   * "Cameras offline": the room is blacked out this round, or the watcher sits in a blacked-out
   * Security (owner, 8 Nov), so `seen` is empty. design §11.1
   */
  readonly offline: boolean;
}

/** Honesty's two counts over the whole game: coins that reached the duffel and coins taken from the bank (seized ones left out). design §7.5 */
export interface Honesty {
  readonly reached: number;
  readonly taken: number;
}

/**
 * design §4.2 step 7, §7.4, §7.5: the public round summary on the ledger.
 * Public through the fact catalogue (§19 seam 1); it never says who pocketed.
 */
export interface RoundResolved {
  readonly type: "roundResolved";
  readonly visibility: PublicVisibility;
  readonly round: number;
  /** Coins left in the bank after this round's grabs. design §6.1 */
  readonly bank: number;
  /** Coins taken from the bank this round, seized ones left out. design §7.4 */
  readonly taken: number;
  /** "N coins went missing": `taken` less the coins handed in this round. design §7.4 */
  readonly missing: number;
  /** Honesty so far, after this round's split. design §7.5 */
  readonly honesty: Honesty;
}

/**
 * design §4.2 step 5, §7.1–§7.3: the duffel (this round's hand-ins, the coins
 * set aside since the last split and the kitty) split equally among all
 * players: each gets `cut` (this round's cut), the change that doesn't divide
 * evenly is the new `kitty`, and `share` is the share after it. No split on a
 * bust (§5.5). Public through the fact catalogue (§19 seam 1).
 */
export interface DuffelSplit {
  readonly type: "duffelSplit";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly handedIn: number;
  readonly setAside: number;
  /** The kitty carried into this split. */
  readonly kittyIn: number;
  readonly cut: number;
  readonly kitty: number;
  readonly share: number;
}

/**
 * design §5.2 (§4.2 step 2): the round's rings have lit their bulbs. `bells`
 * is every open room's lit bulbs now (at most the bell's size; a taped-off
 * room's bell is off, so it isn't listed), except the `hidden` rooms, whose
 * bells a Hacker hid this round (§5.1, §11.1): they show "?". Public through
 * the fact catalogue (§19 seam 1).
 */
export interface BellsRung {
  readonly type: "bellsRung";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly bells: Readonly<Record<RoomId, number>>;
  readonly hidden: readonly RoomId[];
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
 * player cooled the hottest. `bells` is every open room's lit bulbs after it,
 * except this round's hidden bells (§11.1). Public.
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

/**
 * design §11.1 Electrician: "Power cut in the `room`", announced as `round`
 * starts, with no source. Nobody there sees who else is there this round, and
 * its cameras are offline; its bell still rings. Public.
 */
export interface PowerCut {
  readonly type: "powerCut";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly room: RoomId;
}

// ---------------------------------------------------------------- events deck (§13)

/**
 * The round's event card, flipped for everyone at the start of the round
 * (from round 2, a 4-in-10 chance, when events are on). `room` is the room Lockdown closes, else null. design §13
 */
export interface EventFlipped {
  readonly type: "eventFlipped";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly card: EventId;
  readonly room: RoomId | null;
}

/** Inside tip: you learn `subject`'s role as the card flips. design §13 */
export interface InsideTip {
  readonly type: "insideTip";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly subject: PlayerId;
  readonly role: RoleId;
}

/** Audit: the coins that reached the duffel from each room in play this round, 0 where none. design §13 */
export interface AuditReport {
  readonly type: "auditReport";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly duffel: Readonly<Record<RoomId, number>>;
}

// ---------------------------------------------------------------- said (§10, §11.3, §19.2 seam 5)

/** What a player said: talk that changes no rule, possibly false. */
export type Statement =
  /** "I was in the `room` in round `round`", posted in its alibi window (design §10). */
  | { readonly kind: "alibi"; readonly player: PlayerId; readonly round: number; readonly room: RoomId }
  /** "I'm the `role`" (design §11.3 Claims), once per player per stretch (`stretch`, the one it was made in, §9.1). */
  | { readonly kind: "role"; readonly player: PlayerId; readonly role: RoleId; readonly stretch: number };

/** design §19.2 seam 5: every player statement is one public "said" event. design §18 */
export interface Said {
  readonly type: "said";
  readonly visibility: PublicVisibility;
  readonly statement: Statement;
}

// ---------------------------------------------------------------- meetings (§11)

export interface MeetingProposed {
  readonly type: "meetingProposed";
  readonly visibility: PublicVisibility;
  readonly proposalId: string;
  readonly by: PlayerId;
  readonly slot: string;
}

export interface MeetingProposalAccepted {
  readonly type: "meetingProposalAccepted";
  readonly visibility: PublicVisibility;
  readonly proposalId: string;
  readonly by: PlayerId;
}

/**
 * The next regular meeting or briefing's slot, locked in by majority or chosen
 * by the server if nobody did (`proposalId: null`). design §9.4
 */
export interface MeetingScheduled {
  readonly type: "meetingScheduled";
  readonly visibility: PublicVisibility;
  /** Named later by `advance { deadline: { kind: "openMeeting", meetingId } }`. */
  readonly meetingId: string;
  readonly slot: string;
  readonly proposalId: string | null;
}

/** `by` spent one of the crew's emergency meetings (§9.3): public, with the caller named. */
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
   * One per ballot. The Smooth Talker's extra weight decides `result` but is
   * not shown here, so the tally never singles them out next to public
   * ballots (provisional). Skips are kept apart so no player id can collide with them.
   */
  readonly tally: { readonly skip: number; readonly targets: Readonly<Record<PlayerId, number>> };
  readonly ballots: Readonly<Record<PlayerId, VoteChoice>> | null;
  readonly result: MeetingResult;
}

/**
 * The stash is revealed; what the target holds above the share is `taken` and set aside in the duffel
 * for the next split (§7.1). A target at or below the share is `clean`: nothing is taken. The target
 * is protected until the next regular meeting (§9.7). design §9.6
 */
export interface ShakedownResolved {
  readonly type: "shakedownResolved";
  readonly visibility: PublicVisibility;
  readonly meetingId: string;
  readonly target: PlayerId;
  readonly stashRevealed: number;
  readonly taken: number;
  readonly clean: boolean;
}

/**
 * The vote passed a shakedown on `target`; the Bail choice window is open
 * until `advance { resolveShakedown }`. Opened after every passed shakedown
 * when Bail is in this game's shop, so it never tells who holds one. design §9.6, §12
 */
export interface ShakedownPending {
  readonly type: "shakedownPending";
  readonly visibility: PublicVisibility;
  readonly meetingId: string;
  readonly kind: MeetingKind;
  readonly target: PlayerId;
}

/**
 * "A shakedown fell through": its target used Bail, the stash stays closed and
 * the Bail is spent; the target is still protected (§9.7). design §9.6, §12
 */
export interface ShakedownCancelled {
  readonly type: "shakedownCancelled";
  readonly visibility: PublicVisibility;
  readonly meetingId: string;
  readonly target: PlayerId;
}

// ---------------------------------------------------------------- perks (§12)

/**
 * "Someone bought `perk` (`cost` coins)", without a name: each of the round's
 * purchases, all together as planning closes, in the black market's order. design §12, §18
 */
export interface PerkSold {
  readonly type: "perkSold";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly perk: PerkId;
  readonly cost: number;
}

/**
 * You bought and used `perk` for `cost` coins from your stash (they leave the
 * game) in `round`; Bail is held instead. Private until the reveal. design §12
 */
export interface PerkBought {
  readonly type: "perkBought";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly perk: PerkUse;
  readonly cost: number;
}

/** Your Bail choice for the shakedown of you in `meetingId`; the latest counts when the window closes. Private. design §9.6 */
export interface BailChosen {
  readonly type: "bailChosen";
  readonly visibility: PrivateVisibility;
  readonly player: PlayerId;
  readonly meetingId: string;
  readonly use: boolean;
}

/**
 * design §10: `round`'s alibi window closed. Everyone who played the round and posted no alibi is
 * shown in the room they were really in, as a fact (seat order). Public.
 */
export interface AlibiWindowClosed {
  readonly type: "alibiWindowClosed";
  readonly visibility: PublicVisibility;
  readonly round: number;
  readonly noAlibi: readonly { readonly player: PlayerId; readonly room: RoomId }[];
}

/**
 * design §10: `player` marked `target`'s alibi for `round` Trusted or Liar, or cleared it (null).
 * Only the marker ever sees it, even after the game (so it is secret, not private, which opens at the reveal).
 */
export interface AlibiMarked {
  readonly type: "alibiMarked";
  readonly visibility: SecretVisibility;
  readonly player: PlayerId;
  readonly round: number;
  readonly target: PlayerId;
  readonly mark: AlibiMark | null;
}

// ---------------------------------------------------------------- end of game (§3, §13)

/**
 * One player's line in the final ranking, which the reveal shows (design §8.6, §15.5).
 * Ranked by stash; equal stashes keep seat order, with no tie-break (§8.5).
 */
export interface RankEntry {
  readonly player: PlayerId;
  /** Revealed at the end. design §13 */
  readonly role: RoleId;
  /** Final stash. design §7.6, §8 */
  readonly stash: number;
}

/**
 * design §8: the top group is everyone tied for the biggest stash (§8.5). A
 * success (bank or round cap, honesty at or above the line, §8.1) is won by the
 * top group, the whole crew when every stash is equal (§8.2); a heist sunk by
 * theft (§8.4) by the players whose role handler wins it (the Mole and the
 * Fixer, §11.1), and by nobody otherwise. The full ranking is always kept,
 * shown as a loss unless someone won (§8.6).
 */
export type Outcome =
  | {
      readonly result: "success";
      readonly ranking: readonly RankEntry[];
      readonly winners: readonly PlayerId[];
      /** The kitty and any unsplit duffel, paid for the getaway car: they leave the game. design §6.3 */
      readonly getaway: number;
    }
  | {
      readonly result: "failed";
      readonly reason: "theft";
      readonly ranking: readonly RankEntry[];
      readonly winners: readonly PlayerId[];
      /** As on a success. design §6.3 */
      readonly getaway: number;
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

/** design §6.2, §16: the host ended the game early. Nobody wins, nothing is scored and there is no reveal. */
export interface GameAborted {
  readonly type: "gameAborted";
  readonly visibility: PublicVisibility;
}

export interface GameEnded {
  readonly type: "gameEnded";
  readonly visibility: PublicVisibility;
  readonly outcome: Outcome;
}

// ---------------------------------------------------------------- union

export type GameEvent =
  | GameCreated
  | GameAborted
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
  | AbilityAlreadyDone
  | SinsAbsolved
  | RoomSighting
  | RoomWatched
  | RoundResolved
  | DuffelSplit
  | BellsRung
  | RoomRaided
  | BellsCooled
  | RoomReopened
  | PowerCut
  | EventFlipped
  | InsideTip
  | AuditReport
  | Said
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
  | PerkSold
  | PerkBought
  | BailChosen
  | AlibiWindowClosed
  | AlibiMarked
  | GameEnded;

export type GameEventType = GameEvent["type"];
export type EventOfType<T extends GameEventType> = Extract<GameEvent, { type: T }>;
