// The suite's fixed matrix of game settings, one cell per combination, and the
// options every cell's games are built from. design §17.4 ("measured at every
// player count from 2 to 12"), §8.1 (saboteur setting), §10 (events).
import { darkSideOdds, type MoleSetting } from "@skimjob/engine";
import type { MixEntry, SimOptions } from "../args";

/** What a whole suite run is: the same SuiteOptions give the same report, whatever the workers or shards. */
export interface SuiteOptions {
  readonly seed: string;
  readonly playerCounts: readonly number[];
  readonly moles: readonly MoleSetting[];
  readonly events: readonly boolean[];
  readonly mix: readonly MixEntry[];
  /** Untrusted JSON, checked by the engine's validateConfig (as in `pnpm sim`). */
  readonly contentOverrides: unknown;
  /** Adaptive sampling stops a cell once every targeted rate's 95% half-width is at most this (0.02 = ±2 pp)… */
  readonly ciHalfWidth: number;
  /** …but never before `minGames`, and never past `maxGames`. */
  readonly minGames: number;
  readonly maxGames: number;
  /** Games are added in batches of this many; a cell's game count is a whole number of batches. */
  readonly batch: number;
}

export interface Cell {
  /** e.g. "6p/mole-maybe/events-on": also part of each game's seed. */
  readonly key: string;
  readonly players: number;
  readonly mole: MoleSetting;
  readonly events: boolean;
  /** Whether this setting can deal a saboteur at this crew size (so the saboteur win rate applies). */
  readonly saboteurs: boolean;
}

export const cellKey = (players: number, mole: MoleSetting, events: boolean): string => `${players}p/mole-${mole}/events-${events ? "on" : "off"}`;

const sameOdds = (a: ReturnType<typeof darkSideOdds>, b: ReturnType<typeof darkSideOdds>): boolean => JSON.stringify(a) === JSON.stringify(b);

/** When two settings deal alike, the one kept: "off", then "on", then "maybe". */
const PRIORITY: readonly MoleSetting[] = ["off", "on", "maybe"];

/**
 * The saboteur settings worth a cell at `n` players, in the order given: a
 * setting is left out when it deals exactly like another one asked for (by
 * the engine's own `darkSideOdds`), e.g. "maybe" and "on" at 2–3 players are
 * crew-only like "off", and "maybe" is "on" at 9–12. So the matrix follows
 * the dealing rules if they change.
 */
export function distinctMoleSettings(n: number, settings: readonly MoleSetting[]): MoleSetting[] {
  const kept: MoleSetting[] = [];
  const seen: ReturnType<typeof darkSideOdds>[] = [];
  for (const m of PRIORITY.filter((p) => settings.includes(p))) {
    const odds = darkSideOdds(n, m, false);
    if (seen.some((s) => sameOdds(s, odds))) continue;
    seen.push(odds);
    kept.push(m);
  }
  return settings.filter((m) => kept.includes(m));
}

/** Every cell, in report order: player count, then saboteur setting, then events. */
export function buildMatrix(o: Pick<SuiteOptions, "playerCounts" | "moles" | "events">): Cell[] {
  const cells: Cell[] = [];
  for (const n of o.playerCounts) {
    for (const mole of distinctMoleSettings(n, o.moles)) {
      const saboteurs = darkSideOdds(n, mole, false).some((d) => d.saboteurs > 0 && d.chance > 0);
      for (const events of o.events) cells.push({ key: cellKey(n, mole, events), players: n, mole, events, saboteurs });
    }
  }
  return cells;
}

/**
 * The plain simulator's options for one cell. The seed is the suite seed plus
 * the cell key; `gameSeed` adds the player count and game index, so every game
 * has its own seed from (suite seed, settings, index) and nothing else: not
 * the worker, the shard or the batch it ran in. Content overrides are left out
 * of the seed on purpose: a rule change replays the same deals and bot dice
 * (common random numbers), so `--compare` shows the change, not the noise.
 */
export function cellSimOptions(o: SuiteOptions, cell: Cell): SimOptions {
  return {
    games: o.batch,
    playerCounts: [cell.players],
    mix: o.mix,
    seed: `${o.seed}/${cell.key}`,
    job: "bank",
    rolePool: [],
    starterMode: false,
    eventsEnabled: cell.events,
    duel: false,
    mole: cell.mole,
    voteVisibility: "hiddenThenRevealed",
    contentOverrides: o.contentOverrides,
    outDir: null,
    json: false,
  };
}

/**
 * Splits cells over `count` shards, balancing estimated work (a game's cost
 * grows with the crew size): biggest cells first, each to the least-loaded
 * shard, ties to the lower shard. Depends only on the matrix, so every
 * machine agrees on the split. Returns the cells of shard `index` (1-based).
 */
export function shardCells(cells: readonly Cell[], index: number, count: number): Cell[] {
  const load = Array<number>(count).fill(0);
  const owner = new Map<string, number>();
  const order = cells.map((c, i) => ({ c, i })).sort((a, b) => b.c.players - a.c.players || a.i - b.i);
  for (const { c } of order) {
    let best = 0;
    for (let s = 1; s < count; s++) if ((load[s] as number) < (load[best] as number)) best = s;
    load[best] = (load[best] as number) + c.players;
    owner.set(c.key, best + 1);
  }
  return cells.filter((c) => owner.get(c.key) === index);
}
