// Role definitions: powers, restrictions and scoring, as data. design §8
import type { RoleId } from "./index";

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
 * A role that wins when the heist fails (Mole: any failure; Driver: Heat only,
 * and only with the biggest stash). None of the starter roles has one. design §3, §8
 */
export interface WinsOnFailure {
  readonly reasons: readonly FailureReason[];
  /** Also needs the top spot in the stash ranking, ties included (Driver). */
  readonly needsTopStash: boolean;
}

/** Scores are rounded to this many decimal places (Rookie ×1.2 gives fractions). docs/decisions.md */
export const SCORE_DECIMALS = 1;

export interface RoleDef {
  readonly id: RoleId;
  readonly name: string;
  readonly power: RolePower;
  /** false: every move must hand everything in (Insider). design §8 */
  readonly canPocket: boolean;
  readonly scoring: RoleScoring;
  /** null: wins only as the biggest stash of a successful heist. design §3 */
  readonly winsOnFailure: WinsOnFailure | null;
  /**
   * false: never wins a successful heist, whatever its stash (Mole); the best
   * of the others wins instead. design §3, §8
   */
  readonly winsOnSuccess: boolean;
}

const PLAIN_SCORING: RoleScoring = { stashMultiplier: 1, perLootOverFinalTarget: 0 };

/** Every role. The Mole is dealt by the Mole setting, never from the pool. design §8, §8.1 */
export const ROLES: Readonly<Record<RoleId, RoleDef>> = {
  rookie: {
    id: "rookie",
    name: "Rookie",
    power: { kind: "none" },
    canPocket: true,
    scoring: { stashMultiplier: 1.2, perLootOverFinalTarget: 0 },
    winsOnFailure: null,
    winsOnSuccess: true,
  },
  lookout: {
    id: "lookout",
    name: "Lookout",
    power: { kind: "lookout", extraRooms: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    winsOnFailure: null,
    winsOnSuccess: true,
  },
  insider: {
    id: "insider",
    name: "Insider",
    power: { kind: "none" },
    canPocket: false,
    scoring: { stashMultiplier: 1, perLootOverFinalTarget: 0.3 },
    winsOnFailure: null,
    winsOnSuccess: true,
  },
  fence: {
    id: "fence",
    name: "Fence",
    power: { kind: "fenceSafe", perAct: 5 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    winsOnFailure: null,
    winsOnSuccess: true,
  },
  hacker: {
    id: "hacker",
    name: "Hacker",
    power: { kind: "loopCameras", perAct: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    winsOnFailure: null,
    winsOnSuccess: true,
  },
  smoothTalker: {
    id: "smoothTalker",
    name: "Smooth talker",
    power: { kind: "voteWeight", weight: 2 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    winsOnFailure: null,
    winsOnSuccess: true,
  },
  muscle: {
    id: "muscle",
    name: "Muscle",
    power: { kind: "cancelShakedown", perGame: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    winsOnFailure: null,
    winsOnSuccess: true,
  },
  blackmailer: {
    id: "blackmailer",
    name: "Blackmailer",
    power: { kind: "blackmail", perAct: 1, steal: 3 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    winsOnFailure: null,
    winsOnSuccess: true,
  },
  snitch: {
    id: "snitch",
    name: "Snitch",
    power: { kind: "snitch", bonus: 10 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    winsOnFailure: null,
    winsOnSuccess: true,
  },
  driver: {
    id: "driver",
    name: "Driver",
    power: { kind: "none" },
    canPocket: true,
    scoring: PLAIN_SCORING,
    // design §8: escapes a Heat failure and wins it with the biggest stash; wins a success like anyone.
    winsOnFailure: { reasons: ["heat"], needsTopStash: true },
    winsOnSuccess: true,
  },
  mole: {
    id: "mole",
    name: "Mole",
    power: { kind: "tipOff", perAct: 1, heat: 10 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    // design §3, §8: wins only if the heist fails, for either reason, and never a success.
    winsOnFailure: { reasons: ["heat", "target"], needsTopStash: false },
    winsOnSuccess: false,
  },
};
