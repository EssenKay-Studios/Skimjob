// Flattening a finished game for the metrics. design §17.4
import { STARTER_ROLES } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import { handleCommand, replay, setupEvents, type Command, type ContentOverrides, type GameConfig, type GameEvent, type GameState } from "@skimjob/engine";
import { recordGame } from "./record";
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

const R6: ContentOverrides = {
  rooms: { vault: { coins: 6 }, lobby: { coins: 2 } },
  bank: { coinsPerPlayer: 100 },
  alarm: { bulbs: 1000 },
  roundCap: 9,
  shakedown: { cleanBelow: 6, payout: 8 },
};

function config(players: number): GameConfig {
  return {
    seed: "record-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [...STARTER_ROLES], // a shakedown window only if the shop holds a Shield
    eventsEnabled: false,
    voteVisibility: "open",
    // R6's room yields as coin limits, its clean line, a bank too big to run short and bells too big to raid, until S3a.4–S3a.5
    // replace those rules; a 9-round cap keeps the script short (design §6.2)
    contentOverrides: R6,
  };
}

/** A new game where every seat is a Rookie. */
function rookies(players: number): GameState {
  const cfg = config(players);
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "rookie" } : e)));
}

function apply(state: GameState, c: Command): GameState {
  const r = handleCommand(state, c);
  if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
  return r.state;
}
/** A full grab of the room's (pinned) coins, `pocket` of them pocketed. design §3.2 */
const move = (player: string, room: string, pocket = 0): Command => ({ type: "submitMove", player, move: { room, duffel: (R6.rooms?.[room]?.coins ?? 0) - pocket, pocket } });
/** The round's deadline, then (design §5.4) its alibi deadline. */
const roundDeadline = (s: GameState): Command => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const alibiDeadline = (s: GameState): Command => ({ type: "advance", deadline: { kind: "alibis", round: s.resolvedRound } });
function run(state: GameState, ...commands: Command[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleCommand(s, c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state.phase.kind === "alibis" ? apply(r.state, alibiDeadline(r.state)) : r.state;
  }, state);
}
function meeting(s: GameState, act: 1 | 2 | 3, votes: Command[] = []): GameState {
  const id = `act-${act}`;
  s = run(s, { type: "scheduleMeeting", act, slot: `slot-${act}` }, { type: "advance", deadline: { kind: "openMeeting", meetingId: id } });
  return run(s, ...votes, { type: "advance", deadline: { kind: "closeMeeting", meetingId: id } });
}

