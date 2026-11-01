// QA (PR #7): complete scripted games through every ending (success, missed
// final target, raid mid-round, raid at a checkpoint), the final meeting's
// shakedown rescuing or sinking the heist, role scoring in the ranking,
// tie-breaks at every level, 2/3/12 players, commands after the end, and
// determinism / replay of a finished game. design §3, §8, §11.3, §13
import { STARTER_ROLES } from "@skimjob/content";
import { handleThroughAlibis } from "./alibis.testkit";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState, Outcome, PlayerState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { V01_NUMBERS } from "./v01-numbers.testkit";
import { outcomeFor, ranking } from "./end";

function config(players: number): GameConfig {
  return {
    seed: "qa-end",
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

/** Seat i is dealt roles[i] (Rookie if missing). */
function game(players: number, roles: string[] = []): GameState {
  const cfg = config(players);
  let seat = 0;
  const log = setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "rookie" } : e));
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, typeof c === "function" ? c(s) : c);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
    return r.state;
  }, state);
}

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const OPEN = (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const sched = (act: number) => ({ type: "scheduleMeeting", act, slot: "slot" });
const vote = (player: string, target: string) => ({ type: "castVote", player, vote: { kind: "shakedown", target } });
const SAFE1 = { ability: { kind: "fenceSafe", amount: 1 } };

const outcome = (s: GameState): Outcome => {
  if (s.phase.kind !== "ended") throw new Error(`game not over (${s.phase.kind})`);
  return s.phase.outcome;
};
const rows = (o: Outcome) => o.ranking.map((e) => [e.player, e.score]);
const types = (s: GameState, n: number) => s.log.slice(-n).map((e) => e.type);

function withPlayers(s: GameState, haul: number, change: Record<string, Partial<PlayerState>>): GameState {
  const players = Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, ...change[id] }]));
  return { ...s, haul, players };
}

/**
 * 3 players, Heat +4 a round (Vault +20 and Rooftop −20 cancel). p0 Rookie in
 * the Vault, p1 Fence in the Office, p2 Insider on the Rooftop. Rounds 1–6:
 * p0 and p1 pocket 1 (Haul +8). Rounds 7–9: both pocket 2 and the Fence safes 1
 * (Haul +6), p0 pockets `r9extra` more in round 9. Haul before the final
 * meeting: 66 − r9extra (final target 3 × 22 = 66).
 */
function game3(r9extra: number, finalVotes: unknown[] = []): GameState {
  let s = game(3, ["rookie", "fence", "insider"]);
  for (let round = 1; round <= 9; round++) {
    const act3 = round > 6;
    s = run(s, mv("p0", "vault", (act3 ? 2 : 1) + (round === 9 ? r9extra : 0)), mv("p1", "office", act3 ? 2 : 1, act3 ? SAFE1 : {}), mv("p2", "rooftop"), ROUND);
    if (round === 9) s = run(s, sched(3), OPEN, ...finalVotes, CLOSE);
    else if (round % 3 === 0) s = run(s, sched(round / 3), OPEN, CLOSE);
  }
  return s;
}

describe("3 players: the final target boundary — design §3, §8", () => {
  it("Haul exactly at the final target succeeds; Insider surplus is 0; Rookie ×1.2 and Fence safe counted", () => {
    const s = game3(0);
    expect([s.haul, s.heat]).toEqual([66, 36]);
    const o = outcome(s);
    expect(o).toMatchObject({ result: "success", winners: ["p0"] });
    expect(o.ranking).toEqual([
      { player: "p0", role: "rookie", score: 14.4, stash: 12, safe: 0, timesShakenDown: 0, totalHandedIn: 42 },
      { player: "p1", role: "fence", score: 12, stash: 12, safe: 3, timesShakenDown: 0, totalHandedIn: 24 },
      { player: "p2", role: "insider", score: 0, stash: 0, safe: 0, timesShakenDown: 0, totalHandedIn: 0 },
    ]);
  });

  it("one loot short of the final target fails (reason target), ranking kept, nobody wins", () => {
    const o = outcome(game3(1));
    expect(o).toMatchObject({ result: "failed", reason: "target", winners: [] });
    expect(rows(o)).toEqual([["p0", 15.6], ["p1", 12], ["p2", 0]]);
  });
});

