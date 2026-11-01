// A cell's running counts: everything the suite's rates need, folded one game
// at a time, so a cell of thousands of games is a few numbers instead of its
// records. Plain JSON data: shard files carry tallies and `merge` adds them.
// design §17.4, docs/roles-v2.md §5
import type { GameRecord } from "../record";
import { act1LeaderWon, comebackEligible, decidedEarly } from "../metrics";

export interface SeatTally {
  readonly seats: number;
  /** Win credit (joint winners share one win). */
  readonly credit: number;
  /** Σ 1 ÷ crew size over the seats: the credit if every seat won equally often. */
  readonly fair: number;
}

export interface Tally {
  readonly games: number;
  readonly successes: number;
  readonly failures: number;
  readonly heatFailures: number;
  /** Games with a saboteur dealt, and those a saboteur won. */
  readonly saboteurGames: number;
  readonly saboteurWins: number;
  /** Games with a saboteur dealt that the heist failed (the dark side's win). */
  readonly darkSideWins: number;
  /** Successful games with a sole Act 1 leader, and those that leader won. */
  readonly comebackGames: number;
  readonly act1LeaderWins: number;
  /** Successful games settled before Act 3. */
  readonly decidedEarly: number;
  readonly shakedowns: number;
  /** Shakedowns that caught real loot (not clean). */
  readonly shakedownsCaught: number;
  /** Refused bot commands (should be 0). */
  readonly rejections: number;
  readonly roles: Readonly<Record<string, SeatTally>>;
  readonly personalities: Readonly<Record<string, SeatTally>>;
}

export const emptyTally = (): Tally => ({
  games: 0,
  successes: 0,
  failures: 0,
  heatFailures: 0,
  saboteurGames: 0,
  saboteurWins: 0,
  darkSideWins: 0,
  comebackGames: 0,
  act1LeaderWins: 0,
  decidedEarly: 0,
  shakedowns: 0,
  shakedownsCaught: 0,
  rejections: 0,
  roles: {},
  personalities: {},
});

const addSeat = (to: Record<string, SeatTally>, key: string, s: SeatTally): void => {
  const a = Object.hasOwn(to, key) ? to[key] : undefined;
  to[key] = a ? { seats: a.seats + s.seats, credit: a.credit + s.credit, fair: a.fair + s.fair } : { ...s };
};

/** Keys sorted, so a tally prints the same whatever order its games came in. */
const sortedSeats = (m: Record<string, SeatTally>): Record<string, SeatTally> =>
  Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k] as SeatTally]));

/** Fold games, in order, into a tally. */
export function tallyGames(records: readonly GameRecord[], start: Tally = emptyTally()): Tally {
  const t = { ...start, roles: { ...start.roles }, personalities: { ...start.personalities } };
  for (const g of records) {
    t.games++;
    const success = g.result === "success";
    if (success) t.successes++;
    else t.failures++;
    if (!success && g.reason === "heat") t.heatFailures++;
    if (g.playerRecords.some((p) => p.faction === "saboteur")) {
      t.saboteurGames++;
      if (g.playerRecords.some((p) => p.faction === "saboteur" && p.winner)) t.saboteurWins++;
      if (!success) t.darkSideWins++;
    }
    if (comebackEligible(g)) t.comebackGames++;
    if (act1LeaderWon(g)) t.act1LeaderWins++;
    if (decidedEarly(g)) t.decidedEarly++;
    t.shakedowns += g.shakedowns.length;
    t.shakedownsCaught += g.shakedowns.filter((s) => !s.clean).length;
    t.rejections += g.rejections;
    for (const p of g.playerRecords) {
      const seat = { seats: 1, credit: p.winCredit, fair: 1 / g.players };
      addSeat(t.roles, p.role, seat);
      addSeat(t.personalities, p.personality, seat);
    }
  }
  return { ...t, roles: sortedSeats(t.roles), personalities: sortedSeats(t.personalities) };
}

/** a + b. Floating-point sums depend on order, so callers add tallies in a fixed order. */
export function addTallies(a: Tally, b: Tally): Tally {
  const roles: Record<string, SeatTally> = { ...a.roles };
  const personalities: Record<string, SeatTally> = { ...a.personalities };
  for (const [k, s] of Object.entries(b.roles)) addSeat(roles, k, s);
  for (const [k, s] of Object.entries(b.personalities)) addSeat(personalities, k, s);
  return {
    games: a.games + b.games,
    successes: a.successes + b.successes,
    failures: a.failures + b.failures,
    heatFailures: a.heatFailures + b.heatFailures,
    saboteurGames: a.saboteurGames + b.saboteurGames,
    saboteurWins: a.saboteurWins + b.saboteurWins,
    darkSideWins: a.darkSideWins + b.darkSideWins,
    comebackGames: a.comebackGames + b.comebackGames,
    act1LeaderWins: a.act1LeaderWins + b.act1LeaderWins,
    decidedEarly: a.decidedEarly + b.decidedEarly,
    shakedowns: a.shakedowns + b.shakedowns,
    shakedownsCaught: a.shakedownsCaught + b.shakedownsCaught,
    rejections: a.rejections + b.rejections,
    roles: sortedSeats(roles),
    personalities: sortedSeats(personalities),
  };
}
