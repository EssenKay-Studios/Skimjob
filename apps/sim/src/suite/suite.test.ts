// The simulation suite: intervals, the matrix, tallies, adaptive stopping,
// parity, merge and compare. design §17.2 (deterministic), §17.4 (metrics and
// targets), docs/roles-v2.md §5 (role parity).
import { describe, expect, it } from "vitest";
import { checkBand, wilson } from "../stats";
import { gameRec, seat } from "../testkit";
import { gameSeed, setupGame } from "../crew";
import { parseSuiteArgs } from "./args";
import { buildMatrix, cellSimOptions, distinctMoleSettings, shardCells, type SuiteOptions } from "./matrix";
import { mergeShards } from "./merge";
import { buildReport, compareReports, formatSuiteReport, parityOf, REPORT_FORMAT, SHARD_KIND, stringifyJson } from "./report";
import { cellStatus, type CellResult } from "./run";
import { addTallies, emptyTally, tallyGames } from "./tally";
import { PARITY_MIN_SEATS } from "./targets";

const opts = (over: Partial<SuiteOptions> = {}): SuiteOptions => {
  const r = parseSuiteArgs([]);
  if (r.kind !== "run") throw new Error("defaults should parse");
  return { ...r.options, ...over };
};
const versions = { engine: "e", content: "c" };

describe("Wilson 95% intervals", () => {
  it("matches the textbook values", () => {
    const iv = wilson(50, 100);
    expect(iv.rate).toBe(0.5);
    expect(iv.lo).toBeCloseTo(0.4038, 4);
    expect(iv.hi).toBeCloseTo(0.5962, 4);
    const zero = wilson(0, 10);
    expect(zero.lo).toBe(0);
    expect(zero.hi).toBeCloseTo(0.2775, 4);
    expect(wilson(3, 0)).toMatchObject({ rate: null, halfWidth: null });
  });

  it("narrows with more games: ±2 pp at 50% needs about 2,400 games", () => {
    expect(wilson(1200, 2400).halfWidth as number).toBeLessThanOrEqual(0.02);
    expect(wilson(1000, 2000).halfWidth as number).toBeGreaterThan(0.02);
  });

  it("PASS/FAIL on the estimate, sure only when the interval agrees", () => {
    const band = { lo: 0.55, hi: 0.7 };
    expect(checkBand(wilson(620, 1000), band)).toEqual({ verdict: "pass", sure: true });
    expect(checkBand(wilson(56, 100), band)).toEqual({ verdict: "pass", sure: false });
    expect(checkBand(wilson(400, 1000), band)).toEqual({ verdict: "fail", sure: true });
    expect(checkBand(wilson(53, 100), band)).toEqual({ verdict: "fail", sure: false });
    expect(checkBand(wilson(0, 0), band)).toEqual({ verdict: "n/a", sure: false });
  });
});

describe("the matrix — design §17.4 (2–12 players), §8.1 (saboteur setting), §10 (events)", () => {
  it("has every player count, the saboteur settings that deal differently there, events on and off", () => {
    const cells = buildMatrix(opts());
    const settings = (n: number) => [...new Set(cells.filter((c) => c.players === n).map((c) => c.mole))];
    expect(settings(2)).toEqual(["off"]); // crew only at 2–3: "maybe" and "on" deal like "off"
    expect(settings(3)).toEqual(["off"]);
    for (const n of [4, 5, 6, 7, 8]) expect(settings(n)).toEqual(["off", "maybe", "on"]);
    for (const n of [9, 10, 11, 12]) expect(settings(n)).toEqual(["off", "on"]); // "maybe" is "on" from 9
    expect(cells).toHaveLength(2 * (2 + 5 * 3 + 4 * 2));
    expect(cells.filter((c) => c.players === 6).map((c) => c.events)).toEqual([true, false, true, false, true, false]);
    expect(cells.find((c) => c.key === "4p/mole-on/events-on")?.saboteurs).toBe(true);
    expect(cells.find((c) => c.key === "4p/mole-off/events-on")?.saboteurs).toBe(false);
    expect(distinctMoleSettings(10, ["maybe", "on"])).toEqual(["on"]);
    expect(distinctMoleSettings(10, ["maybe"])).toEqual(["maybe"]);
  });

  it("every cell's games are valid configs with uniqueRoles left at its default", () => {
    for (const c of buildMatrix(opts())) {
      const { config } = setupGame(cellSimOptions(opts(), c), c.players, 0);
      expect(config.uniqueRoles).toBeUndefined();
      expect(config.mole).toBe(c.mole);
      expect(config.eventsEnabled).toBe(c.events);
    }
  });

  it("a game's seed comes from the suite seed, the cell and the game index only", () => {
    const o = opts({ seed: "S", batch: 7 });
    const cell = buildMatrix(o).find((c) => c.key === "6p/mole-maybe/events-off");
    if (!cell) throw new Error("cell missing");
    const so = cellSimOptions(o, cell);
    expect(gameSeed(so.seed, cell.players, 12)).toBe("S/6p/mole-maybe/events-off/6p/12");
    // Batch size, sampling targets and overrides don't change the seeds (overrides: paired games for --compare).
    expect(cellSimOptions({ ...o, batch: 50, ciHalfWidth: 0.05, contentOverrides: { heat: { perRound: 1 } } }, cell).seed).toBe(so.seed);
  });

  it("shards split the cells: each cell in exactly one shard, the same split every time", () => {
    const cells = buildMatrix(opts());
    for (const n of [1, 2, 3, 7, 50, 64]) {
      const shards = Array.from({ length: n }, (_, i) => shardCells(cells, i + 1, n));
      const keys = shards.flat().map((c) => c.key);
      expect(keys.sort()).toEqual(cells.map((c) => c.key).sort());
      expect(shardCells(cells, 1, n)).toEqual(shards[0]);
    }
    // Balanced by crew size: with 4 shards the loads are within one 12p cell of each other.
    const loads = [1, 2, 3, 4].map((i) => shardCells(cells, i, 4).reduce((s, c) => s + c.players, 0));
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(12);
  });
});

