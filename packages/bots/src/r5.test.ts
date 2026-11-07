// R5 parity pass bot settings (docs/balance/balance-3.md): the Hacker loops its
// own room when it skims. Bots are
// players, so these are play choices, not rules. design §8, §17.3 (v2 §4)
import { describe, expect, it } from "vitest";
import { ROUNDS_PER_ACT } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState } from "@skimjob/engine";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots, runBotGame } from "./run";

const MIX: PersonalityId[] = ["honest", "opportunist", "greedy", "cautious"];

function play(n: number, seed: string, rolePool: string[]): GameState {
  const c: GameConfig = {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool,
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
  };
  const r = runBotGame(c, createBots(c.players, (_, i) => PERSONALITIES[MIX[(i + seed.length) % MIX.length] as PersonalityId], c.seed));
  expect(r.rejections).toEqual([]);
  return r.state;
}

const of = <T extends GameEvent["type"]>(s: GameState, type: T) => s.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const holder = (s: GameState, role: string) => s.playerOrder.find((id) => s.players[id]?.role === role);

describe("R5 bot settings — v2 §4, docs/balance/balance-3.md", () => {
  it("a Hacker that skims loops its own room that round", () => {
    let skimmed = 0;
    for (let g = 0; g < 12; g++) {
      const s = play(9, `hack-${g}`, ["hacker", "rookie", "lookout", "fixer", "auditor"]);
      const hacker = holder(s, "hacker");
      if (hacker === undefined) continue;
      for (const loop of of(s, "abilityResolved").filter((e) => e.player === hacker && e.ability.kind === "loopCameras")) {
        const split = of(s, "coinsGrabbed").find((e) => e.player === hacker && e.round === loop.round);
        if (!split || split.pocket === 0) continue;
        skimmed++;
        expect(loop.ability).toMatchObject({ kind: "loopCameras", room: split.room });
      }
    }
    expect(skimmed).toBeGreaterThan(0);
  });
});
