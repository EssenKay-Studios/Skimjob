// QA (PR #7): complete scripted games to the round cap and a bust, the
// ranking, ties at every level, 3/12 players, commands after the end, and
// determinism / replay of a finished game. design §5.5, §6.2, §8
import { STARTER_ROLES } from "@skimjob/content";
import { handleThroughAlibis } from "./alibis.testkit";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState, Outcome, PlayerState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { jobFor } from "./overrides";
import { V01_NUMBERS } from "./v01-numbers.testkit";
import { outcomeFor, ranking } from "./end";
import { fullGrab } from "./grab.testkit";

function config(players: number): GameConfig {
  return {
    seed: "qa-end",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [...STARTER_ROLES], // the shop's Shield may open the window (run passes it)
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
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
    // extension.md "Shakedowns": nobody holds a Shield here, so the window just passes.
    if (r.state.phase.kind !== "shakedownPending") return r.state;
    const passed = handleCommand(r.state, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: r.state.phase.meetingId } });
    if (!passed.ok) throw new Error(`rejected: ${passed.reason}`);
    return passed.state;
  }, state);
}

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, pocket, V01_NUMBERS), ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const OPEN = (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const sched = (act: number) => ({ type: "scheduleMeeting", act, slot: "slot" });
const vote = (player: string, target: string) => ({ type: "castVote", player, vote: { kind: "shakedown", target } });

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

describe("12 players — design §3, §6.2, §8", () => {
  // Rooms by seat. Coins 48 a round.
  const ROOMS = ["vault", "vault", "rooftop", "office", "rooftop", "office", "office", "office", "depositBoxes", "depositBoxes", "managersOffice", "managersOffice"];
  const POCKET: Record<string, number> = { p0: 2, p1: 3, p3: 2 };
  function game12(): GameState {
    let s = game(12, ["rookie", "lookout", "priest", "hacker"]);
    for (let round = 1; round <= 12; round++) {
      for (const [i, room] of ROOMS.entries()) {
        const id = `p${i}`;
        s = run(s, mv(id, room, POCKET[id] ?? 0));
      }
      s = run(s, ROUND);
      if (round % 3 === 0 && round < 12) s = run(s, sched(round / 3), OPEN, CLOSE);
    }
    return s;
  }

  it("the ranking in gameEnded matches the final state (nothing left unfolded)", () => {
    const s = game12();
    expect(outcome(s).ranking).toEqual(ranking(s));
  });

  it("is deterministic and a finished game replays exactly", () => {
    const a = game12();
    expect(JSON.stringify(game12().log)).toBe(JSON.stringify(a.log));
    expect(replay(a.config, JSON.parse(JSON.stringify(a.log)) as GameEvent[])).toEqual(a);
  });

  /** Wanted 2 and the Vault's bell one bulb short; all 12 grab there in round 4: a raid and a bust (design §5.5). p0 pockets 1; p1 is the Priest. */
  function raid12(): GameState {
    let s = game(12, ["rookie", "priest"]);
    for (let round = 1; round <= 3; round++) s = run(s, ...Array.from({ length: 12 }, (_, i) => mv(`p${i}`, "lobby")), ROUND);
    s = run(s, sched(1), OPEN, CLOSE);
    const bulbs = jobFor(s.config).alarm.bulbs;
    s = { ...s, wanted: 2, bells: { ...s.bells, vault: bulbs - 1 } };
    for (let i = 0; i < 12; i++) s = run(s, mv(`p${i}`, "vault", i === 0 ? 1 : 0));
    return run(s, ROUND);
  }

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

describe("ties at every level — design §8.5", () => {
  it("the ranking is by stash only: equal stashes keep seat order", () => {
    const s = withPlayers(game(3, ["lookout", "lookout", "lookout"]), 0, {
      p0: { stash: 4 },
      p1: { stash: 5 },
      p2: { stash: 4 },
    });
    expect(ranking(s).map((e) => e.player)).toEqual(["p1", "p0", "p2"]);
    expect(outcomeFor(withPlayers(s, 0, { p1: { stash: 4 } }), null).winners).toEqual(["p0", "p1", "p2"]);
  });

  it("a tie at the top shares the win; a lower tie does not", () => {
    const s = withPlayers(game(12), 0, {
      p3: { stash: 5 },
      p7: { stash: 5 },
      p11: { stash: 5 },
      p0: { stash: 5 },
    });
    const o = outcomeFor(s, null);
    expect(o.winners).toEqual(["p0", "p3", "p7", "p11"]);
    expect(o.ranking.slice(0, 4).map((e) => e.player)).toEqual(["p0", "p3", "p7", "p11"]);
  });

  it("3 players fully tied: all win a success, none wins a failure", () => {
    const s = withPlayers(game(3), 0, { p0: { stash: 3 }, p1: { stash: 3 }, p2: { stash: 3 } });
    expect(outcomeFor(s, null).winners).toEqual(["p0", "p1", "p2"]);
    expect(outcomeFor(s, "theft").winners).toEqual([]);
    expect(outcomeFor(s, "bust").winners).toEqual([]);
  });
});
