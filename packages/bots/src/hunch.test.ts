// The crew's shared hunch changes from game to game (PR #37 review and QA): seat
// and meeting ids are the same in every game, so they alone gave each seat a
// fixed bias. design §17.3; docs/roles-v2.md §5
import { replay, viewFor, type GameConfig, type GameEvent } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { crewHunch } from "./bot";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots, runBotGame } from "./run";

const MIX: PersonalityId[] = ["honest", "opportunist", "greedy", "cautious"];
const personality = (i: number) => PERSONALITIES[MIX[i % MIX.length] as PersonalityId];

/** Seats as the sim and server name them (`p1`…`pN`), with the same names in every game. */
const config = (n: number, seed: string): GameConfig => ({
  seed,
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `${personality(i).name} ${i + 1}`, isBot: true })),
  job: "bank",
  rolePool: [],
  mole: "off",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  starterMode: false,
});

const play = (c: GameConfig) => runBotGame(c, createBots(c.players, (_, i) => personality(i), c.seed));

/** Views at act 1's meeting: p2's and p5's when it opens, and p2's just before it closes (after the votes). */
function meetingViews(seed: string) {
  const c = config(6, seed);
  const log = play(c).state.log;
  const start = log.findIndex((e) => e.type === "meetingOpened" && e.meetingId === "act-1");
  const end = log.findIndex((e) => e.type === "meetingClosed" && e.meetingId === "act-1");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start + 1);
  const opened = replay(c, log.slice(0, start + 1));
  return { p2: viewFor(opened, "p2"), p5: viewFor(opened, "p5"), later: viewFor(replay(c, log.slice(0, end)), "p2") };
}

describe("crew hunch — design §17.3 (v2 §5)", () => {
  it("is shared by every bot and holds for the whole meeting, but differs between games for the same seat and meeting", () => {
    const games = ["g-a", "g-b", "g-c", "g-d"].map(meetingViews);
    expect(new Set(games.map((g) => crewHunch(g.p2, "p3"))).size).toBeGreaterThan(1);
    for (const g of games) {
      expect(crewHunch(g.p2, "p3")).toBe(crewHunch(g.p5, "p3"));
      expect(crewHunch(g.later, "p3")).toBe(crewHunch(g.p2, "p3"));
    }
  });

  it("no seat is always shielded: over 60 seeds at 6 players, every seat is shaken down at act 1's meeting sometimes", () => {
    const targets = new Map<string, number>();
    for (let i = 0; i < 60; i++) {
      const log = play(config(6, `hunch-${i}`)).state.log;
      const closed = log.find((e): e is Extract<GameEvent, { type: "meetingClosed" }> => e.type === "meetingClosed" && e.meetingId === "act-1");
      if (closed?.result.kind === "shakedown") targets.set(closed.result.target, (targets.get(closed.result.target) ?? 0) + 1);
    }
    for (let i = 1; i <= 6; i++) expect(targets.get(`p${i}`) ?? 0, `p${i} in ${JSON.stringify([...targets])}`).toBeGreaterThan(0);
  });
});
