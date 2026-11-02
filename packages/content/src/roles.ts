// Role definitions: powers, restrictions and scoring, as data. design §8
import type { RoleId, RoomId } from "./index";
import type { PerkId } from "./perks";

/** A role's power. `kind` matches the engine's `AbilityUse` kind where the power is used in a move. design §8 */
export type RolePower =
  | { readonly kind: "none" }
  /**
   * Lookout: each round, also sees who was in up to `extraRooms` extra room(s)
   * of their choice, named in the move's `{ kind: "lookout", rooms }` ability.
   */
  | { readonly kind: "lookout"; readonly extraRooms: number }
  /**
   * Fence: may move up to `perAct` loot per act from stash into a hidden safe
   * that shakedowns can't touch. Once its safe holds `revealSafe` or more, it
   * learns one saboteur (once per game). design §8 (v2 §2)
   */
  | { readonly kind: "fenceSafe"; readonly perAct: number; readonly revealSafe: number }
  /** Hacker: `perAct` times per act, a move may loop the cameras so one room shows as empty on Security that round. */
  | { readonly kind: "loopCameras"; readonly perAct: number }
  /** Smooth talker: their ballot counts `weight` times toward a meeting's result (passive). design §11.2 */
  | { readonly kind: "voteWeight"; readonly weight: number }
  /** Muscle: `perGame` times per game, cancel a shakedown after the vote passes (`useAbility`). design §11.3 */
  | { readonly kind: "cancelShakedown"; readonly perGame: number }
  /**
   * Blackmailer: `perAct` times per act, a move may guess one player's role.
   * Right → it steals their vote at the next meeting that opens (their ballot
   * weighs 0 there, and its own weighs `STOLEN_VOTE_WEIGHT` more); the victim is told only
   * that its vote is compromised. A saboteur guessed right and the Blackmailer
   * learn each other. design §8, §11.2 (v2 §2)
   */
  | { readonly kind: "blackmail"; readonly perAct: number }
  /**
   * Forger: `perAct` times per act, a move may plant a fake sighting: `target`
   * shows in `room` on every watch feed of that room this round (Security,
   * Lookout, Tail), as if it were there. design §6.1, §8 (v2 §2)
   */
  | { readonly kind: "forge"; readonly perAct: number }
  /**
   * Embezzler: `perAct` times per act, a move may take `take` from the Haul into
   * its stash after the round's splits, hidden in the round's Haul change. Its
   * stash is never clean while it holds a take (since its last shakedown). design §8, §11.3 (v2 §2)
   */
  | { readonly kind: "embezzle"; readonly perAct: number; readonly take: number }
  /** Auditor: `perAct` times per act (`useAbility`), learn the latest resolved round's shortfall for one room. design §8 (v2 §2) */
  | { readonly kind: "audit"; readonly perAct: number }
  /** Detective: `perAct` times per act (`useAbility`), learn whether a player's stash is at or above the clean threshold. design §8 (v2 §2) */
  | { readonly kind: "checkStash"; readonly perAct: number }
  /**
   * Snitch: dealt a secret target; each time that target is shaken down and
   * isn't clean, its ballot weighs `extraVotes` more for the rest of the game (passive). design §8 (v2 §2)
   */
  | { readonly kind: "snitch"; readonly extraVotes: number }
  /**
   * Priest: `perAct` times per act (`useAbility`), bless another player for the
   * act. Blessed and shaken down clean in that act → the bank pays the
   * compensation, not the Haul. design §8 (v2 §2)
   */
  | { readonly kind: "bless"; readonly perAct: number }
  /** Bagman: each round it pockets nothing, the bank adds `bonus` to the Haul (hidden in the round's Haul change, passive). design §8 (v2 §2) */
  | { readonly kind: "bagman"; readonly bonus: number }
  /** Cleaner: its visit to `room` counts as `visitors` visitors for that room's Heat pressure (passive). design §7, §8 (v2 §2) */
  | { readonly kind: "cleaner"; readonly room: RoomId; readonly visitors: number }
  /**
   * Fixer: once per game, automatically, a raid stops with Heat at `stopAt`;
   * the Fixer loses `lossShare` of its stash (rounded, halves up). design §7, §8 (v2 §2)
   */
  | { readonly kind: "fixer"; readonly stopAt: number; readonly lossShare: number }
  /** Mastermind: privately sees the next event card when a round starts (events on only, passive). design §8, §10 (v2 §2) */
  | { readonly kind: "foresee" }
  /**
   * Getaway Driver: its visit to `room` adds `reverse` × the Heat a visitor
   * there would remove (hidden in the round's Heat). Once Heat reaches
   * `revealHeat`, it learns the saboteurs and they learn it (once per game). design §7, §8 (v2 §2)
   */
  | { readonly kind: "getaway"; readonly room: RoomId; readonly reverse: number; readonly revealHeat: number }
  /**
   * Mole: `perAct` times per act, a move may tip off the cops: +`heat` Heat
   * that round, hidden in the round's total. Each tip-off also tells it one
   * accomplice it didn't know yet (v2 §2). design §7, §8
   */
  | { readonly kind: "tipOff"; readonly perAct: number; readonly heat: number };

