// QA for PR #43: the sim gives its bots a crewSeed from the hidden game
// seed (never from public data), and the sim stays deterministic: same seed →
// identical event log, and the same records on one thread or two workers.
// design §17.2, §17.3, §17.4
import { replay, viewFor } from "@skimjob/engine";
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => [] as string[]);
vi.mock("@skimjob/bots", async (importOriginal) => {
  const real = await importOriginal<typeof import("@skimjob/bots")>();
  return {
    ...real,
    createBots: (...args: Parameters<typeof real.createBots>) => {
      seen.push(args[2]);
      return real.createBots(...args);
    },
  };
});

const { PERSONALITIES, createBots, runBotGame } = await import("@skimjob/bots");
const { parseSimArgs } = await import("./args");
const { setupGame } = await import("./crew");
const { createPool } = await import("./pool");
const { runBatch, runBatchOn, runOne } = await import("./run");

const opts = (argv: string[]) => {
  const r = parseSimArgs(argv);
  if (r.kind !== "run") throw new Error(JSON.stringify(r));
  return r.options;
};

describe("QA PR #43: sim crewSeed and determinism", () => {
  const options = opts(["-n", "6", "-p", "3,5,8,12", "--events", "-s", "qa43", "--no-files"]);

  it("runOne seeds the bots (and so their crewSeed) with the game's hidden seed, which no player's view contains", () => {
    for (const n of [3, 5, 12]) {
      for (let i = 0; i < 2; i++) {
        seen.length = 0;
        runOne(options, n, i);
        const { config } = setupGame(options, n, i);
        expect(seen).toEqual([config.seed]);
        // Not in any view while the game runs (the reveal shows it only after the end).
        const agents = createBots(config.players, () => PERSONALITIES.honest, config.seed);
        const game = runBotGame(config, agents);
        const ended = game.state.log.findIndex((e) => e.type === "gameEnded");
        expect(ended).toBeGreaterThan(0);
        const before = replay(config, game.state.log.slice(0, ended));
        for (const p of game.state.playerOrder) expect(JSON.stringify(viewFor(before, p))).not.toContain(config.seed);
      }
    }
  });

  it("same seed → identical event log, at 3, 8 and 12 players, with no refused bot commands", () => {
    for (const n of [3, 8, 12]) {
      const { config, crew } = setupGame(options, n, 1);
      const play = () => runBotGame(config, createBots(config.players, (_s, i) => PERSONALITIES[crew[i]!], config.seed));
      const a = play();
      const b = play();
      expect(JSON.stringify(b.state.log)).toBe(JSON.stringify(a.state.log));
      expect(a.rejections).toEqual([]);
      // A different hidden seed gives a different game.
      const other = setupGame(options, n, 2).config;
      expect(JSON.stringify(runBotGame(other, createBots(other.players, (_s, i) => PERSONALITIES[crew[i]!], other.seed)).state.log)).not.toBe(JSON.stringify(a.state.log));
    }
  });

  it("runBatch on one thread and runBatchOn with 2 workers give the same records", { timeout: 120_000 }, async () => {
    const small = opts(["-n", "4", "-p", "3,5", "-s", "qa43-w", "--no-files"]);
    const one = runBatch(small);
    const pool = createPool(2);
    try {
      const two = await runBatchOn(pool, small);
      expect(JSON.stringify(two)).toBe(JSON.stringify(one));
    } finally {
      await pool.close();
    }
    expect(one.every((r) => r.rejections === 0)).toBe(true);
  });
});
