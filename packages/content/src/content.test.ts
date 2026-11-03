// The content data is self-consistent and matches the design numbers.
// design §6, §7, §8, §11.5
import { describe, expect, it } from "vitest";
import {
  BALANCED_MIX,
  BANK_JOB,
  DECKS,
  POLICE_ACTIVITY,
  SHOP_COLUMNS,
  PERKS,
  PERK_IDS,
  PERK_RULES,
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

  it("5–8: Deposit boxes 5 loot, holds 2, everyone gets 4 if more go (R5; was 3); Server room counts pocketers", () => {
    expect(BANK_JOB.roomTiers[1]).toEqual({ minPlayers: 5, rooms: ["depositBoxes", "serverRoom"] });
    expect(r.depositBoxes?.loot).toBe(5);
    expect(r.depositBoxes?.capacity).toEqual({ max: 2, crowdedLoot: 4 }); // R5 (balance-3.md): 3 → 4
    expect(r.serverRoom?.loot).toBe(0);
    expect(r.serverRoom?.info).toBe("pocketCount");
  });

  it("9–12: Teller line 4 loot (R5, balance-3.md); Manager's office 4 loot (owner-answers pass, 1 Nov)", () => {
    expect(BANK_JOB.roomTiers[2]).toEqual({ minPlayers: 9, rooms: ["tellerLine", "managersOffice"] });
    expect(r.tellerLine?.loot).toBe(5);
    expect(r.managersOffice?.loot).toBe(3);
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
    expect(BANK_JOB.checkpoints.perPlayer).toEqual([7, 15, 23]); // R5 (balance-3.md): final 24 → 23
  });
});

describe("First National Bank shakedowns — extension.md \"Shakedowns (fixed numbers)\"", () => {
  it("clean below 6, payout 8; the Duel wrong call pays 8; no plurality rule", () => {
    expect(BANK_JOB.shakedown).toEqual({ cleanBelow: 6, payout: 8 });
    expect(BANK_JOB.duel).toEqual({ wrongCallOut: 8 });
  });
});

describe("starter roles — design §8, §8.1", () => {
  it("every role that can be dealt has a definition with a matching id", () => {
    for (const id of new Set([...STARTER_ROLES, ...POOL_ROLES, FILLER_ROLE])) {
      expect(ROLES[id]?.id).toBe(id);
    }
  });

  it("Rookie: no power, plain stash (extension.md: no multiplier)", () => {
    expect(ROLES.rookie).toMatchObject({ power: { kind: "none" }, canPocket: true, scoring: { lootPerPointOverFinalTarget: 0 } });
  });

  it("Lookout: sees who was in one extra room each round", () => {
    expect(ROLES.lookout).toMatchObject({ power: { kind: "lookout", extraRooms: 1 }, canPocket: true });
  });

  it("Inside Man: can't pocket; +1 per 5 loot the Haul ends above the final target (extension.md \"Winning and losing\")", () => {
    expect(ROLES.insideMan).toMatchObject({ power: { kind: "none" }, canPocket: false, scoring: { lootPerPointOverFinalTarget: 5 } });
  });

  it("Fence: up to 5 loot per stretch into a safe; token at 10", () => {
    expect(ROLES.fence).toMatchObject({ power: { kind: "fenceSafe", perAct: 1, tokenSafe: 3 }, canPocket: true });
  });

  it("tags and winsOn (extension.md Build notes \"Win rule\", \"Tags\")", () => {
    const tagged = (tag: string) => Object.values(ROLES).filter((r) => r.tag === tag).map((r) => r.id).sort();
    expect(tagged("wildcard")).toEqual(["blackmailer", "fence", "forger", "getawayDriver", "hacker"]);
    expect(tagged("loneWolf")).toEqual(["embezzler", "mole"]);
    expect(tagged("teamPlayer")).toHaveLength(13);
    const winners = Object.fromEntries(Object.values(ROLES).filter((r) => r.winsOn.length > 0).map((r) => [r.id, r.winsOn]));
    expect(winners).toEqual({ getawayDriver: ["heat"], fence: ["heat", "target"], mole: ["heat", "target"], embezzler: ["target"] });
    for (const id of STARTER_ROLES) expect(ROLES[id]?.tag).toBe("teamPlayer");
  });

  it("every role earns exactly one token per trigger (extension.md \"Roles\")", () => {
    for (const role of Object.values(ROLES)) {
      if (role.id === "rookie" || role.rewards) expect(role.rewards?.map((r) => r.count), role.id).toEqual([1]);
    }
    expect(Object.values(ROLES).filter((r) => !r.rewards).map((r) => r.id)).toEqual([]);
  });

  it("perks: nine kinds in three shop columns; Peek and Shield cost 2, the rest 1 (extension.md \"Tokens and the perk shop\")", () => {
    expect([...PERK_IDS].sort()).toEqual(["alibi", "ballot", "emergency", "extraVote", "peek", "recharge", "rig", "shield", "tail"]);
    for (const id of PERK_IDS) expect(PERKS[id].spent, id).toBe(id === "shield" || id === "emergency" ? "auto" : "use");
    for (const id of PERK_IDS) expect(PERKS[id].cost, id).toBe(id === "peek" || id === "shield" ? 2 : 1);
    for (const [column, ids] of Object.entries(SHOP_COLUMNS)) for (const id of ids) expect(PERKS[id].column).toBe(column);
    expect(PERK_RULES).toEqual({ extraVoteWeight: 1, rigOptions: 2 });
  });

  it("decks: Starter 5, Standard 11, Everything 20 (extension.md \"Decks\")", () => {
    expect(DECKS.starter).toHaveLength(5);
    expect(DECKS.standard).toHaveLength(11);
    expect([...DECKS.everything].sort()).toEqual(Object.keys(ROLES).sort());
  });

  // extension.md Build notes "Tags, decks and dealing": the balance pass decides the mix; r6-balance.md lifted 4p one over the cap.
  it("Balanced mix: under the round(n ÷ 3) cap except the tuned 4p row", () => {
    for (let n = 2; n <= 12; n++) {
      const mix = BALANCED_MIX[n];
      expect(mix, `${n}`).toBeDefined();
      expect((mix?.loneWolves ?? 0) + (mix?.wildcards ?? 0)).toBeLessThanOrEqual(Math.round(n / 3) + (n === 4 ? 1 : 0));
    }
    expect(BALANCED_MIX[4]).toEqual({ loneWolves: 1, wildcards: 1 });
    expect(BALANCED_MIX[12]).toEqual({ loneWolves: 2, wildcards: 2 });
  });
});

describe("events deck content — design §10", () => {
  it("has nine cards with matching ids (Police patrol left, extension.md \"Police activity\"), and room cards name rooms of the bank", () => {
    expect(EVENT_DECK).toHaveLength(9);
    expect(EVENT_DECK).not.toContain("policePatrol");
    expect(POLICE_ACTIVITY).toMatchObject({ chancePercent: 30, heat: 4 });
    for (const id of EVENT_DECK) {
      const def = EVENTS[id];
      expect(def?.id).toBe(id);
      if (def?.effect.kind === "roomSurge") expect(Object.keys(BANK_JOB.rooms)).toContain(def.effect.room);
    }
    expect(EVENTS.shiftChange?.effect).toEqual({ kind: "roomSurge", room: "vault", lootMultiplier: 1.5, heatMultiplier: 2 });
    expect(EVENTS.quietNight?.effect).toEqual({ kind: "heat", amount: -5 });
    expect(EVENTS.raidRumour?.effect).toEqual({ kind: "raidRumour", loss: 3 });
  });
});
