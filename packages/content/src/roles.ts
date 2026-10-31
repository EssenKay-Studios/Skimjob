// Role definitions: powers, restrictions and scoring, as data. design §8
// Only the starter roles exist so far; the rest arrive later in M1 (STATUS.md).
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
  | { readonly kind: "fenceSafe"; readonly perAct: number };

export interface RoleScoring {
  /** Final stash is multiplied by this (Rookie ×1.2). design §8 */
  readonly stashMultiplier: number;
  /** Points for every loot the Haul ends above the final target (Insider: 1). design §8 */
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
}

const PLAIN_SCORING: RoleScoring = { stashMultiplier: 1, perLootOverFinalTarget: 0 };

/** The starter roles. design §8, §8.1 */
export const ROLES: Readonly<Record<RoleId, RoleDef>> = {
  rookie: {
    id: "rookie",
    name: "Rookie",
    power: { kind: "none" },
    canPocket: true,
    scoring: { stashMultiplier: 1.2, perLootOverFinalTarget: 0 },
    winsOnFailure: null,
  },
  lookout: {
    id: "lookout",
    name: "Lookout",
    power: { kind: "lookout", extraRooms: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    winsOnFailure: null,
  },
  insider: {
    id: "insider",
    name: "Insider",
    power: { kind: "none" },
    canPocket: false,
    scoring: { stashMultiplier: 1, perLootOverFinalTarget: 1 },
    winsOnFailure: null,
  },
  fence: {
    id: "fence",
    name: "Fence",
    power: { kind: "fenceSafe", perAct: 5 },
    canPocket: true,
    scoring: PLAIN_SCORING,
    winsOnFailure: null,
  },
};
