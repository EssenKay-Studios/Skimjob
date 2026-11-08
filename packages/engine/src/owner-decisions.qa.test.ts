// QA (PR #21, owner answers 1 Nov; extension.md): the one vote rule at every
// crew size, the alibi phase (§5.4) with meetings,
// shakedown windows and the last round, and repeating cards (§13).
import { BANK_JOB, EVENTS } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState } from "./types";
import { setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { meetingResult } from "./meeting";
import { roundJob } from "./deck";
import { viewFor } from "./view";
import { R6_COINS } from "./v01-numbers.testkit";
import { fullGrab } from "./grab.testkit";

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true }));
function config(n: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "qa-owner",
    players: seats(n),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    contentOverrides: R6_COINS,
    ...extra,
  };
}
/** Seat i gets roles[i] (a Lookout if missing: its power acts only when used). */
function game(cfg: GameConfig, roles: string[] = []): GameState {
  let seat = 0;
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "lookout" } : e)));
}
type Cmd = unknown | ((s: GameState) => unknown);
const exec = (s: GameState, c: Cmd) => handleCommand(s, typeof c === "function" ? (c as (s: GameState) => unknown)(s) : c);
function run(state: GameState, ...cs: Cmd[]): GameState {
  return cs.reduce<GameState>((s, c) => {
    const r = exec(s, c);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
    return r.state;
  }, state);
}
function refused(state: GameState, c: Cmd): string {
  const r = exec(state, c);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const ALIBIS = (s: GameState) => ({ type: "advance", deadline: { kind: "alibis", round: s.resolvedRound } });
const alibiAt = (round: unknown) => ({ type: "advance", deadline: { kind: "alibis", round } });
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, pocket, R6_COINS), ...extra } });
const open = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId } });
const close = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId } });
const RESULT = (s: GameState) => ({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } });
/** The deadlines outside planning and alibis, nobody voting: the meeting a round called (design §9.1, §9.2), then the result window (§9.3). */
function pass(s: GameState): GameState {
  if (s.phase.kind === "result") return run(s, RESULT);
  if (s.phase.kind !== "awaitingMeeting") throw new Error(`unexpected ${s.phase.kind}`);
  const { meetingId } = s.phase;
  return run(s, { type: "scheduleMeeting", meetingId, slot: "x" }, open(meetingId), close(meetingId));
}
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
const LAST = <T extends GameEvent["type"]>(s: GameState, type: T) => s.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type).at(-1);
const m = (entries: [string, number][]) => new Map(entries);

