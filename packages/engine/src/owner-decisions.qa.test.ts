// QA (PR #21, owner answers 1 Nov; extension.md): the one vote rule at every
// crew size, uniqueRoles (§8.1, §15),
// the alibi phase (§5.4) with meetings,
// shakedown windows and the last round, and repeating cards (§10).
import { BANK_JOB, EVENTS, STARTER_ROLES, type RoleId } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState } from "./types";
import { createGame, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { meetingResult } from "./meeting";
import { roundJob } from "./deck";
import { viewFor } from "./view";
import { V01_NUMBERS } from "./v01-numbers.testkit";
import { fullGrab } from "./grab.testkit";

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true }));
function config(n: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "qa-owner",
    players: seats(n),
    job: "bank",
    rolePool: [...STARTER_ROLES],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    contentOverrides: V01_NUMBERS,
    ...extra,
  };
}
/** Seat i gets roles[i] (Rookie if missing). */
function game(cfg: GameConfig, roles: string[] = []): GameState {
  let seat = 0;
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "rookie" } : e)));
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
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, pocket, V01_NUMBERS), ...extra } });
const open = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId } });
const close = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId } });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
const LAST = <T extends GameEvent["type"]>(s: GameState, type: T) => s.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type).at(-1);
const m = (entries: [string, number][]) => new Map(entries);
const dealt = (cfg: GameConfig): RoleId[] => setupEvents(cfg).flatMap((e) => (e.type === "roleDealt" ? [e.role] : []));

describe("QA one vote rule at 8 vs 9 players — extension.md \"One vote rule\", design §11.2", () => {
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
    ["9p Smooth talker: ST + 3 = 5 of 10 is not more than half", 9, 9, 3, m([["a", 5], ["b", 2]]), 10, "noMajority"],
    ["9p Smooth talker: ST + 4 = 6 of 10", 9, 9, 2, m([["a", 6], ["b", 2]]), 10, "shakedown"],
    ["9p Smooth talker skipping makes a skip majority", 9, 9, 6, m([["a", 4]]), 10, "skipped"],
  ] as const)("%s", (_n, crew, voters, skip, targets, weight, expected) => {
    expect(meetingResult(crew, voters, skip, targets, weight).kind).toBe(expected);
  });

  it("the plurality numbers are gone from content overrides", () => {
    expect(validateConfig(config(9, { contentOverrides: { shakedown: { pluralityFromPlayers: 9 } } as never }))).not.toEqual([]);
  });

  // An emergency meeting called in round 1's alibi window.
  function emergencyVote(n: number, votes: [string, string | null][]): GameState {
    const roles = [...Array<string>(n - 1).fill("rookie"), "smoothTalker"];
    let s = run(game(config(n, { rolePool: [...STARTER_ROLES, "smoothTalker"] }), roles), ROUND);
    expect(s.phase).toEqual({ kind: "alibis", round: 1 });
    s = run(s, { type: "callEmergency", player: "p8" }, open("emergency-p8"));
    expect(viewFor(s, "p0").alibiRound).toBe(1);
    expect(refused(s, ALIBIS)).toMatch(/paused while a meeting is open/);
    expect(refused(s, mv("p0", "lobby"))).toMatch(/only be submitted while a round is being planned/);
    s = run(s, ...votes.map(([p, t]) => vote(p, t)));
    return run(s, close("emergency-p8"));
  }
  const ballots: [string, string | null][] = [["p1", "p0"], ["p2", "p0"], ["p3", "p0"], ["p4", "p5"], ["p5", "p4"], ["p6", "p4"], ["p7", null], ["p8", null]];
  const majority: [string, string | null][] = [["p1", "p0"], ["p2", "p0"], ["p3", "p0"], ["p4", "p0"], ["p5", "p0"], ["p6", "p4"], ["p7", null], ["p8", null]];

  it("9p integrated: 5 of 8 passes; alibi deadline stays paused through the shakedown window, then the alibi window resumes", () => {
    let s = emergencyVote(9, majority);
    expect(LAST(s, "meetingClosed")?.result).toEqual({ kind: "shakedown", target: "p0" });
    expect(s.phase.kind).toBe("shakedownPending");
    expect(refused(s, ALIBIS)).toMatch(/paused/);
    s = run(s, { type: "postAlibi", player: "p3", room: "vault" }); // alibis still postable while interrupted
    s = run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "emergency-p8" } });
    expect(s.phase).toEqual({ kind: "alibis", round: 1 });
    refused(s, ROUND);
    s = run(s, ALIBIS);
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
    expect(viewFor(s, "p0").alibiRound).toBeNull();
    expect(refused(s, alibiAt(1))).toMatch(/no alibi deadline/);
    expect(replay(s.config, s.log)).toEqual(s);
  });

  it("8p integrated: a 3-vote lead is no shakedown (nor at 9p)", () => {
    let t = run(game(config(8, { rolePool: [...STARTER_ROLES, "smoothTalker"] })), ROUND, { type: "callEmergency", player: "p7" }, open("emergency-p7"));
    t = run(t, ...ballots.slice(0, 7).map(([p, v]) => vote(p, v)), close("emergency-p7"));
    expect(LAST(t, "meetingClosed")?.result).toEqual({ kind: "noMajority" });
    expect(t.phase).toEqual({ kind: "alibis", round: 1 });
  });
});

