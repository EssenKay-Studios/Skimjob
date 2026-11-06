// QA (PR #36 review fix): the Embezzler's take is capped at the round's inflow, so the
// public Haul change (`roundResolved.haulDelta`) is never negative. All-bot games, many seeds. design §8 (v2 §2)
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent } from "@skimjob/engine";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots, runBotGame } from "./run";

const IDS: PersonalityId[] = ["honest", "opportunist", "greedy", "cautious", "random"];

function config(n: number, seed: string): GameConfig {
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, name: `E${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    mole: "on",
    eventsEnabled: true,
    voteVisibility: "hiddenThenRevealed",
    // The 0.13.0 take of 4 (R5 ships 1, balance-3.md): a take that can outrun a round's inflow tests the cap.
    contentOverrides: { roles: { embezzler: { take: 4 } } },
  };
}

describe("QA Embezzler: the public Haul change is never negative (PR #36 review)", () => {
  it("across many seeds at 4–12 players with an Embezzler dealt", () => {
    let games = 0;
    let takes = 0;
    let fullTakes = 0;
    for (let n = 4; n <= 12; n++) {
      for (let s = 0; s < 15; s++) {
        const c = config(n, `emb-${n}-${s}`);
        const r = runBotGame(c, createBots(c.players, (_, i) => PERSONALITIES[IDS[(i + s) % IDS.length] as PersonalityId], `eb-${s}`));
        const roles = Object.values(r.state.players).map((p) => p.role);
        if (!roles.includes("embezzler") && !r.state.log.some((e) => e.type === "abilityResolved" && e.ability.kind === "embezzle")) continue;
        games++;
        expect(r.rejections, `n=${n} s=${s}`).toEqual([]);
        for (const e of r.state.log as readonly GameEvent[]) {
          if (e.type === "roundResolved") expect(e.haulDelta, `n=${n} s=${s} round ${e.round}`).toBeGreaterThanOrEqual(0);
          if (e.type === "abilityResolved" && e.ability.kind === "embezzle") {
            takes++;
            if (e.ability.amount === 4) fullTakes++;
            // The take never exceeds the round's handed-in loot: the change it is hidden in stays ≥ 0.
            const rr = r.state.log.find((x) => x.type === "roundResolved" && x.round === e.round);
            expect(rr?.type === "roundResolved" && rr.haulDelta >= 0, `n=${n} s=${s}`).toBe(true);
          }
        }
      }
    }
    // The property was really exercised.
    expect(games).toBeGreaterThan(30);
    expect(takes).toBeGreaterThan(10);
    expect(fullTakes).toBeGreaterThan(0);
  }, 120_000);
});
