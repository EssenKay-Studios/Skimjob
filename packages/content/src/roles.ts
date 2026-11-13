// Role definitions as data: each role's kind (eyes or shadows), its power and
// the power's numbers. design §11
//
// `perStretch` counts uses per stretch, the time between two regular meetings
// ("once between meetings", design §9.1, §11.2); `perGame` uses per game. The
// engine's role handlers (one per role id, design §19.2 seam 4) use these.
import type { RoleId } from "./index";

/** Eyes spot theft; shadows make it possible. A deal balances the two (design §11.1, §11.3). */
export type RoleKind = "eyes" | "shadows";

/** A role's power. design §11.1 */
export type RolePower =
  /** Lookout: each round, a move may also watch up to `extraRooms` extra room(s). */
  | { readonly kind: "lookout"; readonly extraRooms: number }
  /** Locksmith (passive): each of your coins rings `fewerRings` time(s) fewer, never below 0. design §5.2 */
  | { readonly kind: "muffle"; readonly fewerRings: number }
  /** Detective: each round (`useAbility`), learn how many coins one player grabbed in the latest resolved round. */
  | { readonly kind: "detect" }
  /** Auditor: `perStretch` times per stretch (`useAbility`), learn how many coins reached the duffel from one room in the latest resolved round. */
  | { readonly kind: "audit"; readonly perStretch: number }
  /** Smooth Talker (passive): their ballot counts `weight` times. design §9.5 */
  | { readonly kind: "voteWeight"; readonly weight: number }
  /** Hacker: `perStretch` times per stretch, a move may hide one open room's bell from everyone else this round. */
  | { readonly kind: "hide"; readonly perStretch: number }
  /** Electrician: `perStretch` times per stretch, a move may black out one room next round. */
  | { readonly kind: "blackout"; readonly perStretch: number }
  /** Priest: `perStretch` times per stretch, a move may absolve one player at this round's split. */
  | { readonly kind: "absolve"; readonly perStretch: number }
  /** Mole: `perStretch` times per stretch, a move may ring any room once (not the Rooftop or a taped-off room). design §5.2 */
  | { readonly kind: "ring"; readonly perStretch: number }
  /** Fixer: `perGame` times per game, a move may tear the tape off a taped-off room; it reopens next round. design §5.3 */
  | { readonly kind: "reopen"; readonly perGame: number };

export interface RoleDef {
  readonly id: RoleId;
  readonly name: string;
  readonly kind: RoleKind;
  readonly power: RolePower;
}

/** Every role, in the order the rulebook lists them. design §11.1 */
export const ROLES: Readonly<Record<RoleId, RoleDef>> = {
  lookout: { id: "lookout", name: "Lookout", kind: "eyes", power: { kind: "lookout", extraRooms: 1 } },
  locksmith: { id: "locksmith", name: "Locksmith", kind: "shadows", power: { kind: "muffle", fewerRings: 1 } },
  detective: { id: "detective", name: "Detective", kind: "eyes", power: { kind: "detect" } },
  auditor: { id: "auditor", name: "Auditor", kind: "eyes", power: { kind: "audit", perStretch: 1 } },
  smoothTalker: { id: "smoothTalker", name: "Smooth Talker", kind: "eyes", power: { kind: "voteWeight", weight: 2 } },
  hacker: { id: "hacker", name: "Hacker", kind: "shadows", power: { kind: "hide", perStretch: 1 } },
  electrician: { id: "electrician", name: "Electrician", kind: "shadows", power: { kind: "blackout", perStretch: 1 } },
  priest: { id: "priest", name: "Priest", kind: "eyes", power: { kind: "absolve", perStretch: 1 } },
  mole: { id: "mole", name: "Mole", kind: "shadows", power: { kind: "ring", perStretch: 1 } },
  fixer: { id: "fixer", name: "Fixer", kind: "shadows", power: { kind: "reopen", perGame: 1 } },
};
