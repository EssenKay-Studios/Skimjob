// Running batches: determinism, settings checks, and content overrides reaching
// the engine and the bots. design §17.2 (deterministic), §17.4
import { describe, expect, it } from "vitest";
import { checkOptions, runBatch, runOne } from "./run";
import { parseSimArgs, type SimOptions } from "./args";
import { summarize } from "./metrics";

const options = (argv: string[]): SimOptions => {
  const r = parseSimArgs(argv);
  if (r.kind !== "run") throw new Error(`bad args ${JSON.stringify(r)}`);
  return r.options;
};

describe("runBatch", () => {
  it("runs N games at each player count, in order", () => {
    const seen: number[] = [];
    const records = runBatch(options(["-n", "3", "-p", "2,7"]), (n) => seen.push(n));
    expect(records.map((r) => r.players)).toEqual([2, 2, 2, 7, 7, 7]);
    expect(seen).toEqual([2, 7]);
    expect(records.every((r) => r.rejections === 0)).toBe(true);
  });

  it("same options and seed, same results; another seed, other games (design §17.2)", () => {
    const o = options(["-n", "4", "-p", "5", "-s", "repeat"]);
    expect(runBatch(o)).toEqual(runBatch(o));
    expect(runBatch(options(["-n", "4", "-p", "5", "-s", "other"]))).not.toEqual(runBatch(o));
  });

  it("plays every setting: starter mode, decks, deals, role lists, vote modes, Random bots", () => {
    for (const argv of [["--starter"], ["--deck", "everything", "-p", "9"], ["--deal", "random", "-p", "7"], ["--role-list", "hidden"], ["--role-list", "possible"], ["--votes", "secret"], ["--votes", "open"], ["-b", "random"], ["--role-pool", "lookout,fence"]]) {
      const o = options(["-n", "2", ...argv]);
      expect(checkOptions(o)).toEqual([]);
      expect(runBatch(o).every((r) => r.rejections === 0)).toBe(true);
    }
    // extension.md "Decks and dealing": Starter mode plays the Starter deck whatever --deck says.
    const starter = runBatch(options(["-n", "2", "-p", "5", "--starter", "--deck", "everything"]));
    expect(starter[0]?.playerRecords.every((p) => !p.star)).toBe(true);
  });
});

describe("checkOptions — the engine's validateConfig on the sim's settings", () => {
  it("passes the defaults", () => {
    expect(checkOptions(options([]))).toEqual([]);
  });
  it("reports bad role pools, jobs and overrides (untrusted JSON, design §17.4)", () => {
    expect(checkOptions(options(["--role-pool", "getaway"]))).toEqual(["unknown role getaway"]);
    expect(checkOptions(options(["--job", "casino"]))).toEqual(["unknown job casino"]);
    expect(checkOptions(options(["--overrides", '{"heat":{"perRound":"lots"}}']))).toEqual(["contentOverrides.heat.perRound must be a finite number"]);
  });
});

describe("content overrides change the games (design §17.4)", () => {
  it("bots use the overridden numbers: with 1-loot rooms no bot pockets more than 1 a round, and none is refused", () => {
    const o = options(["-n", "6", "-p", "6", "--overrides", '{"rooms":{"vault":{"loot":1},"office":{"loot":1},"lobby":{"loot":1},"depositBoxes":{"loot":1,"capacity":{"crowdedLoot":1}}}}']);
    expect(checkOptions(o)).toEqual([]);
    const records = runBatch(o);
    expect(records.every((r) => r.rejections === 0)).toBe(true);
    for (const r of records) for (const p of r.playerRecords) expect(p.looted).toBeLessThanOrEqual(9);
  });

  it("raising the baseline Heat sends more heists to the cops", () => {
    const base = summarize(runBatch(options(["-n", "20", "-p", "6"]))).overall;
    const hot = summarize(runBatch(options(["-n", "20", "-p", "6", "--overrides", '{"heat":{"perRound":30}}']))).overall;
    expect(hot.heatFailures).toBeGreaterThan(base.heatFailures);
  });

  it("a game's record names its seed", () => {
    expect(runOne(options([]), 4, 2).seed).toBe("sim/4p/2");
  });
});
