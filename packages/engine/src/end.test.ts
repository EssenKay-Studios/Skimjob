// End of game: success and failure, the ranking with role scoring, tie-breaks,
// winners, and roles that win on failure. design §3, §8, §13
import { describe, expect, it } from "vitest";
import { STARTER_ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, Outcome, PlayerState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { V01_NUMBERS } from "./v01-numbers.testkit";
import { outcomeFor, ranking } from "./end";

function config(players: number): GameConfig {
  return {
    seed: "end-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [...STARTER_ROLES], // no Muscle, so no shakedown window (task 12)
    mole: "off",
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
    const r = handleCommand(s, typeof c === "function" ? c(s) : c);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
    return r.state;
  }, state);
}

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const sched = (act: number) => ({ type: "scheduleMeeting", act, slot: "slot" });
const OPEN = (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
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
   * 2 players. p0 (Fence) in the Vault pockets 1 a round and puts 1 a round in
   * the safe in Act 3; p1 (Insider) on the Rooftop. Haul +5 a round → 45 ≥ 44.
   */
  function fullGame(): GameState {
    let s = game(2, ["fence", "insider"]);
    for (let round = 1; round <= 9; round++) {
      const safe = round > 6 ? { ability: { kind: "fenceSafe", amount: 1 } } : {};
      s = run(s, mv("p0", "vault", 1, safe), mv("p1", "rooftop"), ROUND);
      if (round % 3 === 0) s = run(s, sched(round / 3), OPEN, CLOSE);
    }
    return s;
  }

  it("the heist succeeds after the final meeting and the biggest score wins", () => {
    const s = fullGame();
    expect([s.haul, s.heat]).toEqual([45, 36]);
    expect(outcome(s)).toEqual({
      result: "success",
      ranking: [
        // design §8: the stash includes the Fence safe.
        { player: "p0", role: "fence", score: 9, stash: 9, safe: 3, timesShakenDown: 0, totalHandedIn: 45 },
        // design §8: the Insider scores 1 per loot above the final target (45 − 44).
        { player: "p1", role: "insider", score: 1, stash: 0, safe: 0, timesShakenDown: 0, totalHandedIn: 0 },
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
  it("Rookie: final stash ×1.2, rounded to one decimal (provisional)", () => {
    const s = withPlayers(game(2), 0, { p0: { stash: 9 }, p1: { stash: 7 } });
    expect(ranking(s).map((e) => [e.player, e.score])).toEqual([
      ["p0", 10.8],
      ["p1", 8.4],
    ]);
  });

  it("Rookie ×1.2 can beat a bigger plain stash", () => {
    const s = withPlayers(game(2, ["lookout", "rookie"]), 0, { p0: { stash: 11 }, p1: { stash: 10 } });
    expect(ranking(s).map((e) => [e.player, e.score])).toEqual([
      ["p1", 12],
      ["p0", 11],
    ]);
  });

  it("Insider: surplus over the final target is added to the stash; none below it", () => {
    const above = withPlayers(game(2, ["insider", "rookie"]), 50, { p0: { stash: 5 } });
    expect(ranking(above).find((e) => e.player === "p0")?.score).toBe(11); // 5 + (50 − 44)
    const below = withPlayers(game(2, ["insider", "rookie"]), 40, { p0: { stash: 5 } });
    expect(ranking(below).find((e) => e.player === "p0")?.score).toBe(5);
  });

  it("a role with no definition yet (the Mole) scores its stash", () => {
    const s = withPlayers(game(2, ["mole", "rookie"]), 0, { p0: { stash: 4 } });
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
    let s = { ...game(2), heat: 86 };
    s = run(s, mv("p0", "vault", 3), mv("p1", "lobby", 1), ROUND); // +4 baseline, +10 Vault → 100
    expect(s.log.slice(-2).map((e) => e.type)).toEqual(["copsRaided", "gameEnded"]);
    const o = outcome(s);
    expect(o).toMatchObject({ result: "failed", reason: "heat", winners: [] });
    // "Best of the losers" ranking, shown as a loss (provisional).
    expect(o.ranking.map((e) => [e.player, e.score, e.stash, e.totalHandedIn])).toEqual([
      ["p0", 3.6, 3, 3],
      ["p1", 1.2, 1, 1],
    ]);
  });

  it("a raid from the missed-checkpoint penalty is ranked after the meeting's shakedown", () => {
    let s = { ...game(2), heat: 80 };
    for (let i = 0; i < 3; i++) s = run(s, mv("p0", "lobby", 2), ROUND); // Haul 6 of 12, Heat 92
    s = run(s, sched(1), OPEN, vote("p0", "p1"), CLOSE); // p1 is clean: paid 5, Haul 1, checkpoint missed
    expect(s.log.slice(-3).map((e) => e.type)).toEqual(["checkpointChecked", "copsRaided", "gameEnded"]);
    const o = outcome(s);
    expect(o).toMatchObject({ result: "failed", reason: "heat", winners: [] });
    expect(o.ranking.map((e) => [e.player, e.score, e.timesShakenDown])).toEqual([
      ["p0", 7.2, 0],
      ["p1", 6, 1],
    ]);
  });

  it("missing the final target fails the heist; the ranking is kept, nobody wins", () => {
    let s = game(2);
    for (let round = 1; round <= 9; round++) {
      s = run(s, mv("p0", "vault", round > 6 ? 6 : 0), mv("p1", "rooftop"), ROUND);
      if (round % 3 === 0) s = run(s, sched(round / 3), OPEN, CLOSE);
    }
    const o = outcome(s);
    expect(o).toMatchObject({ result: "failed", reason: "target", winners: [] });
    expect(o.ranking[0]).toMatchObject({ player: "p0", stash: 18, score: 21.6 });
  });
});

describe("Mole and Driver winning rules (task 13) — design §3, §8", () => {
  // The real content defs (ROLES.mole, ROLES.driver). p0 Mole, p1 Driver, p2 Rookie (stash 5, score 6).
  const state = (driverStash: number, moleStash = 1): GameState =>
    withPlayers(game(3, ["mole", "driver", "rookie"]), 0, { p0: { stash: moleStash }, p1: { stash: driverStash }, p2: { stash: 5 } });

  it("Heat failure: the Mole wins, and the Driver too with the biggest stash", () => {
    expect(outcomeFor(state(9), "heat").winners).toEqual(["p1", "p0"]);
    expect(outcomeFor(state(2), "heat").winners).toEqual(["p0"]);
  });

  it("Heat failure: the Driver's biggest stash is over the whole crew, Moles included", () => {
    expect(outcomeFor(state(9, 12), "heat").winners).toEqual(["p0"]);
  });

  it("missed target: only the Mole wins, whatever the Driver holds", () => {
    expect(outcomeFor(state(9), "target").winners).toEqual(["p0"]);
  });

  it("success: the Driver wins normally with the biggest score", () => {
    expect(outcomeFor(state(9), null)).toMatchObject({ result: "success", winners: ["p1"] });
    expect(outcomeFor(state(2), null)).toMatchObject({ result: "success", winners: ["p2"] });
  });

  it("success: the Mole never wins, even with the biggest stash; the best non-Mole does", () => {
    const o = outcomeFor(state(2, 20), null);
    expect(o.ranking[0]).toMatchObject({ player: "p0", role: "mole", stash: 20 });
    expect(o).toMatchObject({ result: "success", winners: ["p2"] });
  });

  it("success: two Moles on top leave the win to the best non-Mole, ties included", () => {
    const s = withPlayers(game(4, ["mole", "mole", "rookie", "lookout"]), 0, { p0: { stash: 30 }, p1: { stash: 30 }, p2: { stash: 5 }, p3: { stash: 6 } });
    expect(outcomeFor(s, null).winners).toEqual(["p2", "p3"]); // Rookie 5 × 1.2 = 6 ties the Lookout's 6
    expect(outcomeFor(s, "target").winners).toEqual(["p0", "p1"]);
  });

  it("with the starter roles nobody wins a failed heist", () => {
    const s = withPlayers(game(4, ["rookie", "lookout", "insider", "fence"]), 0, { p0: { stash: 3 }, p3: { stash: 8, safe: 2 } });
    expect(outcomeFor(s, "heat").winners).toEqual([]);
    expect(outcomeFor(s, "target").winners).toEqual([]);
  });
});