describe("the final meeting's shakedown decides the heist — design §3, §11.3, §11.4", () => {
  it("shaking down the Fence rescues a failing heist; the safe stays and counts; exactly-at-threshold stash is not clean", () => {
    // Haul 65 before the meeting. Fence stash 9 outside the safe = 3 × act 3 → not clean, all 9 taken → 74.
    const s = game3(1, [vote("p0", "p1"), vote("p2", "p1"), vote("p1", "p0")]);
    expect(s.log.find((e) => e.type === "shakedownResolved")).toMatchObject({ target: "p1", taken: 9, clean: false, compensation: 0 });
    const o = outcome(s);
    expect(o).toMatchObject({ result: "success", winners: ["p0"] });
    expect(o.ranking).toEqual([
      { player: "p0", role: "rookie", score: 15.6, stash: 13, safe: 0, timesShakenDown: 0, totalHandedIn: 41 },
      { player: "p2", role: "insider", score: 8, stash: 0, safe: 0, timesShakenDown: 0, totalHandedIn: 0 }, // 74 − 66
      { player: "p1", role: "fence", score: 3, stash: 3, safe: 3, timesShakenDown: 1, totalHandedIn: 24 },
    ]);
  });

  it("shaking down a clean Insider sinks a passing heist: compensation leaves the Haul below target", () => {
    const s = game3(0, [vote("p0", "p2"), vote("p1", "p2")]);
    expect(s.log.find((e) => e.type === "shakedownResolved")).toMatchObject({ target: "p2", clean: true, compensation: 15 });
    expect(s.log.find((e) => e.type === "checkpointChecked" && e.act === 3)).toMatchObject({ haul: 51, met: false, heatPenalty: 0 });
    const o = outcome(s);
    expect(o).toMatchObject({ result: "failed", reason: "target", winners: [] });
    expect(rows(o)).toEqual([["p2", 15], ["p0", 14.4], ["p1", 12]]);
  });
});