export interface RoleScoring {
  /** Final stash is multiplied by this (Rookie ×1.05). design §8 */
  readonly stashMultiplier: number;
  /** Points for every loot the Haul ends above the final target (Inside Man: 0.3, balance pass 1). design §8 */
  readonly perLootOverFinalTarget: number;
}

/** Why a heist failed: Heat reached 100, or the final target was missed. design §3 */
export type FailureReason = "heat" | "target";

/**
 * The side a role plays for (role deck v2 §0, docs/roles-v2.md). design §3
 * - crew: helps the job; wins a successful heist with the best crew stash.
 * - saboteur: wrecks the job (Mole); dealt by the saboteur setting, never from the pool.
 * - accomplice: helps the saboteurs; never dealt without one.
 * Saboteurs and accomplices are "the dark side": a failed heist is won by
 * the best stash among them, and by nobody if none was dealt.
 */
export type Faction = "crew" | "accomplice" | "saboteur";

/**
 * What earns a role its perk (role deck v2 §2, docs/roles-v2.md). "Dirty"
 * means a shakedown that found the target holding at least the clean
 * threshold (`shakedownResolved` with `clean: false`). design §8.3
 */
export type PerkTrigger =
  /** Each Act 1 or 2 checkpoint made (Rookie: Tail; Inside Man: Peek). The final check ends the game, so it grants nothing. */
  | "checkpointMade"
  /** A player this role's Lookout power saw, earlier this game, is shaken down dirty (Lookout: Peek). */
  | "watchedShakenDirty"
  /** A visitor of a room this role audited, in the audited round, is shaken down dirty (Auditor: Ballot). */
  | "auditedShakenDirty"
  /** A player this role checked, earlier this game, is shaken down dirty (Detective: Shield). */
  | "checkedShakenDirty"
  /** This role voted to shake down a player who was then shaken down dirty (Smooth Talker: an extra emergency meeting). */
  | "wonDirtyShakedown"
  /** This role's cancel saved a player who was clean (Muscle: Recharge). Never for its own shakedown. */
  | "cancelledClean"
  /** A player this role blessed this act is shaken down clean (Priest: Ballot). */
  | "blessedShakenClean"
  /** This role pocketed nothing in every round of an act (Bagman: Alibi), granted as the act's last round resolves. */
  | "actAllIn"
  /** Every `CLEANER_REWARD_EVERY`th round this role spends in its cooling room (Cleaner: +Vote). */
  | "coolingRounds"
  /** This role's power stopped a raid (Fixer: Shield). */
  | "raidStopped"
  /** This role's camera loop hid a saboteur from a Security watcher that round (Hacker: Peek). */
  | "loopHidSaboteur"
  /** A player this role forged into a watch feed, earlier this game, is shaken down clean (Forger: Shield). */
  | "forgedShakenClean";

/**
 * What a stolen vote adds to the Blackmailer's ballot, whatever the victim's
 * own weight (Smooth Talker, +Vote, Snitch reward): the victim's counts 0 (v2 §2; owner, 2 Nov).
 */