describe("QA one vote rule at 8 vs 9 players — extension.md \"One vote rule\", design §9.5", () => {
  it.each([
    // [name, crew, voters, skipWeight, targets, totalWeight, expected]
    ["8p: 4 of 8 is not more than half", 8, 8, 0, m([["a", 4], ["b", 3], ["c", 1]]), 8, "noMajority"],
    ["8p: 5 of 8 is", 8, 8, 0, m([["a", 5], ["b", 3]]), 8, "shakedown"],
    ["9p: 3 of 9, alone on top, is no longer enough (no plurality)", 9, 9, 2, m([["a", 3], ["b", 2], ["c", 2]]), 9, "noMajority"],
    ["9p: 5 of 9", 9, 9, 2, m([["a", 5], ["b", 2]]), 9, "shakedown"],
    ["9p: one absent, 5 of 8", 9, 8, 1, m([["a", 5], ["b", 2]]), 8, "shakedown"],
    ["9p: bare quorum of 5, 3 of 5", 9, 5, 1, m([["a", 3], ["b", 1]]), 5, "shakedown"],
    ["9p: quorum missed by one (4 of 9)", 9, 4, 0, m([["a", 4]]), 4, "noQuorum"],
    ["12p: 6 of 12 is not more than half", 12, 12, 0, m([["a", 6], ["b", 6]]), 12, "noMajority"],
    ["12p: 7 skip of 12", 12, 12, 7, m([["a", 5]]), 12, "skipped"],
    ["12p: 7 of 12", 12, 12, 1, m([["a", 7], ["b", 4]]), 12, "shakedown"],
    ["9p Smooth Talker: ST + 3 = 5 of 10 is not more than half", 9, 9, 3, m([["a", 5], ["b", 2]]), 10, "noMajority"],
    ["9p Smooth Talker: ST + 4 = 6 of 10", 9, 9, 2, m([["a", 6], ["b", 2]]), 10, "shakedown"],
    ["9p Smooth Talker skipping makes a skip majority", 9, 9, 6, m([["a", 4]]), 10, "skipped"],
  ] as const)("%s", (_n, crew, voters, skip, targets, weight, expected) => {
    expect(meetingResult(crew, voters, skip, targets, weight).kind).toBe(expected);
  });

  it("the plurality numbers are gone from content overrides", () => {
    expect(validateConfig(config(9, { contentOverrides: { shakedown: { pluralityFromPlayers: 9 } } as never }))).not.toEqual([]);
  });

  // An emergency meeting called in round 1's result window (design §9.3).
  function emergencyVote(n: number, votes: [string, string | null][]): GameState {
    const roles = [...Array<string>(n - 1).fill("lookout"), "smoothTalker"];
    // A Shield in the shop, so a passed shakedown waits for its window (design §9.6).
    const g = game(config(n), roles);
    const shielded = replay(g.config, g.log.map((e): GameEvent => (e.type === "shopDealt" ? { ...e, perks: ["peek", "shield", "extraVote"] } : e)));
    let s = run(shielded, ROUND, ALIBIS);
    expect(s.phase).toEqual({ kind: "result", round: 1 });
    s = run(s, { type: "callEmergency", player: "p8" }, open("emergency-1"));
    expect(viewFor(s, "p0").alibiRound).toBeNull();
    expect(refused(s, RESULT)).toMatch(/no result window is open/);
    expect(refused(s, mv("p0", "lobby"))).toMatch(/only be submitted while a round is being planned/);
    s = run(s, ...votes.map(([p, t]) => vote(p, t)));
    return run(s, close("emergency-1"));
  }
  const ballots: [string, string | null][] = [["p1", "p0"], ["p2", "p0"], ["p3", "p0"], ["p4", "p5"], ["p5", "p4"], ["p6", "p4"], ["p7", null], ["p8", null]];
  const majority: [string, string | null][] = [["p1", "p0"], ["p2", "p0"], ["p3", "p0"], ["p4", "p0"], ["p5", "p0"], ["p6", "p4"], ["p7", null], ["p8", null]];

  it("9p integrated: 5 of 8 passes; the next round waits out the shakedown window, then starts (design §9.3)", () => {
    let s = emergencyVote(9, majority);
    expect(LAST(s, "meetingClosed")?.result).toEqual({ kind: "shakedown", target: "p0" });
    expect(s.phase.kind).toBe("shakedownPending");
    expect(refused(s, RESULT)).toMatch(/no result window/);
    refused(s, ROUND);
    s = run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "emergency-1" } });
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
    expect(viewFor(s, "p0").alibiRound).toBeNull();
    expect(refused(s, alibiAt(1))).toMatch(/no alibi deadline/);
    expect(replay(s.config, s.log)).toEqual(s);
  });

  it("8p integrated: a 3-vote lead is no shakedown (nor at 9p)", () => {
    let t = run(game(config(8)), ROUND, ALIBIS, { type: "callEmergency", player: "p7" }, open("emergency-1"));
    t = run(t, ...ballots.slice(0, 7).map(([p, v]) => vote(p, v)), close("emergency-1"));
    expect(LAST(t, "meetingClosed")?.result).toEqual({ kind: "noMajority" });
    expect(t.phase).toEqual({ kind: "planning", round: 2 });
  });
});

describe("QA Shift change — design §13", () => {
  it("the Vault gives 1 extra coin and nothing else changes (no crew-size scaling)", () => {
    const surged = roundJob(BANK_JOB, { round: 2, id: "shiftChange", room: null } as never, EVENTS);
    expect(surged.rooms.vault).toEqual({ ...BANK_JOB.rooms.vault, coins: (BANK_JOB.rooms.vault?.coins ?? 0) + 1 });
  });
});

