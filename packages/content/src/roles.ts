// Role definitions: powers, restrictions, scoring, tags and win endings, as data. design §8
//
// extension.md: "per act" in field names (`perAct`) means per stretch, the time
// between two regular meetings ("once between meetings"). The engine keeps acts internally.
import type { RoleId, RoomId } from "./index";

/** A role's power. `kind` matches the engine's `AbilityUse` kind where the power is used in a move. design §8 */
export type RolePower =
  | { readonly kind: "none" }
  /**
   * Lookout: each round, also sees who was in up to `extraRooms` extra room(s)
   * of their choice, named in the move's `{ kind: "lookout", rooms }` ability.
   */
  | { readonly kind: "lookout"; readonly extraRooms: number }
  /**
   * Fence: may move up to `perAct` loot per stretch (between meetings) from
   * stash into a safe that shakedowns show but can't take. Its token comes once
   * the safe holds `tokenSafe` (once per game). design §8, extension.md
   */
  | { readonly kind: "fenceSafe"; readonly perAct: number; readonly tokenSafe: number }
  /** Hacker: `perAct` times per stretch, a move may loop the cameras so one room reads "camera offline" that round. */
  | { readonly kind: "loopCameras"; readonly perAct: number }
  /** Smooth talker: their ballot counts `weight` times toward a meeting's result (passive). design §11.2 */
  | { readonly kind: "voteWeight"; readonly weight: number }
  /** Muscle: `perGame` times per game, cancel a shakedown after the vote passes (`useAbility`). design §11.3 */
  | { readonly kind: "cancelShakedown"; readonly perGame: number }
  /**
   * Blackmailer: `perAct` times per stretch, a move may guess one player's role.
   * Right → it steals their vote at the next meeting that opens (their ballot
   * weighs 0 there, and its own weighs `STOLEN_VOTE_WEIGHT` more); the victim is told only
   * that its vote is compromised. design §8, §11.2 (v2 §2)
   */
  | { readonly kind: "blackmail"; readonly perAct: number }
  /**
   * Forger: `perAct` times per stretch, a move may plant a fake sighting: `target`
   * shows in `room` on every watch feed of that room this round (Security,
   * Lookout, Tail), as if it were there. design §6.1, §8 (v2 §2)
   */
  | { readonly kind: "forge"; readonly perAct: number }
  /**
   * Embezzler: `perAct` times per stretch, a move may take `take` from the Haul into
   * its stash after the round's splits, hidden in the round's Haul change. Its
   * stash is never clean while it holds a take (since its last shakedown). design §8, §11.3 (v2 §2)
   */
  | { readonly kind: "embezzle"; readonly perAct: number; readonly take: number }
  /** Auditor: `perAct` times per stretch (`useAbility`), learn the latest resolved round's shortfall for one room. design §8 (v2 §2) */
  | { readonly kind: "audit"; readonly perAct: number }
  /** Detective: `perAct` times per stretch (`useAbility`), learn whether a player's stash is at or above the clean threshold. design §8 (v2 §2) */
  | { readonly kind: "checkStash"; readonly perAct: number }
  /** Snitch: dealt a secret target; a token each time that target is caught (extension.md: replaces the extra vote). design §8 */
  | { readonly kind: "snitch" }
  /**
   * Priest: `perAct` times per stretch (`useAbility`), bless another player until
   * the next regular meeting closes. Blessed and shaken down clean meanwhile → the bank pays the
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
   * there would remove (hidden in the round's Heat). Its token comes the first
   * time Heat reaches `tokenHeat` (once per game). design §7, §8, extension.md
   */
  | { readonly kind: "getaway"; readonly room: RoomId; readonly reverse: number; readonly tokenHeat: number }
  /**
   * Mole: `perAct` times per stretch, any time, tip off the cops. The tip-off
   * is queued and lands at the next hidden police moment as public "police
   * activity" (`POLICE_ACTIVITY.heat`), the same as a background patrol.
   * extension.md "Police activity"
   */
  | { readonly kind: "tipOff"; readonly perAct: number; readonly perGame: number };

export interface RoleScoring {
  /**
   * +1 score per this many loot the Haul ends above the final target (Inside
   * Man: 5); 0 for none. Scores are whole numbers. extension.md "Winning and losing"
   */
  readonly lootPerPointOverFinalTarget: number;
}

/** Why a heist failed: Heat reached 100, or the final target was missed. design §3 */
export type FailureReason = "heat" | "target";

/**
 * How selfish a power is: it describes, never changes a rule (no teams).
 * extension.md "Roles", Build notes "Tags, decks and dealing"
 */
export type Temperament = "teamPlayer" | "wildcard" | "loneWolf";

