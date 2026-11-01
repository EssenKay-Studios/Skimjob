// Role definitions: powers, restrictions and scoring, as data. design §8
import type { RoleId } from "./index";
import type { PerkId } from "./perks";

/** A role's power. `kind` matches the engine's `AbilityUse` kind where the power is used in a move. design §8 */
export type RolePower =
  | { readonly kind: "none" }
  /**
   * Lookout: each round, also sees who was in up to `extraRooms` extra room(s)
   * of their choice, named in the move's `{ kind: "lookout", rooms }` ability.
   */
  | { readonly kind: "lookout"; readonly extraRooms: number }
  /** Fence: may move up to `perAct` loot per act from stash into a hidden safe that shakedowns can't touch. */
  | { readonly kind: "fenceSafe"; readonly perAct: number }
  /** Hacker: `perAct` times per act, a move may loop the cameras so one room shows as empty on Security that round. */
  | { readonly kind: "loopCameras"; readonly perAct: number }
  /** Smooth talker: their ballot counts `weight` times toward a meeting's result (passive). design §11.2 */
  | { readonly kind: "voteWeight"; readonly weight: number }
  /** Muscle: `perGame` times per game, cancel a shakedown after the vote passes (`useAbility`). design §11.3 */
  | { readonly kind: "cancelShakedown"; readonly perGame: number }
  /** Blackmailer: `perAct` times per act, a move may guess one player's role; if right, steal `steal` from their stash. */
  | { readonly kind: "blackmail"; readonly perAct: number; readonly steal: number }
  /** Snitch: dealt a secret target; gets `bonus` each time that target is shaken down and isn't clean (passive). */
  | { readonly kind: "snitch"; readonly bonus: number }
  /** Mole: `perAct` times per act, a move may tip off the cops: +`heat` Heat that round, hidden in the round's total. design §7, §8 */
  | { readonly kind: "tipOff"; readonly perAct: number; readonly heat: number };

export interface RoleScoring {
  /** Final stash is multiplied by this (Rookie ×1.2). design §8 */
  readonly stashMultiplier: number;
  /** Points for every loot the Haul ends above the final target (Insider: 0.3, balance pass 1). design §8 */
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

/** Scores are rounded to this many decimal places (Rookie ×1.2 gives fractions). docs/decisions.md */
export const SCORE_DECIMALS = 1;

export interface RoleDef {
  readonly id: RoleId;
  readonly name: string;
  readonly power: RolePower;
  /** false: every move must hand everything in (Insider). design §8 */
  readonly canPocket: boolean;
  readonly scoring: RoleScoring;
  /** Which side the role wins with. design §3 */
  readonly faction: Faction;
  /**
   * Perks this role's reward can grant (design §8.3). Absent: none. Read by
   * rules that must not depend on who was dealt (e.g. the shakedown window
   * opens whenever a Shield is possible from the pool). Role deck v2 R2/R3
   * wire the triggers.
   */
  readonly earns?: readonly PerkId[];
  /** Dealt only in crews of at least this size (Insider: 5). Absent: any size. design §8.1 */
  readonly minPlayers?: number;
}

const PLAIN_SCORING: RoleScoring = { stashMultiplier: 1, perLootOverFinalTarget: 0 };

/** Every role. Saboteurs (the Mole) are dealt by the saboteur setting, never from the pool. design §8, §8.1 */
export const ROLES: Readonly<Record<RoleId, RoleDef>> = {
  rookie: {
    id: "rookie",
    name: "Rookie",
    power: { kind: "none" },
    canPocket: true,
    scoring: { stashMultiplier: 1.2, perLootOverFinalTarget: 0 },
    faction: "crew",
  },
  lookout: {
    id: "lookout",
    name: "Lookout",
    power: { kind: "lookout", extraRooms: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
  },
  insider: {
    id: "insider",
    name: "Insider",
    power: { kind: "none" },
    canPocket: false,
    scoring: { stashMultiplier: 1, perLootOverFinalTarget: 0.3 },
    faction: "crew",
    // Owner answers, 1 Nov: a crew of 2–4 can't spare a player who never pockets.
    minPlayers: 5,
  },
  fence: {
    id: "fence",
    name: "Fence",
    power: { kind: "fenceSafe", perAct: 5 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
  },
  hacker: {
    id: "hacker",
    name: "Hacker",
    power: { kind: "loopCameras", perAct: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
  },
  smoothTalker: {
    id: "smoothTalker",
    name: "Smooth talker",
    power: { kind: "voteWeight", weight: 2 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
  },
  muscle: {
    id: "muscle",
    name: "Muscle",
    power: { kind: "cancelShakedown", perGame: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
  },
  blackmailer: {
    id: "blackmailer",
    name: "Blackmailer",
    power: { kind: "blackmail", perAct: 1, steal: 3 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
  },
  snitch: {
    id: "snitch",
    name: "Snitch",
    power: { kind: "snitch", bonus: 10 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    faction: "crew",
  },
  driver: {
    id: "driver",
    name: "Driver",
    power: { kind: "none" },
    canPocket: true,
    scoring: PLAIN_SCORING,
    // Role deck v2 R1 (provisional): crew without its old Heat-failure win, until
    // R2/R3 split it into the Fixer (crew) and the Getaway Driver (accomplice).
    faction: "crew",
  },
  mole: {
    id: "mole",
    name: "Mole",
    power: { kind: "tipOff", perAct: 1, heat: 6 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    // design §3, §8: a saboteur; wins a failed heist with the best dark-side stash, never a success.
    faction: "saboteur",
  },
};
