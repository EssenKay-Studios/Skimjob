// Role definitions: powers, restrictions and scoring, as data. design §8
// Only the starter roles exist so far; the rest arrive later in M1 (STATUS.md).
import type { RoleId } from "./index";

/** A role's power. `kind` matches the engine's `AbilityUse` kind where the power is used in a move. design §8 */
export type RolePower =
  | { readonly kind: "none" }
  /** Lookout: each round, also sees who was in `extraRooms` extra room(s) of their choice. */
  | { readonly kind: "lookout"; readonly extraRooms: number }
  /** Fence: may move up to `perAct` loot per act from stash into a hidden safe that shakedowns can't touch. */
  | { readonly kind: "fenceSafe"; readonly perAct: number };

export interface RoleScoring {
  /** Final stash is multiplied by this (Rookie ×1.2). design §8 */
  readonly stashMultiplier: number;
  /** Points for every loot the Haul ends above the final target (Insider: 1). design §8 */
  readonly perLootOverFinalTarget: number;
}

export interface RoleDef {
  readonly id: RoleId;
  readonly name: string;
  readonly power: RolePower;
  /** false: every move must hand everything in (Insider). design §8 */
  readonly canPocket: boolean;
  readonly scoring: RoleScoring;
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
  },
  lookout: {
    id: "lookout",
    name: "Lookout",
    power: { kind: "lookout", extraRooms: 1 },
    canPocket: true,
    scoring: PLAIN_SCORING,
  },
  insider: {
    id: "insider",
    name: "Insider",
    power: { kind: "none" },
    canPocket: false,
    scoring: { stashMultiplier: 1, perLootOverFinalTarget: 1 },
  },
  fence: {
    id: "fence",
    name: "Fence",
    power: { kind: "fenceSafe", perAct: 5 },
    canPocket: true,
    scoring: PLAIN_SCORING,
  },
};
