// Building simulated crews. design §17.4 (bot mix, seed)
import { describe, expect, it } from "vitest";
import { validateConfig } from "@skimjob/engine";
import { crewFor, gameSeed, setupGame } from "./crew";
import { parseSimArgs, type SimOptions } from "./args";
import type { MixEntry } from "./args";

const mix = (...ws: [string, number][]): MixEntry[] => ws.map(([personality, weight]) => ({ personality, weight }) as MixEntry);
const count = (crew: string[]) => crew.reduce<Record<string, number>>((m, p) => ({ ...m, [p]: (m[p] ?? 0) + 1 }), {});
const options = (argv: string[] = []): SimOptions => {
  const r = parseSimArgs(argv);
  if (r.kind !== "run") throw new Error("bad args");
  return r.options;
};

describe("crewFor — the bot mix by weight", () => {
  it("gives each personality its share of seats", () => {
    expect(count(crewFor(mix(["honest", 1], ["greedy", 1]), 6, "s"))).toEqual({ honest: 3, greedy: 3 });
    expect(count(crewFor(mix(["honest", 3], ["greedy", 1]), 8, "s"))).toEqual({ honest: 6, greedy: 2 });
    expect(crewFor(mix(["random", 1]), 12, "s")).toEqual(Array(12).fill("random"));
  });

  it("is deterministic per seed and always fills the crew", () => {
    const m = mix(["honest", 1], ["opportunist", 1], ["greedy", 1], ["cautious", 1]);
    expect(crewFor(m, 6, "a")).toEqual(crewFor(m, 6, "a"));
    for (let n = 3; n <= 12; n++) expect(crewFor(m, n, `n${n}`)).toHaveLength(n);
  });

  it("over many games, leftover seats are shared fairly (no list-order bias)", () => {
    const m = mix(["honest", 1], ["opportunist", 1], ["greedy", 1], ["cautious", 1]);
    const totals: Record<string, number> = {};
    for (let i = 0; i < 400; i++) for (const p of crewFor(m, 2, `g${i}`)) totals[p] = (totals[p] ?? 0) + 1;
    for (const k of ["honest", "opportunist", "greedy", "cautious"]) expect(totals[k]).toBeGreaterThan(150);
  });
});

describe("setupGame", () => {
  it("builds a valid config with one seed per game", () => {
    const o = options(["--overrides", '{"heat":{"perRound":5}}']);
    const { config, crew } = setupGame(o, 5, 3);
    expect(validateConfig(config)).toEqual([]);
    expect(config.seed).toBe(gameSeed("sim", 5, 3));
    expect(config.players.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(crew).toHaveLength(5);
    expect(config.contentOverrides).toEqual({ heat: { perRound: 5 } });
    expect(setupGame(o, 5, 4).config.seed).not.toBe(config.seed);
  });
});
