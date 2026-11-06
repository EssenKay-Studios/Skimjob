// End of game: success and failure, the ranking with role scoring, tie-breaks,
// winners, and roles that win on failure. design §3, §8, §13
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { STARTER_ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, Outcome, PlayerState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { V01_NUMBERS } from "./v01-numbers.testkit";
import { outcomeFor, ranking } from "./end";
import { checkpointTarget } from "./job";
import { jobFor } from "./overrides";

function config(players: number): GameConfig {
  return {
    seed: "end-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [...STARTER_ROLES], // no Muscle, so no shakedown window (task 12)
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    contentOverrides: V01_NUMBERS, // scripted against content 0.1.0 numbers (balance pass 1)
  };
}

/** A new game with chosen roles (seat i gets roles[i], Rookie if missing). */
function game(players: number, roles: string[] = []): GameState {
  const cfg = config(players);
  const log = setupEvents(cfg).map((e, i, all): GameEvent => {
    if (e.type !== "roleDealt") return e;
    const seat = all.slice(0, i).filter((x) => x.type === "roleDealt").length;
    return { ...e, role: roles[seat] ?? "rookie" };
  });
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    if (command === null) return s;
    const r = handleThroughAlibis(s, command);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
    return r.state;
  }, state);
}

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const sched = (act: number) => ({ type: "scheduleMeeting", act, slot: "slot" });
const OPEN = (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
/** The shakedown window (open whenever the shop holds a Shield) passes. extension.md "Shakedowns" */
const RESOLVE = (s: GameState) => (s.phase.kind === "shakedownPending" ? { type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.phase.meetingId } } : null);
const vote = (player: string, target: string) => ({ type: "castVote", player, vote: { kind: "shakedown", target } });

const outcome = (s: GameState): Outcome => {
  if (s.phase.kind !== "ended") throw new Error(`game not over (${s.phase.kind})`);
  return s.phase.outcome;
};

/** Set players' end-of-game numbers directly (state is plain data). */
function withPlayers(s: GameState, haul: number, change: Record<string, Partial<PlayerState>>): GameState {
  const players = Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, ...change[id] }]));
  return { ...s, haul, players };
}

describe("a successful heist — design §3, §8", () => {
  /**
   * 3 players. p0 (Fence) in the Vault pockets 1 a round and puts 1 a round in
   * the safe in Act 3; p1 (Inside Man) on the Rooftop; p2 (Rookie) in the
   * Office pockets 1 a round until round 9. Haul +8 a round (+9 in round 9):
   * 24 ≥ 18, 48 ≥ 42, 73 ≥ 66. Heat 4 + (20 − 20) ÷ 3 = +4 a round.
   */
  function fullGame(): GameState {
    let s = game(3, ["fence", "insideMan", "rookie"]);
    for (let round = 1; round <= 9; round++) {
      const safe = round > 6 ? { ability: { kind: "fenceSafe", amount: 1 } } : {};
      s = run(s, mv("p0", "vault", 1, safe), mv("p1", "rooftop"), mv("p2", "office", round < 9 ? 1 : 0), ROUND);
      if (round % 3 === 0) s = run(s, sched(round / 3), OPEN, CLOSE);
    }
    return s;
  }

  it("the heist succeeds after the final meeting and the top score wins, whatever the role (extension.md \"How you win\")", () => {
    const s = fullGame();
    expect([s.haul, s.heat]).toEqual([73, 36]);
    expect(outcome(s)).toEqual({
      result: "success",
      ranking: [
        // design §8: the stash includes the Fence safe.
        { player: "p0", role: "fence", score: 9, stash: 9, safe: 3, timesShakenDown: 0, totalHandedIn: 45 },
        { player: "p2", role: "rookie", score: 8, stash: 8, safe: 0, timesShakenDown: 0, totalHandedIn: 28 },
        // design §8: the Inside Man scores 1 per loot above the final target (73 − 66).
        { player: "p1", role: "insideMan", score: 7, stash: 0, safe: 0, timesShakenDown: 0, totalHandedIn: 0 },
      ],
      winners: ["p0"],
    });
  });

  it("the gameEnded event is public and replays to the same state", () => {
    const s = fullGame();
    const ended = s.log[s.log.length - 1];
    expect(ended).toMatchObject({ type: "gameEnded", visibility: { kind: "public" } });
    expect(replay(s.config, s.log)).toEqual(s);
    expect(replay(s.config, JSON.parse(JSON.stringify(s.log)) as GameEvent[])).toEqual(s);
  });
});

