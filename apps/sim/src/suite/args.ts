// Command-line options for the simulation suite (`pnpm sim:suite`). Node built-ins only.
import { parseArgs } from "node:util";
import { DEFAULT_MIX, parseMix, parseOverrides, parsePlayerCounts } from "../args";
import { defaultWorkers } from "../pool";
import type { Setup, SuiteOptions } from "./matrix";

export interface RunSettings {
  readonly workers: number;
  /** 1-based shard of `count`, or null for the whole matrix. */
  readonly shard: { readonly index: number; readonly count: number } | null;
  /** Where the JSON goes (relative to where the command was typed), or null for nowhere. */
  readonly out: string | null;
  readonly compare: string | null;
  readonly strict: boolean;
  readonly json: boolean;
}

export type ParsedSuiteArgs =
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "run"; readonly options: SuiteOptions; readonly settings: RunSettings }
  | { readonly kind: "merge"; readonly files: readonly string[]; readonly settings: RunSettings };

export const DEFAULTS = { seed: "suite", players: "3-12", setups: "balanced,random,possible", events: "on,off", ci: 2, minGames: 400, maxGames: 6000, batch: 200 } as const;

export const SUITE_USAGE = `Skimjob simulation suite: a fixed matrix of all-bot game settings, each played until its
rates are known to within a target, checked against the design §17.4 targets and role
parity (extension.md Build notes "Sim"). Results are the same for any --workers or --shard split.

Usage: pnpm sim:suite -- [options]
       pnpm sim:suite -- merge <shard.json>... [--out f] [--compare f] [--strict] [--json]

Matrix (one cell per combination):
  -p, --players <spec>    player counts, e.g. 3-12 or 4,6,8 (default ${DEFAULTS.players})
      --setups <list>     dealing setups (default ${DEFAULTS.setups}): balanced (Exact role
                          list; the gates), random (Truly random), possible / hidden (Balanced
                          with that role list); the Standard deck throughout
      --events <list>     on, off or both (default ${DEFAULTS.events})
  -b, --bots <mix>        bot mix as in pnpm sim (default honest,opportunist,greedy,cautious)
      --overrides <json>  content overrides, inline JSON or a file (as in pnpm sim); seeds don't
                          change, so --compare against a run without them pairs the same games
  -s, --seed <seed>       suite seed (default "${DEFAULTS.seed}")

Sampling:
      --ci <pp>           stop a cell once every checked rate's 95% half-width is at most this
                          many percentage points (default ${DEFAULTS.ci})
      --min-games <N>     games per cell before it may stop (default ${DEFAULTS.minGames})
      --max-games <N>     cap per cell (default ${DEFAULTS.maxGames})
  -n, --games <N>         fixed N games per cell (min = max = N)
      --batch <N>         games per batch (default ${DEFAULTS.batch}, at most --min-games); a cell
                          grows a batch at a time, so its count is rounded up to whole batches

Running:
  -w, --workers <N>       worker threads (default: CPU count, here ${defaultWorkers()})
      --shard <i/n>       run only shard i of n (cells split by estimated cost); combine with merge
      --out <file>        JSON output (default sim-output/suite.json, or
                          sim-output/suite-shard-<i>-of-<n>.json for a shard)
      --no-files          don't write JSON
      --compare <file>    print what moved since a baseline report (e.g. docs/balance/baseline.json)
      --strict            exit 1 if any check FAILs (confirmed by its 95% interval)
                          exit codes: 1 strict FAIL, 2 bad input (checked before running), 3 broke
      --json              print the report as JSON instead of text
  -h, --help              show this help
`;

function list<T extends string>(spec: string, allowed: readonly T[], name: string): T[] | string {
  const out: T[] = [];
  for (const raw of spec.split(",").map((s) => s.trim())) {
    if (!allowed.includes(raw as T)) return `--${name}: "${raw}" isn't one of ${allowed.join(", ")}`;
    if (!out.includes(raw as T)) out.push(raw as T);
  }
  return out;
}

const wholeNumber = (v: string | undefined, fallback: number): number => (v === undefined ? fallback : /^\d+$/.test(v.trim()) ? Number(v) : NaN);

export function parseShard(spec: string): { index: number; count: number } | string {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(spec);
  if (!m) return `--shard must look like 2/4`;
  const index = Number(m[1]);
  const count = Number(m[2]);
  if (count < 1 || index < 1 || index > count) return `--shard ${spec}: need 1 ≤ i ≤ n`;
  return { index, count };
}

