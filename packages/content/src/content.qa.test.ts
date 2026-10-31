// QA (PR #3): bank room and starter-role data against the design tables.
// design §6, §7, §8 (numbers from balance pass 1, docs/balance/balance-1.md)
import { describe, expect, it } from "vitest";
import { BANK_JOB, INFO_VOTE_ROLES, POOL_ROLES, ROLES, STARTER_ROLES } from "./index";

describe("bank room data — design §6, §7", () => {
  it("loot and Heat pressure for every room", () => {
    const table = Object.fromEntries(Object.values(BANK_JOB.rooms).map((r) => [r.id, [r.loot, r.heatPressure]]));
    expect(table).toEqual({
      vault: [6, 20],
      office: [4, 0],
      lobby: [2, 0],
      security: [0, 0],
      rooftop: [0, -20],
      depositBoxes: [5, 10],
      serverRoom: [0, 0],
      tellerLine: [4, 0],
      managersOffice: [5, 10],
    });
  });

  it("Manager's office is exactly half the Vault; Rooftop exactly cancels the Vault", () => {
    const { vault, managersOffice, rooftop } = BANK_JOB.rooms;
    expect(managersOffice?.heatPressure).toBe((vault?.heatPressure ?? 0) / 2);
    expect(rooftop?.heatPressure).toBe(-(vault?.heatPressure ?? 0));
  });

  it("only Security and Server room give extra info", () => {
    const info = Object.values(BANK_JOB.rooms).filter((r) => r.info !== "none").map((r) => [r.id, r.info]);
    expect(info).toEqual([["security", "watchRoom"], ["serverRoom", "pocketCount"]]);
  });
});

describe("role data — design §8", () => {
  it("the role table has exactly the pool roles (starter + info/vote roles, task 12); every id matches its key", () => {
    expect(Object.keys(ROLES).sort()).toEqual([...STARTER_ROLES, ...INFO_VOTE_ROLES].sort());
    expect([...POOL_ROLES].sort()).toEqual(Object.keys(ROLES).sort());
    for (const [id, def] of Object.entries(ROLES)) expect(def.id).toBe(id);
  });

  it("only the Insider can't pocket", () => {
    expect(Object.values(ROLES).filter((r) => !r.canPocket).map((r) => r.id)).toEqual(["insider"]);
  });

  it("only the Rookie gets a stash multiplier; only the Insider scores on the Haul", () => {
    const mult = Object.values(ROLES).filter((r) => r.scoring.stashMultiplier !== 1).map((r) => r.id);
    const haul = Object.values(ROLES).filter((r) => r.scoring.perLootOverFinalTarget !== 0).map((r) => r.id);
    expect(mult).toEqual(["rookie"]);
    expect(haul).toEqual(["insider"]);
  });
});
