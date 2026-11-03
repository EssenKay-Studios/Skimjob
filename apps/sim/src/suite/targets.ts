// The suite's rates and their targets. design §17.4 "Balance metrics and rough
// targets"; role parity from docs/roles-v2.md §5 (owner requirement); the
// gates and reports of extension.md Build notes "Sim".
// Targets are report settings, not game rules, so they live here and not in
// packages/content.
import type { Band } from "../stats";
import type { Cell } from "./matrix";
import type { Tally } from "./tally";

export interface RateDef {
  readonly id: string;
  readonly label: string;
  readonly num: (t: Tally) => number;
  readonly den: (t: Tally) => number;
  /** The target, or null for a rate that is only reported. Checked rates also drive adaptive sampling. */
  readonly band: Band | null;
  /** Whether the band is checked in this cell; elsewhere the rate is only reported. */
  readonly checked: (cell: Cell) => boolean;
  /** Whether the rate means anything for this cell. */
  readonly applies: (cell: Cell) => boolean;
  readonly source: string;
}

const always = (): boolean => true;
/** Balanced games at 4–12 players. extension.md Build notes "Sim" */
const gated = (c: Cell): boolean => c.gated;

export const RATES: readonly RateDef[] = [
  {
    id: "success",
    label: "success",
    num: (t) => t.successes,
    den: (t) => t.games,
    band: { lo: 0.55, hi: 0.7 },
    checked: gated,
    applies: always,
    source: "extension.md Build notes \"Sim\": success 55–70% (gate: Balanced, 4–12 players; reported elsewhere)",
  },
  { id: "raid", label: "raid", num: (t) => t.heatFailures, den: (t) => t.games, band: null, checked: gated, applies: always, source: "extension.md Build notes \"Sim\": ending split, failed on Heat (reported only)" },
  { id: "miss", label: "miss", num: (t) => t.targetFailures, den: (t) => t.games, band: null, checked: gated, applies: always, source: "extension.md Build notes \"Sim\": ending split, missed final target (reported only)" },
  { id: "noWinner", label: "no winner", num: (t) => t.noWinner, den: (t) => t.games, band: null, checked: gated, applies: always, source: "extension.md Build notes \"Sim\": games nobody won (reported only)" },
  { id: "sharedWin", label: "shared win", num: (t) => t.sharedWin, den: (t) => t.games, band: null, checked: gated, applies: always, source: "extension.md Build notes \"Sim\": games two or more players won together (reported only)" },
  { id: "heatShare", label: "Heat share", num: (t) => t.heatFailures, den: (t) => t.failures, band: { lo: 0.1, hi: 0.2 }, checked: gated, applies: always, source: "design §17.4: 10–20% of failures come from Heat" },
  {
    id: "comeback",
    label: "comeback",
    num: (t) => t.act1LeaderWins,
    den: (t) => t.comebackGames,
    band: { lo: 0, hi: 0.5 },
    checked: gated,
    applies: always,
    source: "design §17.4: the sole Act 1 leader wins under 50% of successful heists",
  },
  {
    id: "decidedEarly",
    label: "decided early",
    num: (t) => t.decidedEarly,
    den: (t) => t.successes,
    band: { lo: 0, hi: 0.15 },
    checked: gated,
    applies: always,
    source: "design §17.4: under 15% of successful heists are settled before Act 3",
  },
  {
    id: "shakedownAccuracy",
    label: "shakedowns caught",
    num: (t) => t.shakedownsCaught,
    den: (t) => t.shakedowns,
    band: null,
    checked: gated,
    applies: always,
    source: "design §17.4 (target 50–70%): shakedowns that caught loot; per shakedown, so its interval is only rough (reported only)",
  },
];

/**
 * Role parity (docs/roles-v2.md §5): each role's win credit ÷ its fair share
 * (Σ 1 ÷ crew size over its seats), over all games, failures included. The
 * spread max − min across the roles dealt must be at most this, in Balanced
 * games at 4–12 players. extension.md Build notes "Sim"
 */
export const PARITY_MAX_SPREAD = 0.1;
/**
 * The split parity gate (PM 3 Nov, provisional): the spread above is checked
 * over the team roles only (roles that win only a success); each ★ role
 * (one that also wins some failures) must instead sit in this band, as its
 * win credit ÷ fair share over the team roles' pooled ratio. The all-role
 * spread is still reported, ungated.
 *
 * Band (PM start 0.9–1.4, set from the data, docs/balance/r6-balance.md): a ★
 * role with an average stash that wins every failure scores 1 ÷ s against the
 * team roles, s the success rate; at the gate's 55% floor that is 1.8. Above
 * it, a ★ role tops the ranking more often than an average player. 1.4 is
 * that ceiling at a 70% success rate, so it would ask ★ roles to rank below
 * average whenever success is under 70%. Below 0.9, the role is too weak.
 */
export const STAR_BAND = { lo: 0.9, hi: 1.8 } as const;
/**
 * The team-role spread's gate (PM 3 Nov, provisional, owner to confirm): 0.20
 * until the M2-14 playtests; PARITY_MAX_SPREAD (0.10) stays the target. The
 * Muscle (self-cancel) and the Cleaner (cools on the 0-loot Rooftop) hold it
 * at 0.2–0.3 at 9–12p, and no number moves them. docs/balance/r6-balance.md
 */
export const TEAM_PARITY_MAX_SPREAD = 0.2;
/** Roles with fewer seats than this in a parity group are listed but left out of its spread. */
export const PARITY_MIN_SEATS = 100;