export const STOLEN_VOTE_WEIGHT = 1;

/** The Cleaner is rewarded on every this-many-th round in its cooling room (v2 §2: every 2nd Rooftop round). */
export const CLEANER_REWARD_EVERY = 2;

/** A role's reward: `count` tokens of `perk` each time `on` happens. design §8.3 */
export interface PerkReward {
  readonly on: PerkTrigger;
  readonly perk: PerkId;
  readonly count: number;
}

/** Scores are rounded to this many decimal places (Rookie ×1.05 gives fractions). docs/decisions.md */
export const SCORE_DECIMALS = 1;

export interface RoleDef {
  readonly id: RoleId;
  readonly name: string;
  readonly power: RolePower;
  /** false: every move must hand everything in (Inside Man). design §8 */
  readonly canPocket: boolean;
  readonly scoring: RoleScoring;
  /** Which side the role wins with. design §3 */
  readonly faction: Faction;
  /**
   * The perks this role earns, and how (design §8.3). Absent: none. Also read
   * by rules that must not depend on who was dealt (e.g. the shakedown window
   * opens whenever a Shield is possible from the pool).
   */
  readonly rewards?: readonly PerkReward[];
  /** Dealt only in crews of at least this size (Inside Man: 5). Absent: any size. design §8.1 */
  readonly minPlayers?: number;
  /** Needs meetings, so never dealt in Duel mode (role deck v2 §3). design §16.1 */
  readonly needsMeetings?: boolean;
  /** Needs the events deck, so dealt only with events on (Mastermind, role deck v2 §3). design §8.1, §10 */
  readonly needsEvents?: boolean;
  /** Told this many saboteurs (at random) at the deal (Hacker: 1, role deck v2 §2). Absent: none. design §8.1 */
  readonly knowsSaboteurs?: number;
  /** The saboteurs are told who holds this role at the deal (the Forger, role deck v2 §2). design §8.1 */
  readonly knownToSaboteurs?: boolean;
}

const PLAIN_SCORING: RoleScoring = { stashMultiplier: 1, perLootOverFinalTarget: 0 };

