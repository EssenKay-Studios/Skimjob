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
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
});

const play = (c: GameConfig) => runBotGame(c, createBots(c.players, (_, i) => personality(i), c.seed));

/** The game's first meeting's id (a briefing, a regular meeting or an emergency). */
const firstMeeting = (log: readonly GameEvent[]) => log.find((e) => e.type === "meetingOpened")?.type === "meetingOpened" ? (log.find((e) => e.type === "meetingOpened") as Extract<GameEvent, { type: "meetingOpened" }>).meetingId : null;

/** Views at the game's first meeting: p2's and p5's when it opens, and p2's just before it closes (after the votes). */
function meetingViews(seed: string) {
  const c = config(6, seed);
  const log = play(c).state.log;
  const id = firstMeeting(log);
  const start = log.findIndex((e) => e.type === "meetingOpened" && e.meetingId === id);
  const end = log.findIndex((e) => e.type === "meetingClosed" && e.meetingId === id);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start + 1);
  const opened = replay(c, log.slice(0, start + 1));
  return { crew: `${seed}/crew`, p2: viewFor(opened, "p2"), p5: viewFor(opened, "p5"), later: viewFor(replay(c, log.slice(0, end)), "p2") };
}

describe("crew hunch — design §17.3 (v2 §5)", () => {
  it("is shared by every bot and holds for the whole meeting, but differs between games for the same seat and meeting", () => {
    const games = ["g-a", "g-b", "g-c", "g-d"].map(meetingViews);
    expect(new Set(games.map((g) => crewHunch(g.p2, "p3", g.crew))).size).toBeGreaterThan(1);
    for (const g of games) {
      expect(crewHunch(g.p2, "p3", g.crew)).toBe(crewHunch(g.p5, "p3", g.crew));
      expect(crewHunch(g.later, "p3", g.crew)).toBe(crewHunch(g.p2, "p3", g.crew));
    }
  });

  it("no seat is always shielded: over 60 seeds at 6 players, every seat is shaken down at the first meeting sometimes", () => {
    const targets = new Map<string, number>();
    for (let i = 0; i < 60; i++) {
      const log = play(config(6, `hunch-${i}`)).state.log;
      const closed = log.find((e): e is Extract<GameEvent, { type: "meetingClosed" }> => e.type === "meetingClosed" && e.meetingId === firstMeeting(log));
      if (closed?.result.kind === "shakedown") targets.set(closed.result.target, (targets.get(closed.result.target) ?? 0) + 1);
    }
    for (let i = 1; i <= 6; i++) expect(targets.get(`p${i}`) ?? 0, `p${i} in ${JSON.stringify([...targets])}`).toBeGreaterThan(0);
  }, 30_000); // 60 full games: about 1 s alone, over the 5 s default on a busy machine

  it("with the harness's hidden crewSeed it can't be computed from public data: the same view gives a different hunch per seed (STATUS follow-up, PR #37 review)", () => {
    // Seeds re-picked when the bots' draws shift (S3a.9): g-b's first meeting is a regular one, like most of the others'.
    const g = meetingViews("g-b");
    const seeds = ["s1", "s2", "s3", "s4", "s5"].map((seed) => crewHunch(g.p2, "p3", seed));
    expect(new Set(seeds).size).toBe(seeds.length);
    // Still shared by the crew and steady for the meeting, for one crewSeed.
    expect(crewHunch(g.p5, "p3", "s1")).toBe(seeds[0]);
    expect(crewHunch(g.later, "p3", "s1")).toBe(seeds[0]);
    // And it comes from the crewSeed, not the view: another game's view of the same meeting gives the same hunch for the same crewSeed.
    const meetingOf = (v: typeof g.p2) => (v.phase.kind === "meeting" ? v.phase.meetingId : null);
    const other = ["g-a", "g-c", "g-d", "g-e", "g-f", "g-g"].map((seed) => meetingViews(seed).p2).find((v) => meetingOf(v) === meetingOf(g.p2));
    expect(other).toBeDefined();
    expect(crewHunch(other as typeof g.p2, "p3", "s1")).toBe(seeds[0]);
  });
});
