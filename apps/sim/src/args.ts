// Command-line options for the simulator. Node built-ins only (util.parseArgs).
// design §17.4 "Inputs: player count (3–12), mix of bot personalities, job,
// role pool, config overrides, number of games, seed."
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { MAX_PLAYERS, MIN_PLAYERS, type DeckId } from "@skimjob/content";
import { PERSONALITIES, type PersonalityId } from "@skimjob/bots";
import type { DealStyle, RoleListSetting, VoteVisibility } from "@skimjob/engine";
import { defaultWorkers } from "./pool";

export interface MixEntry {
  readonly personality: PersonalityId;
  readonly weight: number;
}

export interface SimOptions {
  /** Games to run at each player count. */
  readonly games: number;
  readonly playerCounts: readonly number[];
  readonly mix: readonly MixEntry[];
  readonly seed: string;
  readonly job: string;
  readonly rolePool: readonly string[];
  /** The events deck (design §10). Off by default. */
  readonly eventsEnabled: boolean;
  /** Deck preset, deal style and role list (extension.md "Decks and dealing", "Role list"). */
  readonly deck: DeckId;
  readonly deal: DealStyle;
  readonly roleList: RoleListSetting;
  readonly voteVisibility: VoteVisibility;
  /** Parsed but not yet checked: the engine's validateConfig checks it (untrusted JSON). */
  readonly contentOverrides: unknown;
  /** Directory for per-game CSV/JSON, or null for none. */
  readonly outDir: string | null;
  /** Print the summary as JSON instead of text. */
  readonly json: boolean;
}

export const DEFAULT_MIX: readonly MixEntry[] = [
  { personality: "honest", weight: 1 },
  { personality: "opportunist", weight: 1 },
  { personality: "greedy", weight: 1 },
  { personality: "cautious", weight: 1 },
];

export const USAGE = `Skimjob simulator: runs batches of all-bot games and reports balance metrics (design §17.4).

Usage: pnpm sim -- [options]

  -n, --games <N>         games per player count (default 100)
  -p, --players <spec>    player counts: 6, 3-12 or 4,6,8 (default 6)
  -b, --bots <mix>        bot personalities with optional weights, e.g.
                          honest:2,greedy:1 (default honest,opportunist,greedy,cautious)
                          personalities: ${Object.keys(PERSONALITIES).join(", ")}
  -s, --seed <seed>       base seed; same options + seed = same results (default "sim")
      --job <id>          job (default bank)
      --role-pool <ids>   comma-separated roles to deal from (default: the content default)
      --events            flip an event card each round from round 2 (design §10)
      --deck <preset>     starter | standard | everything (default standard; --role-pool overrides)
      --deal <style>      balanced | random (default balanced)
      --role-list <mode>  exact | possible | hidden (default exact)
      --votes <mode>      hiddenThenRevealed | open | secret (default hiddenThenRevealed)
      --overrides <json>  content overrides as inline JSON or a path to a JSON file, e.g.
                          '{"heat":{"perRound":5},"rooms":{"vault":{"loot":7}}}'
      --out <dir>         where per-game CSV/JSON go (default sim-output)
      --no-files          don't write per-game files
      --json              print the summary as JSON
  -w, --workers <N>       worker threads (default: CPU count); results are the same for any N
  -h, --help              show this help
`;

/** `workers` is kept out of SimOptions: it changes how fast, never what (summary.json records the options). */
export type ParsedArgs =
  | { readonly kind: "help" }
  | { readonly kind: "run"; readonly options: SimOptions; readonly workers: number }
  | { readonly kind: "error"; readonly message: string };

/** "6", "3-12" or "4,6,8" (combinations allowed: "3-5,8"), sorted and deduplicated. */
export function parsePlayerCounts(spec: string): number[] | string {
  const counts = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!m) return `bad player count "${part}" (use 6, 3-12 or 4,6,8)`;
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from > to) return `bad player range "${part}"`;
    if (from < MIN_PLAYERS || to > MAX_PLAYERS) return `player counts must be ${MIN_PLAYERS}–${MAX_PLAYERS}, got "${part}"`;
    for (let n = from; n <= to; n++) counts.add(n);
  }
  return [...counts].sort((a, b) => a - b);
}

/** "honest:2,greedy" → weights; names are case-insensitive. */
export function parseMix(spec: string): MixEntry[] | string {
  const out: MixEntry[] = [];
  for (const part of spec.split(",")) {
    const [rawName, rawWeight, ...extra] = part.trim().split(":");
    const name = (rawName ?? "").toLowerCase();
    if (extra.length > 0 || !Object.hasOwn(PERSONALITIES, name)) {
      return `unknown bot "${part.trim()}" (use ${Object.keys(PERSONALITIES).join(", ")}, optionally name:weight)`;
    }
    const weight = rawWeight === undefined ? 1 : Number(rawWeight);
    if (!Number.isFinite(weight) || weight <= 0) return `bad weight in "${part.trim()}"`;
    if (out.some((e) => e.personality === name)) return `bot "${name}" listed twice`;
    out.push({ personality: name as PersonalityId, weight });
  }
  return out;
}

