// Dealing by faction: the dark-side roll, its hard limits, the saboteur
// setting, unique roles and starter mode. design §8.1 (role deck v2 §3,
// docs/roles-v2.md). The win rule (§3, deck v2 §0) is in end.test.ts.
//
// No accomplice role ships until R3, so the accomplice rules are checked with
// a role table that makes the Fence and Hacker accomplices (dealRoles takes a table).
import { describe, expect, it } from "vitest";
import { MOLE_ROLE, ROLES, type RoleDef, type RoleId } from "@skimjob/content";
import type { GameConfig, MoleSetting } from "./types";
import { darkSideOdds, dealRoles, limitDarkSide, rolePoolFor, saboteursFor, validateConfig } from "./setup";
import { seedRng } from "./rng";
import { factionIn, type RoleTable } from "./overrides";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "faction-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    mole: "on",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...extra,
  };
}

const as = (role: RoleId, faction: RoleDef["faction"]): RoleDef => ({ ...(ROLES[role] as RoleDef), faction });
/** R3-like: Fence and Hacker play as accomplices; a second saboteur exists. */
const TABLE: RoleTable = { ...ROLES, fence: as("fence", "accomplice"), hacker: as("hacker", "accomplice"), embezzler: { ...as("mole", "saboteur"), id: "embezzler", name: "Embezzler" } };
const POOL = ["rookie", "lookout", "insideMan", "fence", "hacker", "smoothTalker", "muscle", "snitch"];

const sides = (n: number, extra: Partial<GameConfig>, seed: string, table: RoleTable = TABLE) => {
  const dealt = dealRoles(config(n, { rolePool: POOL, seed, ...extra }), seedRng(seed), table).value;
  const count = (f: RoleDef["faction"]) => dealt.filter((r) => factionIn(table, r) === f).length;
  return { dealt, saboteurs: count("saboteur"), accomplices: count("accomplice"), crew: count("crew") };
};

describe("dark-side hard limits — design §8.1 (role deck v2 §3)", () => {
  it("at most ⌊n/3⌋ dark seats (accomplices go first), no accomplices without a saboteur, accomplices ≤ saboteurs + 1", () => {
    expect(limitDarkSide(5, { saboteurs: 1, accomplices: 1 })).toEqual({ saboteurs: 1, accomplices: 0 });
    expect(limitDarkSide(6, { saboteurs: 1, accomplices: 1 })).toEqual({ saboteurs: 1, accomplices: 1 });
    expect(limitDarkSide(7, { saboteurs: 1, accomplices: 2 })).toEqual({ saboteurs: 1, accomplices: 1 });
    expect(limitDarkSide(9, { saboteurs: 2, accomplices: 2 })).toEqual({ saboteurs: 2, accomplices: 1 });
    expect(limitDarkSide(11, { saboteurs: 3, accomplices: 1 })).toEqual({ saboteurs: 3, accomplices: 0 });
    expect(limitDarkSide(12, { saboteurs: 1, accomplices: 3 })).toEqual({ saboteurs: 1, accomplices: 2 });
    expect(limitDarkSide(12, { saboteurs: 0, accomplices: 2 })).toEqual({ saboteurs: 0, accomplices: 0 });
    expect(limitDarkSide(3, { saboteurs: 1, accomplices: 0 })).toEqual({ saboteurs: 1, accomplices: 0 });
    expect(limitDarkSide(2, { saboteurs: 1, accomplices: 0 })).toEqual({ saboteurs: 0, accomplices: 0 });
  });
});

describe("dark-side odds by crew size and saboteur setting — design §8.1", () => {
  const sum = (n: number, m: MoleSetting) => darkSideOdds(n, m, false).reduce((a, o) => a + o.chance, 0);

  it("off and starter mode are crew only; 2–3 players are crew only whatever the setting", () => {
    for (let n = 2; n <= 12; n++) {
      expect(darkSideOdds(n, "off", false)).toEqual([{ saboteurs: 0, accomplices: 0, chance: 1 }]);
      expect(darkSideOdds(n, "on", true)).toEqual([{ saboteurs: 0, accomplices: 0, chance: 1 }]);
      for (const m of ["maybe", "on"] as const) expect(sum(n, m)).toBeCloseTo(1, 9);
    }
    for (const n of [2, 3]) for (const m of ["maybe", "on"] as const) expect(darkSideOdds(n, m, false).every((o) => o.saboteurs === 0)).toBe(true);
  });

  it("on: one saboteur at 4; the weighted mixes from 5, after the hard limits", () => {
    expect(darkSideOdds(4, "on", false)).toEqual([{ saboteurs: 1, accomplices: 0, chance: 1 }]);
    expect(darkSideOdds(6, "on", false)).toEqual([
      { saboteurs: 1, accomplices: 0, chance: 0.5 },
      { saboteurs: 1, accomplices: 1, chance: 0.5 },
    ]);
    // 5p: ⌊5/3⌋ = 1 seat, so the 1/1 mix becomes 1/0.
    expect(darkSideOdds(5, "on", false).every((o) => o.saboteurs === 1 && o.accomplices === 0)).toBe(true);
    expect(darkSideOdds(10, "on", false)).toEqual([
      { saboteurs: 2, accomplices: 1, chance: 0.6 },
      { saboteurs: 1, accomplices: 2, chance: 0.2 },
      { saboteurs: 2, accomplices: 1, chance: 0.2 },
    ]);
  });

  it("maybe: a 50% chance of no dark side at 4–8 players; the same as on at 9–12", () => {
    for (const n of [4, 6, 8]) expect(darkSideOdds(n, "maybe", false)[0]).toEqual({ saboteurs: 0, accomplices: 0, chance: 0.5 });
    for (const n of [9, 12]) expect(darkSideOdds(n, "maybe", false)).toEqual(darkSideOdds(n, "on", false));
  });

  it("the deal follows the odds: 'maybe' at 6 deals no dark side about half the time", () => {
    let none = 0;
    for (let i = 0; i < 600; i++) if (sides(6, { mole: "maybe" }, `half-${i}`).saboteurs === 0) none++;
    expect(none).toBeGreaterThan(250);
    expect(none).toBeLessThan(350);
  });
});

