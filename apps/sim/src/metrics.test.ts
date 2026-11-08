// Balance metric definitions. design §17.4 "Balance metrics and rough targets"
import { describe, expect, it } from "vitest";
import {
  moleWinMetric,
  groupWins,
  bustRate,
  raidMetrics,
  pocketBand,
  rate,
  shakedownMetrics,
  successRate,
  summarize,
  theftRate,
  wholeCrewWin,
} from "./metrics";
import { gameRec, seat, shake } from "./testkit";

const failed = (reason: "bust" | "theft", over = {}) => gameRec({ result: "failed", reason, ...over });

describe("success, failure, busts and raids — design §21 (success 55–70%, G2 raids, G3 busts 8–20%, G4 stalls)", () => {
  it("success rate is successes ÷ games", () => {
    expect(successRate([gameRec(), gameRec(), failed("theft"), failed("bust")])).toBe(0.5);
    expect(successRate([])).toBeNull();
  });
  it("bust rate is busts ÷ games", () => {
    expect(bustRate([gameRec(), failed("bust"), failed("theft"), gameRec()])).toBe(0.25);
    expect(bustRate([])).toBeNull();
  });
  it("raids per game, games with a raid, and Rooftop stalls per round played", () => {
    const m = raidMetrics([gameRec({ raids: 3, stalls: 1, endedRound: 9 }), gameRec({ raids: 0, stalls: 0, endedRound: 3 }), gameRec({ raids: 1, stalls: 2, endedRound: 6 })]);
    expect(m).toEqual({ perGame: 4 / 3, games: 2 / 3, stalls: 3 / 18 });
    expect(raidMetrics([])).toEqual({ perGame: null, games: null, stalls: null });
  });
  it("rate is null with nothing to divide", () => {
    expect(rate(1, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
  });
});

describe("pocketing bands — design §17.4 (moderate beats honest, heavy loses)", () => {
  it("bands by pocketed ÷ grabbed: ≤10% honest, ≤40% moderate, more is heavy", () => {
    expect(pocketBand({ grabbed: 0, pocketed: 0 })).toBe("honest");
    expect(pocketBand({ grabbed: 30, pocketed: 3 })).toBe("honest");
    expect(pocketBand({ grabbed: 30, pocketed: 4 })).toBe("moderate");
    expect(pocketBand({ grabbed: 30, pocketed: 12 })).toBe("moderate");
    expect(pocketBand({ grabbed: 30, pocketed: 13 })).toBe("heavy");
  });
});

describe("group win rates — design §17.4 (each role within ±5 pp of 1 ÷ crew)", () => {
  const players = [seat({ id: "a", role: "rookie" }), seat({ id: "b", role: "hacker" }), seat({ id: "c", role: "rookie" }), seat({ id: "d", role: "priest" })];
  const games = [
    gameRec({ players: 4, playerRecords: players, winners: ["a"] }),
    gameRec({ players: 4, playerRecords: players, winners: ["b", "c"] }),
    failed("theft", { players: 4, playerRecords: players }),
  ];
  const byRole = groupWins(games, (p) => p.role);

  it("counts seats, shares joint wins, and compares successful games with the fair share", () => {
    // rookie: 6 seats (2 per game), credit 1 + 0.5; in successes 4 seats.
    expect(byRole.rookie).toEqual({ seats: 6, winRate: 1.5 / 6, successSeats: 4, successWinShare: 1.5 / 4, fairShare: 0.25, deltaPp: 12.5 });
    expect(byRole.hacker?.successWinShare).toBe(0.25);
    expect(byRole.hacker?.deltaPp).toBe(0);
    expect(byRole.priest).toMatchObject({ seats: 3, winRate: 0, successWinShare: 0, deltaPp: -25 });
  });

  it("all seats' win shares in successful games add up to one win per game", () => {
    const total = Object.values(byRole).reduce((t, g) => t + (g.successWinShare ?? 0) * g.successSeats, 0);
    expect(total).toBeCloseTo(2);
  });

  it("a key of null leaves the seat out (Inside Men in the pocketing bands)", () => {
    const out = groupWins(games, (p) => (p.role === "priest" ? null : p.role));
    expect(Object.keys(out)).toEqual(["hacker", "rookie"]);
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

describe("sunk by theft and cap stalls — design §21 G4, G8", () => {
  it("theft rate is games sunk by theft ÷ games (reported)", () => {
    expect(theftRate([gameRec(), failed("theft"), failed("bust"), gameRec()])).toBe(0.25);
    expect(theftRate([])).toBeNull();
  });
  it("cap stalls are games that ended at the cap with over a quarter of the bank left ÷ games", () => {
    const s = summarize([gameRec({ capWithBankLeft: true }), gameRec(), gameRec(), gameRec()]);
    expect(s.overall.capStalls).toBe(0.25);
    expect(s.overall.theftRate).toBe(0);
  });
});

describe("whole-crew wins — design §8.2, §21 G6", () => {
  it("a success every player won is a whole-crew win; the rate is over successful games only", () => {
    const all = gameRec({ players: 3, winners: ["a", "b", "c"] });
    expect([wholeCrewWin(all), wholeCrewWin(gameRec({ players: 3, winners: ["a"] })), wholeCrewWin(failed("bust", { players: 3, winners: ["a", "b", "c"] }))]).toEqual([true, false, false]);
    expect(summarize([all, gameRec({ players: 3, winners: ["a"] }), failed("theft", { players: 3 })]).overall.wholeCrewRate).toBe(0.5);
    expect(summarize([failed("theft")]).overall.wholeCrewRate).toBeNull();
  });
});

describe("summarize — broken down by player count (design §17.4)", () => {
  it("has one entry per player count plus the overall numbers", () => {
    const s = summarize([gameRec({ players: 6 }), gameRec({ players: 2 }), failed("bust", { players: 6 })]);
    expect(Object.keys(s.byPlayers)).toEqual(["2", "6"]);
    expect(s.byPlayers[6]?.successRate).toBe(0.5);
    expect(s.byPlayers[2]?.successRate).toBe(1);
    expect(s.overall.games).toBe(3);
    expect(s.overall.bustRate).toBe(1 / 3);
  });
});

describe("Mole win rate — design §17.4, §3", () => {
  it("games with a Mole that a Mole won, per game (two winning Moles count once)", () => {
    const mole = (id: string) => seat({ id, role: "mole" });
    const records = [
      gameRec({ result: "failed", reason: "bust", playerRecords: [mole("m0"), mole("m1"), seat({ id: "d", role: "fixer" })], winners: ["m0", "m1", "d"] }),
      gameRec({ result: "failed", reason: "theft", playerRecords: [mole("m0")], winners: ["m0"] }),
      gameRec({ playerRecords: [mole("m0"), seat({ id: "x" })], winners: ["x"] }),
      gameRec({ playerRecords: [seat({ id: "x" })], winners: ["x"] }), // no Mole: left out
    ];
    expect(moleWinMetric(records)).toEqual({ games: 3, rate: 2 / 3 });
    expect(moleWinMetric([gameRec()])).toEqual({ games: 0, rate: null });
  });
});
