// The simulation suite: intervals, the matrix, tallies, adaptive stopping,
// parity, merge and compare. design §17.2 (deterministic), §17.4 (metrics and
// targets), extension.md Build notes "Sim" (role parity).
import { describe, expect, it } from "vitest";
import { checkBand, wilson } from "../stats";
import { gameRec, seat } from "../testkit";
import { gameSeed, setupGame } from "../crew";
import { parseSuiteArgs } from "./args";
import { buildMatrix, cellSimOptions, shardCells, type SuiteOptions } from "./matrix";
import { mergeShards } from "./merge";
import { buildReport, compareReports, formatSuiteReport, parityOf, REPORT_FORMAT, SHARD_KIND, splitParityOf, stringifyJson, verdictText } from "./report";
import { checkReport } from "./validate";
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

describe("the matrix — design §17.4 (2–12 players), extension.md Build notes \"Sim\" (setups, gates), §10 (events)", () => {
  it("has every player count × setup × events on and off; only Balanced at 4–12 is gated", () => {
    const cells = buildMatrix(opts());
    expect(cells).toHaveLength(11 * 3 * 2);
    expect(cells.filter((c) => c.players === 6).map((c) => `${c.setup}/${c.events}`)).toEqual([
      "balanced/true", "balanced/false", "random/true", "random/false", "possible/true", "possible/false",
    ]);
    expect(cells.filter((c) => c.gated).map((c) => c.key)).toEqual(
      cells.filter((c) => c.setup === "balanced" && c.players >= 4).map((c) => c.key),
    );
    expect(cells.find((c) => c.key === "3p/balanced/events-on")?.gated).toBe(false);
    expect(cells.find((c) => c.key === "4p/balanced/events-on")?.gated).toBe(true);
    expect(cells.find((c) => c.key === "4p/random/events-on")?.gated).toBe(false);
  });

  it("every cell's games are valid Standard-deck configs with its deal and role list", () => {
    for (const c of buildMatrix(opts({ setups: ["balanced", "random", "possible", "hidden"] }))) {
      const { config } = setupGame(cellSimOptions(opts(), c), c.players, 0);
      expect(config.uniqueRoles).toBeUndefined();
      expect(config.deck).toBe("standard");
      expect(config.deal).toBe(c.setup === "random" ? "random" : "balanced");
      expect(config.roleList).toBe(c.setup === "possible" || c.setup === "hidden" ? c.setup : "exact");
      expect(config.eventsEnabled).toBe(c.events);
    }
  });

  it("a game's seed comes from the suite seed, the cell and the game index only", () => {
    const o = opts({ seed: "S", batch: 7 });
    const cell = buildMatrix(o).find((c) => c.key === "6p/random/events-off");
    if (!cell) throw new Error("cell missing");
    const so = cellSimOptions(o, cell);
    expect(gameSeed(so.seed, cell.players, 12)).toBe("S/6p/random/events-off/6p/12");
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
  const mole = (over = {}) => seat({ id: "m", role: "mole", tag: "loneWolf", star: true, ...over });
  const games = [
    gameRec({ players: 4, winners: ["a", "m"], playerRecords: [seat({ id: "a", winCredit: 0.5, tokensEarned: 2, tokensSpent: 1 }), seat({ id: "b", role: "lookout" }), mole({ winCredit: 0.5, tokensEarned: 1 })] }),
    gameRec({ players: 4, result: "failed", reason: "heat", winners: ["m"], playerRecords: [seat({ id: "a" }), mole({ winCredit: 1, tokensEarned: 2, tokensSpent: 2 })] }),
    gameRec({ players: 4, result: "failed", reason: "target", winners: [], playerRecords: [seat({ id: "a" }), seat({ id: "b", role: "lookout" })] }),
  ];

  it("count what the rates need: endings, no-winner and shared wins, credit by ending, tokens — extension.md Build notes \"Sim\"", () => {
    const t = tallyGames(games);
    expect(t).toMatchObject({ games: 3, successes: 1, failures: 2, heatFailures: 1, targetFailures: 1, noWinner: 1, sharedWin: 1 });
    expect(t.roles.rookie).toEqual({ seats: 3, credit: 0.5, fair: 0.75, successCredit: 0.5, earned: 2, spent: 1 });
    expect(t.roles.mole).toEqual({ seats: 2, credit: 1.5, fair: 0.5, successCredit: 0.5, earned: 3, spent: 2 });
    expect(Object.keys(t.roles)).toEqual(["lookout", "mole", "rookie"]);
  });

  it("adding tallies is folding the games together", () => {
    expect(addTallies(tallyGames(games.slice(0, 1)), tallyGames(games.slice(1)))).toEqual(tallyGames(games));
    expect(addTallies(emptyTally(), tallyGames(games))).toEqual(tallyGames(games));
  });
});

describe("adaptive stopping", () => {
  const cell = buildMatrix(opts()).find((c) => c.key === "6p/balanced/events-on");
  if (!cell) throw new Error("cell missing");
  const t = (over: Partial<ReturnType<typeof emptyTally>>) => ({ ...emptyTally(), ...over });

  it("never stops before minGames; stops at maxGames even if not narrow enough", () => {
    const o = opts({ minGames: 400, maxGames: 1000, ciHalfWidth: 0.02 });
    expect(cellStatus(o, cell, t({ games: 200, successes: 200 }))).toEqual({ done: false, converged: false });
    expect(cellStatus(o, cell, t({ games: 1000, successes: 600 }))).toEqual({ done: true, converged: false });
  });

  it("stops once every checked rate is within the target half-width", () => {
    const o = opts({ minGames: 400, maxGames: 100000, ciHalfWidth: 0.02 });
    const narrow = { games: 10000, successes: 6500, failures: 3500, heatFailures: 600, comebackGames: 6000, act1LeaderWins: 2900, shakedowns: 10000, shakedownsCaught: 5000 };
    expect(cellStatus(o, cell, t({ ...narrow, decidedEarly: 800 }))).toEqual({ done: true, converged: true });
    // Heat share over only 350 failures is ±4 pp: keep going.
    expect(cellStatus(o, cell, t({ ...narrow, decidedEarly: 800, failures: 350, heatFailures: 60 })).done).toBe(false);
  });

  it("an ungated cell (Truly random, or under 4 players) has no bands, so it stops at minGames", () => {
    const o = opts({ minGames: 400, maxGames: 100000, ciHalfWidth: 0.02 });
    const random = buildMatrix(o).find((c) => c.key === "6p/random/events-on");
    if (!random) throw new Error("cell missing");
    expect(cellStatus(o, random, t({ games: 400, successes: 100 }))).toEqual({ done: true, converged: true });
    expect(cellStatus(o, cell, t({ games: 400, successes: 100 })).done).toBe(false);
  });
});

describe("role parity — extension.md Build notes \"Sim\"", () => {
  const n = 5;
  const seats = (s: number, winShare: number) => ({ seats: s, credit: s * winShare, fair: s / n, successCredit: 0, earned: 0, spent: 0 });

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
  it("split gate (PM 3 Nov): the spread over team roles only, ★ roles in STAR_BAND of the team roles' pooled ratio — docs/balance/r6-balance.md", () => {
    // auditor and cleaner win only a success; mole, fence and embezzler are ★ (winsOn).
    const split = splitParityOf({
      auditor: seats(40000, 0.12),
      cleaner: seats(40000, 0.13),
      mole: seats(40000, 0.2),
      fence: seats(40000, 0.3),
      embezzler: seats(40000, 0.1),
    });
    expect(split.team.spread).toBe(0.05);
    expect(split.team.check).toEqual({ verdict: "pass", sure: true });
    expect(split.team.average?.ratio).toBe(0.625);
    const star = Object.fromEntries(split.stars.map((x) => [x.role, x]));
    expect(star.mole).toMatchObject({ relative: 1.6, check: { verdict: "pass", sure: true } });
    expect(star.fence).toMatchObject({ relative: 2.4, check: { verdict: "fail", sure: true } });
    expect(star.embezzler).toMatchObject({ relative: 0.8, check: { verdict: "fail", sure: true } });
  });
  it("the team-role spread is gated at TEAM_PARITY_MAX_SPREAD (0.20, PM provisional), not the 0.10 target — docs/balance/r6-balance.md", () => {
    const team = { auditor: seats(40000, 0.12), cleaner: seats(40000, 0.15) };
    expect(splitParityOf(team).team).toMatchObject({ spread: 0.15, check: { verdict: "pass", sure: true } });
    expect(parityOf(team).check).toEqual({ verdict: "fail", sure: true });
  });
});

/** A finished cell with a made-up tally, for report/merge tests. */
function fakeCell(o: SuiteOptions, key: string, successes: number, games = 1000): CellResult {
  const cell = buildMatrix(o).find((c) => c.key === key);
  if (!cell) throw new Error(`no cell ${key}`);
  return { ...cell, batches: 5, converged: true, tally: { ...emptyTally(), games, successes, failures: games - successes } };
}

describe("report, merge and compare", () => {
  const o = opts({ playerCounts: [4, 6], setups: ["balanced"], events: [true] });
  const keys = buildMatrix(o).map((c) => c.key);
  const cells = [fakeCell(o, keys[0] as string, 620), fakeCell(o, keys[1] as string, 800)];

  it("checks each rate against its target — design §17.4", () => {
    const r = buildReport(o, versions, cells);
    expect(r.cells[0]?.rates.success?.check).toEqual({ verdict: "pass", sure: true });
    expect(r.cells[1]?.rates.success?.check).toEqual({ verdict: "fail", sure: true });
    expect(formatSuiteReport(r)).toContain("4p/balanced/events-on");
    // Refused bot commands are a failure of their own.
    const bad = buildReport(o, versions, [cells[0] as CellResult, { ...(cells[1] as CellResult), tally: { ...(cells[1] as CellResult).tally, rejections: 2 } }]);
    expect(bad.checks.fail).toBe(r.checks.fail + 1);
  });

  it("counts only interval-confirmed PASS/FAIL; a FAIL within noise of the bound is inconclusive (PR #34 review)", () => {
    // 680/1000 is inside 55–70% but its interval crosses 70%; 720/1000 is outside but also crosses it.
    const r = buildReport(o, versions, [fakeCell(o, keys[0] as string, 680), fakeCell(o, keys[1] as string, 720)]);
    expect(r.cells.map((c) => verdictText(c.rates.success?.check ?? null))).toEqual(["inconcl.", "inconcl."]);
    const sure = buildReport(o, versions, cells);
    expect(sure.checks.fail).toBeGreaterThan(0);
    // Neither success check is a confirmed FAIL here, so --strict (checks.fail > 0) can only come from other checks.
    expect(r.checks.fail).toBe(sure.checks.fail - 1);
    expect(r.checks.inconclusive).toBe(sure.checks.inconclusive + 2);
  });

  it("labels a fixed -n run as fixed, without cap marks (PR #34 QA)", () => {
    const fixed = { ...o, minGames: 1000, maxGames: 1000, batch: 200 };
    const text = formatSuiteReport(buildReport(fixed, versions, cells.map((c) => ({ ...c, converged: false }))));
    expect(text).toContain("Fixed: 1000 games per cell");
    expect(text).not.toMatch(/1000\+/);
    expect(formatSuiteReport(buildReport(o, versions, cells.map((c) => ({ ...c, converged: false }))))).toMatch(/1000\+/);
  });

  it("checks a baseline's shape before use (PR #34 QA)", () => {
    const good = JSON.parse(stringifyJson(buildReport(o, versions, cells)));
    expect(typeof checkReport(good)).toBe("object");
    expect(checkReport({ kind: "skimjob-sim-suite", format: 1 })).toMatch(/versions/);
    expect(checkReport({ ...good, cells: null })).toBe("cells isn't a list");
    expect(checkReport({ ...good, parity: [{}] })).toMatch(/parity group 1/);
    expect(checkReport({ ...good, cells: [{ key: "x", rates: { success: { rate: "high" } } }] })).toMatch(/rate success/);
    expect(checkReport("nope")).toMatch(/isn't a suite report/);
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
    // Malformed files with the right kind and format (PR #34 QA): a message, never a crash.
    const { shard: _drop, ...noShard } = shard(1, 2);
    expect(mergeShards([noShard, shard(2, 2)])).toMatch(/^file 1 shard isn't/);
    expect(mergeShards([{ ...shard(1, 2), cells: null }, shard(2, 2)])).toBe("file 1 cells isn't a list");
    expect(mergeShards([{ ...shard(1, 2), options: { seed: 1 } }, shard(2, 2)])).toMatch(/^file 1 options.seed/);
    const badTally = shard(1, 2);
    expect(mergeShards([{ ...badTally, cells: badTally.cells.map((c) => ({ ...c, tally: { games: -1 } })) }, shard(2, 2)])).toMatch(/tally.games isn't a count/);
  });

  it("compare notes different sampling settings (PR #34 review)", () => {
    const base = buildReport({ ...o, ciHalfWidth: 0.05, maxGames: 400 }, versions, cells);
    expect(compareReports(base, buildReport(o, versions, cells))).toMatch(/sampling differs/);
    expect(compareReports(base, base)).not.toMatch(/sampling differs/);
  });

  it("compare shows what moved, marks real moves and flipped checks", () => {
    const base = buildReport(o, versions, cells);
    const cur = buildReport(o, versions, [fakeCell(o, keys[0] as string, 500), cells[1] as CellResult]);
    const text = compareReports(base, cur);
    expect(text).toContain("-12.0*");
    expect(text).toContain("4p/balanced/events-on success: PASS → FAIL");
    expect(compareReports(base, base)).toContain("No check changed verdict.");
  });
});

describe("suite arguments", () => {
  it("defaults: the whole matrix, ±2 pp, 400–6000 games in batches of 200", () => {
    const r = parseSuiteArgs([]);
    if (r.kind !== "run") throw new Error("should parse");
    expect(r.options).toMatchObject({ seed: "suite", setups: ["balanced", "random", "possible"], events: [true, false], ciHalfWidth: 0.02, minGames: 400, maxGames: 6000, batch: 200 });
    expect(r.options.playerCounts).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(r.settings).toMatchObject({ shard: null, out: "sim-output/suite.json", strict: false });
  });

  it("-n fixes the games per cell; shards, merge and bad values", () => {
    const r = parseSuiteArgs(["--", "-n", "30", "--events", "off", "--shard", "2/3"]);
    if (r.kind !== "run") throw new Error("should parse");
    expect(r.options).toMatchObject({ minGames: 30, maxGames: 30, batch: 30, events: [false] });
    expect(r.settings).toMatchObject({ shard: { index: 2, count: 3 }, out: "sim-output/suite-shard-2-of-3.json" });
    expect(parseSuiteArgs(["merge", "a.json", "b.json", "--strict"])).toMatchObject({ kind: "merge", files: ["a.json", "b.json"], settings: { strict: true } });
    for (const bad of [["--shard", "3/2"], ["--shard", "1/2", "--strict"], ["--setups", "sometimes"], ["--ci", "0"], ["-n", "5", "--max-games", "9"], ["--min-games", "500", "--max-games", "100"], ["merge"], ["merge", "a", "-p", "4"], ["-w", "0"], ["-n", "3", "--batch", "5"], ["--min-games", "100", "--batch", "200"]]) {
      expect(parseSuiteArgs(bad).kind, bad.join(" ")).toBe("error");
    }
  });
});
