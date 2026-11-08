// The content data is self-consistent and matches the design numbers.
// design §3, §5, §6, §7, §9.3, §11, §13
import { describe, expect, it } from "vitest";
import {
  BANK_JOB,
  EMERGENCY_POOL,
  SHOP_COLUMNS,
  PERKS,
  PERK_IDS,
  PERK_RULES,
  EVENTS,
  EVENT_DECK,
  JOBS,
  MAX_PLAYERS,
  MAX_ROLE_COPIES,
  MIN_PLAYERS,
  POWER_CLAIM_TARGET,
  ROLES,
  ROLE_DEAL,
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
        expect(Number.isInteger(def.quietCoins) && def.quietCoins >= 0).toBe(true);
      }
      // design §3.3: a missed move grabs 1 coin in the default room.
      expect(job.rooms[job.defaultRoom]?.coins).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(job.bank.coinsPerPlayer) && job.bank.coinsPerPlayer >= 1).toBe(true);
    });

    it(`${job.id}: a whole round cap of 1 or more and an honesty line between 0 and 1 (design §6.2, §7.5)`, () => {
      expect(Number.isInteger(job.roundCap) && job.roundCap >= 1).toBe(true);
      expect(job.honestyLine > 0 && job.honestyLine < 1).toBe(true);
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

describe("First National Bank alarm — design §3.1, §5", () => {
  it("4-bulb bells, taped off for 2 rounds, a bust at 3 Wanted stars", () => {
    expect(BANK_JOB.alarm).toEqual({ bulbs: 4, tapedRounds: 2, bustStars: 3 });
  });

  it("noise: the Lobby is silent, the Office-like rooms' 1st coin is silent, every Vault coin rings; the Rooftop lies low", () => {
    const quiet = Object.fromEntries(Object.values(BANK_JOB.rooms).map((d) => [d.id, d.quietCoins]));
    expect(quiet).toEqual({ vault: 0, office: 1, lobby: 1, security: 0, rooftop: 0, depositBoxes: 1, serverRoom: 1, managersOffice: 1 });
    expect(BANK_JOB.rooms.lobby?.quietCoins).toBe(BANK_JOB.rooms.lobby?.coins);
    expect(Object.values(BANK_JOB.rooms).filter((d) => d.lieLow).map((d) => d.id)).toEqual(["rooftop"]);
  });
});

describe("First National Bank endings — design §6.2, §7.5", () => {
  it("12 rounds at most, and the two-thirds honesty line", () => {
    expect(BANK_JOB.roundCap).toBe(12);
    expect(BANK_JOB.honestyLine).toBe(2 / 3);
  });
});

describe("the emergency pool — design §9.3", () => {
  it("1 emergency meeting for 3–6 players, 2 for 7–12", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) expect(EMERGENCY_POOL[n], `${n} players`).toBe(n <= 6 ? 1 : 2);
  });
});