describe("12 players — design §3, §6.2, §8", () => {
  // Rooms by seat. Heat +4 a round (2 Vault, 2 Rooftop). Loot 44 a round.
  const ROOMS = ["vault", "vault", "rooftop", "office", "rooftop", "office", "office", "office", "depositBoxes", "depositBoxes", "tellerLine", "tellerLine"];
  const POCKET: Record<string, number> = { p0: 2, p1: 3, p3: 2 };
  function game12(): GameState {
    let s = game(12, ["rookie", "lookout", "insider", "fence"]);
    for (let round = 1; round <= 9; round++) {
      for (const [i, room] of ROOMS.entries()) {
        const id = `p${i}`;
        s = run(s, mv(id, room, POCKET[id] ?? 0, id === "p3" && round > 6 ? SAFE1 : {}));
      }
      s = run(s, ROUND);
      if (round % 3 === 0) s = run(s, sched(round / 3), OPEN, CLOSE);
    }
    return s;
  }

  it("a full successful game: the Insider wins on surplus, zero scores ordered by handed in, then seat", () => {
    const s = game12();
    expect([s.haul, s.heat]).toEqual([333, 36]); // final target 264
    const o = outcome(s);
    expect(o).toMatchObject({ result: "success", winners: ["p2"] });
    expect(o.ranking.map((e) => [e.player, e.score, e.totalHandedIn])).toEqual([
      ["p2", 69, 0],
      ["p1", 27, 27],
      ["p0", 21.6, 36],
      ["p3", 18, 18],
      ["p8", 0, 45],
      ["p9", 0, 45],
      ["p5", 0, 36],
      ["p6", 0, 36],
      ["p7", 0, 36],
      ["p10", 0, 27],
      ["p11", 0, 27],
      ["p4", 0, 0],
    ]);
    expect(o.ranking.find((e) => e.player === "p3")).toMatchObject({ stash: 18, safe: 3 });
  });

  it("the ranking in gameEnded matches the final state (nothing left unfolded)", () => {
    const s = game12();
    expect(outcome(s).ranking).toEqual(ranking(s));
  });

  it("is deterministic and a finished game replays exactly", () => {
    const a = game12();
    expect(JSON.stringify(game12().log)).toBe(JSON.stringify(a.log));
    expect(replay(a.config, JSON.parse(JSON.stringify(a.log)) as GameEvent[])).toEqual(a);
  });

  /** All 12 in the Vault: Heat +24 a round → 24, 48, 72, 96, 100 (raid in round 5). p0 pockets 1; p1 is the Insider. */
  function raid12(): GameState {
    let s = game(12, ["rookie", "insider"]);
    for (let round = 1; round <= 5; round++) {
      for (let i = 0; i < 12; i++) s = run(s, mv(`p${i}`, "vault", i === 0 ? 1 : 0));
      s = run(s, ROUND);
      if (round === 3) s = run(s, sched(1), OPEN, CLOSE);
    }
    return s;
  }

  it("a raid mid-round in Act 2: failed (heat), ranked with that round's splits, Insider surplus uses the Haul at the end", () => {
    const s = raid12();
    expect([s.round, s.heat, s.haul]).toEqual([5, 100, 355]);
    expect(types(s, 2)).toEqual(["copsRaided", "gameEnded"]);
    const o = outcome(s);
    expect(o).toMatchObject({ result: "failed", reason: "heat", winners: [] });
    expect(o.ranking.slice(0, 3).map((e) => [e.player, e.score, e.totalHandedIn])).toEqual([
      ["p1", 91, 30], // 355 − 264
      ["p0", 6, 25],
      ["p2", 0, 30],
    ]);
    // Full tie among p2–p11 keeps seat order.
    expect(o.ranking.slice(2).map((e) => e.player)).toEqual(["p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11"]);
    expect(o.ranking).toEqual(ranking(s));
  });

  it("nothing is accepted after the game ends, and the state is untouched", () => {
    const s = raid12();
    const before = JSON.stringify(s);
    const commands = [
      mv("p0", "lobby"),
      { type: "postAlibi", player: "p0", room: "lobby" },
      { type: "proposeMeeting", player: "p0", slot: "x" },
      { type: "acceptMeeting", player: "p1", proposalId: "proposal-1" },
      { type: "callEmergency", player: "p0" },
      vote("p0", "p1"),
      { type: "sealVote", player: "p0", vote: { kind: "skip" } },
      sched(2),
      { type: "advance", deadline: { kind: "round", round: 5 } },
      { type: "advance", deadline: { kind: "round", round: 6 } },
      { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-2" } },
      { type: "advance", deadline: { kind: "closeMeeting", meetingId: "act-2" } },
    ];
    for (const c of commands) expect(handleThroughAlibis(s, c)).toEqual({ ok: false, reason: "the game is over" });
    // Also after a replay of the finished log.
    expect(handleThroughAlibis(replay(s.config, s.log), mv("p0", "lobby"))).toEqual({ ok: false, reason: "the game is over" });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("2 players: a raid exactly at the checkpoint penalty — design §3, §7, §11.5", () => {
  // Both in the Lobby (+4 Heat a round); p0 pockets 1 in round 1, so the Haul is 11 of 12.
  function act1(heat: number): GameState {
    let s = { ...game(2, ["fence", "rookie"]), heat };
    s = run(s, mv("p0", "lobby", 1, SAFE1), ROUND, ROUND, ROUND);
    return run(s, sched(1), OPEN, CLOSE);
  }

  it("Heat 73 + 12 + 15 = 100: raid at the checkpoint, ranked with the safe", () => {
    const s = act1(73);
    expect(types(s, 3)).toEqual(["checkpointChecked", "copsRaided", "gameEnded"]);
    const o = outcome(s);
    expect(o).toMatchObject({ result: "failed", reason: "heat", winners: [] });
    expect(o.ranking).toEqual([
      { player: "p0", role: "fence", score: 1, stash: 1, safe: 1, timesShakenDown: 0, totalHandedIn: 5 },
      { player: "p1", role: "rookie", score: 0, stash: 0, safe: 0, timesShakenDown: 0, totalHandedIn: 6 },
    ]);
  });

  it("Heat 72 → 99: no raid, the game goes on to round 4", () => {
    const s = act1(72);
    expect([s.phase.kind, s.round, s.heat]).toEqual(["planning", 4, 99]);
    expect(s.log.some((e) => e.type === "gameEnded")).toBe(false);
  });
});

describe("tie-breaks at every level — design §3", () => {
  it("cross-role score ties after scoring: Rookie 5 (×1.2 = 6) ties Lookout 6 and Insider 2 + 4 surplus", () => {
    const s = withPlayers(game(3, ["rookie", "lookout", "insider"]), 70, {
      p0: { stash: 5, totalHandedIn: 1 },
      p1: { stash: 6, totalHandedIn: 3 },
      p2: { stash: 2, totalHandedIn: 2 }, // 2 + (70 − 66)
    });
    expect(rows(outcomeFor(s, null))).toEqual([["p1", 6], ["p2", 6], ["p0", 6]]);
    expect(outcomeFor(s, null).winners).toEqual(["p1"]);
  });

  it("score beats shakedowns, shakedowns beat handed in", () => {
    const s = withPlayers(game(3, ["lookout", "lookout", "lookout"]), 0, {
      p0: { stash: 4, timesShakenDown: 0, totalHandedIn: 99 },
      p1: { stash: 5, timesShakenDown: 3, totalHandedIn: 0 },
      p2: { stash: 4, timesShakenDown: 1, totalHandedIn: 100 },
    });
    expect(ranking(s).map((e) => e.player)).toEqual(["p1", "p0", "p2"]);
  });

  it("a full tie at the top shares the win; a lower full tie does not", () => {
    const s = withPlayers(game(12), 0, {
      p3: { stash: 5, totalHandedIn: 4 },
      p7: { stash: 5, totalHandedIn: 4 },
      p11: { stash: 5, totalHandedIn: 4 },
      p0: { stash: 5, totalHandedIn: 3 },
    });
    const o = outcomeFor(s, null);
    expect(o.winners).toEqual(["p3", "p7", "p11"]);
    expect(o.ranking.slice(0, 4).map((e) => e.player)).toEqual(["p3", "p7", "p11", "p0"]);
  });

  it("2 players fully tied: both win a success, neither wins a failure", () => {
    const s = withPlayers(game(2), 0, { p0: { stash: 3, totalHandedIn: 2 }, p1: { stash: 3, totalHandedIn: 2 } });
    expect(outcomeFor(s, null).winners).toEqual(["p0", "p1"]);
    expect(outcomeFor(s, "heat").winners).toEqual([]);
    expect(outcomeFor(s, "target").winners).toEqual([]);
  });

  it("Rookie scores are exact to one decimal with no float noise", () => {
    for (const stash of [1, 3, 7, 13, 29, 101]) {
      const score = ranking(withPlayers(game(2), 0, { p0: { stash } }))[0]?.score;
      expect(String(score)).toBe((stash * 1.2).toFixed(1).replace(/\.0$/, ""));
    }
  });
});
