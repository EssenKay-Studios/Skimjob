// Role definitions: powers, tags, win endings and tokens, as data. design §8
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
  /** Hacker: `perAct` times per stretch, a move may loop the cameras so one room reads "camera offline" that round. */
  | { readonly kind: "loopCameras"; readonly perAct: number }
  /** Smooth talker: their ballot counts `weight` times toward a meeting's result (passive). design §11.2 */
  | { readonly kind: "voteWeight"; readonly weight: number }
  /** Auditor: `perAct` times per stretch (`useAbility`), learn the latest resolved round's shortfall for one room. design §8 (v2 §2) */
  | { readonly kind: "audit"; readonly perAct: number }
  /** Detective: `perAct` times per stretch (`useAbility`), learn whether a player's stash is at or above the clean threshold. design §8 (v2 §2) */
  | { readonly kind: "checkStash"; readonly perAct: number }
  /**
   * Priest: `perAct` times per stretch (`useAbility`), bless another player until
   * the next regular meeting closes. Blessed and shaken down clean meanwhile → the bank pays the
   * compensation, not the Haul. design §8 (v2 §2)
   */
  | { readonly kind: "bless"; readonly perAct: number }
  /**
   * Fixer: once per game, automatically, a raid stops with Heat at `stopAt`;
   * the Fixer loses `lossShare` of its stash (rounded, halves up). design §7, §8 (v2 §2)
   */
  | { readonly kind: "fixer"; readonly stopAt: number; readonly lossShare: number }
  /**
   * Mole: `perAct` times per stretch, any time, tip off the cops. The tip-off
   * is queued and lands at the next hidden police moment as public "police
   * activity" (`POLICE_ACTIVITY.heat`), the same as a background patrol.
   * extension.md "Police activity"
   */
  | { readonly kind: "tipOff"; readonly perAct: number; readonly perGame: number };

/**
 * What a plan-board power claim points at (design §10: "Hacker → Vault", "Detective → Eli"):
 * a room or a player. A power with no target (passive, or the Mole's hidden tip-off) can't be claimed.
 */
export const POWER_CLAIM_TARGET: Readonly<Partial<Record<RolePower["kind"], "room" | "player">>> = {
  lookout: "room",
  loopCameras: "room",
  audit: "room",
  checkStash: "player",
  bless: "player",
};

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
  /** The Haul target is met at meeting 1 or 2 (Rookie). The final check ends the game, so it grants nothing. */
  | "checkpointMade"
  /** A player this role's Lookout power saw, earlier this game, is caught. */
  | "watchedShakenDirty"
  /** A visitor of a room this role audited, in the audited round, is caught. */
  | "auditedShakenDirty"
  /** A player this role checked, earlier this game, is caught. */
  | "checkedShakenDirty"
  /** Its ballot was for a player who was then caught (Smooth Talker). */
  | "wonDirtyShakedown"
  /** A player it blessed is shaken down clean (Priest). */
  | "blessedShakenClean"
  /** Its power stopped a raid (Fixer). */
  | "raidStopped"
  /** Its camera loop hid, from a watcher of that room, a visitor who pocketed (Hacker). */
  | "loopHidPocketer"
  /** Each of its tip-offs, when it lands (Mole, owner ruling 4). */
  | "tipOffLanded";

/** A role's reward: `count` tokens each time `on` happens (1, extension.md). design §8.3 */
export interface TokenReward {
  readonly on: TokenTrigger;
  readonly count: number;
}

export interface RoleDef {
  readonly id: RoleId;
  readonly name: string;
  readonly power: RolePower;
  /** Temperament tag (changes no rule). extension.md */
  readonly tag: Temperament;
  /**
   * Failure endings this role also wins, from the top group (★ roles).
   * Empty: wins only a success. extension.md "Winning and losing"
   */
  readonly winsOn: readonly FailureReason[];
  /** The tokens this role earns, and how. Absent: none. design §8.3 */
  readonly rewards?: readonly TokenReward[];
  /** Dealt only in crews of at least this size (Smooth Talker: 5). Absent: any size. design §8.1 */
  readonly minPlayers?: number;
}

const TEAM = { tag: "teamPlayer", winsOn: [] } as const;
const WILD = { tag: "wildcard", winsOn: [] } as const;
const token = (on: TokenTrigger): readonly TokenReward[] => [{ on, count: 1 }];

/** Every role (R7 C2c: the 9 kept of R6's 20). design §8 */
export const ROLES: Readonly<Record<RoleId, RoleDef>> = {
  rookie: { id: "rookie", name: "Rookie", power: { kind: "none" }, ...TEAM, rewards: token("checkpointMade") },
  lookout: {
    id: "lookout",
    name: "Lookout",
    power: { kind: "lookout", extraRooms: 1 },
    ...TEAM,
    rewards: token("watchedShakenDirty"),
  },
  hacker: { id: "hacker", name: "Hacker", power: { kind: "loopCameras", perAct: 1 }, ...WILD, rewards: token("loopHidPocketer") },
  smoothTalker: {
    id: "smoothTalker",
    name: "Smooth Talker",
    power: { kind: "voteWeight", weight: 2 },
    ...TEAM,
    rewards: token("wonDirtyShakedown"),
    minPlayers: 5,
  },
  auditor: { id: "auditor", name: "Auditor", power: { kind: "audit", perAct: 1 }, ...TEAM, rewards: token("auditedShakenDirty") },
  detective: {
    id: "detective",
    name: "Detective",
    power: { kind: "checkStash", perAct: 1 },
    ...TEAM,
    rewards: token("checkedShakenDirty"),
    minPlayers: 4,
  },
  priest: {
    id: "priest",
    name: "Priest",
    power: { kind: "bless", perAct: 1 },
    ...TEAM,
    rewards: token("blessedShakenClean"),
    minPlayers: 5,
  },
  fixer: {
    id: "fixer",
    name: "Fixer",
    power: { kind: "fixer", stopAt: 95, lossShare: 0.25 },
    ...TEAM,
    rewards: token("raidStopped"),
  },
  mole: {
    id: "mole",
    name: "Mole",
    // extension.md owner ruling 4: at most 3 tip-offs (so tokens) a game, Recharge included.
    power: { kind: "tipOff", perAct: 1, perGame: 3 },
    tag: "loneWolf",
    winsOn: ["heat", "target"],
    rewards: token("tipOffLanded"),
  },
};
