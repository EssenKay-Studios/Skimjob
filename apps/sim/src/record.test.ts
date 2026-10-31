// Flattening a finished game for the metrics. design §17.4
import { STARTER_ROLES } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import { handleCommand, replay, setupEvents, type Command, type GameConfig, type GameEvent, type GameState } from "@skimjob/engine";
import { checkpointRankings, recordGame, standing } from "./record";
import { runOne } from "./run";
import { setupGame } from "./crew";
import { PERSONALITIES, createBots, runBotGame } from "@skimjob/bots";

function runBotGameFor(o: SimOptions, n: number, i: number) {
  const { config, crew } = setupGame(o, n, i);
  return runBotGame(config, createBots(config.players, (_s, k) => PERSONALITIES[crew[k] as keyof typeof PERSONALITIES], config.seed));
}
import { parseSimArgs, type SimOptions } from "./args";

const options = (argv: string[] = []): SimOptions => {
  const r = parseSimArgs(argv);
  if (r.kind !== "run") throw new Error("bad args");
  return r.options;
};

function config(players: number): GameConfig {
  return {
    seed: "record-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [...STARTER_ROLES], // no Muscle, so no shakedown window (task 12)
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "open",
    starterMode: false,
    // scripted against content 0.1.0 checkpoint targets (balance pass 1)
    contentOverrides: { checkpoints: { perPlayer: [6, 14, 22] } },
  };
}

/** A new game where every seat is a Rookie. */
function rookies(players: number): GameState {
  const cfg = config(players);
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "rookie" } : e)));
}

