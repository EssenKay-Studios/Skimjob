// The content data is self-consistent and matches the design numbers.
// design §6, §7, §8, §11.5
import { describe, expect, it } from "vitest";
import {
  ACCOMPLICE_V2_ROLES,
  BANK_JOB,
  DARK_SIDE_RULES,
  PERKS,
  PERK_IDS,
  PERK_RULES,
  DEFAULT_ROLE_POOL,
  EVENTS,
  EVENT_DECK,
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

  it("9–12: Teller line 3 loot; Manager's office 4 loot (owner-answers pass, 1 Nov)", () => {
    expect(BANK_JOB.roomTiers[2]).toEqual({ minPlayers: 9, rooms: ["tellerLine", "managersOffice"] });
    expect(r.tellerLine?.loot).toBe(3);
    expect(r.managersOffice?.loot).toBe(4);
  });
});

describe("First National Bank Heat numbers — design §7", () => {
  it("baseline +4 a round, raid at 100, missed checkpoint +15", () => {
    expect(BANK_JOB.heat).toEqual({ max: 100, perRound: 4, missedCheckpoint: 15 });
  });

  it("Vault +20, Manager's office half of that, Deposit boxes +10, Rooftop −20 (per crew share); other rooms 0", () => {
    const pressure = Object.fromEntries(Object.values(BANK_JOB.rooms).map((d) => [d.id, d.heatPressure]));
    expect(pressure).toEqual({
      vault: 20,
      office: 0,
      lobby: 0,
      security: 0,
      rooftop: -20,
      depositBoxes: 10,
      serverRoom: 0,
      tellerLine: 0,
      managersOffice: 10,
    });
  });
});

describe("First National Bank checkpoint targets — design §11.5", () => {
  it("7, 15 and 24 × crew size at the end of Acts 1, 2 and 3", () => {
    expect(BANK_JOB.checkpoints.perPlayer).toEqual([7, 15, 24]);
  });
});

describe("First National Bank shakedowns — design §11.3", () => {
  it("clean below 3 × the act number; a clean target is paid 5 × the act number; from 9 players ⅓ of the votes is enough (§11.2)", () => {
    expect(BANK_JOB.shakedown).toEqual({ cleanBelowPerAct: 3, compensationPerAct: 5, pluralityFromPlayers: 9, pluralityShare: 1 / 3 });
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

  it("Inside Man: can't pocket; 0.3 points per loot the Haul ends above the final target", () => {
    expect(ROLES.insideMan).toMatchObject({
      power: { kind: "none" },
      canPocket: false,
      scoring: { stashMultiplier: 1, perLootOverFinalTarget: 0.3 },
    });
  });

  it("Fence: up to 5 loot per act into a hidden safe", () => {
    expect(ROLES.fence).toMatchObject({ power: { kind: "fenceSafe", perAct: 5 }, canPocket: true });
  });

  it("only the Rookie and Inside Man score differently from plain stash", () => {
    expect(ROLES.lookout?.scoring).toEqual({ stashMultiplier: 1, perLootOverFinalTarget: 0 });
    expect(ROLES.fence?.scoring).toEqual({ stashMultiplier: 1, perLootOverFinalTarget: 0 });
    expect(ROLES.rookie?.scoring.perLootOverFinalTarget).toBe(0);
  });

  it("the Mole and Embezzler are saboteurs, the Getaway Driver, Fence, Hacker, Blackmailer and Forger accomplices, the rest crew (design §3, role deck v2 R3a, R3b)", () => {
    const faction = (id: string) => (id === "mole" || id === "embezzler" ? "saboteur" : ACCOMPLICE_V2_ROLES.includes(id) ? "accomplice" : "crew");
    expect([...ACCOMPLICE_V2_ROLES].sort()).toEqual(["blackmailer", "fence", "forger", "getawayDriver", "hacker"]);
    for (const role of Object.values(ROLES)) expect(role.faction, role.id).toBe(faction(role.id));
    for (const id of STARTER_ROLES) expect(ROLES[id]?.faction).toBe("crew");
  });

  it("perks: eight kinds plus the Smooth Talker's Emergency; Shield and Emergency spent by themselves, the rest with useAbility (design §8.3)", () => {
    expect([...PERK_IDS].sort()).toEqual(["alibi", "ballot", "emergency", "extraVote", "peek", "recharge", "rig", "shield", "tail"]);
    for (const id of PERK_IDS) expect(PERKS[id].spent, id).toBe(id === "shield" || id === "emergency" ? "auto" : "use");
    expect(PERK_RULES).toEqual({ extraVoteWeight: 1, rigOptions: 2 });
  });

  it("dark-side weights (role deck v2 §3): crew only at 2–3, one saboteur at 4, then the weighted mixes", () => {
    const at = (n: number) => DARK_SIDE_RULES.filter((r) => r.minPlayers <= n).at(-1)?.options.map((o) => [o.saboteurs, o.accomplices, o.weight]);
    expect(at(3)).toEqual([[0, 0, 1]]);
    expect(at(4)).toEqual([[1, 0, 1]]);
    expect(at(6)).toEqual([[1, 0, 50], [1, 1, 50]]);
    expect(at(8)).toEqual([[1, 1, 60], [2, 0, 20], [1, 2, 20]]);
    expect(at(10)).toEqual([[2, 1, 60], [1, 2, 20], [2, 2, 20]]);
    expect(at(12)).toEqual([[2, 2, 60], [2, 1, 20], [3, 1, 20]]);
  });
});

describe("events deck content — design §10", () => {
  it("has ten cards with matching ids, and room cards name rooms of the bank", () => {
    expect(EVENT_DECK).toHaveLength(10);
    for (const id of EVENT_DECK) {
      const def = EVENTS[id];
      expect(def?.id).toBe(id);
      if (def?.effect.kind === "roomSurge") expect(Object.keys(BANK_JOB.rooms)).toContain(def.effect.room);
    }
    // balance pass 2: Police patrol 10 → 5, Shift change Vault Heat ×2 → ×1.5
    expect(EVENTS.policePatrol?.effect).toEqual({ kind: "heat", amount: 5 });
    expect(EVENTS.shiftChange?.effect).toEqual({ kind: "roomSurge", room: "vault", lootMultiplier: 2, heatMultiplier: 1.5 });
    expect(EVENTS.quietNight?.effect).toEqual({ kind: "heat", amount: -10 });
    expect(EVENTS.raidRumour?.effect).toEqual({ kind: "raidRumour", loss: 3 });
  });
});