/**
 * What earns a role a token (extension.md "Roles"). "Caught" means a
 * shakedown that found the target dirty (`shakedownResolved` with `clean: false`). design §8.3
 */
export type TokenTrigger =
  /** The Haul target is met at meeting 1 or 2 (Rookie, Inside Man, Mastermind). The final check ends the game, so it grants nothing. */
  | "checkpointMade"
  /** A player this role's Lookout power saw, earlier this game, is caught. */
  | "watchedShakenDirty"
  /** A visitor of a room this role audited, in the audited round, is caught. */
  | "auditedShakenDirty"
  /** A player this role checked, earlier this game, is caught. */
  | "checkedShakenDirty"
  /** Its secret target is caught (Snitch). */
  | "targetShakenDirty"
  /** Its ballot was for a player who was then caught (Smooth Talker). */
  | "wonDirtyShakedown"
  /** Its cancel saved a player who was clean (Muscle; it also gets the power back). Never for its own shakedown. */
  | "cancelledClean"
  /** A player it blessed is shaken down clean (Priest). */
  | "blessedShakenClean"
  /** It handed in everything `BAGMAN_STREAK` rounds running (Bagman); the count restarts after each token. */
  | "allInStreak"
  /** Every `CLEANER_REWARD_EVERY`th round it spends in its cooling room (Cleaner). */
  | "coolingRounds"
  /** Its power stopped a raid (Fixer). */
  | "raidStopped"
  /** Its camera loop hid, from a watcher of that room, a visitor who pocketed (Hacker). */
  | "loopHidPocketer"
  /** A player it forged into a watch feed, earlier this game, is shaken down clean (Forger). */
  | "forgedShakenClean"
  /** Heat first reaches its `tokenHeat` (Getaway Driver), once per game. */
  | "heatReached"
  /** Its safe first reaches its `tokenSafe` (Fence), once per game. */
  | "safeReached"
  /** A vote it stole decided a shakedown: it wouldn't have passed without it (Blackmailer, owner ruling 5). */
  | "stolenVoteDecided"
  /** Each of its tip-offs, when it lands (Mole, owner ruling 4). */
  | "tipOffLanded"
  /** Its first take (Embezzler). */
  | "firstTake";

/**
 * What a stolen vote adds to the Blackmailer's ballot, whatever the victim's
 * own weight (Smooth Talker, +Vote): the victim's counts 0 (v2 §2; owner, 2 Nov).
 */
export const STOLEN_VOTE_WEIGHT = 1;

/** The Cleaner earns a token on every this-many-th round in its cooling room (v2 §2: every 2nd Rooftop round). */
export const CLEANER_REWARD_EVERY = 2;

/** The Bagman earns a token per this many rounds in a row of handing in everything. extension.md gap-fills */
export const BAGMAN_STREAK = 3;

/** A role's reward: `count` tokens each time `on` happens (1, extension.md). design §8.3 */
export interface TokenReward {
  readonly on: TokenTrigger;
  readonly count: number;
}

export interface RoleDef {
  readonly id: RoleId;
  readonly name: string;
  readonly power: RolePower;
  /** false: every move must hand everything in (Inside Man). design §8 */
  readonly canPocket: boolean;
  readonly scoring: RoleScoring;
  /** Temperament tag (changes no rule). extension.md */
  readonly tag: Temperament;
  /**
   * Failure endings this role also wins, from the top group (★ roles).
   * Empty: wins only a success. extension.md "Winning and losing"
   */
  readonly winsOn: readonly FailureReason[];
  /** The tokens this role earns, and how. Absent: none. design §8.3 */
  readonly rewards?: readonly TokenReward[];
  /** Dealt only in crews of at least this size (Inside Man: 5). Absent: any size. design §8.1 */
  readonly minPlayers?: number;
  /** Needs the events deck, so dealt only with events on (Mastermind, role deck v2 §3). design §8.1, §10 */
  readonly needsEvents?: boolean;
}

const PLAIN_SCORING: RoleScoring = { lootPerPointOverFinalTarget: 0 };
const TEAM = { tag: "teamPlayer", winsOn: [] } as const;
const WILD = { tag: "wildcard", winsOn: [] } as const;
const token = (on: TokenTrigger): readonly TokenReward[] => [{ on, count: 1 }];

