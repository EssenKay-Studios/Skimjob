// QA (PR #50, R6a): whole bot games — determinism and replay, bells, raids and
// Wanted adding up (design §5), whole-number scores, no automatic role reveal.
import { describe, expect, it } from "vitest";
import { BANK_JOB } from "@skimjob/content";
import { createGame, replay, viewFor, type GameConfig, type GameEvent, type RoleListSetting } from "@skimjob/engine";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots, runBotGame } from "./run";

const IDS: PersonalityId[] = ["honest", "opportunist", "greedy", "cautious", "random"];

function config(n: number, seed: string, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `q${i}`, name: `Q${i}`, isBot: true })),
    job: "bank",
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

describe("QA: full bot games under the R7 rules", () => {
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

  it("bells only rise with rings, a full bell is raided at once, Wanted counts the raids, and Wanted 3 is a bust (design §5)", () => {
    const { bulbs, bustStars } = BANK_JOB.alarm;
    for (const { n, extra } of CASES) {
      for (let i = 0; i < GAMES_PER_CASE; i++) {
        const c = config(n, `bells-${n}-${i}-${JSON.stringify(extra)}`, extra);
        const { state } = play(c);
        let bells: Record<string, number> = createGame(c).bells;
        let wanted = 0;
        // design §5.1, §11.1: a bell a Hacker hid is left out of the public events; its Hacker's own result has it.
        let hidden: readonly string[] = [];
        const kept = () => Object.fromEntries(hidden.filter((r) => r in bells).map((r) => [r, bells[r] as number]));
        for (const e of state.log as GameEvent[]) {
          if (e.type === "bellsRung") {
            for (const [room, lit] of Object.entries(e.bells)) expect(lit, room).toBeGreaterThanOrEqual(bells[room] ?? 0);
            hidden = e.hidden;
            bells = { ...e.bells, ...kept() };
          } else if (e.type === "roomRaided") {
            if (!hidden.includes(e.room)) expect(bells[e.room]).toBe(bulbs);
            expect(e.wanted).toBe(++wanted);
            // Its bell is off until it reopens at 0 (design §5.3).
            hidden = hidden.filter((r) => r !== e.room);
            bells = Object.fromEntries(Object.entries(bells).filter(([r]) => r !== e.room));
          } else if (e.type === "bellsCooled") {
            for (const lit of Object.values(e.bells)) expect(lit).toBeLessThan(bulbs);
            bells = { ...e.bells, ...kept() };
          } else if (e.type === "abilityResolved" && e.ability.kind === "hide" && e.ability.bulbs !== null) {
            bells = { ...bells, [e.ability.room]: e.ability.bulbs };
          } else if (e.type === "gameEnded" && e.outcome.result === "failed" && e.outcome.reason === "bust") {
            expect(wanted).toBeGreaterThanOrEqual(bustStars);
          }
        }
        expect(state.wanted).toBe(wanted);
      }
    }
  }, SLOW);

  it("stashes are whole numbers; nobody learns an ally automatically", () => {
    for (const { n, extra } of CASES) {
      for (let i = 0; i < GAMES_PER_CASE; i++) {
        const c = config(n, `prop-${n}-${i}-${JSON.stringify(extra)}`, extra);
        const { state } = play(c);
        const end = state.log.find((e) => e.type === "gameEnded");
        expect(end).toBeDefined();
        const outcome = (end as unknown as { outcome: { ranking: { stash: number }[] } }).outcome;
        for (const r of outcome.ranking) expect(Number.isInteger(r.stash)).toBe(true);
        for (const p of Object.values(state.players)) expect(Number.isInteger(p.stash) && p.stash >= 0).toBe(true);
        expect(state.log.some((e) => e.type === ("alliesLearned" as string))).toBe(false);
        // Nobody's view names another player's role before the reveal.
        const live = createGame(c);
        for (const id of live.playerOrder) for (const o of viewFor(live, id).players) expect(JSON.stringify(o)).not.toMatch(/"role"/);
      }
    }
  }, SLOW);
});
