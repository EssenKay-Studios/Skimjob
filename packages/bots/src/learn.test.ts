// Learn the game (design §14): the bots play a whole guided game by the same
// rules: one each of four roles, no shop, no events, at most 6 rounds.
import { describe, expect, it } from "vitest";
import type { GameConfig } from "@skimjob/engine";
import { PERSONALITIES } from "./personalities";
import { createBots, runBotGame } from "./run";

const config = (seed: string): GameConfig => ({
  seed,
  players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
  job: "bank",
  ruleset: "learn",
  eventsEnabled: true,
  voteVisibility: "hiddenThenRevealed",
});

describe("a Learn the game crew — design §14", () => {
  it("finishes within 6 rounds with no event card, no purchase and no refused command", () => {
    for (let i = 0; i < 20; i++) {
      const c = config(`learn-${i}`);
      const { state, rejections } = runBotGame(c, createBots(c.players, () => PERSONALITIES.opportunist, `bots-${i}`));
      expect(state.phase.kind, c.seed).toBe("ended");
      expect(rejections, c.seed).toEqual([]);
      const types = new Set(state.log.map((e) => e.type));
      expect(types.has("eventFlipped"), c.seed).toBe(false);
      expect(types.has("perkBought"), c.seed).toBe(false);
      const rounds = state.log.filter((e) => e.type === "roundStarted").length;
      expect(rounds, c.seed).toBeLessThanOrEqual(6);
    }
  });
});