describe("recordGame — a scripted game", () => {
  // Rounds 1–3: p0 skims 6 in the Vault every round, p1 skims 1 in the Lobby, p2 hands the Lobby's 2 in; p1 and
  // p2 shake p0 down. Then everyone hands in the Lobby's 2 (6 a round) to the 9-round cap: the Haul is 63 of the
  // 66 coins taken, above the honesty line (design §7.5), so the heist succeeds and p1's 3 is the biggest stash.
  const lobby = (st: GameState) => run(st, move("p0", "lobby"), move("p1", "lobby"), move("p2", "lobby"), roundDeadline(st));
  let s = rookies(3);
  for (let r = 0; r < 3; r++) s = run(s, move("p0", "vault", 6), move("p1", "lobby", 1), move("p2", "lobby"), roundDeadline(s));
  s = meeting(s, 1, [
    { type: "castVote", player: "p1", vote: { kind: "shakedown", target: "p0" } },
    { type: "castVote", player: "p2", vote: { kind: "shakedown", target: "p0" } },
  ]);
  for (let r = 0; r < 3; r++) s = lobby(s);
  s = meeting(s, 2);
  for (let r = 0; r < 3; r++) s = lobby(s);
  const rec = recordGame(s, ["greedy", "opportunist", "honest"]);

  it("records the ending (design §6.2, §8.1, §21 G4)", () => {
    expect(rec).toMatchObject({ seed: "record-seed", players: 3, result: "success", reason: null, endedRound: 9 });
    expect(rec.haul).toBe(63);
    expect(rec.bankLeft).toBe(300 - 66);
    expect(rec.capWithBankLeft).toBe(true); // at the cap, with over a quarter of the bank left
    expect(rec.meetings).toBe(2); // none after the last round
    expect(rec.winners).toEqual(["p1"]);
  });

  it("records a heist sunk by theft (design §8.4)", () => {
    const cfg = { ...config(3), contentOverrides: { ...R6, roundCap: 1 } };
    let t = replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "rookie" } : e)));
    t = run(t, move("p0", "lobby", 2), move("p1", "lobby", 2), move("p2", "lobby"), roundDeadline(t));
    expect(recordGame(t, ["greedy", "greedy", "honest"])).toMatchObject({ result: "failed", reason: "theft", endedRound: 1, capWithBankLeft: true });
  });

  it("records the shakedown (design §11.3)", () => {
    expect(rec.shakedowns).toEqual([{ act: 1, emergency: false, target: "p0", stashRevealed: 18, clean: false, targetHadPocketed: true }]);
  });

  it("records each seat's looting and pocketing", () => {
    const [p0, p1, p2] = rec.playerRecords;
    expect(p0).toMatchObject({ id: "p0", personality: "greedy", role: "rookie", grabbed: 18 + 12, pocketed: 18, stash: 0, timesShakenDown: 1 });
    expect(p1).toMatchObject({ personality: "opportunist", grabbed: 18, pocketed: 3, stash: 3, score: 3, winner: true, winCredit: 1 });
    expect(p2).toMatchObject({ personality: "honest", grabbed: 18, pocketed: 0 });
  });

  it("refuses a game that isn't over", () => {
    expect(() => recordGame(rookies(3), ["honest", "honest", "honest"])).toThrow(/isn't over/);
  });
});

describe("recordGame — bot games agree with the engine's ranking", () => {
  it("stashes, winners and win credit match gameEnded", () => {
    const o = options(["-p", "3-12"]);
    for (const n of [3, 5, 9, 12]) {
      for (let i = 0; i < 3; i++) {
        const rec = runOne(o, n, i);
        const { state } = runBotGameFor(o, n, i);
        if (state.phase.kind !== "ended") throw new Error("not over");
        expect(rec.rejections).toBe(0);
        const engine = new Map(state.phase.outcome.ranking.map((e) => [e.player, e]));
        for (const p of rec.playerRecords) {
          expect(p.stash).toBe(engine.get(p.id)?.stash);
          expect(p.score).toBe(engine.get(p.id)?.score);
          expect(p.timesShakenDown).toBe(state.log.filter((e) => e.type === "shakedownResolved" && e.target === p.id).length);
        }
        expect(rec.playerRecords).toHaveLength(n);
        const credit = rec.playerRecords.reduce((t, p) => t + p.winCredit, 0);
        expect(credit).toBeCloseTo(rec.winners.length > 0 ? 1 : 0);
        for (const p of rec.playerRecords) {
          expect(p.pocketed).toBeLessThanOrEqual(p.grabbed);
        }
      }
    }
  });
});

describe("recordGame — raids, Wanted, Rooftop stalls and the bust (design §5, §21 G2–G4)", () => {
  it("counts the raids, the final Wanted and the rounds with more than half the crew on the Rooftop", () => {
    // 2-bulb bells, a bust at 2 stars: round 1 raids the Vault (2 of 3 on the Rooftop: a stall), round 2 the Office (a bust).
    const cfg = { ...config(3), contentOverrides: { ...R6, alarm: { bulbs: 2, bustStars: 2 } } };
    let s = replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "rookie" } : e)));
    s = run(s, move("p0", "vault"), move("p1", "rooftop"), move("p2", "rooftop"), roundDeadline(s));
    const office = (player: string): Command => ({ type: "submitMove", player, move: { room: "office", duffel: 2, pocket: 0 } });
    s = run(s, office("p0"), move("p1", "rooftop"), office("p2"), roundDeadline(s));
    const g = recordGame(s, ["honest", "honest", "honest"]);
    expect([g.result, g.reason, g.raids, g.wanted, g.stalls, g.endedRound]).toEqual(["failed", "bust", 2, 2, 1, 2]);
  });
});
