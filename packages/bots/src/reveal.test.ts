// The end-of-game reveal summary over whole bot games (design §15.5): it adds
// up to the final ranking and shows every raid, reopened room, power cut and
// power used.
import { describe, expect, it } from "vitest";
import { revealSummary, viewFor, type GameConfig, type GameEvent, type RevealItem } from "@skimjob/engine";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots, runBotGame } from "./run";

const IDS: PersonalityId[] = ["honest", "opportunist", "greedy", "cautious", "random"];

function config(n: number, seed: string, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `R${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: true,
    voteVisibility: "secret",
    ...extra,
  };
}

const play = (c: GameConfig) => runBotGame(c, createBots(c.players, (_, i) => PERSONALITIES[IDS[i % IDS.length] as PersonalityId], c.seed)).state;
const count = (log: readonly GameEvent[], f: (e: GameEvent) => boolean) => log.filter(f).length;

describe("reveal summary in whole bot games — design §15.5", () => {
  it("adds up to the ranking and shows every raid, reopened room, power cut and power used, for every viewer", () => {
    const seen = new Set<string>();
    for (const [n, seed] of [
      [3, "rv-a"],
      [5, "rv-b"],
      [8, "rv-c"],
      [12, "rv-d"],
      [5, "rv-5-7"],
      [8, "rv-8-4"],
    ] as const) {
      const state = play(config(n, seed));
      expect(state.phase.kind).toBe("ended");
      for (const viewer of state.playerOrder) {
        const reveal = viewFor(state, viewer).reveal;
        if (!reveal) throw new Error("no reveal after the game");
        const log = reveal.log.map((e) => e.event);
        const { summary } = reveal;
        // design §15.5: built only from the viewer's own reveal log (so it can't leak past it).
        expect(summary).toEqual(revealSummary(log, reveal.outcome));
        // The stash over time ends at each player's final stash (absolves and shakedowns included).
        const last = summary.rounds.at(-1)?.stashes ?? {};
        for (const seat of summary.seats) expect(last[seat.player], `${seed} ${viewer} ${seat.player}`).toBe(seat.stash);
        expect(summary.seats.map((s) => s.player)).toEqual(reveal.outcome.ranking.map((r) => r.player));
        const items: RevealItem[] = summary.rounds.flatMap((r) => [...r.items]);
        for (const type of ["powerCut", "abilityResolved"] as const) {
          expect(items.filter((i) => i.kind === "event" && i.event.type === type).length, type).toBe(count(log, (e) => e.type === type));
        }
        expect(items.filter((i) => i.kind === "token").length).toBe(count(log, (e) => e.type === "tokenEarned"));
        for (const i of items) seen.add(i.kind === "event" ? i.event.type : i.kind);
      }
    }
    // Tokens and perks: reveal.qa.test.ts (the Mole's and Fixer's R6 tokens are gone, so these games earn few).
    expect([...seen].sort()).toEqual(expect.arrayContaining(["roomRaided", "roomReopened", "powerCut", "sinsAbsolved"]));
  }, 120_000);
});
