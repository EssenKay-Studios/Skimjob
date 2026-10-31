// Job helpers: rooms by crew size, room yields, the Heat formula, checkpoint
// targets. design §6, §7, §11.5
import { describe, expect, it } from "vitest";
import { BANK_JOB, type JobDef } from "@skimjob/content";
import { checkpointTarget, clampHeat, jobById, roomDef, roomLoot, roomsInPlay, roundHeatDelta } from "./job";

const bank = BANK_JOB;

describe("jobById", () => {
  it("finds the bank and rejects unknown or inherited ids", () => {
    expect(jobById("bank")).toBe(BANK_JOB);
    for (const id of ["museum", "toString", "__proto__", ""]) expect(() => jobById(id)).toThrow(/unknown job/);
  });
});

describe("rooms in play — design §6.2, §16", () => {
  it("5 rooms at 2–4, 7 at 5–8, 9 at 9–12", () => {
    for (let n = 2; n <= 12; n++) expect(roomsInPlay(bank, n)).toHaveLength(n <= 4 ? 5 : n <= 8 ? 7 : 9);
  });

  it("roomDef rejects rooms the job doesn't have", () => {
    expect(roomDef(bank, "vault").loot).toBe(6);
    expect(() => roomDef(bank, "casinoFloor")).toThrow(/no room/);
    expect(() => roomDef(bank, "constructor")).toThrow(/no room/);
  });
});

describe("room yields — design §6.1, §6.2", () => {
  it("each visitor collects the room's loot, however many go (no capacity)", () => {
    for (const v of [1, 2, 5, 12]) expect(roomLoot(roomDef(bank, "vault"), v)).toBe(6);
  });

  it("Deposit boxes: 5 each for up to 2 people, 3 each if more than 2 go", () => {
    const boxes = roomDef(bank, "depositBoxes");
    expect([1, 2, 3, 4].map((v) => roomLoot(boxes, v))).toEqual([5, 5, 3, 3]);
  });
});

describe("round Heat — design §7", () => {
  it("baseline +4 when nobody is in a Heat room", () => {
    expect(roundHeatDelta(bank, 4, {})).toBe(4);
    expect(roundHeatDelta(bank, 4, { office: 2, lobby: 1, security: 1 })).toBe(4);
  });

  it("vault pressure is +20 × (Vault visitors ÷ crew size)", () => {
    expect(roundHeatDelta(bank, 4, { vault: 1 })).toBe(4 + 5);
    expect(roundHeatDelta(bank, 4, { vault: 4 })).toBe(4 + 20);
  });

  it("the same share of the crew gives the same Heat at any crew size", () => {
    expect(roundHeatDelta(bank, 12, { vault: 3 })).toBe(roundHeatDelta(bank, 4, { vault: 1 }));
    expect(roundHeatDelta(bank, 12, { vault: 4 })).toBe(roundHeatDelta(bank, 3, { vault: 1 }));
    expect(roundHeatDelta(bank, 10, { vault: 5, rooftop: 5 })).toBe(roundHeatDelta(bank, 2, { vault: 1, rooftop: 1 }));
  });

  it("Manager's office adds half the vault pressure", () => {
    expect(roundHeatDelta(bank, 10, { managersOffice: 2 })).toBe(4 + 2);
    expect(roundHeatDelta(bank, 10, { vault: 2 })).toBe(4 + 4);
  });

  it("Rooftop removes −20 × (Rooftop visitors ÷ crew size)", () => {
    expect(roundHeatDelta(bank, 4, { rooftop: 2 })).toBe(4 - 10);
    expect(roundHeatDelta(bank, 4, { vault: 1, rooftop: 1 })).toBe(4);
  });

  it("sanity check: a quarter of the crew in the Vault every round totals 81 over 9 rounds", () => {
    expect(9 * roundHeatDelta(bank, 8, { vault: 2 })).toBe(81);
  });

  it("sanity check: half the crew in the Vault every round busts without the Rooftop", () => {
    expect(9 * roundHeatDelta(bank, 6, { vault: 3 })).toBeGreaterThanOrEqual(bank.heat.max);
  });

  it("the round total is rounded to a whole number, halves up (provisional)", () => {
    expect(roundHeatDelta(bank, 3, { vault: 1 })).toBe(11); // 4 + 6.67
    expect(roundHeatDelta(bank, 8, { vault: 1 })).toBe(7); // 4 + 2.5
    expect(roundHeatDelta(bank, 8, { rooftop: 3 })).toBe(-3); // 4 − 7.5
    expect(roundHeatDelta(bank, 7, { vault: 1, managersOffice: 1, rooftop: 1 })).toBe(5); // 4 + 10/7
  });

  it("rejects rooms the job doesn't have and bad crew sizes", () => {
    expect(() => roundHeatDelta(bank, 4, { kitchen: 1 })).toThrow(/no room/);
    for (const n of [0, -1, 2.5, Number.NaN]) expect(() => roundHeatDelta(bank, n, {})).toThrow(/crew size/);
  });

  it("reads its numbers from the job, not the engine", () => {
    const hot: JobDef = { ...bank, heat: { ...bank.heat, perRound: 5 } }; // Casino-style baseline, design §9
    expect(roundHeatDelta(hot, 4, {})).toBe(5);
  });

  it("Heat stays within 0–100", () => {
    expect([-12, 0, 57, 100, 130].map((h) => clampHeat(bank, h))).toEqual([0, 0, 57, 100, 100]);
  });
});

describe("checkpoint targets — design §11.5", () => {
  it("7, 15 and 24 × crew size, cumulative", () => {
    for (let n = 2; n <= 12; n++) {
      expect([1, 2, 3].map((act) => checkpointTarget(bank, act as 1 | 2 | 3, n))).toEqual([7 * n, 15 * n, 24 * n]);
    }
  });

  it("a crew of 5 needs 35, 75 and 120", () => {
    expect(checkpointTarget(bank, 1, 5)).toBe(35);
    expect(checkpointTarget(bank, 2, 5)).toBe(75);
    expect(checkpointTarget(bank, 3, 5)).toBe(120);
  });

  it("rejects an act outside 1–3", () => {
    expect(() => checkpointTarget(bank, 4 as 1, 5)).toThrow(/no checkpoint/);
  });
});
