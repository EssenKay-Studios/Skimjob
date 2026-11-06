// QA (PR #3): bank room and starter-role data against the design tables.
// design §6, §7, §8 (numbers from balance pass 1, docs/balance/balance-1.md)
import { describe, expect, it } from "vitest";
import { BANK_JOB, MOLE_ROLE, POOL_ROLES, ROLES } from "./index";

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
      tellerLine: [6, 10], // R6 split-gate pass (r6-balance.md)
      managersOffice: [3, 10],
    });
  });

  it("Manager's office is exactly half the Vault; Rooftop exactly cancels the Vault", () => {
    const { vault, managersOffice, rooftop } = BANK_JOB.rooms;
    expect(managersOffice?.heatPressure).toBe((vault?.heatPressure ?? 0) / 2);
    expect(rooftop?.heatPressure).toBe(-(vault?.heatPressure ?? 0));
  });

  it("only Security gives extra info", () => {
    const info = Object.values(BANK_JOB.rooms).filter((r) => r.info !== "none").map((r) => [r.id, r.info]);
    expect(info).toEqual([["security", "watchRoom"]]);
  });
});

describe("role data — design §8", () => {
  it("every role can be toggled into a deck (extension.md \"Decks\"); every id matches its key", () => {
    expect([...POOL_ROLES].sort()).toEqual(Object.keys(ROLES).sort());
    expect(POOL_ROLES).toContain(MOLE_ROLE);
    for (const [id, def] of Object.entries(ROLES)) expect(def.id).toBe(id);
  });
});
