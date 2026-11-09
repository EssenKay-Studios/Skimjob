// Commands in, events out. design §17.2
//
// Player commands are what a client (human or bot) sends. System commands are
// sent by the server scheduler or the simulator: the engine has no clock, so it
// never decides by itself that time is up or picks a meeting time.
import type { RoleId, RoomId } from "@skimjob/content";
import type { PlayerId } from "./config";

/** Role powers used as part of a move. design §11.1 */
export type AbilityUse =
  /**
   * Lookout: also see who was in these rooms this round. 1 to the role's
   * `extraRooms` (content) distinct rooms in play.
   */
  | { readonly kind: "lookout"; readonly rooms: readonly RoomId[] }
  /** Hacker: hide `room`'s bell (an open room) from everyone else this round. Once between meetings. */
  | { readonly kind: "hide"; readonly room: RoomId }
  /** Electrician: black out `room` next round: no sightings, cameras offline. Once between meetings. */
  | { readonly kind: "blackout"; readonly room: RoomId }
  /** Priest: at this round's split, set aside whatever `target` holds above the share. Once between meetings. */
  | { readonly kind: "absolve"; readonly target: PlayerId }
  /** Mole: ring `room` once (not the Rooftop or a taped-off room). Once between meetings. design §5.2 */
  | { readonly kind: "ring"; readonly room: RoomId }
  /** Fixer: tear the tape off taped-off `room`; it reopens next round. Once per game. design §5.3 */
  | { readonly kind: "reopen"; readonly room: RoomId };

/**
 * A perk bought on the black market and used at once, while planning (design
 * §12); Bail is the one held item.
 * - tail: next round, also see who was in `room`.
 * - alibi: if your alibi for this round is true, it is stamped "verified" in the ledger.
 * - ballot: see `target`'s vote at the next meeting (also in Secret mode).
 * - softShoes: next round, your coins don't ring at all.
 * - blackout: next round, `room` goes dark (announced like a power cut).
 * - bail: held until a shakedown passes against you; then you choose whether to use it (§9.6).
 * - plantEvidence: this round, `target` appears in `room`'s camera, Lookout and Tail feeds.
 */
export type PerkUse =
  | { readonly kind: "tail"; readonly room: RoomId }
  | { readonly kind: "alibi" }
  | { readonly kind: "ballot"; readonly target: PlayerId }
  | { readonly kind: "softShoes" }
  | { readonly kind: "blackout"; readonly room: RoomId }
  | { readonly kind: "bail" }
  | { readonly kind: "plantEvidence"; readonly target: PlayerId; readonly room: RoomId };

/** Role powers used outside a move, with `useAbility`. design §11.1, §17.2 */
export type InstantAbility =
  /** Auditor: how many coins reached the duffel from `room` in the latest resolved round. Once between meetings. */
  | { readonly kind: "audit"; readonly room: RoomId }
  /** Detective: how many coins `target` grabbed in the latest resolved round. Every round. */
  | { readonly kind: "detect"; readonly target: PlayerId };

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

// ---------------------------------------------------------------- the plan board (§10)

/** A power claim (a pledge): "Hacker → Vault" or "Detective → Eli". design §10 */
export interface PowerClaim {
  readonly role: RoleId;
  /** A room in play or another player, by the role's power. */
  readonly target: RoomId | PlayerId;
}

/** One seat's line on the plan board. Seats with nothing on it are not listed. design §10 */
export interface PlanEntry {
  readonly player: PlayerId;
  /** Where the crew put this avatar on the proposed plan (anyone may move it); null: nowhere. */
  readonly placed: RoomId | null;
  /** The seat's own room claim (✋): only that seat sets it. */
  readonly room: RoomId | null;
  readonly power: PowerClaim | null;
  readonly agreed: boolean;
}

/** One edit in the board's compact history: the latest of its actor, kind and subject. design §10 */
export interface PlanEditRecord {
  readonly actor: PlayerId;
  /** "place" moves `subject`'s avatar; "room", "power" and "agree" are the actor's own claims (subject = actor). */
  readonly kind: "place" | "room" | "power" | "agree";
  readonly subject: PlayerId;
  /** The room, the claimed role, or "true" / "false" for agree; null: cleared. */
  readonly value: string | null;
  /** A power claim's target. */
  readonly target: string | null;
  /** Ms left to the round's deadline when it was made; null if there was none. */
  readonly msBeforeDeadline: number | null;
}

/** The plan board as its round resolves: the final plan and its pledges, and the edit history oldest first. design §10 */
export interface PlanSnapshot {
  /** In seat order. */
  readonly entries: readonly PlanEntry[];
  readonly history: readonly PlanEditRecord[];
}

/** A vote in a crew meeting: shake someone down, or skip. design §11.2 */
export type VoteChoice =
  | { readonly kind: "shakedown"; readonly target: PlayerId }
  | { readonly kind: "skip" };

export type PlayerCommand =
  | { readonly type: "submitMove"; readonly player: PlayerId; readonly move: Move }
  /** Say (truthfully or not) you were in `room` in resolved `round`; any time, once per round. design §11.3 */
  | { readonly type: "postAlibi"; readonly player: PlayerId; readonly round: number; readonly room: RoomId }
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
  /** A role power used outside a move (Auditor, Detective). design §11.1, §17.2 */
  | { readonly type: "useAbility"; readonly player: PlayerId; readonly ability: InstantAbility }
  /** Buy one of this game's perks with coins from your stash and use it, while planning; one per round. design §12 */
  | { readonly type: "buyPerk"; readonly player: PlayerId; readonly perk: PerkUse }
  /** The target of a passed shakedown, holding Bail: use it (the shakedown falls through) or not. Changeable until the window closes. design §9.6 */
  | { readonly type: "chooseBail"; readonly player: PlayerId; readonly use: boolean };

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
   * or late deadline can't resolve the next round early. `plan` is the plan
   * board as the round resolves (the server's live board, design §10), left
   * out when nobody used it. design §4.2
   */
  | { readonly kind: "round"; readonly round: number; readonly plan?: PlanSnapshot }
  /** The result window after `round` has closed with no emergency called: the next round starts. design §9.3 */
  | { readonly kind: "result"; readonly round: number }
  /** A scheduled meeting's slot, or an emergency's notice period, has arrived: open the vote window. design §9.3, §9.4 */
  | { readonly kind: "openMeeting"; readonly meetingId: string }
  /** The open vote window has ended: tally and shakedown, then the result window or the next round. design §9.5, §9.6 */
  | { readonly kind: "closeMeeting"; readonly meetingId: string }
  /**
   * The Bail choice window after a shakedown vote passed (`shakedownPending`)
   * has ended: the shakedown falls through if its target chose to use Bail,
   * else the stash opens; then go on as after the meeting. design §9.6, §12
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