/** Every role. Saboteurs (the Mole) are dealt by the saboteur setting, never from the pool. design §8, §8.1 */
export const ROLES: Readonly<Record<RoleId, RoleDef>> = {
  rookie: {
    id: "rookie",
    name: "Rookie",
    power: { kind: "none" },
    canPocket: true,
    // ×1.2 → ×1.05 in R5 (balance-3.md): the Rookie topped the crew's parity at most counts.
    scoring: { stashMultiplier: 1.05, perLootOverFinalTarget: 0 },
    faction: "crew",
    rewards: [{ on: "checkpointMade", perk: "tail", count: 1 }],
  },
  lookout: {
    id: "lookout",
    name: "Lookout",
    power: { kind: "lookout", extraRooms: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
    rewards: [{ on: "watchedShakenDirty", perk: "peek", count: 1 }],
  },
  insideMan: {
    id: "insideMan",
    name: "Inside Man",
    power: { kind: "none" },
    canPocket: false,
    // 0.3 → 0.15 per loot in R5 (balance-3.md): with the lower final target, overshoot came easier
    // and it topped the parity table at 5–12 players.
    scoring: { stashMultiplier: 1, perLootOverFinalTarget: 0.15 },
    faction: "crew",
    rewards: [{ on: "checkpointMade", perk: "peek", count: 1 }],
    // Owner answers, 1 Nov: a crew of 2–4 can't spare a player who never pockets.
    minPlayers: 5,
  },
  // Accomplices (role deck v2 §2): help the saboteurs; dealt only with one.
  getawayDriver: {
    id: "getawayDriver",
    name: "Getaway Driver",
    // The Driver's dark half; the Fixer is its crew half.
    // reverse ×1 → ×0 in R5 (balance-3.md): its Rooftop visit cools nothing (it only looks like it
    // does) instead of adding Heat; adding Heat made it the dark side's top seat at 5–10p.
    power: { kind: "getaway", room: "rooftop", reverse: 0, revealHeat: 75 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "accomplice",
  },
  fence: {
    id: "fence",
    name: "Fence",
    power: { kind: "fenceSafe", perAct: 5, revealSafe: 10 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "accomplice",
  },
  hacker: {
    id: "hacker",
    name: "Hacker",
    power: { kind: "loopCameras", perAct: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "accomplice",
    rewards: [{ on: "loopHidSaboteur", perk: "peek", count: 1 }],
    knowsSaboteurs: 1,
  },
  blackmailer: {
    id: "blackmailer",
    name: "Blackmailer",
    power: { kind: "blackmail", perAct: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "accomplice",
    minPlayers: 7,
    needsMeetings: true,
  },
  forger: {
    id: "forger",
    name: "Forger",
    power: { kind: "forge", perAct: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "accomplice",
    rewards: [{ on: "forgedShakenClean", perk: "shield", count: 1 }],
    minPlayers: 7,
    needsMeetings: true,
    knownToSaboteurs: true,
  },
  smoothTalker: {
    id: "smoothTalker",
    name: "Smooth Talker",
    power: { kind: "voteWeight", weight: 2 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
    rewards: [{ on: "wonDirtyShakedown", perk: "emergency", count: 1 }],
    minPlayers: 5,
    needsMeetings: true,
  },
  muscle: {
    id: "muscle",
    name: "Muscle",
    power: { kind: "cancelShakedown", perGame: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
    rewards: [{ on: "cancelledClean", perk: "recharge", count: 1 }],
    minPlayers: 5,
    needsMeetings: true,
  },
  snitch: {
    id: "snitch",
    name: "Snitch",
    power: { kind: "snitch", extraVotes: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
    minPlayers: 4,
    needsMeetings: true,
  },
  auditor: {
    id: "auditor",
    name: "Auditor",
    power: { kind: "audit", perAct: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
    rewards: [{ on: "auditedShakenDirty", perk: "ballot", count: 1 }],
  },
  detective: {
    id: "detective",
    name: "Detective",
    power: { kind: "checkStash", perAct: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
    rewards: [{ on: "checkedShakenDirty", perk: "shield", count: 1 }],
    minPlayers: 4,
    needsMeetings: true,
  },
  priest: {
    id: "priest",
    name: "Priest",
    power: { kind: "bless", perAct: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
    rewards: [{ on: "blessedShakenClean", perk: "ballot", count: 1 }],
    minPlayers: 5,
    needsMeetings: true,
  },
  bagman: {
    id: "bagman",
    name: "Bagman",
    power: { kind: "bagman", bonus: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
    rewards: [{ on: "actAllIn", perk: "alibi", count: 1 }],
  },
  cleaner: {
    id: "cleaner",
    name: "Cleaner",
    power: { kind: "cleaner", room: "rooftop", visitors: 2 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
    rewards: [{ on: "coolingRounds", perk: "extraVote", count: 1 }],
  },
  fixer: {
    id: "fixer",
    name: "Fixer",
    // The Driver's crew half (role deck v2 §2); the Getaway Driver is its accomplice half.
    power: { kind: "fixer", stopAt: 95, lossShare: 0.25 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
    rewards: [{ on: "raidStopped", perk: "shield", count: 1 }],
  },
  mastermind: {
    id: "mastermind",
    name: "Mastermind",
    power: { kind: "foresee" },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
    rewards: [{ on: "checkpointMade", perk: "rig", count: 1 }],
    needsEvents: true,
  },
  mole: {
    id: "mole",
    name: "Mole",
    // +6 → +4 Heat in R5 (balance-3.md).
    power: { kind: "tipOff", perAct: 1, heat: 4 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    // design §3, §8: a saboteur; wins a failed heist with the best dark-side stash, never a success.
    faction: "saboteur",
  },
  embezzler: {
    id: "embezzler",
    name: "Embezzler",
    // Take 4 → 1 in R5 (balance-3.md): the take made it the dark side's best stash in almost every
    // failure (parity 1.8–5.7× fair share).
    power: { kind: "embezzle", perAct: 1, take: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    // v2 §2: a saboteur, dealt by the saboteur setting like the Mole.
    faction: "saboteur",
  },
};