describe("QA dealing — design §8.1", () => {
  const SEEDS = Array.from({ length: 150 }, (_, i) => `deal-${i}`);

  it("uniqueRoles false repeats roles; true never does; non-boolean rejected; deal is deterministic", () => {
    const repeats = (cfg: GameConfig) => {
      const roles = dealt(cfg).filter((r) => r !== "rookie" && r !== "mole" && r !== "mole");
      return roles.length !== new Set(roles).size;
    };
    expect(SEEDS.slice(0, 40).some((seed) => repeats(config(12, { seed, rolePool: [], uniqueRoles: false })))).toBe(true);
    expect(SEEDS.slice(0, 40).some((seed) => repeats(config(12, { seed, rolePool: [] })))).toBe(false);
    expect(dealt(config(6, { rolePool: ["lookout"], uniqueRoles: false, deal: "random" }))).toEqual(Array(6).fill("lookout"));
    expect(validateConfig({ ...config(6), uniqueRoles: "no" })).toContain("uniqueRoles must be a boolean");
    const cfg = config(12, { seed: "det", rolePool: [], uniqueRoles: false });
    expect(setupEvents(cfg)).toEqual(setupEvents(cfg));
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

  it("an emergency called (not yet open) during alibis doesn't pause them; it opens in the next planning", () => {
    let s = run(game(config(3)), ROUND, { type: "callEmergency", player: "p0" }, ALIBIS);
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
    s = run(s, open("emergency-p0"), close("emergency-p0"));
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
  });

  it("act's last round: the regular meeting can't open during its alibis; an emergency there returns to alibis", () => {
    let s = run(game(config(3)), ROUND, ALIBIS, ROUND, ALIBIS, ROUND, { type: "scheduleMeeting", act: 1, slot: "x" });
    expect(s.phase).toEqual({ kind: "alibis", round: 3 });
    expect(refused(s, open("act-1"))).toMatch(/opens after round 3/);
    s = run(s, { type: "callEmergency", player: "p2" }, open("emergency-p2"), close("emergency-p2"));
    expect(s.phase).toEqual({ kind: "alibis", round: 3 });
    s = run(s, ALIBIS);
    expect(s.phase).toEqual({ kind: "awaitingMeeting", act: 1 });
    s = run(s, open("act-1"));
    expect(s.phase.kind).toBe("meeting");
  });

  it("last round of the game: round 9 has an alibi window, then the act-3 meeting ends the game", () => {
    let s = game(config(3));
    while (s.round < 9 || s.phase.kind === "planning") {
      if (s.phase.kind === "planning") s = run(s, ROUND);
      else if (s.phase.kind === "alibis") { if (s.round === 9) break; s = run(s, ALIBIS); }
      else if (s.phase.kind === "awaitingMeeting") {
        const act = s.phase.act;
        s = run(s, { type: "scheduleMeeting", act, slot: "x" }, open(`act-${act}`), close(`act-${act}`));
      } else throw new Error(`unexpected ${s.phase.kind}`);
      if (s.phase.kind === "ended") break;
    }
    expect(s.phase).toEqual({ kind: "alibis", round: 9 });
    s = run(s, { type: "postAlibi", player: "p0", room: "vault" }, ALIBIS, { type: "scheduleMeeting", act: 3, slot: "x" }, open("act-3"), close("act-3"));
    expect(s.phase.kind).toBe("ended");
    expect(refused(s, alibiAt(9))).toMatch(/over/);
  });
});

describe("QA game end closes the alibi window — design §5.4 (PR #21 QA repro)", () => {
  it("3p, all in the Vault every round until the game ends: no alibi window in state or view", () => {
    let s = game(config(3));
    for (let i = 0; i < 12 && s.phase.kind !== "ended"; i++) {
      if (s.phase.kind === "alibis") s = run(s, ALIBIS);
      if (s.phase.kind === "awaitingMeeting") {
        const act = s.phase.act;
        s = run(s, { type: "scheduleMeeting", act, slot: "x" }, open(`act-${act}`), close(`act-${act}`));
        if (s.phase.kind === "ended") break;
      }
      s = run(s, mv("p0", "vault"), mv("p1", "vault"), mv("p2", "vault"), ROUND);
    }
    expect(s.phase.kind).toBe("ended");
    expect(s.alibisOpen).toBe(false);
    for (const p of ["p0", "p1", "p2"]) expect(viewFor(s, p).alibiRound).toBeNull();
    expect(replay(s.config, s.log)).toEqual(s);
  });
});

describe("QA repeating cards — design §10", () => {
  function cards(seed: string): string[] {
    let s = game(config(4, { seed, eventsEnabled: true, rolePool: ["rookie"] }));
    for (let i = 0; i < 40 && s.phase.kind !== "ended"; i++) {
      if (s.phase.kind === "planning") s = run(s, ROUND);
      else if (s.phase.kind === "alibis") s = run(s, ALIBIS);
      else if (s.phase.kind === "awaitingMeeting") {
        const act = s.phase.act;
        s = run(s, { type: "scheduleMeeting", act, slot: "x" }, open(`act-${act}`), close(`act-${act}`));
      } else break;
    }
    return [...s.cardsFlipped];
  }
  it("same seed → same cards; across seeds cards do repeat within a game", () => {
    expect(cards("deck-a")).toEqual(cards("deck-a"));
    const games = Array.from({ length: 30 }, (_, i) => cards(`deck-${i}`));
    expect(games.some((c) => c.length !== new Set(c).size)).toBe(true);
    expect(games.some((c) => c.join() !== games[0]!.join())).toBe(true);
  });
});
