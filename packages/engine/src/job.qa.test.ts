// QA (PR #3): adversarial tests for the bank job helpers — Heat at 2/3/12,
// rounding, the 0 floor, room tiers at the boundaries, checkpoint targets.
// design §3.1
import { describe, expect, it } from "vitest";
import { BANK_JOB as bank } from "@skimjob/content";
import { checkpointTarget, clampHeat, roomsInPlay, roundHeatDelta } from "./job";

const CORE = ["vault", "office", "lobby", "security", "rooftop"];
const MID = [...CORE, "depositBoxes", "serverRoom"];
const BIG = [...MID, "managersOffice"];

/** Fold rounds the way task 4 will: add the round delta, then clamp. */
function heatAfter(crew: number, start: number, rounds: Record<string, number>[]): number {
  return rounds.reduce((h, v) => clampHeat(bank, h + roundHeatDelta(bank, crew, v)), start);
}

describe("Heat at 3 and 12 players — design §7", () => {
  it("3 players: thirds round to the nearest whole number", () => {
    expect(roundHeatDelta(bank, 3, { vault: 1 })).toBe(11); // 10.67
    expect(roundHeatDelta(bank, 3, { vault: 2 })).toBe(17); // 17.33
    expect(roundHeatDelta(bank, 3, { vault: 3 })).toBe(24);
    expect(roundHeatDelta(bank, 3, { rooftop: 1 })).toBe(-3); // −2.67
    expect(roundHeatDelta(bank, 3, { rooftop: 2 })).toBe(-9); // −9.33
    expect(roundHeatDelta(bank, 3, { vault: 2, rooftop: 1 })).toBe(11); // 10.67
  });

  it("12 players: Vault, Manager's office and Rooftop shares", () => {
    expect(roundHeatDelta(bank, 12, { vault: 1 })).toBe(6); // 5.67
    expect(roundHeatDelta(bank, 12, { vault: 12 })).toBe(24);
    expect(roundHeatDelta(bank, 12, { managersOffice: 1 })).toBe(5); // 4.83
    expect(roundHeatDelta(bank, 12, { rooftop: 1 })).toBe(2); // 2.33
    expect(roundHeatDelta(bank, 12, { rooftop: 12 })).toBe(-16);
    // Same shares as 3 players → same Heat.
    expect(roundHeatDelta(bank, 12, { vault: 8, rooftop: 4 })).toBe(roundHeatDelta(bank, 3, { vault: 2, rooftop: 1 }));
  });

  it("exact halves round towards more Heat, positive and negative (provisional)", () => {
    expect(roundHeatDelta(bank, 12, { managersOffice: 3 })).toBe(7); // 6.5
    expect(roundHeatDelta(bank, 12, { vault: 3, managersOffice: 3, rooftop: 3 })).toBe(7); // 6.5
    expect(roundHeatDelta(bank, 12, { managersOffice: 3, rooftop: 6 })).toBe(-3); // −3.5
  });

  it("result is always a whole number at every crew size and mix", () => {
    for (let n = 3; n <= 12; n++) {
      for (let v = 0; v <= n; v++) {
        for (let r = 0; r <= n - v; r++) {
          expect(Number.isInteger(roundHeatDelta(bank, n, { vault: v, rooftop: r }))).toBe(true);
        }
      }
    }
  });
});

describe("Heat floor and ceiling — design §7", () => {
  it("Rooftop turns can't bank Heat below 0 (3 and 12 players)", () => {
    expect(heatAfter(3, 0, [{ rooftop: 3 }, {}])).toBe(4); // 4 − 20 → 0, then +4
    expect(heatAfter(3, 5, [{ rooftop: 3 }, { rooftop: 3 }, {}])).toBe(4);
    expect(heatAfter(12, 2, [{ rooftop: 12 }, { vault: 3 }])).toBe(9);
  });

  it("landing exactly on 100 reaches the max; overshoot is capped at 100", () => {
    expect(heatAfter(3, 76, [{ vault: 3 }])).toBe(bank.heat.max); // 76 + 24
    expect(heatAfter(12, 99, [{ vault: 12 }])).toBe(bank.heat.max);
    expect(heatAfter(3, 75, [{ vault: 3 }])).toBe(99);
  });

  it("missed-checkpoint +15 lives on the job", () => {
    expect(bank.heat.missedCheckpoint).toBe(15);
    expect(clampHeat(bank, 90 + bank.heat.missedCheckpoint)).toBe(100);
  });
});

describe("room tiers at the boundaries — design §3.1", () => {
  it("4 → core only; 5 → + Deposit boxes, Server room; 8 → same; 9 and 12 → + Manager's office", () => {
    expect(roomsInPlay(bank, 3)).toEqual(CORE);
    expect(roomsInPlay(bank, 4)).toEqual(CORE);
    expect(roomsInPlay(bank, 5)).toEqual(MID);
    expect(roomsInPlay(bank, 8)).toEqual(MID);
    expect(roomsInPlay(bank, 9)).toEqual(BIG);
    expect(roomsInPlay(bank, 12)).toEqual(BIG);
  });
});

describe("checkpoint targets per crew size — design §11.5", () => {
  it("2, 3 and 12 players", () => {
    expect([1, 2, 3].map((a) => checkpointTarget(bank, a as 1 | 2 | 3, 2))).toEqual([6, 14, 22]);
    expect([1, 2, 3].map((a) => checkpointTarget(bank, a as 1 | 2 | 3, 3))).toEqual([9, 21, 33]);
    expect([1, 2, 3].map((a) => checkpointTarget(bank, a as 1 | 2 | 3, 12))).toEqual([36, 84, 132]);
  });

  it("rejects act 0", () => {
    expect(() => checkpointTarget(bank, 0 as 1, 4)).toThrow(/no checkpoint/);
  });
});
