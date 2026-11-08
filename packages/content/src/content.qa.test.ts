// QA (PR #3): bank room data against the design tables. design §3.1, §5
import { describe, expect, it } from "vitest";
import { BANK_JOB } from "./index";

describe("bank room data — design §3.1", () => {
  it("noise: the Office-like rooms all ring alike; only the Rooftop lies low (design §3.1, §5.5, §5.6)", () => {
    const { office, depositBoxes, managersOffice, serverRoom } = BANK_JOB.rooms;
    for (const r of [depositBoxes, managersOffice, serverRoom]) expect([r?.coins, r?.quietCoins]).toEqual([office?.coins, office?.quietCoins]);
    expect(Object.values(BANK_JOB.rooms).filter((r) => r.lieLow).map((r) => r.id)).toEqual(["rooftop"]);
  });

  it("only Security gives extra info", () => {
    const info = Object.values(BANK_JOB.rooms).filter((r) => r.info !== "none").map((r) => [r.id, r.info]);
    expect(info).toEqual([["security", "watchRoom"]]);
  });
});
