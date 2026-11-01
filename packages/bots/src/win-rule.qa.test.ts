// QA (PR #25, role deck v2 R1): the win rule in every real ending, checked on
// all-bot games with the dark side on and off, events on and off. Each game's
// winners must be the leaders of the right side of its own final ranking:
// success → crew only; failure (Heat raid or missed target) → saboteurs and
// accomplices only, nobody if none was dealt. design §3 (docs/roles-v2.md §0)
import { describe, expect, it } from "vitest";
import { ROLES } from "@skimjob/content";
import { leadersOf, type GameConfig, type MoleSetting } from "@skimjob/engine";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots, runBotGame } from "./run";

const MIXED: PersonalityId[] = ["honest", "opportunist", "cautious", "greedy", "random"];
const dark = (role: string) => (ROLES[role]?.faction ?? "crew") !== "crew";

function config(n: number, seed: string, mole: MoleSetting, eventsEnabled: boolean): GameConfig {
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    mole,
    eventsEnabled,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
  };
}

describe("QA: win rule in every ending, all-bot games — design §3", () => {
  it("winners are the leaders of the right side, in success, Heat raids and missed targets; no refused command", () => {
    const endings = new Map<string, number>();
    for (const n of [4, 6, 9, 12]) {
      for (const mole of ["on", "off"] as const) {
        for (const events of [false, true]) {
          for (let i = 0; i < 4; i++) {
            const c = config(n, `win-${n}-${mole}-${events}-${i}`, mole, events);
            const { state, rejections } = runBotGame(c, createBots(c.players, (_, k) => PERSONALITIES[MIXED[k % MIXED.length] as PersonalityId], c.seed));
            expect(rejections).toEqual([]);
            if (state.phase.kind !== "ended") throw new Error("not ended");
            const o = state.phase.outcome;
            const side = o.result === "success" ? o.ranking.filter((e) => !dark(e.role)) : o.ranking.filter((e) => dark(e.role));
            expect([...o.winners].sort()).toEqual([...leadersOf(side)].sort());
            if (o.result === "failed" && !o.ranking.some((e) => dark(e.role))) expect(o.winners).toEqual([]);
            if (o.result === "success") for (const w of o.winners) expect(dark(o.ranking.find((e) => e.player === w)?.role ?? "")).toBe(false);
            const key = `${o.result === "success" ? "success" : o.reason}/${o.ranking.some((e) => dark(e.role)) ? "dark" : "crew-only"}`;
            endings.set(key, (endings.get(key) ?? 0) + 1);
          }
        }
      }
    }
    // The sample covers success and both failures, with and without a dark side.
    expect([...endings.keys()]).toEqual(expect.arrayContaining(["success/dark", "success/crew-only"]));
    expect([...endings.keys()].some((k) => k.startsWith("heat/") || k.startsWith("target/"))).toBe(true);
  });
});
