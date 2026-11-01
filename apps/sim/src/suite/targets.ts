// The suite's rates and their targets. design §17.4 "Balance metrics and rough
// targets"; role parity from docs/roles-v2.md §5 (owner requirement).
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
  /** Whether the rate means anything for this cell. */
  readonly applies: (cell: Cell) => boolean;
  readonly source: string;
}

const always = (): boolean => true;

export const RATES: readonly RateDef[] = [
  { id: "success", label: "success", num: (t) => t.successes, den: (t) => t.games, band: { lo: 0.55, hi: 0.7 }, applies: always, source: "design §17.4: heist success rate 55–70%" },
  {
    id: "saboteurWin",
    label: "saboteur wins",
    num: (t) => t.saboteurWins,
    den: (t) => t.saboteurGames,
    band: { lo: 0.3, hi: 0.4 },
    applies: (c) => c.saboteurs,
    source: "design §17.4: Mole win rate (when present) 30–40%; games with a saboteur dealt that a saboteur won",
  },
  { id: "heatShare", label: "Heat share", num: (t) => t.heatFailures, den: (t) => t.failures, band: { lo: 0.1, hi: 0.2 }, applies: always, source: "design §17.4: 10–20% of failures come from Heat" },
  {
    id: "comeback",
    label: "comeback",
    num: (t) => t.act1LeaderWins,
    den: (t) => t.comebackGames,
    band: { lo: 0, hi: 0.5 },
    applies: always,
    source: "design §17.4: the sole Act 1 leader wins under 50% of successful heists",
  },
  {
    id: "decidedEarly",
    label: "decided early",
    num: (t) => t.decidedEarly,
    den: (t) => t.successes,
    band: { lo: 0, hi: 0.15 },
    applies: always,
    source: "design §17.4: under 15% of successful heists are settled before Act 3",
  },
  {
    id: "darkSideWin",
    label: "dark side wins",
    num: (t) => t.darkSideWins,
    den: (t) => t.saboteurGames,
    band: null,
    applies: (c) => c.saboteurs,
    source: "games with a saboteur dealt that the heist failed (reported only)",
  },
  {
    id: "shakedownAccuracy",
    label: "shakedowns caught",
    num: (t) => t.shakedownsCaught,
    den: (t) => t.shakedowns,
    band: null,
    applies: always,
    source: "design §17.4 (target 50–70%): shakedowns that caught loot; per shakedown, so its interval is only rough (reported only)",
  },
];

/**
 * Role parity (docs/roles-v2.md §5): each role's win credit ÷ its fair share
 * (Σ 1 ÷ crew size over its seats), over all games, failures included. The
 * spread max − min across the roles dealt must be at most this.
 */
export const PARITY_MAX_SPREAD = 0.1;
/** Roles with fewer seats than this in a parity group are listed but left out of its spread. */
export const PARITY_MIN_SEATS = 100;
