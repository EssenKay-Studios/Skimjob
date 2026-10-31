// Simulator options. design §17.4 "Inputs"
import { describe, expect, it } from "vitest";
import { DEFAULT_MIX, parseMix, parsePlayerCounts, parseSimArgs, type SimOptions } from "./args";

const run = (argv: string[], readFile?: (p: string) => string): SimOptions => {
  const r = parseSimArgs(argv, readFile);
  if (r.kind !== "run") throw new Error(`expected options, got ${JSON.stringify(r)}`);
  return r.options;
};
const error = (argv: string[]): string => {
  const r = parseSimArgs(argv);
  if (r.kind !== "error") throw new Error(`expected an error, got ${r.kind}`);
  return r.message;
};

describe("player counts — design §17.4 (2–12)", () => {
  it("takes one count, a range or a list, sorted and deduplicated", () => {
    expect(parsePlayerCounts("6")).toEqual([6]);
    expect(parsePlayerCounts("2-12")).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(parsePlayerCounts("8,4,6,4")).toEqual([4, 6, 8]);
    expect(parsePlayerCounts("2-4,10")).toEqual([2, 3, 4, 10]);
  });
  it("refuses counts outside 2–12 and junk", () => {
    expect(parsePlayerCounts("1")).toMatch(/2–12/);
    expect(parsePlayerCounts("2-13")).toMatch(/2–12/);
    expect(parsePlayerCounts("6-4")).toMatch(/range/);
    expect(parsePlayerCounts("six")).toMatch(/bad player count/);
    expect(parsePlayerCounts("")).toMatch(/bad player count/);
  });
});

describe("bot mix — design §17.3, §17.4", () => {
  it("takes names with optional weights, case-insensitive", () => {
    expect(parseMix("honest:2,Greedy")).toEqual([
      { personality: "honest", weight: 2 },
      { personality: "greedy", weight: 1 },
    ]);
  });
  it("refuses unknown bots, bad weights and repeats", () => {
    expect(parseMix("mole")).toMatch(/unknown bot/);
    expect(parseMix("toString")).toMatch(/unknown bot/);
    expect(parseMix("honest:0")).toMatch(/bad weight/);
    expect(parseMix("honest:x")).toMatch(/bad weight/);
    expect(parseMix("honest:1:2")).toMatch(/unknown bot/);
    expect(parseMix("honest,honest")).toMatch(/twice/);
  });
});

describe("parseSimArgs", () => {
  it("has sensible defaults", () => {
    expect(run([])).toEqual({
      games: 100,
      playerCounts: [6],
      mix: DEFAULT_MIX,
      seed: "sim",
      job: "bank",
      rolePool: [],
      starterMode: false,
      mole: "off",
      voteVisibility: "hiddenThenRevealed",
      contentOverrides: null,
      outDir: "sim-output",
      json: false,
    });
  });

  it("ignores the leading -- that `pnpm sim -- …` passes through", () => {
    expect(parseSimArgs(["--", "--help"])).toEqual({ kind: "help" });
    expect(run(["--", "-n", "5"]).games).toBe(5);
  });

  it("reads every option", () => {
    const o = run([
      "-n", "7", "-p", "3-4", "-b", "random", "-s", "x", "--job", "bank", "--role-pool", "lookout, fence",
      "--starter", "--mole", "maybe", "--votes", "secret", "--out", "here", "--json",
    ]);
    expect(o).toMatchObject({
      games: 7, playerCounts: [3, 4], mix: [{ personality: "random", weight: 1 }], seed: "x", rolePool: ["lookout", "fence"],
      starterMode: true, mole: "maybe", voteVisibility: "secret", outDir: "here", json: true,
    });
    expect(run(["--no-files"]).outDir).toBeNull();
  });

  it("reads overrides inline or from a file, and reports bad JSON", () => {
    expect(run(["--overrides", '{"heat":{"perRound":5}}']).contentOverrides).toEqual({ heat: { perRound: 5 } });
    expect(run(["--overrides", "o.json"], (p) => (p === "o.json" ? '{"shakedown":{}}' : "")).contentOverrides).toEqual({ shakedown: {} });
    expect(error(["--overrides", "{nope"])).toMatch(/--overrides/);
  });

  it("refuses bad values and unknown options", () => {
    expect(error(["-n", "0"])).toMatch(/--games/);
    expect(error(["-n", "2.5"])).toMatch(/--games/);
    expect(error(["--mole", "sometimes"])).toMatch(/--mole/);
    expect(error(["--votes", "loud"])).toMatch(/--votes/);
    expect(error(["--frob"])).toMatch(/frob/);
    expect(error(["stray"])).toMatch(/stray|positional/i);
    // An empty --out would resolve to the directory pnpm was run from (PR #10 QA).
    expect(error(["--out", ""])).toMatch(/--out/);
    expect(error(["--out", "  "])).toMatch(/--out/);
  });
});
