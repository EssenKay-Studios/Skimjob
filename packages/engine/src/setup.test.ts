// Deterministic setup: rooms by player count, dealing roles, RNG on replay.
// design §6.2, §8.1, §16, §17.2
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOLE_ROLE, STARTER_ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, MoleSetting } from "./types";
import { canSee } from "./types";
import { createGame, dealRoles, roomsFor, setupEvents, validateConfig } from "./setup";
import { applyEvent, initialState, replay } from "./reduce";
import { seedRng } from "./rng";
/** Role deck v2 R3b: the Embezzler is a saboteur too, dealt by the same setting. */
const isSaboteur = (r: string): boolean => r === "mole" || r === "embezzler";

function config(players: number, overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "test-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i > 0 })),
    job: "bank",
    rolePool: [],
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...overrides,
  };
}

function rolesOf(cfg: GameConfig): string[] {
  return Object.values(createGame(cfg).players).map((p) => p.role);
}

const CORE = ["vault", "office", "lobby", "security", "rooftop"];

afterEach(() => vi.restoreAllMocks());

describe("rooms by player count — design §6.2, §16", () => {
  it("2–4 players: core rooms only (5)", () => {
    for (const n of [2, 3, 4]) expect(roomsFor("bank", n)).toEqual(CORE);
  });

  it("5–8 players: adds Deposit boxes and Server room (7)", () => {
    for (const n of [5, 6, 7, 8]) expect(roomsFor("bank", n)).toEqual([...CORE, "depositBoxes", "serverRoom"]);
  });

  it("9–12 players: adds Teller line and Manager's office too (9)", () => {
    for (const n of [9, 10, 11, 12]) {
      expect(roomsFor("bank", n)).toEqual([...CORE, "depositBoxes", "serverRoom", "tellerLine", "managersOffice"]);
    }
  });

  it("the game state holds the rooms for its crew size", () => {
    expect(createGame(config(6)).rooms).toHaveLength(7);
  });
});

