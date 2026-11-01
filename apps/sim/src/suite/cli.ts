// `pnpm sim:suite`: the simulation suite CLI. See `pnpm sim:suite -- --help`
// and docs/testing.md "Running the suite". design §17.4, docs/roles-v2.md §5
import { accessSync, constants, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CONTENT_VERSION, ENGINE_VERSION } from "@skimjob/engine";
import { invocationDir } from "../args";
import { createPool } from "../pool";
import { checkOptions } from "../run";
import { SUITE_USAGE, parseSuiteArgs, type RunSettings } from "./args";
import { buildMatrix, cellSimOptions, shardCells } from "./matrix";
import { mergeShards } from "./merge";
import { buildReport, compareReports, formatSuiteReport, reportJson, shardJson, SHARD_KIND, REPORT_FORMAT, type SuiteReport } from "./report";
import { checkReport } from "./validate";
import { runCells } from "./run";

const versions = { engine: ENGINE_VERSION, content: CONTENT_VERSION };
const at = (path: string): string => resolve(invocationDir(), path);
const say = (s: string): void => {
  process.stderr.write(s + "\n");
};

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  say(`  wrote ${path}`);
}

/** Exit codes: 0 ok; 1 = --strict and a confirmed FAIL; 2 = bad input (arguments, files); 3 = the run itself broke. */
class InputError extends Error {}

function readJson(path: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(at(path), "utf8");
  } catch (e) {
    throw new InputError(`${what} ${path}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new InputError(`${what} ${path} isn't valid JSON (${(e as Error).message})`);
  }
}

/** The --compare baseline, read and checked before any game runs. */
function loadBaseline(path: string): SuiteReport {
  const r = checkReport(readJson(path, "--compare"));
  if (typeof r === "string") throw new InputError(`--compare ${path} ${r}`);
  return r;
}

/** Make sure the output file can be written before the games run (as pnpm sim does). */
function checkOut(path: string): void {
  const st = statSync(path, { throwIfNoEntry: false });
  if (st && !st.isFile()) throw new InputError(`--out ${path} exists and is not a file`);
  try {
    mkdirSync(dirname(path), { recursive: true });
    accessSync(dirname(path), constants.W_OK);
    if (st) accessSync(path, constants.W_OK);
  } catch (e) {
    throw new InputError(`--out ${path}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
}

/** Print (and write) a finished report, compare it, and pick the exit code. */
function finish(report: SuiteReport, s: RunSettings, base: SuiteReport | null): number {
  if (s.out !== null) write(at(s.out), reportJson(report));
  process.stdout.write(s.json ? reportJson(report) : "\n" + formatSuiteReport(report));
  if (base !== null) (s.json ? process.stderr : process.stdout).write("\n" + compareReports(base, report));
  if (s.strict && report.checks.fail > 0) {
    say(`sim:suite: ${report.checks.fail} check(s) FAILED, confirmed by their 95% intervals (--strict)`);
    return 1;
  }
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseSuiteArgs(argv);
  if (parsed.kind === "help") {
    process.stdout.write(SUITE_USAGE);
    return 0;
  }
  if (parsed.kind === "error") {
    process.stderr.write(`sim:suite: ${parsed.message}\n\n${SUITE_USAGE}`);
    return 2;
  }

  const { settings } = parsed;
  const base = settings.compare === null ? null : loadBaseline(settings.compare);
  if (settings.out !== null) checkOut(at(settings.out));

  if (parsed.kind === "merge") {
    const shards = parsed.files.map((f) => readJson(f, "shard"));
    let merged;
    try {
      merged = mergeShards(shards);
    } catch (e) {
      // mergeShards checks shapes first; this only catches what those checks missed.
      throw new InputError(`merge: the shard files don't fit together (${(e as Error).message})`);
    }
    if (typeof merged === "string") {
      say(`sim:suite merge: ${merged}`);
      return 2;
    }
    if (merged.versions.engine !== versions.engine || merged.versions.content !== versions.content) {
      say(`  note: shards ran engine ${merged.versions.engine}, content ${merged.versions.content} (this checkout: ${versions.engine}, ${versions.content})`);
    }
    return finish(buildReport(merged.options, merged.versions, merged.cells), settings, base);
  }

  const { options } = parsed;
  const matrix = buildMatrix(options);
  const cells = settings.shard ? shardCells(matrix, settings.shard.index, settings.shard.count) : matrix;
  const errors = new Set<string>();
  for (const c of cells) for (const e of checkOptions(cellSimOptions(options, c))) errors.add(`${c.key}: ${e}`);
  if (errors.size > 0) {
    say(`sim:suite: invalid game settings:\n${[...errors].map((e) => `  - ${e}`).join("\n")}`);
    return 2;
  }
  const label = settings.shard ? ` (shard ${settings.shard.index}/${settings.shard.count})` : "";
  say(`Skimjob sim suite${label}: ${cells.length} of ${matrix.length} cells, ${settings.workers} worker${settings.workers === 1 ? "" : "s"}`);

  const started = performance.now();
  const pool = createPool(settings.workers);
  let results;
  try {
    results = await runCells(options, cells, pool, (r, done, total) => {
      const secs = ((performance.now() - started) / 1000).toFixed(0);
      const capped = r.converged || options.minGames === options.maxGames ? "" : " (reached the --max-games cap)";
      say(`  [${done}/${total}] ${r.key}: ${r.tally.games} games${capped}  ${secs}s`);
    });
  } finally {
    await pool.close();
  }
  say(`  ${results.reduce((s, r) => s + r.tally.games, 0)} games in ${((performance.now() - started) / 1000).toFixed(1)}s`);

  if (settings.shard) {
    if (settings.out !== null) write(at(settings.out), shardJson({ kind: SHARD_KIND, format: REPORT_FORMAT, versions, options, shard: settings.shard, cells: results }));
    return 0;
  }
  return finish(buildReport(options, versions, results), settings, base);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: Error) => {
    if (e instanceof InputError) {
      process.stderr.write(`sim:suite: ${e.message}\n`);
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`sim:suite: ${e.stack ?? e.message}\n`);
    process.exitCode = 3;
  },
);