describe("role scoring — design §8", () => {
  // extension.md "Winning and losing": whole-number scores, no Rookie multiplier.
  it("Rookie: scores its stash (no multiplier); scores are whole numbers", () => {
    const s = withPlayers(game(3, ["rookie", "lookout"]), 0, { p0: { stash: 9 }, p1: { stash: 10 } });
    expect(ranking(s).map((e) => [e.player, e.score])).toEqual([
      ["p1", 10],
      ["p0", 9],
      ["p2", 0],
    ]);
  });

  it("Inside Man: surplus over the final target is added to the stash; none below it", () => {
    const above = withPlayers(game(3, ["insideMan", "rookie"]), 72, { p0: { stash: 5 } });
    expect(ranking(above).find((e) => e.player === "p0")?.score).toBe(11); // 5 + (72 − 66), V01 numbers: 1 point per loot
    const below = withPlayers(game(3, ["insideMan", "rookie"]), 60, { p0: { stash: 5 } });
    expect(ranking(below).find((e) => e.player === "p0")?.score).toBe(5);
  });

  // extension.md "Winning and losing": +1 per 5 loot over the final target, rounded down.
  it("Inside Man (shipped numbers): +1 point per 5 loot over the final target", () => {
    const cfg = { ...config(3), contentOverrides: null };
    const log = setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" && e.player === "p0" ? { ...e, role: "insideMan" } : e));
    const target = checkpointTarget(jobFor(cfg), 3, 3);
    const at = (haul: number) => ranking(withPlayers(replay(cfg, log), haul, { p0: { stash: 5 } })).find((e) => e.player === "p0")?.score;
    expect(target).toBeGreaterThan(0);
    expect([at(target + 4), at(target + 5), at(target + 14), at(target - 3)]).toEqual([5, 6, 7, 5]);
  });

  it("the Mole scores its stash", () => {
    const s = withPlayers(game(3, ["mole", "rookie"]), 0, { p0: { stash: 4 } });
    expect(ranking(s)[0]).toMatchObject({ player: "p0", role: "mole", score: 4 });
  });
});

describe("tie-breaks — design §3", () => {
  it("equal scores: fewer shakedowns first, then more handed in", () => {
    const s = withPlayers(game(4), 0, {
      p0: { stash: 5, timesShakenDown: 1, totalHandedIn: 99 },
      p1: { stash: 5, timesShakenDown: 0, totalHandedIn: 10 },
      p2: { stash: 5, timesShakenDown: 0, totalHandedIn: 20 },
      p3: { stash: 6, timesShakenDown: 2, totalHandedIn: 0 },
    });
    expect(ranking(s).map((e) => e.player)).toEqual(["p3", "p2", "p1", "p0"]);
    expect(outcomeFor(s, null).winners).toEqual(["p3"]);
  });

  it("a full tie keeps seat order and every tied leader wins (provisional)", () => {
    const s = withPlayers(game(3), 0, {
      p0: { stash: 1 },
      p1: { stash: 4, totalHandedIn: 7 },
      p2: { stash: 4, totalHandedIn: 7 },
    });
    expect(ranking(s).map((e) => e.player)).toEqual(["p1", "p2", "p0"]);
    expect(outcomeFor(s, null).winners).toEqual(["p1", "p2"]);
  });
});

