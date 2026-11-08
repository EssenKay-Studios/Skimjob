// End of game: the end check after a round (the bank, the round cap), the
// honesty line, the ranking and the winners. design §4.2 step 8, §6.2, §7.5, §8
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { BANK_JOB } from "@skimjob/content";
import type { ContentOverrides, GameConfig, GameEvent, GameState, Outcome, PlayerState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { NO_RAIDS } from "./v01-numbers.testkit";
import { outcomeFor, ranking } from "./end";
import { honesty } from "./shares";

function config(players: number, overrides?: ContentOverrides): GameConfig {
  return {
    seed: "end-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...(overrides && { contentOverrides: overrides }),
  };
}

/** A new game with chosen roles (seat i gets roles[i], a Lookout if missing). */
function game(players: number, roles: string[] = [], overrides?: ContentOverrides): GameState {
  const cfg = config(players, overrides);
  const log = setupEvents(cfg).map((e, i, all): GameEvent => {
    if (e.type !== "roleDealt") return e;
    const seat = all.slice(0, i).filter((x) => x.type === "roleDealt").length;
    return { ...e, role: roles[seat] ?? "lookout" };
  });
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    const r = handleThroughAlibis(s, command);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
    return r.state;
  }, state);
}

const mv = (player: string, room: string, duffel: number, pocket = 0) => ({ type: "submitMove", player, move: { room, duffel, pocket } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const OPEN = (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId } });

/** Through the regular meeting a third of the bank calls (design §9.1), nobody voting, and its result window (§9.3). */
function meeting(s: GameState): GameState {
  if (s.phase.kind !== "awaitingMeeting") return s;
  const { meetingId } = s.phase;
  return run(
    s,
    { type: "scheduleMeeting", meetingId, slot: "slot" },
    OPEN,
    { type: "advance", deadline: { kind: "closeMeeting", meetingId } },
    { type: "advance", deadline: { kind: "result", round: s.resolvedRound } },
  );
}

const outcome = (s: GameState): Outcome => {
  if (s.phase.kind !== "ended") throw new Error(`game not over (${s.phase.kind})`);
  return s.phase.outcome;
};

/** Every seat in the Vault with a full grab (3 coins), `pockets[i]` of them pocketed. */
const vaultRound = (s: GameState, pockets: number[]): GameState => run(s, ...pockets.map((p, i) => mv(`p${i}`, "vault", 3 - p, p)), ROUND);

/** Set players' end-of-game numbers directly (state is plain data). */
function withPlayers(s: GameState, change: Record<string, Partial<PlayerState>>): GameState {
  const players = Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, ...change[id] }]));
  return { ...s, players };
}

