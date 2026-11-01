// QA (PR #21, owner answers 1 Nov): big-crew plurality edges (§11.2), Insider
// from 5 and one Mole (§8.1), uniqueRoles (§8.1, §15), scaled event Heat (§10),
// Fence safe in the clean check (§11.3), the alibi phase (§5.4) with meetings,
// shakedown windows, Duel mode and the last round, and repeating cards (§10).
import { BANK_JOB, EVENTS, STARTER_ROLES, type RoleId } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState } from "./types";
import { createGame, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { meetingResult } from "./meeting";
import { eventHeatScale, roundJob, scaledCardHeat } from "./deck";
import { viewFor } from "./view";
import { V01_NUMBERS } from "./v01-numbers.testkit";

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true }));
function config(n: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "qa-owner",
    players: seats(n),
    job: "bank",
    rolePool: [...STARTER_ROLES],
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
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
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const open = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId } });
const close = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId } });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
const LAST = <T extends GameEvent["type"]>(s: GameState, type: T) => s.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type).at(-1);
const m = (entries: [string, number][]) => new Map(entries);
const dealt = (cfg: GameConfig): RoleId[] => setupEvents(cfg).flatMap((e) => (e.type === "roleDealt" ? [e.role] : []));

describe("QA plurality at 8 vs 9 players — design §11.2", () => {
  it.each([
    // [name, crew, voters, skipWeight, targets, totalWeight, expected]
    ["8p: 4 of 8 is not more than half", 8, 8, 0, m([["a", 4], ["b", 3], ["c", 1]]), 8, "noMajority"],
    ["9p: 3 of 9 exactly a third, alone on top", 9, 9, 3, m([["a", 3], ["b", 2], ["c", 1]]), 9, "shakedown"],
    ["9p: 3–3 tie at a third", 9, 9, 3, m([["a", 3], ["b", 3]]), 9, "noMajority"],
    ["9p: one absent, 3 of 8", 9, 8, 2, m([["a", 3], ["b", 2], ["c", 1]]), 8, "shakedown"],
    ["9p: bare quorum of 5, 2 of 5", 9, 5, 1, m([["a", 2], ["b", 1], ["c", 1]]), 5, "shakedown"],
    ["9p: quorum missed by one (4 of 9)", 9, 4, 0, m([["a", 4]]), 4, "noQuorum"],
    ["9p: skip outvotes the leader but isn't a majority", 9, 9, 4, m([["a", 3], ["b", 2]]), 9, "shakedown"],
    ["12p: current behaviour — skip leads 6 vs A 4 without a majority, A (⅓) is still shaken down", 12, 12, 6, m([["a", 4], ["b", 2]]), 12, "shakedown"],
    ["12p: 7 skip of 12", 12, 12, 7, m([["a", 5]]), 12, "skipped"],
    ["9p Smooth talker: 3 plain votes of weight 10 is under a third", 9, 9, 3, m([["a", 3], ["b", 2], ["c", 2]]), 10, "noMajority"],
    ["9p Smooth talker: ST + 2 = 4 of 10", 9, 9, 3, m([["a", 4], ["b", 2], ["c", 1]]), 10, "shakedown"],
    ["9p Smooth talker: 4–4 weight tie (ST+2 vs 4 plain)", 9, 9, 0, m([["a", 4], ["b", 4], ["c", 2]]), 10, "noMajority"],
    ["9p Smooth talker skipping makes a skip majority", 9, 9, 6, m([["a", 4]]), 10, "skipped"],
    ["9p: every voter skips 4, rest scattered singletons", 9, 9, 4, m([["a", 1], ["b", 1], ["c", 1], ["d", 1], ["e", 1]]), 9, "noMajority"],
  ] as const)("%s", (_n, crew, voters, skip, targets, weight, expected) => {
    expect(meetingResult(crew, voters, skip, targets, weight, BANK_JOB.shakedown).kind).toBe(expected);
  });

  it("overrides: pluralityFromPlayers above the crew turns it off; validation rejects bad values", () => {
    expect(meetingResult(12, 12, 3, m([["a", 4], ["b", 3], ["c", 2]]), 12, { pluralityFromPlayers: 13, pluralityShare: 1 / 3 }).kind).toBe("noMajority");
    expect(validateConfig(config(9, { contentOverrides: { shakedown: { pluralityFromPlayers: 0 } } }))).not.toEqual([]);
    expect(validateConfig(config(9, { contentOverrides: { shakedown: { pluralityShare: -0.1 } } }))).not.toEqual([]);
  });

  // An emergency meeting called in round 1's alibi window, with a Muscle in the pool (so a shakedown window).
  function emergencyVote(n: number, votes: [string, string | null][]): GameState {
    let s = run(game(config(n, { rolePool: [...STARTER_ROLES, "muscle"] })), ROUND);
    expect(s.phase).toEqual({ kind: "alibis", round: 1 });
    s = run(s, { type: "callEmergency", player: "p8" }, open("emergency-p8"));
    expect(viewFor(s, "p0").alibiRound).toBe(1);
    expect(refused(s, ALIBIS)).toMatch(/paused while a meeting is open/);
    expect(refused(s, mv("p0", "lobby"))).toMatch(/only be submitted while a round is being planned/);
    s = run(s, ...votes.map(([p, t]) => vote(p, t)));
    return run(s, close("emergency-p8"));
  }
  const ballots: [string, string | null][] = [["p1", "p0"], ["p2", "p0"], ["p3", "p0"], ["p4", "p5"], ["p5", "p4"], ["p6", "p4"], ["p7", null], ["p8", null]];

  it("9p integrated: 3 of 8 alone on top passes; alibi deadline stays paused through the shakedown window, then the alibi window resumes", () => {
    let s = emergencyVote(9, ballots);
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

  it("8p integrated: the same 3-vote lead is no shakedown", () => {
    let t = run(game(config(8, { rolePool: [...STARTER_ROLES, "muscle"] })), ROUND, { type: "callEmergency", player: "p7" }, open("emergency-p7"));
    t = run(t, ...ballots.slice(0, 7).map(([p, v]) => vote(p, v)), close("emergency-p7"));
    expect(LAST(t, "meetingClosed")?.result).toEqual({ kind: "noMajority" });
    expect(t.phase).toEqual({ kind: "alibis", round: 1 });
  });
});

describe("QA dealing — design §8.1", () => {
  const SEEDS = Array.from({ length: 150 }, (_, i) => `deal-${i}`);

  it("the Insider is never dealt at 2–4 players (any setting); it is dealt at 5", () => {
    for (const n of [2, 3, 4]) {
      for (const seed of SEEDS) {
        for (const extra of [{}, { uniqueRoles: false }, { rolePool: ["insider"] }, { rolePool: ["insider"], uniqueRoles: false }, { starterMode: true }] as Partial<GameConfig>[]) {
          expect(dealt(config(n, { seed, mole: "on", eventsEnabled: extra.starterMode ? false : true, ...extra, ...(extra.starterMode ? { mole: "off" } : {}) }))).not.toContain("insider");
        }
      }
    }
    // An Insider-only pool at 4p deals all Rookies, also with uniqueRoles false.
    expect(dealt(config(4, { rolePool: ["insider"], uniqueRoles: false }))).toEqual(["rookie", "rookie", "rookie", "rookie"]);
    expect(SEEDS.some((seed) => dealt(config(5, { seed })).includes("insider"))).toBe(true);
  });

  it("exactly one Mole at 9–12 with 'on'; 0 or 1 with 'maybe'; never more with uniqueRoles false", () => {
    for (const n of [5, 8, 9, 10, 11, 12]) {
      const maybeCounts = new Set<number>();
      for (const seed of SEEDS.slice(0, 60)) {
        for (const uniqueRoles of [true, false]) {
          const moles = (mole: "on" | "maybe") => dealt(config(n, { seed, mole, rolePool: [], uniqueRoles })).filter((r) => r === "mole").length;
          expect(moles("on")).toBe(1);
          const mb = moles("maybe");
          expect(mb).toBeLessThanOrEqual(1);
          maybeCounts.add(mb);
        }
      }
      expect([...maybeCounts].sort()).toEqual([0, 1]);
    }
  });

  it("uniqueRoles false repeats roles; true never does; non-boolean rejected; deal is deterministic", () => {
    const repeats = (cfg: GameConfig) => {
      const roles = dealt(cfg).filter((r) => r !== "rookie" && r !== "mole");
      return roles.length !== new Set(roles).size;
    };
    expect(SEEDS.slice(0, 40).some((seed) => repeats(config(12, { seed, rolePool: [], uniqueRoles: false })))).toBe(true);
    expect(SEEDS.slice(0, 40).some((seed) => repeats(config(12, { seed, rolePool: [] })))).toBe(false);
    expect(dealt(config(6, { rolePool: ["hacker"], uniqueRoles: false, mole: "on" })).sort()).toEqual(["hacker", "hacker", "hacker", "hacker", "hacker", "mole"]);
    expect(validateConfig({ ...config(6), uniqueRoles: "no" })).toContain("uniqueRoles must be a boolean");
    const cfg = config(12, { seed: "det", rolePool: [], uniqueRoles: false, mole: "on" });
    expect(setupEvents(cfg)).toEqual(setupEvents(cfg));
  });
});

describe("QA event Heat scaling — design §10", () => {
  const patrol = (EVENTS.policePatrol!.effect as { amount: number }).amount;
  const quiet = (EVENTS.quietNight!.effect as { amount: number }).amount;
  it.each([
    [2, 2, -4, 1.2],
    [3, 3, -6, 1.3],
    [4, 4, -8, 1.4],
    [5, 5, -10, 1.5],
    [12, 5, -10, 1.5],
  ])("%ip: Police patrol %i, Quiet night %i, Shift change Vault Heat ×%f", (n, p, q, mult) => {
    expect(scaledCardHeat(patrol, n)).toBe(p);
    expect(scaledCardHeat(quiet, n)).toBe(q);
    expect(eventHeatScale(n)).toBeLessThanOrEqual(1);
    const base = BANK_JOB.rooms.vault!;
    const vault = roundJob(BANK_JOB, { round: 2, id: "shiftChange", room: null } as never, EVENTS, n).rooms.vault!;
    expect(vault.heatPressure).toBeCloseTo(base.heatPressure * mult, 9);
    expect(vault.loot).toBe(base.loot * 2); // loot isn't scaled
    // Payday's ×1 Heat stays ×1.
    expect(roundJob(BANK_JOB, { round: 2, id: "payday", room: null } as never, EVENTS, n).rooms.lobby!.heatPressure).toBe(BANK_JOB.rooms.lobby!.heatPressure);
  });

  it("rounding of odd amounts, negatives included (halves toward +∞)", () => {
    expect(scaledCardHeat(7, 3)).toBe(4); // 4.2
    expect(scaledCardHeat(-7, 3)).toBe(-4); // -4.2
    expect(scaledCardHeat(-3, 2)).toBe(-1); // -1.2
    expect(scaledCardHeat(-1, 2)).toBe(-0); // -0.4 rounds to -0
    expect(scaledCardHeat(0, 3)).toBe(0);
  });

  it("integrated: a Police patrol round adds the scaled amount at 2/3/4/5 players", () => {
    for (const n of [2, 3, 4, 5]) {
      let found = false;
      for (let i = 0; i < 200 && !found; i++) {
        const s1 = run(game(config(n, { seed: `heat-${n}-${i}`, eventsEnabled: true, rolePool: ["rookie"] })), ROUND, ALIBIS);
        if (s1.card?.id !== "policePatrol") continue;
        found = true;
        const d1 = s1.heat;
        const s2 = run(s1, ROUND);
        const delta2 = s2.heat - d1;
        // Round 1 (no card) and round 2 have the same default moves, so the difference is the card.
        expect(delta2 - d1).toBe(scaledCardHeat(patrol, n));
      }
      expect(found).toBe(true);
    }
  });
});

describe("QA Fence safe in the clean check — design §11.3", () => {
  // 3p, Fence at seat 0; emergency in round 1's alibi window (act 1: clean below 3).
  function shake(pocket: number, safe: number): GameState {
    let s = run(game(config(3), ["fence"]), mv("p0", "vault", pocket, { ability: { kind: "fenceSafe", amount: safe } }), ROUND);
    expect(s.players.p0).toMatchObject({ stash: pocket - safe, safe });
    s = run(s, { type: "callEmergency", player: "p1" }, open("emergency-p1"), vote("p1", "p0"), vote("p2", "p0"), close("emergency-p1"));
    return s;
  }
  it("stash 1 + safe 2 = exactly 3 is not clean; the safe isn't taken or shown", () => {
    const s = shake(3, 2);
    expect(LAST(s, "shakedownResolved")).toMatchObject({ stashRevealed: 1, taken: 1, clean: false, compensation: 0 });
    expect(s.players.p0).toMatchObject({ stash: 0, safe: 2 });
    expect(JSON.stringify(LAST(s, "shakedownResolved"))).not.toMatch(/safe/);
    expect(s.phase).toEqual({ kind: "alibis", round: 1 });
  });
  it("safe 3 and an empty stash is not clean (stash shown as 0)", () => {
    expect(LAST(shake(3, 3), "shakedownResolved")).toMatchObject({ stashRevealed: 0, clean: false, compensation: 0 });
  });
  it("stash 0 + safe 2 = 2 is clean and compensated", () => {
    const s = shake(2, 2);
    expect(LAST(s, "shakedownResolved")).toMatchObject({ stashRevealed: 0, clean: true, compensation: 5 });
    expect(s.players.p0).toMatchObject({ stash: 5, safe: 2 });
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

  it("Duel: callOut refused during alibis; closing round 3's alibis settles call-outs and the checkpoint at once", () => {
    const cfg = config(2, { duel: true, rolePool: [] });
    let s = run(game(cfg), ROUND);
    expect(refused(s, { type: "callOut", player: "p0", target: "p1" })).toMatch(/planned/);
    s = run(s, ALIBIS, ROUND, ALIBIS, ROUND);
    expect(s.phase).toEqual({ kind: "alibis", round: 3 });
    const r = handleCommand(s, ALIBIS(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events[0]).toMatchObject({ type: "alibisClosed", round: 3 });
    expect(r.events.some((e) => e.type === "checkpointChecked")).toBe(true);
    expect(["planning", "ended"]).toContain(r.state.phase.kind);
    expect(r.state.alibisOpen).toBe(false);
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