/** Parse argv (without node and the script). A leading "--" from `pnpm sim:suite -- …` is ignored. */
export function parseSuiteArgs(argv: readonly string[], readFile?: (path: string) => string): ParsedSuiteArgs {
  const args = argv.filter((a, i) => !(a === "--" && i === 0));
  const merging = args[0] === "merge";
  let values;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: merging ? args.slice(1) : args,
      strict: true,
      allowPositionals: merging,
      allowNegative: true,
      options: {
        players: { type: "string", short: "p" },
        setups: { type: "string" },
        events: { type: "string" },
        bots: { type: "string", short: "b" },
        overrides: { type: "string" },
        seed: { type: "string", short: "s" },
        ci: { type: "string" },
        "min-games": { type: "string" },
        "max-games": { type: "string" },
        games: { type: "string", short: "n" },
        batch: { type: "string" },
        workers: { type: "string", short: "w" },
        shard: { type: "string" },
        out: { type: "string" },
        files: { type: "boolean" },
        compare: { type: "string" },
        strict: { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
  if (values.help) return { kind: "help" };
  const error = (message: string): ParsedSuiteArgs => ({ kind: "error", message });

  if (values.out !== undefined && (values.out.trim() === "" || values.out.includes("\0"))) return error("--out needs a file name (use --no-files for none)");
  const workers = wholeNumber(values.workers, defaultWorkers());
  if (!Number.isInteger(workers) || workers < 1) return error("--workers must be a whole number, 1 or more");
  const shard = values.shard === undefined ? null : parseShard(values.shard);
  if (typeof shard === "string") return error(shard);
  const settings = (defaultOut: string): RunSettings => ({
    workers,
    shard,
    out: values.files === false ? null : (values.out ?? defaultOut),
    compare: values.compare ?? null,
    strict: values.strict ?? false,
    json: values.json ?? false,
  });

  if (merging) {
    const matrixFlags = ["players", "setups", "events", "bots", "overrides", "seed", "ci", "min-games", "max-games", "games", "batch", "shard"] as const;
    const given = matrixFlags.filter((f) => values[f] !== undefined);
    if (given.length > 0) return error(`merge takes its settings from the shard files, not --${given.join(", --")}`);
    if (positionals.length === 0) return error("merge needs the shard files to combine");
    return { kind: "merge", files: positionals, settings: settings("sim-output/suite.json") };
  }

  if (shard && (values.compare !== undefined || values.strict)) return error("--compare and --strict need the whole matrix: give them to merge");
  const playerCounts = parsePlayerCounts(values.players ?? DEFAULTS.players);
  if (typeof playerCounts === "string") return error(playerCounts);
  const setups = list<Setup>(values.setups ?? DEFAULTS.setups, ["balanced", "random", "possible", "hidden"], "setups");
  if (typeof setups === "string") return error(setups);
  const eventList = list(values.events ?? DEFAULTS.events, ["on", "off"], "events");
  if (typeof eventList === "string") return error(eventList);
  const mix = values.bots === undefined ? DEFAULT_MIX : parseMix(values.bots);
  if (typeof mix === "string") return error(mix);
  let contentOverrides: unknown = null;
  if (values.overrides !== undefined) {
    try {
      contentOverrides = parseOverrides(values.overrides, readFile);
    } catch (e) {
      return error(`--overrides: ${(e as Error).message}`);
    }
  }
  const ci = values.ci === undefined ? DEFAULTS.ci : Number(values.ci);
  if (!Number.isFinite(ci) || ci <= 0 || ci > 50) return error("--ci must be a number of percentage points above 0 (e.g. 2)");
  if (values.games !== undefined && (values["min-games"] !== undefined || values["max-games"] !== undefined)) return error("--games sets both --min-games and --max-games: give one or the other");
  const fixed = values.games === undefined ? null : wholeNumber(values.games, 0);
  const minGames = fixed ?? wholeNumber(values["min-games"], DEFAULTS.minGames);
  const maxGames = fixed ?? wholeNumber(values["max-games"], Math.max(DEFAULTS.maxGames, minGames));
  if (!Number.isInteger(minGames) || minGames < 1) return error(`--${fixed === null ? "min-games" : "games"} must be a whole number, 1 or more`);
  if (!Number.isInteger(maxGames) || maxGames < minGames) return error("--max-games must be a whole number, at least --min-games");
  // A cell's games are whole batches, so the default batch is no bigger than the minimum (-n 30 plays exactly 30).
  const batch = wholeNumber(values.batch, Math.min(DEFAULTS.batch, minGames));
  if (!Number.isInteger(batch) || batch < 1) return error("--batch must be a whole number, 1 or more");
  if (batch > minGames) return error(`--batch ${batch} is more than ${fixed === null ? "--min-games" : "-n"} ${minGames}: a cell plays whole batches`);

  const options: SuiteOptions = {
    seed: values.seed ?? DEFAULTS.seed,
    playerCounts,
    setups,
    events: eventList.map((e) => e === "on"),
    mix,
    contentOverrides,
    ciHalfWidth: ci / 100,
    minGames,
    maxGames,
    batch,
  };
  const defaultOut = shard ? `sim-output/suite-shard-${shard.index}-of-${shard.count}.json` : "sim-output/suite.json";
  return { kind: "run", options, settings: settings(defaultOut) };
}