describe("the bank empties — design §6.2, §4.2 step 8", () => {
  it("the game ends after the round that empties the bank, early, with no meeting after it", () => {
    // 3 players × 9 coins: three rounds of three full Vault grabs (bells too big to raid).
    let s = game(3, [], { ...NO_RAIDS, bank: { coinsPerPlayer: 9 } });
    // Rounds 1 and 2 each take a third of the bank, so each calls a regular meeting (design §9.1).
    s = meeting(vaultRound(s, [0, 0, 0]));
    s = meeting(vaultRound(s, [0, 0, 0]));
    expect(s.log.filter((e) => e.type === "meetingOpened")).toHaveLength(2);
    s = vaultRound(s, [0, 0, 0]);
    expect(s.bank).toBe(0);
    expect(s.round).toBe(3);
    expect(outcome(s)).toMatchObject({ result: "success" });
    // design §6.2: no meeting after the last round, and §4.2 step 8: nothing below the end check runs.
    const after = s.log.slice(s.log.findIndex((e) => e.type === "roundResolved" && e.round === 3));
    expect(after.map((e) => e.type)).toEqual(["roundResolved", "gameEnded"]);
    expect(handleCommand(s, OPEN(s))).toMatchObject({ ok: false, reason: "the game is over" });
  });

  it("a short last round still ends it: the bank is empty, not just low (design §3.2)", () => {
    const s = vaultRound(game(3, [], { ...NO_RAIDS, bank: { coinsPerPlayer: 2 } }), [0, 0, 0]); // 6 coins, 9 asked for
    expect(s.bank).toBe(0);
    expect(outcome(s).result).toBe("success");
  });

  it("a round that leaves a coin in the bank plays on", () => {
    const s = vaultRound(game(3, [], { ...NO_RAIDS, bank: { coinsPerPlayer: 4 } }), [0, 0, 0]); // 12 coins
    expect(s.bank).toBe(3);
    // It took two thirds of the bank, so the game goes on to one regular meeting (design §9.1).
    expect(s.phase).toEqual({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" });
  });
});

describe("the round cap — design §6.2", () => {
  it("12 rounds: with coins still in the bank the game ends after round 12, and no meeting follows it", () => {
    expect(BANK_JOB.roundCap).toBe(12);
    let s = game(3);
    for (let round = 1; round <= 12; round++) {
      // The shipped numbers: 48 coins, 3 Lobby coins a round (silent), all handed in.
      s = run(s, mv("p0", "lobby", 1), mv("p1", "lobby", 1), mv("p2", "lobby", 1), ROUND);
      if (round < 12) expect(s.phase.kind, `round ${round}`).not.toBe("ended");
      if (round < 12) s = meeting(s);
    }
    expect(s.bank).toBe(48 - 36);
    // The bank's thirds call regular meetings after rounds 6 (30 left) and 11 (15 left). design §9.1
    expect(s.log.filter((e) => e.type === "meetingOpened").map((e) => e.type === "meetingOpened" && e.meetingId)).toEqual(["meeting-1", "meeting-2"]);
    expect(s.log.at(-2)).toMatchObject({ type: "roundResolved", round: 12 });
    expect(outcome(s)).toMatchObject({ result: "success" });
  });

  it("the cap is content: an override ends the game sooner", () => {
    const s = vaultRound(game(3, [], { ...NO_RAIDS, roundCap: 1 }), [0, 0, 0]);
    expect(s.bank).toBe(48 - 9);
    expect(outcome(s).result).toBe("success");
  });
});

describe("success or sunk by theft: the honesty line — design §7.5, §8.1, §8.4", () => {
  const once: ContentOverrides = { ...NO_RAIDS, roundCap: 1 };

  it("honesty is the coins that reached the duffel ÷ the coins taken, full before any coin is taken", () => {
    expect(honesty({ reached: 0, taken: 0 })).toBe(1);
    expect(honesty({ reached: 6, taken: 9 })).toBe(2 / 3);
    expect(honesty({ reached: 5, taken: 9 })).toBeLessThan(BANK_JOB.honestyLine);
  });

  it("exactly two-thirds handed in is a success", () => {
    const s = vaultRound(game(3, [], once), [1, 1, 1]); // 6 of 9
    expect(outcome(s)).toMatchObject({ result: "success" });
  });

  it("below two-thirds the heist is sunk by theft, and nobody wins without a role that wins it", () => {
    const s = vaultRound(game(3, ["lookout"], once), [2, 1, 1]); // 5 of 9
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "theft", winners: [] });
    // design §8.6: the full ranking is still shown.
    // The pockets plus the cut of 1 (5 handed in, 3 ways; the kitty of 2 pays the getaway car, design §6.3).
    expect(outcome(s).ranking.map((e) => [e.player, e.stash])).toEqual([["p0", 3], ["p1", 2], ["p2", 2]]);
    expect(outcome(s)).toMatchObject({ getaway: 2 });
  });

  it("sunk by theft: the Mole holding the biggest stash wins it (design §8.4; its handler in S3a.6)", () => {
    const s = vaultRound(game(3, ["mole"], once), [2, 1, 1]);
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "theft", winners: ["p0"] });
  });

  it("sunk by theft: the Fixer holding the biggest stash wins it too (design §8.4; QA #166 repro)", () => {
    const s = vaultRound(game(3, ["fixer"], once), [2, 1, 1]); // 5 of 9
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "theft", winners: ["p0"] });
  });

  it("sunk by theft: each Mole or Fixer copy wins under its own handler when it ties at the top (design §8.5, §11.3)", () => {
    const tied = (roles: string[]) => withPlayers(game(4, roles), { p0: { stash: 6 }, p1: { stash: 6 }, p2: { stash: 6 }, p3: { stash: 2 } });
    expect(outcomeFor(tied(["fixer", "fixer", "lookout"]), "theft").winners).toEqual(["p0", "p1"]);
    expect(outcomeFor(tied(["mole", "lookout", "fixer"]), "theft").winners).toEqual(["p0", "p2"]);
    // A Fixer below the top wins nothing, and nor does a Fixer on a success it doesn't top.
    const behind = withPlayers(game(3, ["fixer", "lookout"]), { p0: { stash: 5 }, p1: { stash: 6 } });
    expect(outcomeFor(behind, "theft").winners).toEqual([]);
    expect(outcomeFor(behind, null).winners).toEqual(["p1"]);
  });

  it("seized coins count neither as taken nor as reaching the duffel", () => {
    // Real bells: two full Vault grabs ring 6 and raid it (design §5.3); the Lobby coin is the only one taken.
    let s = game(3, [], { roundCap: 1 });
    s = run(s, mv("p0", "vault", 3), mv("p1", "vault", 2, 1), mv("p2", "lobby", 1), ROUND);
    expect(s.seized).toBe(6);
    expect(s.wanted).toBe(1);
    expect(outcome(s).result).toBe("success"); // 1 of 1; counting the seized coins would make it 1 of 7
  });

  it("the gameEnded event is public and replays to the same state", () => {
    const s = vaultRound(game(3, [], once), [2, 1, 1]);
    expect(s.log.at(-1)).toMatchObject({ type: "gameEnded", visibility: { kind: "public" } });
    expect(replay(s.config, s.log)).toEqual(s);
    expect(replay(s.config, JSON.parse(JSON.stringify(s.log)) as GameEvent[])).toEqual(s);
  });
});

