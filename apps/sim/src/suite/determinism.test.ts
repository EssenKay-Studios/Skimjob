// The suite's results don't depend on how the work is split: one thread, two
// worker threads, or shards merged afterwards all give byte-identical reports,
// adaptive stopping included. design §17.2 (same seed + same commands = same
// game); real games and real worker threads, kept small for a shared machine.
import { describe, expect, it } from "vitest";
import { createPool } from "../pool";
import { runBatch, runBatchOn } from "../run";
import { parseSimArgs } from "../args";
import { buildMatrix, shardCells, type SuiteOptions } from "./matrix";
import { mergeShards } from "./merge";
import { buildReport, REPORT_FORMAT, reportJson, SHARD_KIND, shardJson } from "./report";
import { runCells } from "./run";

const versions = { engine: "e", content: "c" };
// Two cheap cells; a wide target so a cell can stop early, and lookahead batches get thrown away.
const options: SuiteOptions = {
  seed: "determinism",
  playerCounts: [2, 4],
  setups: ["balanced"],
  events: [true],
  mix: [
    { personality: "honest", weight: 1 },
    { personality: "greedy", weight: 1 },
  ],
  contentOverrides: null,
  ciHalfWidth: 0.2,
  minGames: 10,
  maxGames: 40,
  batch: 5,
};

async function suiteJson(workers: number, cells = buildMatrix(options)): Promise<{ json: string; results: Awaited<ReturnType<typeof runCells>> }> {
  const pool = createPool(workers);
  try {
    const results = await runCells(options, cells, pool);
    return { json: reportJson(buildReport(options, versions, results)), results };
  } finally {
    await pool.close();
  }
}

describe("suite determinism across workers and shards", () => {
  it("1 thread, 2 worker threads and 2 merged shards give the same report", { timeout: 120_000 }, async () => {
    const one = await suiteJson(1);
    const two = await suiteJson(2);
    expect(two.json).toBe(one.json);
    // Adaptive stopping happened on whole batches.
    for (const r of one.results) expect(r.tally.games % options.batch).toBe(0);

    const matrix = buildMatrix(options);
    const shards = [];
    for (const index of [1, 2]) {
      const { results } = await suiteJson(1, shardCells(matrix, index, 2));
      shards.push(JSON.parse(shardJson({ kind: SHARD_KIND, format: REPORT_FORMAT, versions, options, shard: { index, count: 2 }, cells: results })));
    }
    const merged = mergeShards(shards.reverse());
    if (typeof merged === "string") throw new Error(merged);
    expect(reportJson(buildReport(merged.options, merged.versions, merged.cells))).toBe(one.json);
  });

  it("pnpm sim's records are the same with 1 or 2 workers", { timeout: 120_000 }, async () => {
    const parsed = parseSimArgs(["-n", "30", "-p", "2,3", "-s", "w"]);
    if (parsed.kind !== "run") throw new Error("should parse");
    const pool = createPool(2);
    try {
      expect(JSON.stringify(await runBatchOn(pool, parsed.options))).toBe(JSON.stringify(runBatch(parsed.options)));
    } finally {
      await pool.close();
    }
  });
});
