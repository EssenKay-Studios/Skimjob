// Commands in, events out. design §17.2
//
// Player commands are what a client (human or bot) sends. System commands are
// sent by the server scheduler or the simulator: the engine has no clock, so it
// never decides by itself that time is up or picks a meeting time.
import type { EventId, PerkId, RoleId, RoomId } from "@skimjob/content";
import type { PlayerId } from "./config";

/** Role powers used as part of a move. Grows as roles are added. design §8 */
export type AbilityUse =
  /**
   * Lookout: also see who was in these rooms this round. 1 to the role's
   * `extraRooms` (content) distinct rooms in play.
   */
  | { readonly kind: "lookout"; readonly rooms: readonly RoomId[] }
  /** Hacker: Security shows `room` as empty this round. Once between meetings (content). design §8 */
  | { readonly kind: "loopCameras"; readonly room: RoomId }
  /** Mole: ring `room` once (not the Rooftop or a taped-off room). Once between meetings (content). design §5.2, §11.1 */
  | { readonly kind: "ring"; readonly room: RoomId }
  /** Fixer: tear the tape off taped-off `room`; it reopens next round. Once per game. design §5.3, §11.1 */
  | { readonly kind: "reopen"; readonly room: RoomId };

/**
 * Spending a perk token (design §8.3, docs/roles-v2.md §1), with `useAbility`.
 * The Shield isn't here: it is spent by itself when a shakedown on you passes.
 * - peek: learn `target`'s role now.
 * - extraVote: your ballot in the open meeting weighs +1 (once per meeting).
 * - ballot: see `target`'s ballot in the open meeting, as it changes (also in Secret mode).
 * - tail: while planning, also see who is in `room` when this round resolves.
 * - alibi: your alibi for the latest resolved round, if true, is stamped Verified (public).
 * - recharge: one used-up use of your power (this stretch's, or a once-per-game one) comes back.
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

/** Role powers and perks used outside a move, with `useAbility`. design §17.2 */
export type InstantAbility =
  /** Auditor: the latest resolved round's shortfall for `room`. Once between meetings (content). design §8 (v2 §2) */
  | { readonly kind: "audit"; readonly room: RoomId }
  /** Detective: does `target` hold anything above the share? Once between meetings (content). design §8 (v2 §2) */
  | { readonly kind: "checkStash"; readonly target: PlayerId }
  /** Priest: bless another player for this stretch. Once between meetings (content). design §8 (v2 §2) */
  | { readonly kind: "bless"; readonly target: PlayerId }
  | PerkSpend;

/**
 * One player's secret move for a round: a room, and the coins grabbed there
 * split into two bags. design §3.2
 *
 * The grab is `duffel + pocket`: 1 up to the room's limit in a coin room, 0 in
 * Security and on the Rooftop. A short bank can cut the grab at resolution
 * (pocket-bound coins first, design §3.2), so the coins a player really got
 * are in their `coinsGrabbed` event.
 */
export interface Move {
  readonly room: RoomId;
  /** Coins handed in to the crew duffel. */
  readonly duffel: number;
  /** Coins kept in your own pocket. */
  readonly pocket: number;
  /** Required when `room` is a watcher room (Security): which room to watch. design §3.1 */
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
   * Claim (truthfully or not) to be `role`: public, changes no rule. Once per
   * stretch; any role the content knows. design §11.3
   */
  | { readonly type: "claimRole"; readonly player: PlayerId; readonly role: RoleId }
  /**
   * `slot` is an opaque label for the proposed time (e.g. an ISO timestamp).
   * The engine stores it and only ever compares slots for equality; it never
   * reads one as a time.
   */
  | { readonly type: "proposeMeeting"; readonly player: PlayerId; readonly slot: string }
  | { readonly type: "acceptMeeting"; readonly player: PlayerId; readonly proposalId: string }
  /** Spend one of the crew's emergency meetings, only in the result window. design §9.3 */
  | { readonly type: "callEmergency"; readonly player: PlayerId }
  | { readonly type: "castVote"; readonly player: PlayerId; readonly vote: VoteChoice }
  /** Leave a vote in advance for the next meeting you might miss. design §11.2 */
  | { readonly type: "sealVote"; readonly player: PlayerId; readonly vote: VoteChoice }
  /** A role power used outside a move (Auditor, Detective, Priest), or a perk spent. design §17.2, §8.3 */
  | { readonly type: "useAbility"; readonly player: PlayerId; readonly ability: InstantAbility }
  /** Buy one of the shop's perks with tokens; any time. extension.md "Tokens and the perk shop" */
  | { readonly type: "buyPerk"; readonly player: PlayerId; readonly perk: PerkId };

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
   * meeting the round called is awaited, else the result window opens or the
   * next round starts. Rejected unless `round` is the one whose alibis are
   * open, so a retry is refused.
   */
  | { readonly kind: "alibis"; readonly round: number }
  /** The result window after `round` has closed with no emergency called: the next round starts. design §9.3 */
  | { readonly kind: "result"; readonly round: number }
  /** A scheduled meeting's slot, or an emergency's notice period, has arrived: open the vote window. design §9.3, §9.4 */
  | { readonly kind: "openMeeting"; readonly meetingId: string }
  /** The open vote window has ended: tally and shakedown, then the result window or the next round. design §9.5, §9.6 */
  | { readonly kind: "closeMeeting"; readonly meetingId: string }
  /**
   * The window after a shakedown vote passed (`shakedownPending`) has ended:
   * apply the shakedown, unless a Shield cancelled it, then go on as after
   * the meeting. design §9.6, §12
   */
  | { readonly kind: "resolveShakedown"; readonly meetingId: string };

export type SystemCommand =
  | { readonly type: "advance"; readonly deadline: Deadline }
  /**
   * Nobody locked in a slot for the meeting the round called (`meetingId`, the
   * next one), so the server picks it. Emits `meetingScheduled` with
   * `proposalId: null`. design §9.4
   */
  | { readonly type: "scheduleMeeting"; readonly meetingId: string; readonly slot: string };

export type Command = PlayerCommand | SystemCommand;
export type CommandType = Command["type"];
