// Running a batch of all-bot games. design §17.4
import { PERSONALITIES, createBots, runBotGame } from "@skimjob/bots";
import { validateConfig } from "@skimjob/engine";
import type { SimOptions } from "./args";
import type { Pool } from "./pool";
import { setupGame } from "./crew";
import { recordGame, type GameRecord } from "./record";

/**
 * Everything wrong with the options as a game config (job, content overrides:
 * the engine's own checks, since overrides are untrusted JSON), or [].
 */
export function checkOptions(options: SimOptions): string[] {
  const errors = new Set<string>();
  for (const n of options.playerCounts) for (const e of validateConfig(setupGame(options, n, 0).config)) errors.add(e);
  return [...errors];
}

/** Play one game: same options, player count and index, same record. */
export function runOne(options: SimOptions, players: number, index: number): GameRecord {
  const { config, crew } = setupGame(options, players, index);
  const agents = createBots(config.players, (_seat, i) => PERSONALITIES[crew[i] as keyof typeof PERSONALITIES], config.seed);
  const result = runBotGame(config, agents);
  return recordGame(result.state, crew, result.rejections.length);
}

/** All games, player count by player count. `progress` is told after each player count. */
export function runBatch(options: SimOptions, progress?: (players: number, games: number) => void): GameRecord[] {
  const records: GameRecord[] = [];
  for (const n of options.playerCounts) {
    for (let i = 0; i < options.games; i++) records.push(runOne(options, n, i));
    progress?.(n, options.games);
  }
  return records;
}

/** Games per worker task in `runBatchOn`. */
export const GAMES_PER_TASK = 25;

/**
 * `runBatch` over a worker pool: the same records in the same order, for any
 * pool size (each game depends only on the options, player count and index).
 */
export async function runBatchOn(pool: Pool, options: SimOptions, progress?: (players: number, games: number) => void): Promise<GameRecord[]> {
  const perCount = options.playerCounts.map(async (players) => {
    const tasks: Promise<GameRecord[]>[] = [];
    for (let from = 0; from < options.games; from += GAMES_PER_TASK) {
      tasks.push(pool.run({ kind: "games", options, players, from, to: Math.min(options.games, from + GAMES_PER_TASK) }));
    }
    const records = (await Promise.all(tasks)).flat();
    progress?.(players, options.games);
    return records;
  });
  return (await Promise.all(perCount)).flat();
}
