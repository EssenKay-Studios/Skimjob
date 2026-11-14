// QA for Learn the game (design §14): whole bot games are deterministic, the
// event switch changes nothing (empty deck), and the round cap holds at the
// smallest and largest crews the ruleset deals.
import { describe, expect, it } from "vitest";
import type { GameConfig } from "@skimjob/engine";
import { PERSONALITIES } from "./personalities";
import { createBots, runBotGame } from "./run";

const config = (seed: string, n = 4, eventsEnabled = true): GameConfig => ({
  seed,
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
  job: "bank",
  ruleset: "learn",
  eventsEnabled,
  voteVisibility: "hiddenThenRevealed",
});
const run = (c: GameConfig, botSeed: string) => runBotGame(c, createBots(c.players, () => PERSONALITIES.opportunist, botSeed));

describe("Learn the game bot games — design §14", () => {
  it("same seed and bots, same log", () => {
    for (let i = 0; i < 5; i++) {
      const c = config(`det-${i}`);
      expect(run(c, `b-${i}`).state.log).toEqual(run(c, `b-${i}`).state.log);
    }
  });

  it("the same game with events off: only gameCreated's switch differs", () => {
    for (let i = 0; i < 5; i++) {
      const on = run(config(`ev-${i}`), `b-${i}`).state.log;
      const off = run(config(`ev-${i}`, 4, false), `b-${i}`).state.log;
      const strip = (log: typeof on) => log.map((e) => (e.type === "gameCreated" ? { ...e, eventsEnabled: null } : e));
      expect(strip(off)).toEqual(strip(on));
    }
  });

  it("ends by round 6 at 3 and at 8 players, with no refused command", () => {
    for (const n of [3, 8]) {
      for (let i = 0; i < 8; i++) {
        const c = config(`size-${n}-${i}`, n);
        const { state, rejections } = run(c, `b-${n}-${i}`);
        expect(state.phase.kind, c.seed).toBe("ended");
        expect(rejections, c.seed).toEqual([]);
        expect(state.log.filter((e) => e.type === "roundStarted").length, c.seed).toBeLessThanOrEqual(6);
      }
    }
  });
});