describe("a failed heist — design §3, §19.1", () => {
  it("a Heat raid after a round: ranked with that round's splits, nobody wins", () => {
    let s = { ...game(3), heat: 89 };
    s = run(s, mv("p0", "vault", 3), mv("p1", "lobby", 1), mv("p2", "lobby"), ROUND); // +4 baseline, +20 ÷ 3 Vault: round(10.67) = 11 → 100
    expect(s.log.slice(-2).map((e) => e.type)).toEqual(["copsRaided", "gameEnded"]);
    const o = outcome(s);
    expect(o).toMatchObject({ result: "failed", reason: "heat", winners: [] });
    // "Best of the losers" ranking, shown as a loss (provisional).
    expect(o.ranking.map((e) => [e.player, e.score, e.stash, e.totalHandedIn])).toEqual([
      ["p0", 3, 3, 3],
      ["p1", 1, 1, 1],
      ["p2", 0, 0, 2],
    ]);
  });

  it("a raid from the missed-checkpoint penalty is ranked after the meeting's shakedown", () => {
    let s = { ...game(3), heat: 80 };
    for (let i = 0; i < 3; i++) s = run(s, mv("p0", "lobby", 2), ROUND); // p1 and p2 default to the Lobby: Haul 12 of 18, Heat 92
    s = run(s, sched(1), OPEN, vote("p0", "p1"), vote("p2", "p1"), CLOSE, RESOLVE); // p1 is clean: paid 8 from the Haul (12 → 4), checkpoint missed
    expect(s.log.slice(-3).map((e) => e.type)).toEqual(["checkpointChecked", "copsRaided", "gameEnded"]);
    const o = outcome(s);
    expect(o).toMatchObject({ result: "failed", reason: "heat", winners: [] });
    expect(o.ranking.map((e) => [e.player, e.score, e.timesShakenDown])).toEqual([
      ["p1", 8, 1],
      ["p0", 6, 0],
      ["p2", 0, 0],
    ]);
  });

  it("missing the final target fails the heist; the ranking is kept, nobody wins", () => {
    let s = game(3);
    for (let round = 1; round <= 9; round++) {
      // Haul 8 a round makes 24 ≥ 18 and 48 ≥ 42; p0 pockets the Vault in Act 3, so 54 < 66.
      s = run(s, mv("p0", "vault", round > 6 ? 6 : 0), mv("p1", "rooftop"), mv("p2", "lobby"), ROUND);
      if (round % 3 === 0) s = run(s, sched(round / 3), OPEN, CLOSE);
    }
    const o = outcome(s);
    expect(o).toMatchObject({ result: "failed", reason: "target", winners: [] });
    expect(o.ranking[0]).toMatchObject({ player: "p0", stash: 18, score: 18 });
  });
});

describe("one crew: the top group wins (extension.md \"How you win\", Build notes \"Win rule\")", () => {
  // p0 Mole, p1 Auditor, p2 Rookie (stash 5).
  const state = (auditorStash: number, moleStash = 1): GameState =>
    withPlayers(game(3, ["mole", "auditor", "rookie"]), 0, { p0: { stash: moleStash }, p1: { stash: auditorStash }, p2: { stash: 5 } });

  it("success: the top group wins whatever their roles, the Mole included", () => {
    expect(outcomeFor(state(9), null)).toMatchObject({ result: "success", winners: ["p1"] });
    expect(outcomeFor(state(2), null)).toMatchObject({ result: "success", winners: ["p2"] });
    expect(outcomeFor(state(2, 20), null)).toMatchObject({ result: "success", winners: ["p0"] });
  });

  it("failure: only a top-group member whose role wins that ending; a failure-winner outside the top group doesn't win", () => {
    expect(outcomeFor(state(2, 12), "heat").winners).toEqual(["p0"]);
    expect(outcomeFor(state(2, 12), "target").winners).toEqual(["p0"]);
    expect(outcomeFor(state(9), "heat").winners).toEqual([]);
    expect(outcomeFor(state(9), "target").winners).toEqual([]);
  });

  it("the full ranking is kept on a loss", () => {
    const o = outcomeFor(state(9), "heat");
    expect(o.ranking.map((e) => e.player)).toEqual(["p1", "p2", "p0"]);
  });

  it("winsOn: Getaway Driver [heat], Embezzler [target], Fence and Mole both", () => {
    const top = (role: string, reason: "heat" | "target") =>
      outcomeFor(withPlayers(game(3, [role, "rookie"]), 0, { p0: { stash: 9 }, p1: { stash: 1 } }), reason).winners;
    expect([top("getawayDriver", "heat"), top("getawayDriver", "target")]).toEqual([["p0"], []]);
    expect([top("embezzler", "heat"), top("embezzler", "target")]).toEqual([[], ["p0"]]);
    expect([top("fence", "heat"), top("fence", "target")]).toEqual([["p0"], ["p0"]]);
    expect([top("mole", "heat"), top("mole", "target")]).toEqual([["p0"], ["p0"]]);
    expect([top("lookout", "heat"), top("lookout", "target")]).toEqual([[], []]);
  });

  it("a tied top group: on success all win; on failure only those whose role wins it", () => {
    const s = withPlayers(game(4, ["mole", "lookout", "rookie", "fence"]), 0, { p0: { stash: 6 }, p1: { stash: 6 }, p2: { stash: 5 }, p3: { stash: 6 } });
    expect(outcomeFor(s, null).winners).toEqual(["p0", "p1", "p3"]);
    expect(outcomeFor(s, "heat").winners).toEqual(["p0", "p3"]);
  });

  it("tie-breaks come first: a failure-winner behind on shakedowns is out of the top group", () => {
    const s = withPlayers(game(3, ["mole", "lookout"]), 0, { p0: { stash: 6, timesShakenDown: 1 }, p1: { stash: 6 } });
    expect(outcomeFor(s, "heat").winners).toEqual([]);
  });
});
