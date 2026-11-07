// QA (PR #3): adversarial tests for the bank job helpers — room tiers at the
// boundaries, checkpoint targets.
// design §3.1
import { describe, expect, it } from "vitest";
import { BANK_JOB as bank } from "@skimjob/content";
import { checkpointTarget, roomsInPlay } from "./job";

const CORE = ["vault", "office", "lobby", "security", "rooftop"];
const MID = [...CORE, "depositBoxes", "serverRoom"];
const BIG = [...MID, "managersOffice"];

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
    expect([1, 2, 3].map((a) => checkpointTarget(bank, a as 1 | 2 | 3, 2))).toEqual([4, 8, 12]);
    expect([1, 2, 3].map((a) => checkpointTarget(bank, a as 1 | 2 | 3, 3))).toEqual([6, 12, 18]);
    expect([1, 2, 3].map((a) => checkpointTarget(bank, a as 1 | 2 | 3, 12))).toEqual([24, 48, 72]);
  });

  it("rejects act 0", () => {
    expect(() => checkpointTarget(bank, 0 as 1, 4)).toThrow(/no checkpoint/);
  });
});
