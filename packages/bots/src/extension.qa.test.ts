// QA (PR #50, R6a): whole bot games against docs/extension.md — determinism and
// replay, the Heat breakdown adding up to the Heat, whole-number scores, no
// automatic ally reveal, police only when a Mole could be in the game.
import { describe, expect, it } from "vitest";
import { ROLES } from "@skimjob/content";
import { createGame, heatBreakdown, replay, viewFor, type GameConfig, type GameEvent, type RoleListSetting } from "@skimjob/engine";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots, runBotGame } from "./run";

const IDS: PersonalityId[] = ["honest", "opportunist", "greedy", "cautious", "random"];
const ALL_ROLES = Object.keys(ROLES) as GameConfig["rolePool"][number][];

function config(n: number, seed: string, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `q${i}`, name: `Q${i}`, isBot: true })),
    job: "bank",
    rolePool: ALL_ROLES,
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}

// Whole bot games are slow on CI runners (~5× this Mac): few games per case and a generous timeout.
const GAMES_PER_CASE = 2;
const SLOW = 60_000;

const play = (c: GameConfig, botSeed = c.seed) => runBotGame(c, createBots(c.players, (_, i) => PERSONALITIES[IDS[i % IDS.length] as PersonalityId], botSeed));

const CASES: { n: number; extra: Partial<GameConfig> }[] = [];
for (const n of [3, 5, 8, 12])
  for (const events of [false, true])
    for (const roleList of ["exact", "possible", "hidden"] as RoleListSetting[]) CASES.push({ n, extra: { eventsEnabled: events, roleList } });
CASES.push({ n: 5, extra: { deck: "starter", rolePool: [] } }, { n: 12, extra: { deck: "starter", rolePool: [] } });

describe("QA: full bot games under the Extension rules", () => {
  it("the same seed plays the same game; the log replays to the same state (design §17.2)", () => {
    for (const { n, extra } of CASES) {
      const c = config(n, `det-${n}-${JSON.stringify(extra)}`, extra);
      const a = play(c);
      const b = play(c);
      expect(a.state.phase.kind).toBe("ended");
      expect(a.rejections, `${n} ${JSON.stringify(extra)}`).toEqual([]);
      expect(b.state.log).toEqual(a.state.log);
      expect(replay(c, a.state.log)).toEqual(a.state);
    }
  }, SLOW);

  it("every round's Heat parts add up to its Heat change; every police activity and missed target adds what it says", () => {
    for (const { n, extra } of CASES) {
      for (let i = 0; i < GAMES_PER_CASE; i++) {
        const c = config(n, `heat-${n}-${i}-${JSON.stringify(extra)}`, extra);
        const { state } = play(c);
        let heat = createGame(c).heat;
        for (const e of state.log as GameEvent[]) {
          if (e.type === "roundResolved") {
            const sum = e.heatParts.base + Object.values(e.heatParts.rooms).reduce((x, y) => x + y, 0);
            const expected = Math.max(0, heat + sum);
            if (expected < 100) expect(e.heat, `round ${e.round}`).toBe(expected);
            for (const v of [e.heatParts.base, ...Object.values(e.heatParts.rooms)]) expect(Number.isInteger(v)).toBe(true);
            heat = e.heat;
          } else if (e.type === "policeActivity") {
            if (heat + e.heatAdded < 100) expect(e.heat).toBe(heat + e.heatAdded);
            heat = e.heat;
          } else if (e.type === "checkpointChecked") {
            heat += e.heatPenalty;
          } else if (e.type === "raidStopped") heat = e.heat;
        }
        // The breakdown the view shows has a row for every resolved round.
        const resolved = state.log.filter((e) => e.type === "roundResolved").map((e) => (e as { round: number }).round);
        for (const r of resolved) expect(heatBreakdown(state.log, r)).not.toBeNull();
      }
    }
  }, SLOW);

  it("scores and tokens are whole numbers; nobody learns an ally automatically; police only when a Mole could be in", () => {
    for (const { n, extra } of CASES) {
      for (let i = 0; i < GAMES_PER_CASE; i++) {
        const c = config(n, `prop-${n}-${i}-${JSON.stringify(extra)}`, extra);
        const { state } = play(c);
        const end = state.log.find((e) => e.type === "gameEnded");
        expect(end).toBeDefined();
        const outcome = (end as unknown as { outcome: { ranking: { score: number }[] } }).outcome;
        for (const r of outcome.ranking) expect(Number.isInteger(r.score)).toBe(true);
        for (const p of Object.values(state.players)) expect(Number.isInteger(p.roleState.tokens) && p.roleState.tokens >= 0).toBe(true);
        expect(state.log.some((e) => e.type === ("alliesLearned" as string))).toBe(false);
        // Nobody's view names another player's role before the reveal.
        const live = createGame(c);
        for (const id of live.playerOrder) for (const o of viewFor(live, id).players) expect(JSON.stringify(o)).not.toMatch(/"role"/);
        const police = state.log.filter((e) => e.type === "policeActivity" || e.type === "policeScheduled");
        const start = createGame(c);
        if (start.police === null) expect(police).toEqual([]);
        // The Starter deck never runs police.
        if (c.deck === "starter") expect(start.police).toBeNull();
        // Under Exact, police run iff a Mole was dealt.
        if (extra.roleList === "exact") expect(start.police !== null).toBe(Object.values(start.players).some((p) => p.role === "mole"));
      }
    }
  }, SLOW);
});
