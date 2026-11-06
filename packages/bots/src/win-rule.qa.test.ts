// QA: the one-crew win rule in every real ending, checked on all-bot games
// across decks, role lists and events on/off. On a success the top group wins
// whatever their roles; on a failure only top-group members whose role wins
// that ending (`winsOn`), else nobody. extension.md "One crew, and how you win"
import { describe, expect, it } from "vitest";
import { ROLES, type FailureReason } from "@skimjob/content";
import { leadersOf, type GameConfig } from "@skimjob/engine";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots, runBotGame } from "./run";

const MIXED: PersonalityId[] = ["honest", "opportunist", "cautious", "greedy", "random"];
const winsOn = (role: string, reason: FailureReason) => ROLES[role]?.winsOn.includes(reason) ?? false;

function config(n: number, seed: string, deck: "standard" | "everything", eventsEnabled: boolean): GameConfig {
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    deck,
    roleList: deck === "standard" ? "exact" : "possible",
    eventsEnabled,
    voteVisibility: "hiddenThenRevealed",
  };
}

describe("QA: win rule in every ending, all-bot games — extension.md \"One crew, and how you win\"", () => {
  it("success: the top group; failure: its members who win that ending, else nobody; no refused command", () => {
    const endings = new Map<string, number>();
    for (const n of [4, 6, 9, 12]) {
      for (const deck of ["standard", "everything"] as const) {
        for (const events of [false, true]) {
          for (let i = 0; i < 4; i++) {
            const c = config(n, `win-${n}-${deck}-${events}-${i}`, deck, events);
            const { state, rejections } = runBotGame(c, createBots(c.players, (_, k) => PERSONALITIES[MIXED[k % MIXED.length] as PersonalityId], c.seed));
            expect(rejections).toEqual([]);
            if (state.phase.kind !== "ended") throw new Error("not ended");
            const o = state.phase.outcome;
            const top = leadersOf(o.ranking);
            const expected = o.result === "success" ? top : top.filter((id) => winsOn(o.ranking.find((e) => e.player === id)?.role ?? "", o.reason));
            expect([...o.winners].sort()).toEqual([...expected].sort());
            expect(o.ranking).toHaveLength(n);
            const key = o.result === "success" ? "success" : `${o.reason}/${o.winners.length > 0 ? "won" : "nobody"}`;
            endings.set(key, (endings.get(key) ?? 0) + 1);
          }
        }
      }
    }
    // The sample covers success and at least one failure.
    expect(endings.get("success")).toBeGreaterThan(0);
    expect([...endings.keys()].some((k) => k.startsWith("heat/") || k.startsWith("target/"))).toBe(true);
  }, 60_000); // many full bot games: over the 5 s default on a busy machine
});
