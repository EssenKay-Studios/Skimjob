// The suite's fixed matrix of game settings, one cell per combination, and the
// options every cell's games are built from. design §17.4 ("measured at every
// player count from 3 to 12"), §10 (events); extension.md "Decks and dealing",
// "Role list" and Build notes "Sim".
import type { DealStyle, RoleListSetting } from "@skimjob/engine";
import type { MixEntry, SimOptions } from "../args";

/**
 * A dealing setup: Balanced with the Exact role list (the default, and the one
 * the gates apply to), Truly random, or Balanced with the Possible or Hidden
 * role list. The Standard deck throughout. extension.md Build notes "Sim"
 */
export type Setup = "balanced" | "random" | "possible" | "hidden";
const SETUPS: Readonly<Record<Setup, { readonly deal: DealStyle; readonly roleList: RoleListSetting }>> = {
  balanced: { deal: "balanced", roleList: "exact" },
  random: { deal: "random", roleList: "exact" },
  possible: { deal: "balanced", roleList: "possible" },
  hidden: { deal: "balanced", roleList: "hidden" },
};
export const isSetup = (v: unknown): v is Setup => typeof v === "string" && Object.hasOwn(SETUPS, v);

/** The gates (success band, role parity) cover Balanced games at 4–12 players. extension.md Build notes "Sim" */
const GATED_FROM_PLAYERS = 4;

/** What a whole suite run is: the same SuiteOptions give the same report, whatever the workers or shards. */
export interface SuiteOptions {
  readonly seed: string;
  readonly playerCounts: readonly number[];
  readonly setups: readonly Setup[];
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
  /** e.g. "6p/balanced/events-on": also part of each game's seed. */
  readonly key: string;
  readonly players: number;
  readonly setup: Setup;
  readonly events: boolean;
  /** Whether the gates apply: Balanced, 4–12 players. Other cells are reported only. */
  readonly gated: boolean;
}

const cellKey = (players: number, setup: Setup, events: boolean): string => `${players}p/${setup}/events-${events ? "on" : "off"}`;

/** Every cell, in report order: player count, then setup, then events. */
export function buildMatrix(o: Pick<SuiteOptions, "playerCounts" | "setups" | "events">): Cell[] {
  const cells: Cell[] = [];
  for (const n of o.playerCounts) {
    for (const setup of o.setups) {
      const gated = setup === "balanced" && n >= GATED_FROM_PLAYERS;
      for (const events of o.events) cells.push({ key: cellKey(n, setup, events), players: n, setup, events, gated });
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
    eventsEnabled: cell.events,
    deck: "standard",
    deal: SETUPS[cell.setup].deal,
    roleList: SETUPS[cell.setup].roleList,
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