describe("roles — design §11.1, §11.2", () => {
  it("the ten roles, each with a matching id", () => {
    expect(Object.keys(ROLES)).toEqual(["lookout", "locksmith", "detective", "auditor", "smoothTalker", "hacker", "electrician", "priest", "mole", "fixer"]);
    for (const [id, def] of Object.entries(ROLES)) expect(def.id).toBe(id);
  });

  it("eyes spot theft, shadows make it possible: five of each", () => {
    const of = (kind: string) => Object.values(ROLES).filter((r) => r.kind === kind).map((r) => r.id);
    expect(of("eyes")).toEqual(["lookout", "detective", "auditor", "smoothTalker", "priest"]);
    expect(of("shadows")).toEqual(["locksmith", "hacker", "electrician", "mole", "fixer"]);
  });

  it("powers and frequencies: every round, passive, once between meetings, once per game (§11.2)", () => {
    const powers = Object.fromEntries(Object.values(ROLES).map((r) => [r.id, r.power]));
    expect(powers).toEqual({
      lookout: { kind: "lookout", extraRooms: 1 },
      locksmith: { kind: "muffle", fewerRings: 1 },
      detective: { kind: "detect" },
      auditor: { kind: "audit", perStretch: 1 },
      smoothTalker: { kind: "voteWeight", weight: 2 },
      hacker: { kind: "hide", perStretch: 1 },
      electrician: { kind: "blackout", perStretch: 1 },
      priest: { kind: "absolve", perStretch: 1 },
      mole: { kind: "ring", perStretch: 1 },
      fixer: { kind: "reopen", perGame: 1 },
    });
  });

  it("every role earns exactly one token per trigger (extension.md \"Roles\", until S3a.7)", () => {
    for (const role of Object.values(ROLES)) {
      if (role.rewards) expect(role.rewards?.map((r) => r.count), role.id).toEqual([1]);
    }
    expect(Object.values(ROLES).filter((r) => r.rewards).map((r) => r.id)).toEqual(["lookout", "detective", "auditor", "smoothTalker"]);
  });

  it("perks: eight kinds in three shop columns; Peek and Shield cost 2, the rest 1 (extension.md \"Tokens and the perk shop\")", () => {
    expect([...PERK_IDS].sort()).toEqual(["alibi", "ballot", "extraVote", "peek", "recharge", "rig", "shield", "tail"]);
    for (const id of PERK_IDS) expect(PERKS[id].spent, id).toBe(id === "shield" ? "auto" : "use");
    for (const id of PERK_IDS) expect(PERKS[id].cost, id).toBe(id === "peek" || id === "shield" ? 2 : 1);
    for (const [column, ids] of Object.entries(SHOP_COLUMNS)) for (const id of ids) expect(PERKS[id].column).toBe(column);
    expect(PERK_RULES).toEqual({ extraVoteWeight: 1, rigOptions: 2 });
  });
});

describe("the deal by crew size — design §11.3, §19.2 seam 8", () => {
  const kinds = { eyes: Object.values(ROLES).filter((r) => r.kind === "eyes").length, shadows: Object.values(ROLES).filter((r) => r.kind === "shadows").length };

  it("every player gets a role, eyes and shadows within one of each other", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const deal = ROLE_DEAL[n];
      expect(deal, `${n}`).toBeDefined();
      if (!deal) continue;
      expect(deal.eyes + deal.shadows + deal.either, `${n}`).toBe(n);
      expect(Math.abs(deal.eyes - deal.shadows), `${n}`).toBe(0);
      expect(deal.either, `${n}`).toBe(n % 2);
    }
  });

  it("up to 10 players every role is distinct; at 11–12 a role may repeat, at most twice", () => {
    expect(MAX_ROLE_COPIES).toBe(2);
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const deal = ROLE_DEAL[n] as (typeof ROLE_DEAL)[number];
      const most = { eyes: deal.eyes + deal.either, shadows: deal.shadows + deal.either };
      for (const kind of ["eyes", "shadows"] as const) {
        if (n <= 10) expect(most[kind], `${n} ${kind}`).toBeLessThanOrEqual(kinds[kind]);
        expect(most[kind], `${n} ${kind}`).toBeLessThanOrEqual(kinds[kind] * MAX_ROLE_COPIES);
      }
    }
  });
});

describe("events deck content — design §10", () => {
  it("has four cards with matching ids, and room cards name rooms of the bank", () => {
    expect(EVENT_DECK).toHaveLength(4);
    expect(EVENT_DECK).not.toContain("policePatrol");
    for (const id of EVENT_DECK) {
      const def = EVENTS[id];
      expect(def?.id).toBe(id);
      if (def?.effect.kind === "roomSurge") expect(Object.keys(BANK_JOB.rooms)).toContain(def.effect.room);
    }
    expect(EVENTS.shiftChange?.effect).toEqual({ kind: "roomSurge", room: "vault", extraCoins: 1 }); // design §13: Vault +1 coin
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
