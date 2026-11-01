// The work a simulator worker does: play a range of games for one setting and
// send back their records, or just their tally. Pure (same task, same result),
// so it makes no difference which thread runs it. design §17.2, §17.4
import type { SimOptions } from "./args";
import type { GameRecord } from "./record";
import { runOne } from "./run";
import { tallyGames, type Tally } from "./suite/tally";

export type Task =
  /** Games `from` … `to − 1` at `players` players: their records, in order. */
  | { readonly kind: "games"; readonly options: SimOptions; readonly players: number; readonly from: number; readonly to: number }
  /** The same games, folded in order into one tally. */
  | { readonly kind: "tally"; readonly options: SimOptions; readonly players: number; readonly from: number; readonly to: number };

export type TaskResult<T extends Task> = T extends { kind: "games" } ? GameRecord[] : Tally;

function playRange(options: SimOptions, players: number, from: number, to: number): GameRecord[] {
  const out: GameRecord[] = [];
  for (let i = from; i < to; i++) out.push(runOne(options, players, i));
  return out;
}

export function runTask(task: Task): GameRecord[] | Tally {
  const records = playRange(task.options, task.players, task.from, task.to);
  return task.kind === "games" ? records : tallyGames(records);
}
