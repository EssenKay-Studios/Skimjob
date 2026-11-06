// QA (PR #3): adversarial tests for the bank job helpers — Heat at 2/3/12,
// rounding, the 0 floor, room tiers at the boundaries, checkpoint targets.
// design §6.2, §7, §11.5, §16
import { describe, expect, it } from "vitest";
import { BANK_JOB as bank } from "@skimjob/content";
import { checkpointTarget, clampHeat, roomDef, roomLoot, roomsInPlay, roundHeatDelta } from "./job";

const CORE = ["vault", "office", "lobby", "security", "rooftop"];
const MID = [...CORE, "depositBoxes", "serverRoom"];
const BIG = [...MID, "tellerLine", "managersOffice"];

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
  it("Rooftop turns can't bank Heat below 0 (2, 3, 12 players)", () => {
    expect(heatAfter(2, 0, [{ rooftop: 2 }, {}])).toBe(4);
    expect(heatAfter(3, 5, [{ rooftop: 3 }, { rooftop: 3 }, {}])).toBe(4);
    expect(heatAfter(12, 2, [{ rooftop: 12 }, { vault: 3 }])).toBe(9);
  });

  it("landing exactly on 100 reaches the max; overshoot is capped at 100", () => {
    expect(heatAfter(2, 76, [{ vault: 2 }])).toBe(bank.heat.max);
    expect(heatAfter(12, 99, [{ vault: 12 }])).toBe(bank.heat.max);
    expect(heatAfter(3, 75, [{ vault: 3 }])).toBe(99);
  });

  it("missed-checkpoint +15 lives on the job", () => {
    expect(bank.heat.missedCheckpoint).toBe(15);
    expect(clampHeat(bank, 90 + bank.heat.missedCheckpoint)).toBe(100);
  });
});

describe("room tiers at the boundaries — design §6.2, §16", () => {
  it("4 → core only; 5 → + Deposit boxes, Server room; 8 → same; 9 and 12 → + Teller line, Manager's office", () => {
    expect(roomsInPlay(bank, 3)).toEqual(CORE);
    expect(roomsInPlay(bank, 4)).toEqual(CORE);
    expect(roomsInPlay(bank, 5)).toEqual(MID);
    expect(roomsInPlay(bank, 8)).toEqual(MID);
    expect(roomsInPlay(bank, 9)).toEqual(BIG);
    expect(roomsInPlay(bank, 12)).toEqual(BIG);
  });
});

describe("Deposit-box capacity — design §6.2", () => {
  it("full 5 at exactly 2 visitors, 4 each from the 3rd visitor on (R5; was 3)", () => {
    const boxes = roomDef(bank, "depositBoxes");
    expect(boxes.capacity).toEqual({ max: 2, crowdedLoot: 4 });
    expect(roomLoot(boxes, 2)).toBe(5);
    expect(roomLoot(boxes, 3)).toBe(4);
    expect(roomLoot(boxes, 8)).toBe(4);
  });

  it("no other bank room has a capacity", () => {
    const capped = Object.values(bank.rooms).filter((r) => r.capacity).map((r) => r.id);
    expect(capped).toEqual(["depositBoxes"]);
  });
});

describe("checkpoint targets per crew size — design §11.5", () => {
  it("2, 3 and 12 players", () => {
    expect([1, 2, 3].map((a) => checkpointTarget(bank, a as 1 | 2 | 3, 2))).toEqual([14, 30, 46]);
    expect([1, 2, 3].map((a) => checkpointTarget(bank, a as 1 | 2 | 3, 3))).toEqual([21, 45, 69]);
    expect([1, 2, 3].map((a) => checkpointTarget(bank, a as 1 | 2 | 3, 12))).toEqual([84, 180, 276]);
  });

  it("rejects act 0", () => {
    expect(() => checkpointTarget(bank, 0 as 1, 4)).toThrow(/no checkpoint/);
  });
});
