// QA (PR #125, C2a): the sim and the suite refuse 2-player games and Duel
// flags, default to 3+ players, and a 3-player batch plays with no refused
// bot command, the same on every run.
import { describe, expect, it } from "vitest";
import { parsePlayerCounts, parseSimArgs } from "./args";
import { runBatch } from "./run";
import { DEFAULTS, parseSuiteArgs } from "./suite/args";

describe("QA #125: sim player counts", () => {
  it.each(["2", "1", "0", "2-12", "2,3", "2-3", "13", "3-13"])("-p %s is refused", (spec) => {
    expect(typeof parsePlayerCounts(spec)).toBe("string");
    expect(parseSimArgs(["-p", spec]).kind).toBe("error");
    expect(parseSuiteArgs(["-p", spec]).kind).toBe("error");
  });

  it("3, 3-12 and 12 are accepted; the suite default is 3-12", () => {
    expect(parsePlayerCounts("3")).toEqual([3]);
    expect(parsePlayerCounts("12")).toEqual([12]);
    expect(parsePlayerCounts("3-12")).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(DEFAULTS.players).toBe("3-12");
    const r = parseSuiteArgs([]);
    expect(r.kind).toBe("run");
  });

  it("--duel is no longer an option", () => {
    expect(parseSimArgs(["--duel"]).kind).toBe("error");
    expect(parseSuiteArgs(["--duel"]).kind).toBe("error");
  });

  it("a 3-player batch (events on) plays with no refused bot command, and is deterministic", { timeout: 60_000 }, () => {
    const r = parseSimArgs(["-n", "10", "-p", "3", "--events", "-s", "qa125", "--no-files"]);
    if (r.kind !== "run") throw new Error(JSON.stringify(r));
    const a = runBatch(r.options);
    expect(a).toHaveLength(10);
    expect(a.every((g) => g.players === 3 && g.rejections === 0)).toBe(true);
    expect(JSON.stringify(runBatch(r.options))).toBe(JSON.stringify(a));
  });
});