describe("who wins — design §8.2, §8.5", () => {
  it("the ranking is by stash; equal stashes keep seat order, with no tie-break", () => {
    const s = withPlayers(game(4), {
      p0: { stash: 5 },
      p1: { stash: 5 },
      p2: { stash: 6 },
      p3: { stash: 1 },
    });
    expect(ranking(s).map((e) => [e.player, e.stash])).toEqual([["p2", 6], ["p0", 5], ["p1", 5], ["p3", 1]]);
  });

  it("everyone tied for the biggest stash wins", () => {
    const s = withPlayers(game(3), { p0: { stash: 4 }, p1: { stash: 4 }, p2: { stash: 1 } });
    expect(outcomeFor(s, null).winners).toEqual(["p0", "p1"]);
  });

  it("every stash equal on a success: the whole crew wins together", () => {
    const s = vaultRound(game(3, [], { ...NO_RAIDS, roundCap: 1 }), [0, 0, 0]);
    expect(outcome(s)).toMatchObject({ result: "success", winners: ["p0", "p1", "p2"] });
  });

  it("a perk buyer (a lower stash) doesn't share the whole-crew win", () => {
    const s = withPlayers(game(3), { p0: { stash: 3 }, p1: { stash: 3 }, p2: { stash: 2 } });
    expect(outcomeFor(s, null).winners).toEqual(["p0", "p1"]);
  });

  it("sunk by theft: a Mole tied at the top with a player who can't win still wins; a Mole below the top doesn't", () => {
    const tied = withPlayers(game(3, ["mole", "lookout"]), { p0: { stash: 6 }, p1: { stash: 6 } });
    expect(outcomeFor(tied, "theft").winners).toEqual(["p0"]);
    const behind = withPlayers(game(3, ["mole", "lookout"]), { p0: { stash: 5 }, p1: { stash: 6 } });
    expect(outcomeFor(behind, "theft").winners).toEqual([]);
  });
});
