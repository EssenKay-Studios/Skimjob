// Commands in, events out. design §17.2
//
// Player commands are what a client (human or bot) sends. System commands are
// sent by the server scheduler or the simulator: the engine has no clock, so it
// never decides by itself that time is up or picks a meeting time.
import type { EventId, RoleId, RoomId } from "@skimjob/content";
import type { PlayerId } from "./config";
import type { ActNumber } from "./events";

/** Role powers used as part of a move. Grows as roles are added. design §8 */
export type AbilityUse =
  /**
   * Lookout: also see who was in these rooms this round. 1 to the role's
   * `extraRooms` (content) distinct rooms in play.
   */
  | { readonly kind: "lookout"; readonly rooms: readonly RoomId[] }
  /**
   * Fence: move loot from stash into the hidden safe after this round's split.
   * Submitted: 1 to what is left of the per-act cap (content). Resolved
   * (`abilityResolved`): what actually moved, capped by the stash.
   */
  | { readonly kind: "fenceSafe"; readonly amount: number }
  /** Hacker: Security shows `room` as empty this round. Once per act (content). design §8 */
  | { readonly kind: "loopCameras"; readonly room: RoomId }
  /** Blackmailer: guess `target`'s role; if right, steal from their stash this round. Once per act (content). design §8 */
  | { readonly kind: "blackmail"; readonly target: PlayerId; readonly role: RoleId }
  /** Mole: tip off the cops, adding the role's Heat (content) to this round's total. Once per act (content). design §7, §8 */
  | { readonly kind: "tipOff" };

/**
 * Spending a perk token (design §8.3, docs/roles-v2.md §1), with `useAbility`.
 * The Shield isn't here: it is spent by itself when a shakedown on you passes.
 * - peek: learn `target`'s role now.
 * - extraVote: your ballot in the open meeting weighs +1 (once per meeting).
 * - ballot: see `target`'s ballot in the open meeting, as it changes (also in Secret mode).
 * - tail: while planning, also see who is in `room` when this round resolves.
 * - alibi: your alibi for the latest resolved round, if true, is stamped Verified (public).
 * - recharge: your power's uses this act / one use this game come back.
 * - rig: draw two cards for the next round; `rigPick` chooses one (the first if you don't).
 */
export type PerkSpend =
  | { readonly kind: "peek"; readonly target: PlayerId }
  | { readonly kind: "extraVote" }
  | { readonly kind: "ballot"; readonly target: PlayerId }
  | { readonly kind: "tail"; readonly room: RoomId }
  | { readonly kind: "alibi" }
  | { readonly kind: "recharge" }
  | { readonly kind: "rig" }
  /** Not a spend: choose which of your Rig's cards flips next; changeable until that round starts. */
  | { readonly kind: "rigPick"; readonly card: EventId };

/**
 * Role powers and perks used outside a move, with `useAbility`. design §17.2
 * Muscle: cancel the shakedown that is pending (between the vote passing and
 * the shakedown being applied). Once per game (content). design §8, §11.3
 */
export type InstantAbility = { readonly kind: "cancelShakedown" } | PerkSpend;

/**
 * One player's secret move for a round. design §5.1
 *
 * The split is expressed as how much to *pocket*; everything else goes to the
 * Haul. The room's actual yield can change after submission (shared Deposit
 * boxes, events), so pocket is clamped to the real yield at resolution, and
 * "hand everything in" is simply `pocket: 0`. See docs/decisions.md.
 */
export interface Move {
  readonly room: RoomId;
  readonly pocket: number;
  /** Required when `room` is a watcher room (Security): which room to watch. design §6.1 */
  readonly watch?: RoomId;
  readonly ability?: AbilityUse;
}

/** A vote in a crew meeting: shake someone down, or skip. design §11.2 */
export type VoteChoice =
  | { readonly kind: "shakedown"; readonly target: PlayerId }
  | { readonly kind: "skip" };

export type PlayerCommand =
  | { readonly type: "submitMove"; readonly player: PlayerId; readonly move: Move }
  /** Claim (truthfully or not) which room you were in during the last resolved round. design §5.4 */
  | { readonly type: "postAlibi"; readonly player: PlayerId; readonly room: RoomId }
  /**
   * `slot` is an opaque label for the proposed time (e.g. an ISO timestamp).
   * The engine stores it and only ever compares slots for equality; it never
   * reads one as a time.
   */
  | { readonly type: "proposeMeeting"; readonly player: PlayerId; readonly slot: string }
  | { readonly type: "acceptMeeting"; readonly player: PlayerId; readonly proposalId: string }
  | { readonly type: "callEmergency"; readonly player: PlayerId }
  | { readonly type: "castVote"; readonly player: PlayerId; readonly vote: VoteChoice }
  /** Leave a vote in advance for the next meeting you might miss. design §11.2 */
  | { readonly type: "sealVote"; readonly player: PlayerId; readonly vote: VoteChoice }
  /** A role power used outside a move (Muscle), or a perk spent. design §17.2, §8.3 */
  | { readonly type: "useAbility"; readonly player: PlayerId; readonly ability: InstantAbility }
  /** Accept (or decline) this round's Double-cross offer; the last answer before the deadline counts. design §10 */
  | { readonly type: "answerDoubleCross"; readonly player: PlayerId; readonly accept: boolean }
  /**
   * Duel mode: call out the opponent for this act, at most once per act, while
   * one of its rounds is being planned. Settled when the act's last round
   * resolves; can't be withdrawn. design §16.1
   */
  | { readonly type: "callOut"; readonly player: PlayerId };

/**
 * Which deadline has passed. The engine has no clock, and several deadlines can
 * be pending at once (e.g. the round deadline and an emergency meeting's notice
 * period during planning), so the scheduler must say which one it means. The
 * engine rejects a deadline that isn't currently pending. design §4.1, §11.1
 */
export type Deadline =
  /**
   * The planning deadline for `round`: resolve it (default moves for anyone
   * missing). Rejected unless `round` is the one being planned, so a retried
   * or late deadline can't resolve the next round early. design §5
   */
  | { readonly kind: "round"; readonly round: number }
  /**
   * The alibi deadline for `round` (design §5.4): no more alibis for it; the
   * next round's planning starts (or the act's meeting is awaited). Rejected
   * unless `round` is the one whose alibis are open, so a retry is refused.
   */
  | { readonly kind: "alibis"; readonly round: number }
  /** A scheduled regular meeting's slot, or an emergency's notice period, has arrived: open the vote window. design §11.1 */
  | { readonly kind: "openMeeting"; readonly meetingId: string }
  /** The open vote window has ended: tally, shakedown, then checkpoint / final check. design §11.2–§11.4 */
  | { readonly kind: "closeMeeting"; readonly meetingId: string }
  /**
   * The window after a shakedown vote passed (`shakedownPending`) has ended:
   * apply the shakedown, unless the Muscle cancelled it, then go on as after
   * the meeting (checkpoint, next act or final check). design §8, §11.3, §11.4
   */
  | { readonly kind: "resolveShakedown"; readonly meetingId: string };

export type SystemCommand =
  | { readonly type: "advance"; readonly deadline: Deadline }
  /**
   * Nobody locked in a regular meeting by the act deadline, so the server picks
   * the slot. Emits `meetingScheduled` with `proposalId: null`. design §11.1
   */
  | { readonly type: "scheduleMeeting"; readonly act: ActNumber; readonly slot: string };

export type Command = PlayerCommand | SystemCommand;
export type CommandType = Command["type"];
