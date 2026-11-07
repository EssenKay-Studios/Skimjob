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
    const records = runBatch(options(["-n", "3", "-p", "3,7"]), (n) => seen.push(n));
    expect(records.map((r) => r.players)).toEqual([3, 3, 3, 7, 7, 7]);
    expect(seen).toEqual([3, 7]);
    expect(records.every((r) => r.rejections === 0)).toBe(true);
  });

  it("same options and seed, same results; another seed, other games (design §17.2)", () => {
    const o = options(["-n", "4", "-p", "5", "-s", "repeat"]);
    expect(runBatch(o)).toEqual(runBatch(o));
    expect(runBatch(options(["-n", "4", "-p", "5", "-s", "other"]))).not.toEqual(runBatch(o));
  });

  it("plays every setting: decks, deals, role lists, vote modes, Random bots", () => {
    for (const argv of [["--deck", "everything", "-p", "9"], ["--deal", "random", "-p", "7"], ["--role-list", "hidden"], ["--role-list", "possible"], ["--votes", "secret"], ["--votes", "open"], ["-b", "random"], ["--role-pool", "lookout,hacker"]]) {
      const o = options(["-n", "2", ...argv]);
      expect(checkOptions(o)).toEqual([]);
      expect(runBatch(o).every((r) => r.rejections === 0)).toBe(true);
    }
  });
});

describe("checkOptions — the engine's validateConfig on the sim's settings", () => {
  it("passes the defaults", () => {
    expect(checkOptions(options([]))).toEqual([]);
  });
  it("reports bad role pools, jobs and overrides (untrusted JSON, design §17.4)", () => {
    expect(checkOptions(options(["--role-pool", "wizard"]))).toEqual(["unknown role wizard"]);
    expect(checkOptions(options(["--job", "casino"]))).toEqual(["unknown job casino"]);
    expect(checkOptions(options(["--overrides", '{"alarm":{"bulbs":"lots"}}']))).toEqual(["contentOverrides.alarm.bulbs must be a whole number, 1 or more"]);
  });
});

describe("content overrides change the games (design §17.4)", () => {
  it("bots use the overridden numbers: with 1-coin rooms no bot grabs more than 1 a round, and none is refused", () => {
    const o = options(["-n", "6", "-p", "6", "--overrides", '{"rooms":{"vault":{"coins":1},"office":{"coins":1},"depositBoxes":{"coins":1},"serverRoom":{"coins":1}}}']);
    expect(checkOptions(o)).toEqual([]);
    const records = runBatch(o);
    expect(records.every((r) => r.rejections === 0)).toBe(true);
    for (const r of records) for (const p of r.playerRecords) expect(p.grabbed).toBeLessThanOrEqual(r.endedRound); // 12 rounds at most (design §6.2)
  });

  it("smaller bells mean more raids and busts (design §5)", () => {
    const base = summarize(runBatch(options(["-n", "20", "-p", "6"]))).overall;
    const loud = summarize(runBatch(options(["-n", "20", "-p", "6", "--overrides", '{"alarm":{"bulbs":2}}']))).overall;
    expect(loud.raids.perGame ?? 0).toBeGreaterThan(base.raids.perGame ?? 0);
    expect(loud.busts).toBeGreaterThan(base.busts);
  });

  it("a game's record names its seed", () => {
    expect(runOne(options([]), 4, 2).seed).toBe("sim/4p/2");
  });
});
