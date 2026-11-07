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
  POWER_CLAIM_TARGET,
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
        expect(Number.isInteger(def.coins) && def.coins >= 0).toBe(true);
        expect(Number.isFinite(def.heatPressure)).toBe(true);
      }
      // design §3.3: a missed move grabs 1 coin in the default room.
      expect(job.rooms[job.defaultRoom]?.coins).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(job.bank.coinsPerPlayer) && job.bank.coinsPerPlayer >= 1).toBe(true);
    });

    it(`${job.id}: checkpoint targets are cumulative`, () => {
      const [a, b, c] = job.checkpoints.perPlayer;
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(c);
    });
  }
});

describe("First National Bank rooms — design §3.1", () => {
  const r = BANK_JOB.rooms;

  it("coins per visitor: Lobby 1, Office, Deposit boxes, Manager's office and Server room 2, Vault 3, Security and Rooftop 0", () => {
    const coins = Object.fromEntries(Object.values(r).map((d) => [d.id, d.coins]));
    expect(coins).toEqual({ lobby: 1, office: 2, depositBoxes: 2, managersOffice: 2, serverRoom: 2, vault: 3, security: 0, rooftop: 0 });
  });

  it("3–4 players 5 rooms, 5–8 players 7 rooms (Deposit boxes, Server room), 9–12 players 8 rooms (Manager's office)", () => {
    expect(BANK_JOB.roomTiers).toEqual([
      { minPlayers: 3, rooms: ["vault", "office", "lobby", "security", "rooftop"] },
      { minPlayers: 5, rooms: ["depositBoxes", "serverRoom"] },
      { minPlayers: 9, rooms: ["managersOffice"] },
    ]);
    expect(Object.keys(r)).not.toContain("tellerLine");
  });

  it("Security watches one room; it is the only room that tells you more", () => {
    expect(r.security?.info).toBe("watchRoom");
    for (const d of Object.values(r)) if (d.id !== "security") expect(d.info).toBe("none");
  });

  it("the missed move's room is the Lobby (design §3.3)", () => {
    expect(BANK_JOB.defaultRoom).toBe("lobby");
  });
});

describe("First National Bank bank — design §6.1", () => {
  it("16 coins per player", () => {
    expect(BANK_JOB.bank).toEqual({ coinsPerPlayer: 16 });
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
      managersOffice: 10,
    });
  });
});

describe("First National Bank checkpoint targets — design §11.5", () => {
  it("3, 7 and 11 × crew size at the end of Acts 1, 2 and 3", () => {
    expect(BANK_JOB.checkpoints.perPlayer).toEqual([3, 7, 11]); // scaled to R7 coins in S3a.1 (was 7, 15, 23)
  });
});

describe("First National Bank shakedowns — extension.md \"Shakedowns (fixed numbers)\"", () => {
  it("clean below 3, payout 4 (scaled to R7 coins in S3a.1; were 6 and 8); no plurality rule", () => {
    expect(BANK_JOB.shakedown).toEqual({ cleanBelow: 3, payout: 4 });
  });
});

describe("starter roles — design §8, §8.1", () => {
  it("every role that can be dealt has a definition with a matching id", () => {
    for (const id of new Set([...STARTER_ROLES, ...POOL_ROLES, FILLER_ROLE])) {
      expect(ROLES[id]?.id).toBe(id);
    }
  });

  it("Rookie: no power, plain stash (extension.md: no multiplier)", () => {
    expect(ROLES.rookie).toMatchObject({ power: { kind: "none" } });
  });

  it("Lookout: sees who was in one extra room each round", () => {
    expect(ROLES.lookout).toMatchObject({ power: { kind: "lookout", extraRooms: 1 } });
  });

  it("tags and winsOn (extension.md Build notes \"Win rule\", \"Tags\")", () => {
    const tagged = (tag: string) => Object.values(ROLES).filter((r) => r.tag === tag).map((r) => r.id).sort();
    expect(tagged("wildcard")).toEqual(["hacker"]);
    expect(tagged("loneWolf")).toEqual(["mole"]);
    expect(tagged("teamPlayer")).toHaveLength(7);
    const winners = Object.fromEntries(Object.values(ROLES).filter((r) => r.winsOn.length > 0).map((r) => [r.id, r.winsOn]));
    expect(winners).toEqual({ mole: ["heat", "target"] });
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

  it("decks: Starter 2, Standard 6, Everything 9 (extension.md \"Decks\", R7 cut)", () => {
    expect(DECKS.starter).toHaveLength(2);
    expect(DECKS.standard).toHaveLength(6);
    expect(DECKS.everything).toHaveLength(9);
    expect([...DECKS.everything].sort()).toEqual(Object.keys(ROLES).sort());
  });

  // extension.md Build notes "Tags, decks and dealing": the balance pass decides the mix; r6-balance.md lifted 4p one over the cap.
  it("Balanced mix: under the round(n ÷ 3) cap except the tuned 4p row", () => {
    for (let n = MIN_PLAYERS; n <= 12; n++) {
      const mix = BALANCED_MIX[n];
      expect(mix, `${n}`).toBeDefined();
      expect((mix?.loneWolves ?? 0) + (mix?.wildcards ?? 0)).toBeLessThanOrEqual(Math.round(n / 3) + (n === 4 ? 1 : 0));
    }
    expect(BALANCED_MIX[4]).toEqual({ loneWolves: 1, wildcards: 1 });
    expect(BALANCED_MIX[12]).toEqual({ loneWolves: 2, wildcards: 2 });
  });
});

describe("events deck content — design §10", () => {
  it("has four cards with matching ids (Police patrol left, extension.md \"Police activity\"), and room cards name rooms of the bank", () => {
    expect(EVENT_DECK).toHaveLength(4);
    expect(EVENT_DECK).not.toContain("policePatrol");
    expect(POLICE_ACTIVITY).toMatchObject({ chancePercent: 30, heat: 4 });
    for (const id of EVENT_DECK) {
      const def = EVENTS[id];
      expect(def?.id).toBe(id);
      if (def?.effect.kind === "roomSurge") expect(Object.keys(BANK_JOB.rooms)).toContain(def.effect.room);
    }
    expect(EVENTS.shiftChange?.effect).toEqual({ kind: "roomSurge", room: "vault", extraCoins: 1, heatMultiplier: 2 }); // design §13: Vault +1 coin
  });
});

describe("plan-board power claims — design §10", () => {
  it("every claimable power is a power some role has, and points at a room or a player", () => {
    const kinds = new Set(Object.values(ROLES).map((r) => r.power.kind));
    for (const [kind, aims] of Object.entries(POWER_CLAIM_TARGET)) {
      expect(kinds.has(kind as never)).toBe(true);
      expect(["room", "player"]).toContain(aims);
    }
  });
});