/** Every role (extension.md "Roles": all 20 stay, with the same powers). design §8 */
export const ROLES: Readonly<Record<RoleId, RoleDef>> = {
  rookie: { id: "rookie", name: "Rookie", power: { kind: "none" }, canPocket: true, scoring: PLAIN_SCORING, ...TEAM, rewards: token("checkpointMade") },
  lookout: {
    id: "lookout",
    name: "Lookout",
    power: { kind: "lookout", extraRooms: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    ...TEAM,
    rewards: token("watchedShakenDirty"),
  },
  insideMan: {
    id: "insideMan",
    name: "Inside Man",
    power: { kind: "none" },
    canPocket: false,
    // extension.md: +1 per 5 loot over the final target (was +0.15 per loot).
    scoring: { lootPerPointOverFinalTarget: 5 },
    ...TEAM,
    rewards: token("checkpointMade"),
    // Owner answers, 1 Nov: a crew of 3–4 can't spare a player who never pockets.
    minPlayers: 5,
  },
  getawayDriver: {
    id: "getawayDriver",
    name: "Getaway Driver",
    // reverse ×0 since R5 (balance-3.md): its Rooftop visit cools nothing (it only looks like it does).
    power: { kind: "getaway", room: "rooftop", reverse: 0, tokenHeat: 75 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    tag: "wildcard",
    winsOn: ["heat"],
    rewards: token("heatReached"),
  },
  fence: {
    id: "fence",
    name: "Fence",
    power: { kind: "fenceSafe", perAct: 1, tokenSafe: 3 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    tag: "wildcard",
    winsOn: ["heat", "target"],
    rewards: token("safeReached"),
  },
  hacker: { id: "hacker", name: "Hacker", power: { kind: "loopCameras", perAct: 1 }, canPocket: true, scoring: PLAIN_SCORING, ...WILD, rewards: token("loopHidPocketer") },
  blackmailer: {
    id: "blackmailer",
    name: "Blackmailer",
    power: { kind: "blackmail", perAct: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    ...WILD,
    rewards: token("stolenVoteDecided"),
    minPlayers: 7,
  },
  forger: {
    id: "forger",
    name: "Forger",
    power: { kind: "forge", perAct: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    ...WILD,
    rewards: token("forgedShakenClean"),
    minPlayers: 7,
  },
  smoothTalker: {
    id: "smoothTalker",
    name: "Smooth Talker",
    power: { kind: "voteWeight", weight: 2 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    ...TEAM,
    rewards: token("wonDirtyShakedown"),
    minPlayers: 5,
  },
  muscle: {
    id: "muscle",
    name: "Muscle",
    power: { kind: "cancelShakedown", perGame: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    ...TEAM,
    rewards: token("cancelledClean"),
    minPlayers: 5,
  },
  snitch: {
    id: "snitch",
    name: "Snitch",
    power: { kind: "snitch" },
    canPocket: true,
    scoring: PLAIN_SCORING,
    ...TEAM,
    rewards: token("targetShakenDirty"),
    minPlayers: 4,
  },
  auditor: { id: "auditor", name: "Auditor", power: { kind: "audit", perAct: 1 }, canPocket: true, scoring: PLAIN_SCORING, ...TEAM, rewards: token("auditedShakenDirty") },
  detective: {
    id: "detective",
    name: "Detective",
    power: { kind: "checkStash", perAct: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    ...TEAM,
    rewards: token("checkedShakenDirty"),
    minPlayers: 4,
  },
  priest: {
    id: "priest",
    name: "Priest",
    power: { kind: "bless", perAct: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    ...TEAM,
    rewards: token("blessedShakenClean"),
    minPlayers: 5,
  },
  bagman: { id: "bagman", name: "Bagman", power: { kind: "bagman", bonus: 1 }, canPocket: true, scoring: PLAIN_SCORING, ...TEAM, rewards: token("allInStreak") },
  cleaner: {
    id: "cleaner",
    name: "Cleaner",
    power: { kind: "cleaner", room: "rooftop", visitors: 2 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    ...TEAM,
    rewards: token("coolingRounds"),
  },
  fixer: {
    id: "fixer",
    name: "Fixer",
    power: { kind: "fixer", stopAt: 95, lossShare: 0.25 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    ...TEAM,
    rewards: token("raidStopped"),
  },
  mastermind: {
    id: "mastermind",
    name: "Mastermind",
    power: { kind: "foresee" },
    canPocket: true,
    scoring: PLAIN_SCORING,
    ...TEAM,
    rewards: token("checkpointMade"),
    needsEvents: true,
  },
  mole: {
    id: "mole",
    name: "Mole",
    // extension.md owner ruling 4: at most 3 tip-offs (so tokens) a game, Recharge included.
    power: { kind: "tipOff", perAct: 1, perGame: 3 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    tag: "loneWolf",
    winsOn: ["heat", "target"],
    rewards: token("tipOffLanded"),
  },
  embezzler: {
    id: "embezzler",
    name: "Embezzler",
    // Take 4 → 1 in R5 (balance-3.md).
    power: { kind: "embezzle", perAct: 1, take: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    tag: "loneWolf",
    winsOn: ["target"],
    rewards: token("firstTake"),
  },
};
