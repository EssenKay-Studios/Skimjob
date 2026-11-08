// QA (PR #34): adversarial checks on the parallel sim suite. design §17.2
// (deterministic), §17.4 (rates and targets), extension.md Build notes "Sim" (parity).
import { describe, expect, it } from "vitest";
import { createPool } from "../pool";
import { wilson } from "../stats";
import { parseSuiteArgs } from "./args";
import { buildMatrix, cellSimOptions, shardCells, type SuiteOptions } from "./matrix";
import { mergeShards } from "./merge";
import { buildReport, formatSuiteReport, parityOf, REPORT_FORMAT, reportJson, SHARD_KIND, shardJson } from "./report";
import { runCells } from "./run";

const versions = { engine: "e", content: "c" };
const opts = (argv: string[]): SuiteOptions => {
  const r = parseSuiteArgs(argv);
  if (r.kind !== "run") throw new Error(`should parse: ${JSON.stringify(r)}`);
  return r.options;
};
// Adaptive (not fixed -n), so the stop point itself must be worker-independent.
const options = opts(["-p", "3,5", "--setups", "balanced,possible", "--events", "off", "--min-games", "4", "--max-games", "12", "--batch", "4", "--ci", "30", "-s", "qa"]);

async function run(workers: number, cells = buildMatrix(options)) {
  const pool = createPool(workers);
  try {
    return await runCells(options, cells, pool);
  } finally {
    await pool.close();
  }
}

describe("QA: suite determinism, 1/2/3 workers and 1/1, 3-way shards — design §17.2", () => {
  it("adaptive suite: same bytes for any workers and any shard split", { timeout: 180_000 }, async () => {
    const one = reportJson(buildReport(options, versions, await run(1)));
    expect(reportJson(buildReport(options, versions, await run(3)))).toBe(one);
    const matrix = buildMatrix(options);
    for (const count of [1, 3]) {
      const shards = [];
      for (let index = 1; index <= count; index++) {
        const cells = await run(index === 2 ? 2 : 1, shardCells(matrix, index, count));
        shards.push(JSON.parse(shardJson({ kind: SHARD_KIND, format: REPORT_FORMAT, versions, options, shard: { index, count }, cells })));
      }
      const merged = mergeShards([...shards].reverse());
      if (typeof merged === "string") throw new Error(merged);
      expect(reportJson(buildReport(merged.options, merged.versions, merged.cells))).toBe(one);
    }
  });
});

describe("QA: tiny CI target hits the cap and says so — design §17.4", () => {
  it("every cell stops at max-games (rounded up to whole batches), converged false, marked +", { timeout: 60_000 }, async () => {
    const o = opts(["-p", "4", "--setups", "balanced", "--events", "off", "--ci", "0.001", "--min-games", "3", "--max-games", "7", "--batch", "3"]);
    const pool = createPool(1);
    const results = await runCells(o, buildMatrix(o), pool);
    await pool.close();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ converged: false, batches: 3 });
    expect(results[0]?.tally.games).toBe(9);
    const report = buildReport(o, versions, results);
    expect(report.cells[0]?.converged).toBe(false);
    expect(formatSuiteReport(report)).toMatch(/4p\/balanced\/events-off\s+9\+/);
  });
});

describe("QA: a failing task rejects the run instead of hanging", () => {
  it("worker pool rejects a throwing task and closes", { timeout: 60_000 }, async () => {
    const o = opts(["-p", "4", "--setups", "balanced", "--events", "off", "-n", "2"]);
    const cell = buildMatrix(o)[0];
    if (!cell) throw new Error("no cell");
    const pool = createPool(2);
    const bad = { ...cellSimOptions(o, cell), mix: [] };
    await expect(pool.run({ kind: "tally", options: bad, players: 4, from: 0, to: 1 })).rejects.toThrow(/empty bot mix/);
    await pool.close();
  });

  it("runCells rejects when a cell's games throw (bad content override)", { timeout: 60_000 }, async () => {
    const o = { ...opts(["-p", "3,4", "--setups", "balanced", "--events", "off", "-n", "2"]), contentOverrides: { nope: 1 } };
    const pool = createPool(2);
    await expect(runCells(o, buildMatrix(o), pool)).rejects.toThrow(/overridable/);
    await pool.close();
  });
});