function run(state: GameState, ...commands: Command[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleCommand(s, c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}
const move = (player: string, room: string, pocket = 0): Command => ({ type: "submitMove", player, move: { room, pocket } });
const roundDeadline = (s: GameState): Command => ({ type: "advance", deadline: { kind: "round", round: s.round } });
function meeting(s: GameState, act: 1 | 2 | 3, votes: Command[] = []): GameState {
  const id = `act-${act}`;
  s = run(s, { type: "scheduleMeeting", act, slot: `slot-${act}` }, { type: "advance", deadline: { kind: "openMeeting", meetingId: id } });
  return run(s, ...votes, { type: "advance", deadline: { kind: "closeMeeting", meetingId: id } });
}

describe("standing — leaders and lead from the engine's ranking (design §3 tie-breaks)", () => {
  const entry = (player: string, score: number, timesShakenDown = 0, totalHandedIn = 0) =>
    ({ player, role: "rookie", score, stash: score, safe: 0, timesShakenDown, totalHandedIn });
  it("leaders are tied on score and both tie-breaks; the lead is over the best of the rest", () => {
    expect(standing([entry("a", 5, 0, 9), entry("b", 5, 0, 9), entry("c", 2)])).toEqual({ leaders: ["a", "b"], topScore: 5, lead: 3 });
    expect(standing([entry("a", 6), entry("b", 2)])).toEqual({ leaders: ["a"], topScore: 6, lead: 4 });
  });
  it("a tie on score broken by fewer shakedowns or more handed in gives one leader, with lead 0", () => {
    expect(standing([entry("a", 5, 0), entry("b", 5, 1)])).toEqual({ leaders: ["a"], topScore: 5, lead: 0 });
    expect(standing([entry("a", 5, 0, 10), entry("b", 5, 0, 4)])).toEqual({ leaders: ["a"], topScore: 5, lead: 0 });
  });
});

describe("recordGame — a scripted game", () => {
  // Act 1: p0 skims 6 in the Vault every round, p1 skims 1 in the Lobby; p1 and
  // p2 shake p0 down. Then everyone defaults to the Lobby (6 a round): checkpoints
  // 1 and 2 are met (27 ≥ 18, 45 ≥ 42), the final target is missed (63 < 66).
  let s = rookies(3);
  for (let r = 0; r < 3; r++) s = run(s, move("p0", "vault", 6), move("p1", "lobby", 1), roundDeadline(s));
  s = meeting(s, 1, [
    { type: "castVote", player: "p1", vote: { kind: "shakedown", target: "p0" } },
    { type: "castVote", player: "p2", vote: { kind: "shakedown", target: "p0" } },
  ]);
  for (let r = 0; r < 3; r++) s = run(s, roundDeadline(s));
  s = meeting(s, 2);
  for (let r = 0; r < 3; r++) s = run(s, roundDeadline(s));
  s = meeting(s, 3);
  const rec = recordGame(s, ["greedy", "opportunist", "honest"]);

  it("records the ending (design §3, §11.5)", () => {
    expect(rec).toMatchObject({ seed: "record-seed", players: 3, result: "failed", reason: "target", endedRound: 9, endedAct: 3 });
    expect(rec.finalTarget).toBe(66);
    expect(rec.haul).toBe(63);
    expect(rec.checkpointsMissed).toBe(1);
    expect(rec.meetings).toBe(3);
    expect(rec.winners).toEqual([]);
  });

  it("records the shakedown (design §11.3)", () => {
    expect(rec.shakedowns).toEqual([{ act: 1, emergency: false, target: "p0", stashRevealed: 18, clean: false, targetHadPocketed: true }]);
  });

  it("records the standings after Act 1, after its shakedown (design §11.4)", () => {
    // p0 lost 18; p1 has 3 × 1.2 (Rookie).
    expect(rec.afterAct1).toEqual({ leaders: ["p1"], topScore: 3.6, lead: 3.6 });
    expect(rec.afterAct2).toEqual({ leaders: ["p1"], topScore: 3.6, lead: 3.6 });
    expect(rec.act3MaxGain).toBe(21.6); // 3 rounds × Vault 6 × Rookie 1.2
  });

  it("records each seat's looting and pocketing", () => {
    const [p0, p1, p2] = rec.playerRecords;
    expect(p0).toMatchObject({ id: "p0", personality: "greedy", role: "rookie", looted: 18 + 12, pocketed: 18, stash: 0, timesShakenDown: 1 });
    expect(p1).toMatchObject({ personality: "opportunist", looted: 18, pocketed: 3, stash: 3, score: 3.6, winner: false, winCredit: 0 });
    expect(p2).toMatchObject({ personality: "honest", looted: 18, pocketed: 0, canPocket: true });
  });

  it("refuses a game that isn't over", () => {
    expect(() => recordGame(rookies(3), ["honest", "honest", "honest"])).toThrow(/isn't over/);
  });
});

describe("recordGame — bot games agree with the engine's ranking", () => {
  it("the ranking at the final checkpoint is the engine's final ranking", () => {
    const o = options(["-p", "2-12"]);
    for (const n of [3, 6, 12]) {
      for (let i = 0; i < 3; i++) {
        const { state } = runBotGameFor(o, n, i);
        if (state.phase.kind !== "ended") throw new Error("not over");
        const rankings = checkpointRankings(state.config, state.log);
        if (state.phase.outcome.result === "success" || state.phase.outcome.reason === "target") {
          expect(rankings[2]).toEqual(state.phase.outcome.ranking);
        }
      }
    }
  });

  it("stashes, winners and win credit match gameEnded", () => {
    const o = options(["-p", "2-12"]);
    for (const n of [2, 5, 9, 12]) {
      for (let i = 0; i < 3; i++) {
        const rec = runOne(o, n, i);
        const { state } = runBotGameFor(o, n, i);
        if (state.phase.kind !== "ended") throw new Error("not over");
        expect(rec.rejections).toBe(0);
        const engine = new Map(state.phase.outcome.ranking.map((e) => [e.player, e]));
        for (const p of rec.playerRecords) {
          expect(p.stash).toBe(engine.get(p.id)?.stash);
          expect(p.score).toBe(engine.get(p.id)?.score);
          expect(p.timesShakenDown).toBe(engine.get(p.id)?.timesShakenDown);
        }
        expect(rec.playerRecords).toHaveLength(n);
        const credit = rec.playerRecords.reduce((t, p) => t + p.winCredit, 0);
        expect(credit).toBeCloseTo(rec.winners.length > 0 ? 1 : 0);
        for (const p of rec.playerRecords) {
          expect(p.pocketed).toBeLessThanOrEqual(p.looted);
          if (!p.canPocket) expect(p.pocketed).toBe(0);
        }
      }
    }
  });
});