describe("dealing by faction — design §8.1 (role deck v2 §3)", () => {
  it("invariants at every size and setting: the limits hold, accomplices never without a saboteur, at most one of each role", () => {
    for (let n = 2; n <= 12; n++) {
      for (const mole of ["off", "maybe", "on"] as const) {
        for (let i = 0; i < 25; i++) {
          const d = sides(n, { mole }, `inv-${n}-${mole}-${i}`);
          expect(d.dealt).toHaveLength(n);
          expect(d.saboteurs + d.accomplices).toBeLessThanOrEqual(Math.floor(n / 3));
          if (d.saboteurs === 0) expect(d.accomplices).toBe(0);
          expect(d.accomplices).toBeLessThanOrEqual(d.saboteurs + 1);
          if (mole === "off" || n <= 3) expect(d.saboteurs).toBe(0);
          const special = d.dealt.filter((r) => r !== "rookie");
          expect(new Set(special).size).toBe(special.length);
        }
      }
    }
  });

  it("reaches the mixes the weights allow (7–8: 1/1, 2/0; 11–12: 2/2, 2/1, 3/0 is capped by two saboteur roles)", () => {
    const seen = (n: number) => new Set(Array.from({ length: 150 }, (_, i) => sides(n, {}, `mix-${n}-${i}`)).map((d) => `${d.saboteurs}/${d.accomplices}`));
    expect([...seen(8)].sort()).toEqual(["1/1", "2/0"]); // 1/2 is capped to 1/1 by ⌊8/3⌋ = 2
    expect([...seen(12)].sort()).toEqual(["2/1", "2/2"]); // 3/1: only two saboteur roles exist here
  });

  it("no saboteur role to deal: accomplices are dropped too, and the seats go to the crew", () => {
    const noSaboteur: RoleTable = { ...TABLE, mole: as("mole", "crew"), embezzler: as("mole", "crew") };
    for (let i = 0; i < 30; i++) {
      const d = sides(9, {}, `nosab-${i}`, noSaboteur);
      expect([d.saboteurs, d.accomplices, d.crew]).toEqual([0, 0, 9]);
    }
  });

  it("an accomplice seat the pool can't fill goes to the crew (no accomplice roles in the pool)", () => {
    for (let i = 0; i < 30; i++) {
      const d = sides(9, { rolePool: ["rookie", "lookout"] }, `noacc-${i}`);
      expect(d.accomplices).toBe(0);
      expect(d.saboteurs).toBeGreaterThan(0);
    }
  });

  it("uniqueRoles false repeats pool roles (accomplices too) but never a saboteur (one Mole at most, owner answers 1 Nov)", () => {
    let repeatedAccomplice = false;
    for (let i = 0; i < 60; i++) {
      const d = sides(12, { uniqueRoles: false, rolePool: ["rookie", "fence"] }, `rep-${i}`);
      expect(d.dealt.filter((r) => r === MOLE_ROLE).length).toBeLessThanOrEqual(1);
      expect(d.dealt.filter((r) => r === "embezzler").length).toBeLessThanOrEqual(1);
      if (d.dealt.filter((r) => r === "fence").length > 1) repeatedAccomplice = true;
    }
    expect(repeatedAccomplice).toBe(true);
  });

  it("starter mode deals crew only, even when a starter role is an accomplice", () => {
    const starter = config(5, { starterMode: true, mole: "off" });
    expect(rolePoolFor(starter, TABLE)).not.toContain("fence");
    for (let i = 0; i < 20; i++) {
      const dealt = dealRoles({ ...starter, seed: `st-${i}` }, seedRng(`st-${i}`), TABLE).value;
      for (const r of dealt) expect(factionIn(TABLE, r)).toBe("crew");
    }
  });

  it("saboteurs are never pool roles: the shipped Mole is the only saboteur, dealt by the setting", () => {
    expect(saboteursFor(config(6))).toEqual([MOLE_ROLE]);
    expect(rolePoolFor(config(6))).not.toContain(MOLE_ROLE);
    expect(validateConfig(config(6, { rolePool: ["rookie", MOLE_ROLE] })).join()).toMatch(/saboteur/);
  });
});