/** `pnpm sim` runs in apps/sim; relative paths are taken from where the command was typed. */
export const invocationDir = (): string => process.env.INIT_CWD ?? process.cwd();
const readFromInvocationDir = (path: string): string => readFileSync(resolve(invocationDir(), path), "utf8");

/** Inline JSON (starts with "{") or a path to a JSON file. */
export function parseOverrides(value: string, readFile: (path: string) => string = readFromInvocationDir): unknown {
  const text = value.trimStart().startsWith("{") ? value : readFile(value);
  return JSON.parse(text) as unknown;
}

const DECKS: readonly string[] = ["starter", "standard", "everything"];
const DEALS: readonly string[] = ["balanced", "random"];
const ROLE_LISTS: readonly string[] = ["exact", "possible", "hidden"];
const VOTES: readonly string[] = ["hiddenThenRevealed", "open", "secret"];

/** Parse argv (without node and the script). A leading "--" from `pnpm sim -- …` is ignored. */
export function parseSimArgs(argv: readonly string[], readFile?: (path: string) => string): ParsedArgs {
  const args = argv.filter((a, i) => !(a === "--" && i === 0));
  let values;
  try {
    ({ values } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      allowNegative: true,
      options: {
        games: { type: "string", short: "n" },
        players: { type: "string", short: "p" },
        bots: { type: "string", short: "b" },
        seed: { type: "string", short: "s" },
        job: { type: "string" },
        "role-pool": { type: "string" },
        events: { type: "boolean" },
        deck: { type: "string" },
        deal: { type: "string" },
        "role-list": { type: "string" },
        votes: { type: "string" },
        overrides: { type: "string" },
        out: { type: "string" },
        files: { type: "boolean" },
        json: { type: "boolean" },
        workers: { type: "string", short: "w" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
  if (values.help) return { kind: "help" };
  const error = (message: string): ParsedArgs => ({ kind: "error", message });

  const games = values.games === undefined ? 100 : Number(values.games);
  if (!Number.isInteger(games) || games < 1) return error(`--games must be a whole number, 1 or more`);
  const playerCounts = parsePlayerCounts(values.players ?? "6");
  if (typeof playerCounts === "string") return error(playerCounts);
  const mix = values.bots === undefined ? DEFAULT_MIX : parseMix(values.bots);
  if (typeof mix === "string") return error(mix);
  const deck = values.deck ?? "standard";
  if (!DECKS.includes(deck)) return error(`--deck must be one of ${DECKS.join(", ")}`);
  const deal = values.deal ?? "balanced";
  if (!DEALS.includes(deal)) return error(`--deal must be one of ${DEALS.join(", ")}`);
  const roleList = values["role-list"] ?? "exact";
  if (!ROLE_LISTS.includes(roleList)) return error(`--role-list must be one of ${ROLE_LISTS.join(", ")}`);
  const votes = values.votes ?? "hiddenThenRevealed";
  if (!VOTES.includes(votes)) return error(`--votes must be one of ${VOTES.join(", ")}`);
  let contentOverrides: unknown = null;
  if (values.overrides !== undefined) {
    try {
      contentOverrides = parseOverrides(values.overrides, readFile);
    } catch (e) {
      return error(`--overrides: ${(e as Error).message}`);
    }
  }
  if (values.out !== undefined && values.out.trim() === "") return error("--out needs a directory (use --no-files for none)");
  if (values.out !== undefined && values.out.includes("\0")) return error("--out is not a valid path");
  const workers = values.workers === undefined ? defaultWorkers() : /^\d+$/.test(values.workers.trim()) ? Number(values.workers) : NaN;
  if (!Number.isInteger(workers) || workers < 1) return error("--workers must be a whole number, 1 or more");
  const rolePool = values["role-pool"] === undefined ? [] : values["role-pool"].split(",").map((r) => r.trim()).filter((r) => r !== "");

  return {
    kind: "run",
    workers,
    options: {
      games,
      playerCounts,
      mix,
      seed: values.seed ?? "sim",
      job: values.job ?? "bank",
      rolePool,
      eventsEnabled: values.events ?? false,
      deck: deck as DeckId,
      deal: deal as DealStyle,
      roleList: roleList as RoleListSetting,
      voteVisibility: votes as VoteVisibility,
      contentOverrides,
      outDir: values.files === false ? null : (values.out ?? "sim-output"),
      json: values.json ?? false,
    },
  };
}