describe("QA: hand-checked numbers", () => {
  it("Wilson 95% for 30/40 (a real 5p cell from a tiny run): 59.81–85.81%, ±13.0 pp", () => {
    const iv = wilson(30, 40);
    expect(iv.lo).toBeCloseTo(0.5981, 4);
    expect(iv.hi).toBeCloseTo(0.8581, 4);
    expect(iv.halfWidth).toBeCloseTo(0.13, 4);
  });

  it("parity: credit ÷ fair share, spread and its range — extension.md Build notes \"Sim\"", () => {
    // 4-player seats: fair = seats/4. a wins 50 of 200 (ratio 1.0), b wins 20 of 100 (ratio 0.8).
    const p = parityOf({ a: { seats: 200, credit: 50, fair: 50, successCredit: 0, earned: 0, spent: 0 }, b: { seats: 100, credit: 20, fair: 25, successCredit: 0, earned: 0, spent: 0 }, c: { seats: 99, credit: 99, fair: 24.75, successCredit: 0, earned: 0, spent: 0 } });
    expect(p.fewSeats).toEqual(["c"]);
    expect(p.roles).toEqual([
      { role: "a", seats: 200, ratio: 1, lo: 0.78, hi: 1.257 },
      { role: "b", seats: 100, ratio: 0.8, lo: 0.533, hi: 1.155 },
    ]);
    expect(p).toMatchObject({ spread: 0.2, spreadLo: 0, spreadHi: 0.724, check: { verdict: "fail", sure: false } });
  });
});

describe("QA: merge refuses forged shard sets", () => {
  const o = opts(["-p", "3,5", "--setups", "balanced", "--events", "off", "-n", "2"]);
  const matrix = buildMatrix(o);
  const shard = (index: number, count: number, cells = shardCells(matrix, index, count)) => ({
    kind: SHARD_KIND,
    format: REPORT_FORMAT,
    versions,
    options: o,
    shard: { index, count },
    cells: cells.map((c) => ({ ...c, batches: 1, converged: true, tally: {} })),
  });

  it("refuses an out-of-range shard index, a wrong format, and a shard with another shard's cells", () => {
    expect(mergeShards([shard(1, 2), shard(2, 2), { ...shard(1, 2), shard: { index: 3, count: 2 } }])).toMatch(/doesn't hold the cells/);
    expect(mergeShards([{ ...shard(1, 1), format: 2 }])).toMatch(/format 2/);
    expect(mergeShards([shard(1, 2, shardCells(matrix, 2, 2)), shard(2, 2, shardCells(matrix, 1, 2))])).toMatch(/doesn't hold the cells/);
  });
});

describe("QA: output paths and flags", () => {
  it("default files land under sim-output/; --compare/--strict need the whole matrix", () => {
    const whole = parseSuiteArgs(["-p", "4"]);
    const part = parseSuiteArgs(["-p", "4", "--shard", "2/3"]);
    const merge = parseSuiteArgs(["merge", "a.json"]);
    expect(whole.kind === "run" && whole.settings.out).toBe("sim-output/suite.json");
    expect(part.kind === "run" && part.settings.out).toBe("sim-output/suite-shard-2-of-3.json");
    expect(merge.kind === "merge" && merge.settings.out).toBe("sim-output/suite.json");
    expect(parseSuiteArgs(["--shard", "1/2", "--strict"]).kind).toBe("error");
    expect(parseSuiteArgs(["--shard", "0/2"]).kind).toBe("error");
    expect(parseSuiteArgs(["--shard", "3/2"]).kind).toBe("error");
    expect(parseSuiteArgs(["-w", "0"]).kind).toBe("error");
    expect(parseSuiteArgs(["merge", "a.json", "--seed", "x"]).kind).toBe("error");
  });
});
