// Running the suite's cells over a worker pool with adaptive sampling.
//
// A cell's games are played in fixed batches (games b·batch … (b+1)·batch − 1).
// Batches are folded into the cell's tally strictly in batch order, and the
// stop rule is checked after each fold, so where a cell stops depends only on
// its own games, never on timing. Workers may run a few batches ahead; any
// batch past the stop point is thrown away. Result: the same tallies (byte for
// byte) for any number of workers or shards. design §17.2, §17.4
import { wilson } from "../stats";
import type { Pool } from "../pool";
import { cellSimOptions, type Cell, type SuiteOptions } from "./matrix";
import { RATES } from "./targets";
import { addTallies, emptyTally, type Tally } from "./tally";

export interface CellResult extends Cell {
  /** Batches folded into the tally. */
  readonly batches: number;
  /** True if it stopped because every targeted interval was narrow enough; false if it hit maxGames. */
  readonly converged: boolean;
  readonly tally: Tally;
}

/**
 * The stop rule, after a fold: never before minGames; then stop once every
 * checked rate that applies has a 95% half-width ≤ ciHalfWidth (a rate with
 * nothing to count yet, e.g. Heat share with no failures, doesn't hold it
 * up), or at maxGames.
 */
export function cellStatus(o: SuiteOptions, cell: Cell, t: Tally): { done: boolean; converged: boolean } {
  if (t.games < o.minGames) return { done: false, converged: false };
  const converged = RATES.filter((r) => r.band !== null && r.checked(cell) && r.applies(cell)).every((r) => {
    const hw = wilson(r.num(t), r.den(t)).halfWidth;
    return hw === null || hw <= o.ciHalfWidth;
  });
  return { done: converged || t.games >= o.maxGames, converged };
}

interface CellRun {
  readonly cell: Cell;
  readonly index: number;
  tally: Tally;
  folded: number;
  next: number;
  inFlight: number;
  readonly pending: Map<number, Tally>;
  done: boolean;
  converged: boolean;
}

/** Plays every cell to its stop point. `onCellDone` is told as each finishes (in finishing order). */
export function runCells(o: SuiteOptions, cells: readonly Cell[], pool: Pool, onCellDone?: (r: CellResult, done: number, total: number) => void): Promise<CellResult[]> {
  const maxBatches = Math.ceil(o.maxGames / o.batch);
  const runs: CellRun[] = cells.map((cell, index) => ({ cell, index, tally: emptyTally(), folded: 0, next: 0, inFlight: 0, pending: new Map(), done: false, converged: false }));
  const result = (r: CellRun): CellResult => ({ ...r.cell, batches: r.folded, converged: r.converged, tally: r.tally });
  let inFlight = 0;
  let finished = 0;

  return new Promise((resolve, reject) => {
    let failed = false;
    const settle = (): void => {
      if (!failed && finished === runs.length && inFlight === 0) resolve(runs.map(result));
    };
    const fold = (r: CellRun): void => {
      for (let t = r.pending.get(r.folded); t !== undefined && !r.done; t = r.pending.get(r.folded)) {
        r.pending.delete(r.folded);
        r.tally = r.folded === 0 ? t : addTallies(r.tally, t);
        r.folded++;
        const status = cellStatus(o, r.cell, r.tally);
        if (status.done) {
          r.done = true;
          r.converged = status.converged;
          r.pending.clear();
          finished++;
          onCellDone?.(result(r), finished, runs.length);
        }
      }
    };
    const dispatch = (): void => {
      while (!failed && inFlight < pool.size) {
        // Least-ahead cell first; then bigger crews (slower games) so they don't trail at the end.
        let pick: CellRun | undefined;
        for (const r of runs) {
          if (r.done || r.next >= maxBatches || r.inFlight >= pool.size) continue;
          if (!pick || r.inFlight < pick.inFlight || (r.inFlight === pick.inFlight && r.cell.players > pick.cell.players)) pick = r;
        }
        if (!pick) break;
        const r = pick;
        const b = r.next++;
        r.inFlight++;
        inFlight++;
        const options = cellSimOptions(o, r.cell);
        pool.run({ kind: "tally", options, players: r.cell.players, from: b * o.batch, to: (b + 1) * o.batch }).then(
          (t) => {
            r.inFlight--;
            inFlight--;
            if (!r.done) {
              r.pending.set(b, t);
              fold(r);
            }
            dispatch();
            settle();
          },
          (e: Error) => {
            failed = true;
            reject(e);
          },
        );
      }
    };
    if (runs.length === 0) return resolve([]);
    dispatch();
  });
}