describe("dealing roles — design §8.1", () => {
  it("every seat gets exactly one role", () => {
    for (let n = 2; n <= 12; n++) {
      const state = createGame(config(n));
      expect(Object.keys(state.players).sort()).toEqual(state.playerOrder.slice().sort());
      expect(state.log.filter((e) => e.type === "roleDealt")).toHaveLength(n);
    }
  });

  it("starter mode: only Rookie, Inside Man, Lookout, Bagman and Cleaner (role deck v2 §3); no Mole", () => {
    for (let n = 2; n <= 12; n++) {
      for (const seed of ["a", "b", "c"]) {
        const roles = rolesOf(config(n, { seed, starterMode: true, rolePool: ["fence"] }));
        for (const role of roles) expect(STARTER_ROLES).toContain(role);
      }
    }
  });

  it("4 players, starter mode: one of each starter role but the Inside Man (from 5 players)", () => {
    expect(rolesOf(config(4, { starterMode: true })).sort()).toEqual(["bagman", "cleaner", "lookout", "rookie"]);
    expect(rolesOf(config(5, { starterMode: true })).sort()).toEqual([...STARTER_ROLES].sort());
  });

  it("the Inside Man is dealt only from 5 players (design §8.1, owner answers 1 Nov)", () => {
    for (const n of [2, 3, 4]) {
      for (let s = 0; s < 30; s++) expect(rolesOf(config(n, { seed: `ins-${n}-${s}`, rolePool: ["insideMan", "fence"] }))).not.toContain("insideMan");
    }
    expect(rolesOf(config(5, { rolePool: ["insideMan"] }))).toContain("insideMan");
  });

  it("pool roles are dealt at most once each; Rookie fills the remaining seats (provisional)", () => {
    const roles = rolesOf(config(12, { starterMode: true }));
    for (const r of ["lookout", "insideMan", "bagman", "cleaner"]) expect(roles.filter((x) => x === r)).toHaveLength(1);
    expect(roles.filter((x) => x === "rookie")).toHaveLength(8);
  });

  it("small crews get a random subset of the pool", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 50; s++) for (const r of rolesOf(config(2, { seed: `s${s}`, starterMode: true }))) seen.add(r);
    expect([...seen].sort()).toEqual(STARTER_ROLES.filter((r) => r !== "insideMan").sort());
  });

  it("uniqueRoles false deals every seat from the pool with replacement, so roles may repeat; the Mole only by the Mole setting (design §8.1, §15)", () => {
    let repeated = false;
    for (let s = 0; s < 20; s++) {
      const roles = rolesOf(config(12, { seed: `rep-${s}`, mole: "on", uniqueRoles: false }));
      // v2 §3 (R3b): one or two saboteurs at 12, each at most once.
      expect([1, 2]).toContain(roles.filter(isSaboteur).length);
      expect(roles.filter((r) => r === MOLE_ROLE).length).toBeLessThanOrEqual(1);
      if (new Set(roles.filter((r) => r !== "rookie")).size < roles.filter((r) => r !== "rookie").length) repeated = true;
    }
    expect(repeated).toBe(true);
    // A pool of one: every non-Mole seat gets it.
    expect(rolesOf(config(6, { rolePool: ["lookout"], uniqueRoles: false })).sort()).toEqual(Array(6).fill("lookout"));
    // Default (absent or true): each pool role at most once.
    for (const unique of [undefined, true]) {
      const roles = rolesOf(config(12, { rolePool: ["lookout"], ...(unique !== undefined && { uniqueRoles: unique }) }));
      expect(roles.filter((r) => r === "lookout")).toHaveLength(1);
    }
    expect(validateConfig(config(6, { uniqueRoles: "no" as unknown as boolean }))).toContain("uniqueRoles must be a boolean");
  });

  it("the host's role pool is respected", () => {
    const roles = rolesOf(config(3, { rolePool: ["bagman", "lookout"] }));
    expect(roles.sort()).toEqual(["bagman", "lookout", "rookie"]);
  });

  function moleCounts(n: number, mole: MoleSetting): Set<number> {
    const counts = new Set<number>();
    for (let s = 0; s < 60; s++) counts.add(rolesOf(config(n, { seed: `m${s}`, mole })).filter(isSaboteur).length);
    return counts;
  }

  it("Mole: none at 2–3 players, whatever the setting (role deck v2 §3)", () => {
    for (const n of [2, 3]) for (const m of ["off", "maybe", "on"] as const) expect(moleCounts(n, m)).toEqual(new Set([0]));
  });

  // Counted as saboteurs (Mole or Embezzler): since R3b the pool holds two, so the §3 mixes with two deal from 7.
  it("saboteurs at 4–8: off → 0, on → 1 (two possible from 7), maybe → also 0 (role deck v2 §3)", () => {
    for (const n of [4, 5]) {
      expect(moleCounts(n, "off")).toEqual(new Set([0]));
      expect(moleCounts(n, "on")).toEqual(new Set([1]));
      expect(moleCounts(n, "maybe")).toEqual(new Set([0, 1]));
    }
    expect(moleCounts(8, "on")).toEqual(new Set([1, 2]));
    expect(moleCounts(8, "maybe")).toEqual(new Set([0, 1, 2]));
  });

  it("saboteurs at 9–12: off → 0, on and maybe → 1 or 2, 2 at 12 (role deck v2 §3: 'maybe' only matters at 4–8; each saboteur role once)", () => {
    // At 11–12 every mix has two or more saboteurs, so both roles are dealt.
    for (const [n, counts] of [[9, [1, 2]], [12, [2]]] as const) {
      expect(moleCounts(n, "off")).toEqual(new Set([0]));
      expect(moleCounts(n, "on")).toEqual(new Set(counts));
      expect(moleCounts(n, "maybe")).toEqual(new Set(counts));
    }
  });

  it("'maybe a Mole' at 5–8 is about 50%", () => {
    let withMole = 0;
    for (let s = 0; s < 1000; s++) {
      if (dealRoles(config(6, { seed: `half${s}`, mole: "maybe" }), seedRng(`half${s}`)).value.some(isSaboteur)) withMole++;
    }
    expect(withMole).toBeGreaterThan(430);
    expect(withMole).toBeLessThan(570);
  });

  it("the deal is shuffled across seats", () => {
    const fenceSeats = new Set<number>();
    for (let s = 0; s < 40; s++) fenceSeats.add(rolesOf(config(4, { seed: `seat${s}`, starterMode: true })).indexOf("bagman"));
    expect(fenceSeats).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe("config validation — design §1, §15", () => {
  it("rejects fewer than 2 or more than 12 players", () => {
    expect(() => setupEvents(config(1))).toThrow();
    expect(() => setupEvents(config(13))).toThrow();
  });

  it("rejects duplicate or empty player ids", () => {
    const dup = config(3);
    expect(() => setupEvents({ ...dup, players: [dup.players[0]!, dup.players[0]!, dup.players[1]!] })).toThrow(/unique/);
    expect(() => setupEvents({ ...dup, players: [{ id: "", name: "x", isBot: false }, ...dup.players.slice(1)] })).toThrow();
  });

  it("rejects an unknown job, unknown or duplicate pool roles, and the Mole in the pool", () => {
    expect(() => setupEvents(config(3, { job: "casino" }))).toThrow(/job/);
    expect(() => setupEvents(config(3, { rolePool: ["wizard"] }))).toThrow(/role/);
    expect(() => setupEvents(config(3, { rolePool: ["fence", "fence"] }))).toThrow(/duplicates/);
    expect(() => setupEvents(config(6, { rolePool: ["mole"] }))).toThrow(/mole setting/);
  });

  it("starter mode rejects a Mole setting or events (design §8.1: no Mole, no events)", () => {
    expect(() => setupEvents(config(6, { starterMode: true, mole: "on" }))).toThrow(/mole/);
    expect(() => setupEvents(config(6, { starterMode: true, mole: "maybe" }))).toThrow(/mole/);
    expect(() => setupEvents(config(6, { starterMode: true, eventsEnabled: true }))).toThrow(/events/);
    const created = setupEvents(config(6, { starterMode: true }))[0];
    expect(created).toMatchObject({ type: "gameCreated", starterMode: true, mole: "off", eventsEnabled: false });
  });

  // QA reproductions from PR #2: configs arrive as untrusted JSON (M2 server).
  it("returns errors instead of throwing, and [] for a valid config", () => {
    expect(validateConfig(config(6))).toEqual([]);
    expect(validateConfig(null)).toEqual(["config must be an object"]);
    expect(validateConfig({ ...config(1), job: "casino" })).toHaveLength(2);
  });

  it("rejects an unknown voteVisibility (it would land in the public gameCreated)", () => {
    expect(validateConfig({ ...config(6), voteVisibility: "loud" })).toEqual([expect.stringMatching(/voteVisibility/)]);
    expect(() => setupEvents({ ...config(6), voteVisibility: "loud" as never })).toThrow(/voteVisibility/);
  });

  it("rejects an unknown mole setting with a validation error, not a TypeError", () => {
    expect(validateConfig({ ...config(6), mole: "sometimes" })).toEqual([expect.stringMatching(/mole/)]);
    expect(() => setupEvents({ ...config(6), mole: "sometimes" as never })).toThrow(/invalid game config/);
  });

  it("looks jobs up by own key only (toString, __proto__ are unknown jobs)", () => {
    for (const job of ["toString", "__proto__", "constructor"]) {
      expect(validateConfig({ ...config(6), job })).toEqual([`unknown job ${job}`]);
      expect(() => roomsFor(job, 6)).toThrow(/unknown job/);
    }
  });

  it("rejects non-boolean starterMode / eventsEnabled / isBot and other wrong types", () => {
    expect(validateConfig({ ...config(6), starterMode: "false" })).toEqual([expect.stringMatching(/starterMode/)]);
    expect(validateConfig({ ...config(6), eventsEnabled: 0 })).toEqual([expect.stringMatching(/eventsEnabled/)]);
    const players = config(3).players.map((p) => ({ ...p, isBot: "no" }));
    expect(validateConfig({ ...config(3), players })).toEqual([expect.stringMatching(/isBot/)]);
    expect(validateConfig({ ...config(3), seed: 42 })).toEqual(["seed must be a string"]);
    expect(validateConfig({ ...config(3), rolePool: "fence" })).toEqual([expect.stringMatching(/rolePool/)]);
    expect(validateConfig({ ...config(3), players: "abc" })).toEqual(["players must be an array"]);
  });

  it("starter mode ignores the role pool (GameConfig.rolePool)", () => {
    expect(() => setupEvents(config(3, { starterMode: true, rolePool: ["wizard"] }))).not.toThrow();
  });
});

describe("setup events and visibility — design §17.2", () => {
  it("emits gameCreated, rngSeeded, roomsSet, one roleDealt per seat, roundStarted, then rngAdvanced", () => {
    // No Snitch in this pool, so no snitchTargetAssigned (and no Moles at 3 players).
    const events = setupEvents(config(3, { rolePool: ["rookie", "lookout", "fence"] }));
    expect(events.map((e) => e.type)).toEqual([
      "gameCreated",
      "rngSeeded",
      "roomsSet",
      "roleDealt",
      "roleDealt",
      "roleDealt",
      "roundStarted",
      "rngAdvanced",
    ]);
  });

  it("each roleDealt is private to the player it deals to", () => {
    for (const e of setupEvents(config(5))) {
      if (e.type === "roleDealt") expect(e.visibility).toEqual({ kind: "private", player: e.player });
    }
  });

  it("no player can see the seed or RNG state during the game", () => {
    const cfg = config(5, { seed: "very-secret-seed" });
    const events = setupEvents(cfg);
    const finalWords = createGame(cfg).rng.words;
    for (const viewer of cfg.players.map((p) => p.id)) {
      const visible = events.filter((e) => canSee(e.visibility, viewer, false));
      expect(visible.some((e) => e.type === "rngSeeded" || e.type === "rngAdvanced")).toBe(false);
      const json = JSON.stringify(visible);
      expect(json).not.toContain("very-secret-seed");
      for (const w of finalWords) expect(json).not.toContain(String(w));
    }
  });

  it("each player sees only their own role", () => {
    const cfg = config(4);
    for (const viewer of cfg.players.map((p) => p.id)) {
      const roles = setupEvents(cfg).filter((e) => e.type === "roleDealt" && canSee(e.visibility, viewer, false));
      expect(roles).toHaveLength(1);
      expect(roles[0]).toMatchObject({ player: viewer });
    }
  });
});

describe("determinism and replay — design §17.2", () => {
  it("same config, same events", () => {
    expect(setupEvents(config(9, { mole: "maybe" }))).toEqual(setupEvents(config(9, { mole: "maybe" })));
  });

  it("different seeds give different deals", () => {
    const deals = new Set<string>();
    for (let s = 0; s < 10; s++) deals.add(JSON.stringify(rolesOf(config(6, { seed: `d${s}` }))));
    expect(deals.size).toBeGreaterThan(1);
  });

  it("uses no Math.random or Date.now", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random used");
    });
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now used");
    });
    expect(() => createGame(config(12, { mole: "maybe" }))).not.toThrow();
  });

  it("replaying the log rebuilds the same state, RNG included", () => {
    // No Snitch in the pool, so the deal is the setup's only draw.
    const cfg = config(7, { mole: "maybe", rolePool: ["rookie", "lookout", "insideMan", "fence", "hacker"] });
    const state = createGame(cfg);
    const rebuilt = replay(cfg, JSON.parse(JSON.stringify(state.log)) as GameEvent[]);
    expect(rebuilt).toEqual(state);
    expect(state.rng.words).toEqual(dealRoles(cfg, seedRng(cfg.seed)).rng.words);
  });

  it("rngSeeded sets the RNG from the seed; rngAdvanced replaces it", () => {
    const cfg = config(2);
    const seeded = applyEvent(initialState(cfg), { type: "rngSeeded", visibility: { kind: "reveal" }, seed: "x" });
    expect(seeded.rng).toEqual(seedRng("x"));
    const advanced = applyEvent(seeded, { type: "rngAdvanced", visibility: { kind: "reveal" }, words: [9, 8, 7, 6] });
    expect(advanced.rng.words).toEqual([9, 8, 7, 6]);
    expect(advanced.log).toHaveLength(2);
  });

  it("after setup, round 1 of act 1 is open for planning — design §4, §5.1", () => {
    const state = createGame(config(3));
    expect(state.phase).toEqual({ kind: "planning", round: 1 });
    expect(state.round).toBe(1);
  });
});