describe("tallies", () => {
  const mole = (over = {}) => seat({ id: "m", role: "mole", faction: "saboteur", ...over });
  const games = [
    gameRec({ players: 4, winners: ["a"], playerRecords: [seat({ id: "a" }), seat({ id: "b", role: "lookout" }), mole()] }),
    gameRec({ players: 4, result: "failed", reason: "heat", winners: ["m"], playerRecords: [seat({ id: "a" }), mole()] }),
    gameRec({ players: 4, result: "failed", reason: "target", winners: [], playerRecords: [seat({ id: "a" }), seat({ id: "b", role: "lookout" })] }),
  ];

  it("count what the rates need — design §17.4", () => {
    const t = tallyGames(games);
    expect(t).toMatchObject({ games: 3, successes: 1, failures: 2, heatFailures: 1, saboteurGames: 2, saboteurWins: 1, darkSideWins: 1 });
    expect(t.roles.rookie).toEqual({ seats: 3, credit: 1, fair: 0.75 });
    expect(t.roles.mole).toEqual({ seats: 2, credit: 1, fair: 0.5 });
    expect(Object.keys(t.roles)).toEqual(["lookout", "mole", "rookie"]);
  });

  it("adding tallies is folding the games together", () => {
    expect(addTallies(tallyGames(games.slice(0, 1)), tallyGames(games.slice(1)))).toEqual(tallyGames(games));
    expect(addTallies(emptyTally(), tallyGames(games))).toEqual(tallyGames(games));
  });
});

describe("adaptive stopping", () => {
  const cell = buildMatrix(opts()).find((c) => c.key === "6p/mole-on/events-on");
  if (!cell) throw new Error("cell missing");
  const t = (over: Partial<ReturnType<typeof emptyTally>>) => ({ ...emptyTally(), ...over });

  it("never stops before minGames; stops at maxGames even if not narrow enough", () => {
    const o = opts({ minGames: 400, maxGames: 1000, ciHalfWidth: 0.02 });
    expect(cellStatus(o, cell, t({ games: 200, successes: 200 }))).toEqual({ done: false, converged: false });
    expect(cellStatus(o, cell, t({ games: 1000, successes: 600, saboteurGames: 1000, saboteurWins: 350 }))).toEqual({ done: true, converged: false });
  });

  it("stops once every checked rate is within the target half-width", () => {
    const o = opts({ minGames: 400, maxGames: 100000, ciHalfWidth: 0.02 });
    const narrow = { games: 10000, successes: 6500, failures: 3500, heatFailures: 600, saboteurGames: 10000, saboteurWins: 3500, comebackGames: 6000, act1LeaderWins: 2900 };
    expect(cellStatus(o, cell, t({ ...narrow, decidedEarly: 800 }))).toEqual({ done: true, converged: true });
    // Heat share over only 350 failures is ±4 pp: keep going.
    expect(cellStatus(o, cell, t({ ...narrow, decidedEarly: 800, failures: 350, heatFailures: 60 })).done).toBe(false);
  });
});

describe("role parity — docs/roles-v2.md §5", () => {
  const n = 5;
  const seats = (s: number, winShare: number) => ({ seats: s, credit: s * winShare, fair: s / n });

  it("is each role's win credit ÷ fair share; spread max − min must be ≤ 0.10", () => {
    const p = parityOf({ a: seats(40000, 0.2), b: seats(40000, 0.21), c: seats(10, 0.9) });
    expect(p.roles.map((r) => [r.role, r.ratio])).toEqual([["a", 1], ["b", 1.05]]);
    expect(p.fewSeats).toEqual(["c"]); // fewer than PARITY_MIN_SEATS
    expect(p.spread).toBe(0.05);
    expect(p.check).toEqual({ verdict: "pass", sure: true });
  });

  it("fails a spread over 0.10, and says when the intervals can't tell yet", () => {
    expect(parityOf({ a: seats(40000, 0.2), b: seats(40000, 0.25) }).check).toEqual({ verdict: "fail", sure: true });
    expect(parityOf({ a: seats(PARITY_MIN_SEATS, 0.2), b: seats(PARITY_MIN_SEATS, 0.225) }).check).toEqual({ verdict: "fail", sure: false });
    expect(parityOf({ a: seats(400, 0.2) }).check.verdict).toBe("n/a");
  });
});

