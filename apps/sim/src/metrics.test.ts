// Balance metric definitions. design §17.4 "Balance metrics and rough targets"
import { describe, expect, it } from "vitest";
import {
  moleWinMetric,
  comebackMetric,
  decidedEarly,
  decidedEarlyMetric,
  groupWins,
  heatBustShare,
  pocketBand,
  rate,
  shakedownMetrics,
  successRate,
  summarize,
} from "./metrics";
import { gameRec, seat, shake } from "./testkit";

const failed = (reason: "heat" | "target", over = {}) => gameRec({ result: "failed", reason, ...over });

describe("success and failure — design §17.4 (success 55–70%, Heat 10–20% of failures)", () => {
  it("success rate is successes ÷ games", () => {
    expect(successRate([gameRec(), gameRec(), failed("target"), failed("heat")])).toBe(0.5);
    expect(successRate([])).toBeNull();
  });
  it("Heat-bust share counts only failures", () => {
    expect(heatBustShare([gameRec(), failed("heat"), failed("target"), failed("target"), failed("target")])).toBe(0.25);
    expect(heatBustShare([gameRec()])).toBeNull();
  });
  it("rate is null with nothing to divide", () => {
    expect(rate(1, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
  });
});

describe("pocketing bands — design §17.4 (moderate beats honest, heavy loses)", () => {
  it("bands by pocketed ÷ looted: ≤10% honest, ≤40% moderate, more is heavy", () => {
    expect(pocketBand({ looted: 0, pocketed: 0 })).toBe("honest");
    expect(pocketBand({ looted: 30, pocketed: 3 })).toBe("honest");
    expect(pocketBand({ looted: 30, pocketed: 4 })).toBe("moderate");
    expect(pocketBand({ looted: 30, pocketed: 12 })).toBe("moderate");
    expect(pocketBand({ looted: 30, pocketed: 13 })).toBe("heavy");
  });
});

describe("group win rates — design §17.4 (each role within ±5 pp of 1 ÷ crew)", () => {
  const players = [seat({ id: "a", role: "rookie" }), seat({ id: "b", role: "fence" }), seat({ id: "c", role: "rookie" }), seat({ id: "d", role: "insideMan" })];
  const games = [
    gameRec({ players: 4, playerRecords: players, winners: ["a"] }),
    gameRec({ players: 4, playerRecords: players, winners: ["b", "c"] }),
    failed("target", { players: 4, playerRecords: players }),
  ];
  const byRole = groupWins(games, (p) => p.role);

  it("counts seats, shares joint wins, and compares successful games with the fair share", () => {
    // rookie: 6 seats (2 per game), credit 1 + 0.5; in successes 4 seats.
    expect(byRole.rookie).toEqual({ seats: 6, winRate: 1.5 / 6, successSeats: 4, successWinShare: 1.5 / 4, fairShare: 0.25, deltaPp: 12.5 });
    expect(byRole.fence?.successWinShare).toBe(0.25);
    expect(byRole.fence?.deltaPp).toBe(0);
    expect(byRole.insideMan).toMatchObject({ seats: 3, winRate: 0, successWinShare: 0, deltaPp: -25 });
  });

  it("all seats' win shares in successful games add up to one win per game", () => {
    const total = Object.values(byRole).reduce((t, g) => t + (g.successWinShare ?? 0) * g.successSeats, 0);
    expect(total).toBeCloseTo(2);
  });

  it("a key of null leaves the seat out (Inside Men in the pocketing bands)", () => {
    const out = groupWins(games, (p) => (p.role === "insideMan" ? null : p.role));
    expect(Object.keys(out)).toEqual(["fence", "rookie"]);
  });

  it("fair share follows the crew size of each seat's game", () => {
    const g = groupWins([gameRec({ players: 2, playerRecords: [seat({ id: "a" })], winners: ["a"] }), gameRec({ players: 4, playerRecords: [seat({ id: "a" })] })], () => "x");
    expect(g.x?.fairShare).toBeCloseTo((0.5 + 0.25) / 2);
  });
});

describe("shakedown accuracy — design §17.4 (50–70% catch a real cheater)", () => {
  it("is the share of shakedowns that weren't clean", () => {
    const m = shakedownMetrics([gameRec({ shakedowns: [shake(), shake({ clean: true, targetHadPocketed: false })] }), gameRec({ shakedowns: [shake()] }), gameRec()]);
    expect(m).toEqual({ count: 3, perGame: 1, accuracy: 2 / 3, hitPocketer: 2 / 3 });
    expect(shakedownMetrics([gameRec()]).accuracy).toBeNull();
  });
});

describe("comeback — design §17.4 (the Act 1 leader wins under 50%)", () => {
  const lead = (leaders: string[], topScore = 5) => ({ leaders, topScore, lead: 1 });
  it("counts successful games with a sole Act 1 leader, and whether that leader won", () => {
    const m = comebackMetric([
      gameRec({ afterAct1: lead(["a"]), winners: ["a"] }),
      gameRec({ afterAct1: lead(["a", "b"]), winners: ["b"] }), // still fully tied after tie-breaks: left out
      gameRec({ afterAct1: lead(["a"]), winners: ["c"] }),
      gameRec({ afterAct1: lead(["c"]), winners: ["d", "c"] }),
      gameRec({ afterAct1: lead(["a"], 0), winners: ["a"] }), // nobody had anything yet
      failed("target", { afterAct1: lead(["a"]) }), // no winner
      gameRec({ afterAct1: null, winners: ["a"] }),
    ]);
    expect(m).toEqual({ games: 3, rate: 2 / 3 });
  });
});

describe("decided early — design §17.4 (under 15% settled before Act 3)", () => {
  const act2 = (leaders: string[], lead: number) => ({ leaders, topScore: 20, lead });
  it("a sole Act 2 leader who wins with a lead of at least half the most anyone can add in Act 3", () => {
    expect(decidedEarly(gameRec({ afterAct2: act2(["a"], 10), act3MaxGain: 20, winners: ["a"] }))).toBe(true);
    expect(decidedEarly(gameRec({ afterAct2: act2(["a"], 9.9), act3MaxGain: 20, winners: ["a"] }))).toBe(false);
    expect(decidedEarly(gameRec({ afterAct2: act2(["a"], 15), act3MaxGain: 20, winners: ["b"] }))).toBe(false);
    expect(decidedEarly(gameRec({ afterAct2: act2(["a", "b"], 15), act3MaxGain: 20, winners: ["a"] }))).toBe(false);
    expect(decidedEarly(failed("target", { afterAct2: act2(["a"], 15), act3MaxGain: 20 }))).toBe(false);
  });
  it("counts successful games only, so it doesn't move with the success rate", () => {
    const m = decidedEarlyMetric([
      gameRec({ afterAct2: act2(["a"], 15), winners: ["a"] }),
      gameRec(),
      failed("heat", { endedRound: 5, endedAct: 2 }),
      failed("target", { afterAct2: act2(["a"], 15) }),
    ]);
    expect(m).toEqual({ games: 2, rate: 0.5 });
  });
});

describe("summarize — broken down by player count (design §17.4)", () => {
  it("has one entry per player count plus the overall numbers", () => {
    const s = summarize([gameRec({ players: 6 }), gameRec({ players: 2 }), failed("heat", { players: 6 })]);
    expect(Object.keys(s.byPlayers)).toEqual(["2", "6"]);
    expect(s.byPlayers[6]?.successRate).toBe(0.5);
    expect(s.byPlayers[2]?.successRate).toBe(1);
    expect(s.overall.games).toBe(3);
    expect(s.overall.heatBustShare).toBe(1);
  });
});

describe("Mole win rate — design §17.4, §3", () => {
  it("games with a Mole that a Mole won, per game (two winning Moles count once)", () => {
    const mole = (id: string) => seat({ id, role: "mole" });
    const records = [
      gameRec({ result: "failed", reason: "heat", playerRecords: [mole("m0"), mole("m1"), seat({ id: "d", role: "fixer" })], winners: ["m0", "m1", "d"] }),
      gameRec({ result: "failed", reason: "target", playerRecords: [mole("m0")], winners: ["m0"] }),
      gameRec({ playerRecords: [mole("m0"), seat({ id: "x" })], winners: ["x"] }),
      gameRec({ playerRecords: [seat({ id: "x" })], winners: ["x"] }), // no Mole: left out
    ];
    expect(moleWinMetric(records)).toEqual({ games: 3, rate: 2 / 3 });
    expect(moleWinMetric([gameRec()])).toEqual({ games: 0, rate: null });
  });
});
