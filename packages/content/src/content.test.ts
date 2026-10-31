// The content data is self-consistent and matches the design numbers.
// design §6, §7, §8, §11.5
import { describe, expect, it } from "vitest";
import {
  BANK_JOB,
  DEFAULT_ROLE_POOL,
  FILLER_ROLE,
  JOBS,
  MIN_PLAYERS,
  POOL_ROLES,
  ROLES,
  STARTER_ROLES,
} from "./index";

describe("job data is consistent", () => {
  for (const job of Object.values(JOBS)) {
    it(`${job.id}: every room in a tier has a definition, and every definition is in exactly one tier`, () => {
      const tiered = job.roomTiers.flatMap((t) => t.rooms);
      expect(new Set(tiered).size).toBe(tiered.length);
      expect(tiered.slice().sort()).toEqual(Object.keys(job.rooms).sort());
      for (const [key, def] of Object.entries(job.rooms)) expect(def.id).toBe(key);
    });

    it(`${job.id}: tiers start at the minimum crew size and go up`, () => {
      expect(job.roomTiers[0]?.minPlayers).toBe(MIN_PLAYERS);
      const mins = job.roomTiers.map((t) => t.minPlayers);
      expect(mins).toEqual(mins.slice().sort((a, b) => a - b));
      expect(new Set(mins).size).toBe(mins.length);
    });

    it(`${job.id}: room numbers are sane`, () => {
      for (const def of Object.values(job.rooms)) {
        expect(Number.isInteger(def.loot) && def.loot >= 0).toBe(true);
        expect(Number.isFinite(def.heatPressure)).toBe(true);
        if (def.capacity) {
          expect(def.capacity.max).toBeGreaterThanOrEqual(1);
          expect(def.capacity.crowdedLoot).toBeLessThanOrEqual(def.loot);
        }
      }
    });

    it(`${job.id}: checkpoint targets are cumulative`, () => {
      const [a, b, c] = job.checkpoints.perPlayer;
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(c);
    });
  }
});

describe("First National Bank rooms — design §6.1, §6.2", () => {
  const r = BANK_JOB.rooms;

  it("core rooms: Vault 6, Office 4, Lobby 2, Security 0, Rooftop 0", () => {
    expect(BANK_JOB.roomTiers[0]?.rooms).toEqual(["vault", "office", "lobby", "security", "rooftop"]);
    expect([r.vault?.loot, r.office?.loot, r.lobby?.loot, r.security?.loot, r.rooftop?.loot]).toEqual([6, 4, 2, 0, 0]);
  });

  it("Security watches one room; it is the only core room that tells you more", () => {
    expect(r.security?.info).toBe("watchRoom");
    for (const id of ["vault", "office", "lobby", "rooftop"]) expect(r[id]?.info).toBe("none");
  });

  it("5–8: Deposit boxes 5 loot, holds 2, everyone gets 3 if more go; Server room counts pocketers", () => {
    expect(BANK_JOB.roomTiers[1]).toEqual({ minPlayers: 5, rooms: ["depositBoxes", "serverRoom"] });
    expect(r.depositBoxes?.loot).toBe(5);
    expect(r.depositBoxes?.capacity).toEqual({ max: 2, crowdedLoot: 3 });
    expect(r.serverRoom?.loot).toBe(0);
    expect(r.serverRoom?.info).toBe("pocketCount");
  });

  it("9–12: Teller line 3 loot; Manager's office 5 loot", () => {
    expect(BANK_JOB.roomTiers[2]).toEqual({ minPlayers: 9, rooms: ["tellerLine", "managersOffice"] });
    expect(r.tellerLine?.loot).toBe(3);
    expect(r.managersOffice?.loot).toBe(5);
  });
});

describe("First National Bank Heat numbers — design §7", () => {
  it("baseline +4 a round, raid at 100, missed checkpoint +15", () => {
    expect(BANK_JOB.heat).toEqual({ max: 100, perRound: 4, missedCheckpoint: 15 });
  });

  it("Vault +20, Manager's office half of that, Rooftop −20 (per crew share); other rooms 0", () => {
    const pressure = Object.fromEntries(Object.values(BANK_JOB.rooms).map((d) => [d.id, d.heatPressure]));
    expect(pressure).toEqual({
      vault: 20,
      office: 0,
      lobby: 0,
      security: 0,
      rooftop: -20,
      depositBoxes: 0,
      serverRoom: 0,
      tellerLine: 0,
      managersOffice: 10,
    });
  });
});

describe("First National Bank checkpoint targets — design §11.5", () => {
  it("6, 14 and 22 × crew size at the end of Acts 1, 2 and 3", () => {
    expect(BANK_JOB.checkpoints.perPlayer).toEqual([6, 14, 22]);
  });
});

describe("First National Bank shakedowns — design §11.3", () => {
  it("clean below 3 × the act number; a clean target is paid 5 × the act number", () => {
    expect(BANK_JOB.shakedown).toEqual({ cleanBelowPerAct: 3, compensationPerAct: 5 });
  });
});

describe("starter roles — design §8, §8.1", () => {
  it("every role that can be dealt has a definition with a matching id", () => {
    for (const id of new Set([...STARTER_ROLES, ...POOL_ROLES, ...DEFAULT_ROLE_POOL, FILLER_ROLE])) {
      expect(ROLES[id]?.id).toBe(id);
    }
  });

  it("Rookie: no power, final stash ×1.2", () => {
    expect(ROLES.rookie).toMatchObject({ power: { kind: "none" }, canPocket: true, scoring: { stashMultiplier: 1.2 } });
  });

  it("Lookout: sees who was in one extra room each round", () => {
    expect(ROLES.lookout).toMatchObject({ power: { kind: "lookout", extraRooms: 1 }, canPocket: true });
  });

  it("Insider: can't pocket; 1 point per loot the Haul ends above the final target", () => {
    expect(ROLES.insider).toMatchObject({
      power: { kind: "none" },
      canPocket: false,
      scoring: { stashMultiplier: 1, perLootOverFinalTarget: 1 },
    });
  });

  it("Fence: up to 5 loot per act into a hidden safe", () => {
    expect(ROLES.fence).toMatchObject({ power: { kind: "fenceSafe", perAct: 5 }, canPocket: true });
  });

  it("only the Rookie and Insider score differently from plain stash", () => {
    expect(ROLES.lookout?.scoring).toEqual({ stashMultiplier: 1, perLootOverFinalTarget: 0 });
    expect(ROLES.fence?.scoring).toEqual({ stashMultiplier: 1, perLootOverFinalTarget: 0 });
    expect(ROLES.rookie?.scoring.perLootOverFinalTarget).toBe(0);
  });

  it("no starter role wins on failure (design §3: only roles like the Mole or Driver do)", () => {
    for (const role of Object.values(ROLES)) expect(role.winsOnFailure).toBeNull();
  });
});