describe("QA alibi phase — design §5.4", () => {
  it("stale, duplicate, future and malformed alibi deadlines are refused without state change", () => {
    let s = run(game(config(3)), ROUND);
    for (const r of [0, 2, -1, "1", 1.5, null, undefined]) {
      const before = JSON.stringify(s);
      refused(s, alibiAt(r));
      expect(JSON.stringify(s)).toBe(before);
    }
    expect(refused(s, ROUND)).toMatch(/no round deadline/);
    s = run(s, alibiAt(1));
    expect(refused(s, alibiAt(1))).toMatch(/no alibi deadline/);
    expect(refused(s, { type: "postAlibi", player: "p0", room: "lobby" })).toMatch(/closed/);
    expect(refused(game(config(3)), alibiAt(0))).toMatch(/no alibi deadline/);
  });

  it("no emergency during alibis; once they close, one called in the result window opens and the next round follows (design §9.3)", () => {
    let s = run(game(config(3)), ROUND);
    expect(refused(s, { type: "callEmergency", player: "p0" })).toMatch(/between a round's result and the next planning/);
    s = run(s, ALIBIS, { type: "callEmergency", player: "p0" });
    expect(s.phase).toEqual({ kind: "result", round: 1 });
    s = run(s, open("emergency-1"), close("emergency-1"));
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
  });

  it("a round that calls a meeting: it can't open during the round's alibis, only once they close (design §4.2 step 9)", () => {
    // A bank of 9: round 1's three missed moves leave 6, a third gone (design §9.1).
    let s = run(game(config(3, { contentOverrides: { ...R6_COINS, bank: { coinsPerPlayer: 3 } } })), { type: "proposeMeeting", player: "p0", slot: "x" }, { type: "acceptMeeting", player: "p1", proposalId: "proposal-1" }, ROUND);
    expect(s.phase).toEqual({ kind: "alibis", round: 1 });
    expect(refused(s, open("meeting-1"))).toMatch(/opens once a round calls it/);
    expect(refused(s, { type: "callEmergency", player: "p2" })).toMatch(/between a round's result/);
    s = run(s, ALIBIS);
    expect(s.phase).toEqual({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" });
    s = run(s, open("meeting-1"));
    expect(s.phase.kind).toBe("meeting");
  });

  it("last round of the game: the round cap ends it at once, with no alibi window after it (design §6.2)", () => {
    let s = game(config(3));
    while (s.phase.kind !== "ended") {
      if (s.phase.kind === "planning") s = run(s, ROUND);
      else if (s.phase.kind === "alibis") s = run(s, ALIBIS);
      else s = pass(s);
    }
    // Missed moves: 3 Lobby coins a round, so the 48-coin bank outlasts the 12 rounds.
    expect(s.round).toBe(12);
    expect(s.log.filter((e) => e.type === "alibisClosed").map((e) => (e as { round: number }).round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(refused(s, alibiAt(12))).toMatch(/over/);
  });
});

describe("QA game end closes the alibi window — design §5.4 (PR #21 QA repro)", () => {
  it("3p, all in the Vault every round until the game ends: no alibi window in state or view", () => {
    let s = game(config(3));
    for (let i = 0; i < 12 && s.phase.kind !== "ended"; i++) {
      if (s.phase.kind === "alibis") s = run(s, ALIBIS);
      while (s.phase.kind === "awaitingMeeting" || s.phase.kind === "result") s = pass(s);
      s = run(s, mv("p0", "vault"), mv("p1", "vault"), mv("p2", "vault"), ROUND);
    }
    expect(s.phase.kind).toBe("ended");
    expect(s.alibisOpen).toBe(false);
    for (const p of ["p0", "p1", "p2"]) expect(viewFor(s, p).alibiRound).toBeNull();
    expect(replay(s.config, s.log)).toEqual(s);
  });
});

describe("QA repeating cards — design §13", () => {
  function cards(seed: string): string[] {
    let s = game(config(4, { seed, eventsEnabled: true }));
    for (let i = 0; i < 40 && s.phase.kind !== "ended"; i++) {
      if (s.phase.kind === "planning") s = run(s, ROUND);
      else if (s.phase.kind === "alibis") s = run(s, ALIBIS);
      else if (s.phase.kind === "awaitingMeeting" || s.phase.kind === "result") s = pass(s);
      else break;
    }
    return s.log.flatMap((e) => (e.type === "eventFlipped" ? [e.card] : []));
  }
  it("same seed → same cards; across seeds cards do repeat within a game", () => {
    expect(cards("deck-a")).toEqual(cards("deck-a"));
    const games = Array.from({ length: 30 }, (_, i) => cards(`deck-${i}`));
    expect(games.some((c) => c.length !== new Set(c).size)).toBe(true);
    expect(games.some((c) => c.join() !== games[0]!.join())).toBe(true);
  });
});
