// `pnpm sim:suite`: the simulation suite CLI. See `pnpm sim:suite -- --help`
// and docs/testing.md "Running the suite". design §17.4, docs/roles-v2.md §5
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CONTENT_VERSION, ENGINE_VERSION } from "@skimjob/engine";
import { invocationDir } from "../args";
import { createPool } from "../pool";
import { checkOptions } from "../run";
import { SUITE_USAGE, parseSuiteArgs, type RunSettings } from "./args";
import { buildMatrix, cellSimOptions, shardCells } from "./matrix";
import { mergeShards } from "./merge";
import { buildReport, compareReports, formatSuiteReport, REPORT_KIND, reportJson, shardJson, SHARD_KIND, REPORT_FORMAT, type SuiteReport } from "./report";
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

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(at(path), "utf8")) as unknown;
}

/** Print (and write) a finished report, compare it, and pick the exit code. */
function finish(report: SuiteReport, s: RunSettings): number {
  if (s.out !== null) write(at(s.out), reportJson(report));
  process.stdout.write(s.json ? reportJson(report) : "\n" + formatSuiteReport(report));
  if (s.compare !== null) {
    const base = readJson(s.compare) as SuiteReport;
    if (base?.kind !== REPORT_KIND || base.format !== REPORT_FORMAT) {
      say(`sim:suite: ${s.compare} isn't a suite report`);
      return 2;
    }
    (s.json ? process.stderr : process.stdout).write("\n" + compareReports(base, report));
  }
  if (s.strict && report.checks.fail > 0) {
    say(`sim:suite: ${report.checks.fail} check(s) FAILED (--strict)`);
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

  if (parsed.kind === "merge") {
    let shards: unknown[];
    try {
      shards = parsed.files.map(readJson);
    } catch (e) {
      say(`sim:suite merge: ${(e as Error).message}`);
      return 2;
    }
    const merged = mergeShards(shards);
    if (typeof merged === "string") {
      say(`sim:suite merge: ${merged}`);
      return 2;
    }
    if (merged.versions.engine !== versions.engine || merged.versions.content !== versions.content) {
      say(`  note: shards ran engine ${merged.versions.engine}, content ${merged.versions.content} (this checkout: ${versions.engine}, ${versions.content})`);
    }
    return finish(buildReport(merged.options, merged.versions, merged.cells), parsed.settings);
  }

  const { options, settings } = parsed;
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
      say(`  [${done}/${total}] ${r.key}: ${r.tally.games} games${r.converged ? "" : " (hit --max-games)"}  ${secs}s`);
    });
  } finally {
    await pool.close();
  }
  say(`  ${results.reduce((s, r) => s + r.tally.games, 0)} games in ${((performance.now() - started) / 1000).toFixed(1)}s`);

  if (settings.shard) {
    if (settings.out !== null) write(at(settings.out), shardJson({ kind: SHARD_KIND, format: REPORT_FORMAT, versions, options, shard: settings.shard, cells: results }));
    return 0;
  }
  return finish(buildReport(options, versions, results), settings);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: Error) => {
    process.stderr.write(`sim:suite: ${e.stack ?? e.message}\n`);
    process.exitCode = 1;
  },
);
