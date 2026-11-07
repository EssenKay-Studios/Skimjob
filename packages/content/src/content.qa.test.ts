// QA (PR #3): bank room and starter-role data against the design tables.
// design §6, §7, §8 (numbers from balance pass 1, docs/balance/balance-1.md)
import { describe, expect, it } from "vitest";
import { BANK_JOB, MOLE_ROLE, POOL_ROLES, ROLES } from "./index";

describe("bank room data — design §3.1", () => {
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