/** A finished cell with a made-up tally, for report/merge tests. */
function fakeCell(o: SuiteOptions, key: string, successes: number, games = 1000): CellResult {
  const cell = buildMatrix(o).find((c) => c.key === key);
  if (!cell) throw new Error(`no cell ${key}`);
  return { ...cell, batches: 5, converged: true, tally: { ...emptyTally(), games, successes, failures: games - successes } };
}

describe("report, merge and compare", () => {
  const o = opts({ playerCounts: [4, 6], moles: ["maybe"], events: [true] });
  const keys = buildMatrix(o).map((c) => c.key);
  const cells = [fakeCell(o, keys[0] as string, 620), fakeCell(o, keys[1] as string, 800)];

  it("checks each rate against its target — design §17.4", () => {
    const r = buildReport(o, versions, cells);
    expect(r.cells[0]?.rates.success?.check).toEqual({ verdict: "pass", sure: true });
    expect(r.cells[1]?.rates.success?.check).toEqual({ verdict: "fail", sure: true });
    expect(formatSuiteReport(r)).toContain("4p/mole-maybe/events-on");
    // Refused bot commands are a failure of their own.
    const bad = buildReport(o, versions, [cells[0] as CellResult, { ...(cells[1] as CellResult), tally: { ...(cells[1] as CellResult).tally, rejections: 2 } }]);
    expect(bad.checks.fail).toBe(r.checks.fail + 1);
  });

  it("merge puts shards back together exactly, and refuses a bad set", () => {
    const matrix = buildMatrix(o);
    const shard = (index: number, count: number) => ({
      kind: SHARD_KIND,
      format: REPORT_FORMAT,
      versions,
      options: o,
      shard: { index, count },
      cells: shardCells(matrix, index, count).map((c) => cells[matrix.indexOf(c)] as CellResult),
    });
    const merged = mergeShards([JSON.parse(stringifyJson(shard(2, 2))), JSON.parse(stringifyJson(shard(1, 2)))]);
    if (typeof merged === "string") throw new Error(merged);
    expect(stringifyJson(buildReport(merged.options, merged.versions, merged.cells))).toBe(stringifyJson(buildReport(o, versions, cells)));
    expect(mergeShards([shard(1, 2)])).toBe("missing shard 2/2");
    expect(mergeShards([shard(1, 2), shard(1, 2)])).toBe("shard 1/2 given twice");
    expect(mergeShards([shard(1, 2), { ...shard(2, 2), options: { ...o, seed: "other" } }])).toBe("shards come from runs with different settings");
    expect(mergeShards([{ kind: "nope" }])).toMatch(/isn't a suite shard/);
  });

  it("compare shows what moved, marks real moves and flipped checks", () => {
    const base = buildReport(o, versions, cells);
    const cur = buildReport(o, versions, [fakeCell(o, keys[0] as string, 500), cells[1] as CellResult]);
    const text = compareReports(base, cur);
    expect(text).toContain("-12.0*");
    expect(text).toContain("4p/mole-maybe/events-on success: PASS → FAIL");
    expect(compareReports(base, base)).toContain("No check changed verdict.");
  });
});

describe("suite arguments", () => {
  it("defaults: the whole matrix, ±2 pp, 400–6000 games in batches of 200", () => {
    const r = parseSuiteArgs([]);
    if (r.kind !== "run") throw new Error("should parse");
    expect(r.options).toMatchObject({ seed: "suite", moles: ["off", "maybe", "on"], events: [true, false], ciHalfWidth: 0.02, minGames: 400, maxGames: 6000, batch: 200 });
    expect(r.options.playerCounts).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(r.settings).toMatchObject({ shard: null, out: "sim-output/suite.json", strict: false });
  });

  it("-n fixes the games per cell; shards, merge and bad values", () => {
    const r = parseSuiteArgs(["--", "-n", "30", "--events", "off", "--shard", "2/3"]);
    if (r.kind !== "run") throw new Error("should parse");
    expect(r.options).toMatchObject({ minGames: 30, maxGames: 30, batch: 30, events: [false] });
    expect(r.settings).toMatchObject({ shard: { index: 2, count: 3 }, out: "sim-output/suite-shard-2-of-3.json" });
    expect(parseSuiteArgs(["merge", "a.json", "b.json", "--strict"])).toMatchObject({ kind: "merge", files: ["a.json", "b.json"], settings: { strict: true } });
    for (const bad of [["--shard", "3/2"], ["--shard", "1/2", "--strict"], ["--mole", "sometimes"], ["--ci", "0"], ["-n", "5", "--max-games", "9"], ["--min-games", "500", "--max-games", "100"], ["merge"], ["merge", "a", "-p", "4"], ["-w", "0"]]) {
      expect(parseSuiteArgs(bad).kind, bad.join(" ")).toBe("error");
    }
  });
});
