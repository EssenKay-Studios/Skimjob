// The end-of-game reveal summary over whole bot games (design §13): it adds up
// to the final ranking and accounts for every hidden police activity and
// "camera offline" (extension.md "Police activity", "Situations").
import { describe, expect, it } from "vitest";
import { ROLES } from "@skimjob/content";
import { eventsFor, revealSummary, rolesFor, viewFor, type GameConfig, type GameEvent, type RevealItem } from "@skimjob/engine";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots, runBotGame } from "./run";

const IDS: PersonalityId[] = ["honest", "opportunist", "greedy", "cautious", "random"];

function config(n: number, seed: string, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `R${i}`, isBot: true })),
    job: "bank",
    rolePool: Object.keys(ROLES) as GameConfig["rolePool"][number][],
    deck: "everything",
    eventsEnabled: true,
    voteVisibility: "secret",
    ...extra,
  };
}

const play = (c: GameConfig) => runBotGame(c, createBots(c.players, (_, i) => PERSONALITIES[IDS[i % IDS.length] as PersonalityId], c.seed)).state;
const count = (log: readonly GameEvent[], f: (e: GameEvent) => boolean) => log.filter(f).length;

describe("reveal summary in whole bot games — design §13", () => {
  it("adds up to the ranking and explains every police activity and offline camera, for every viewer", () => {
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
        // design §13: built only from the viewer's own reveal log (so it can't leak past it).
        expect(summary).toEqual(revealSummary(log, reveal.outcome, { roles: rolesFor(state.config), events: eventsFor(state.config) }));
        // The stash over time ends at each player's final stash (safe included).
        const last = summary.rounds.at(-1)?.stashes ?? {};
        for (const seat of summary.seats) expect(last[seat.player], `${seed} ${viewer} ${seat.player}`).toBe(seat.stash);
        expect(summary.seats.map((s) => s.player)).toEqual(reveal.outcome.ranking.map((r) => r.player));
        const items: RevealItem[] = summary.rounds.flatMap((r) => [...r.items]);
        const police = items.filter((i) => i.kind === "police");
        expect(police.length).toBe(count(log, (e) => e.type === "policeActivity"));
        expect(police.filter((i) => i.cause === "tipOff").length).toBe(count(log, (e) => e.type === "tipOffLanded"));
        const steals = log.flatMap((e) => (e.type === "votesStolen" ? e.steals : []));
        expect(items.filter((i) => i.kind === "voteStolen").map((i) => i.kind === "voteStolen" && i.decided)).toEqual(steals.map((st) => st.decided));
        const offline = items.filter((i) => i.kind === "cameraOffline");
        expect(offline.length).toBe(count(log, (e) => e.type === "roomWatched" && e.offline));
        for (const o of offline) if (o.cause === "hackerLoop") expect(o.hackers.length).toBeGreaterThan(0);
        expect(items.filter((i) => i.kind === "token").length).toBe(count(log, (e) => e.type === "tokenEarned"));
        for (const i of items) seen.add(i.kind === "police" || i.kind === "cameraOffline" ? `${i.kind}:${i.cause}` : i.kind === "event" ? i.event.type : i.kind);
      }
    }
    expect([...seen].sort()).toEqual(expect.arrayContaining(["police:patrol", "police:tipOff", "cameraOffline:hackerLoop", "cameraOffline:powerCut", "token", "perkBought", "perkUsed", "voteStolen", "sightingForged", "doubleCross"]));
  }, 120_000);
});
