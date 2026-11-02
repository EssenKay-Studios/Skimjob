// QA (PR #44): bots never propose a meeting slot (owner decision, 2 Nov; design §11.1, §17.3).
import { describe, expect, it } from "vitest";
import type { GameConfig } from "@skimjob/engine";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots, runBotGame } from "./run";

const IDS = Object.keys(PERSONALITIES) as PersonalityId[];
const config = (n: number, seed: string): GameConfig => ({
  seed,
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
  job: "bank",
  rolePool: [],
  mole: "maybe",
  eventsEnabled: true,
  voteVisibility: "hiddenThenRevealed",
  starterMode: false,
});

describe("bots never propose; games still finish with 0 refused commands", () => {
  for (const n of [2, 3, 8, 12]) {
    it(`${n} bots, 15 seeds: no meetingProposed, no refusals, every game ends`, () => {
      for (let k = 0; k < 15; k++) {
        const c = config(n, `qa44-${n}-${k}`);
        const r = runBotGame(c, createBots(c.players, (_, i) => PERSONALITIES[IDS[(i + k) % IDS.length]!], `b-${k}`));
        expect(r.state.phase.kind).toBe("ended");
        expect(r.rejections).toEqual([]);
        expect(r.state.log.filter((e) => e.type === "meetingProposed")).toEqual([]);
        // Every lock-in mark precedes the move it marks, once per player per round.
        const marks = r.state.log.filter((e) => e.type === "moveLocked").map((e) => `${(e as { round: number }).round}:${(e as { player: string }).player}`);
        expect(new Set(marks).size).toBe(marks.length);
      }
    });
  }
});
