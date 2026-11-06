// Deterministic setup: rooms by player count, dealing roles, RNG on replay.
// design §6.2, §8.1, §16, §17.2
import { afterEach, describe, expect, it, vi } from "vitest";
import { BALANCED_MIX, MOLE_ROLE, ROLES, STANDARD_ROLES, STARTER_ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent } from "./types";
import { canSee } from "./types";
import { createGame, dealRoles, deckFor, roomsFor, setupEvents, validateConfig } from "./setup";
import { applyEvent, initialState, replay } from "./reduce";
import { seedRng } from "./rng";
const tagOf = (r: string) => ROLES[r]?.tag;
const countTag = (roles: readonly string[], tag: string) => roles.filter((r) => tagOf(r) === tag).length;

function config(players: number, overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "test-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i > 0 })),
    job: "bank",
    rolePool: [],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...overrides,
  };
}

function rolesOf(cfg: GameConfig): string[] {
  return Object.values(createGame(cfg).players).map((p) => p.role);
}

const CORE = ["vault", "office", "lobby", "security", "rooftop"];

afterEach(() => vi.restoreAllMocks());

describe("rooms by player count — design §6.2, §16", () => {
  it("3–4 players: core rooms only (5)", () => {
    for (const n of [3, 4]) expect(roomsFor("bank", n)).toEqual(CORE);
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
    for (let n = 3; n <= 12; n++) {
      const state = createGame(config(n));
      expect(Object.keys(state.players).sort()).toEqual(state.playerOrder.slice().sort());
      expect(state.log.filter((e) => e.type === "roleDealt")).toHaveLength(n);
    }
  });

  it("pool roles are dealt at most once each; Rookie fills the remaining seats (provisional)", () => {
    const roles = rolesOf(config(12, { deck: "starter" }));
    expect(roles.filter((x) => x === "lookout")).toHaveLength(1);
    expect(roles.filter((x) => x === "rookie")).toHaveLength(11);
  });

  it("small crews get a random subset of the pool", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 50; s++) {
      const roles = rolesOf(config(3, { seed: `s${s}`, rolePool: ["lookout", "fixer", "auditor"] }));
      expect(new Set(roles).size).toBe(3);
      for (const r of roles) seen.add(r);
    }
    // Rookies only fill (Balanced deals them last), so a 3-seat crew draws three of a four-role pool,
    // a different three across seeds.
    expect([...seen].sort()).toEqual(["auditor", "fixer", "lookout"]);
  });

  it("uniqueRoles false deals every seat from the deck with replacement, so roles may repeat; never two Moles or Embezzlers (design §8.1, §15; extension.md \"Truly random\")", () => {
    let repeated = false;
    for (let s = 0; s < 20; s++) {
      for (const deal of ["balanced", "random"] as const) {
        const roles = rolesOf(config(12, { seed: `rep-${s}`, deal, uniqueRoles: false }));
        expect(roles.filter((r) => r === MOLE_ROLE).length).toBeLessThanOrEqual(1);
        expect(roles.filter((r) => r === "mole").length).toBeLessThanOrEqual(1);
        if (new Set(roles.filter((r) => r !== "rookie")).size < roles.filter((r) => r !== "rookie").length) repeated = true;
      }
    }
    expect(repeated).toBe(true);
    // A pool of one: every seat gets it.
    expect(rolesOf(config(6, { rolePool: ["lookout"], uniqueRoles: false })).sort()).toEqual(Array(6).fill("lookout"));
    // Default (absent or true): each pool role at most once.
    for (const unique of [undefined, true]) {
      const roles = rolesOf(config(12, { rolePool: ["lookout"], ...(unique !== undefined && { uniqueRoles: unique }) }));
      expect(roles.filter((r) => r === "lookout")).toHaveLength(1);
    }
    expect(validateConfig(config(6, { uniqueRoles: "no" as unknown as boolean }))).toContain("uniqueRoles must be a boolean");
  });

  it("the host's role pool is respected", () => {
    const roles = rolesOf(config(3, { rolePool: ["auditor", "lookout"] }));
    expect(roles.sort()).toEqual(["auditor", "lookout", "rookie"]);
  });

  // extension.md "Decks": Standard is the default; the preset or the host's own picks.
  it("decks: Standard by default, Starter, Everything; host picks replace the preset", () => {
    expect(deckFor(config(8))).toEqual(STANDARD_ROLES);
    expect(deckFor(config(8, { deck: "starter" }))).toEqual(STARTER_ROLES);
    expect(deckFor(config(8, { deck: "everything" }))).toEqual(Object.keys(ROLES));
    expect(deckFor(config(8, { deck: "starter", rolePool: ["mole", "hacker"] }))).toEqual(["mole", "hacker"]);
    for (let s = 0; s < 20; s++) for (const r of rolesOf(config(10, { seed: `std-${s}` }))) expect([...STANDARD_ROLES, "rookie"]).toContain(r);
  });

  // extension.md "Host settings" (Balanced), Build notes start values.
  it("Balanced deals the fixed Lone wolf / Wildcard mix for the crew size (capped at the deck's one of each), the rest Team players", () => {
    for (let n = 3; n <= 12; n++) {
      const mix = BALANCED_MIX[n]!;
      for (let s = 0; s < 15; s++) {
        const roles = rolesOf(config(n, { seed: `bal-${n}-${s}`, deck: "everything", eventsEnabled: true }));
        expect(countTag(roles, "loneWolf"), `${n}p`).toBe(Math.min(mix.loneWolves, 1));
        expect(countTag(roles, "wildcard"), `${n}p`).toBe(Math.min(mix.wildcards, 1));
      }
    }
    expect(BALANCED_MIX[8]).toEqual({ loneWolves: 2, wildcards: 1 });
  });

  it("Balanced: a tag the deck can't fill goes to Team players", () => {
    // No Lone wolves in this deck.
    const roles = rolesOf(config(9, { rolePool: ["lookout", "hacker", "auditor", "detective", "fixer", "smoothTalker"] }));
    expect(countTag(roles, "loneWolf")).toBe(0);
    expect(countTag(roles, "wildcard")).toBe(BALANCED_MIX[9]!.wildcards);
  });

  // extension.md "Truly random": uniform from the eligible deck; any mix, at most one Mole.
  it("Truly random deals any mix, sometimes no Lone wolf at all", () => {
    const loneCounts = new Set<number>();
    for (let s = 0; s < 200; s++) {
      const roles = rolesOf(config(8, { seed: `rnd-${s}`, deal: "random", deck: "everything" }));
      loneCounts.add(countTag(roles, "loneWolf"));
      expect(roles.filter((r) => r === MOLE_ROLE).length).toBeLessThanOrEqual(1);
    }
    expect(loneCounts).toEqual(new Set([0, 1]));
  });

  it("the deal is shuffled across seats", () => {
    const fenceSeats = new Set<number>();
    for (let s = 0; s < 40; s++) fenceSeats.add(rolesOf(config(4, { seed: `seat${s}`, deck: "starter" })).indexOf("lookout"));
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

  it("rejects an unknown job and unknown or duplicate pool roles; any role may be toggled on (extension.md \"Decks\")", () => {
    expect(() => setupEvents(config(3, { job: "casino" }))).toThrow(/job/);
    expect(() => setupEvents(config(3, { rolePool: ["wizard"] }))).toThrow(/role/);
    expect(() => setupEvents(config(3, { rolePool: ["hacker", "hacker"] }))).toThrow(/duplicates/);
    expect(() => setupEvents(config(6, { rolePool: ["mole"] }))).not.toThrow();
  });

  it("rejects unknown deck, deal and role-list settings", () => {
    expect(validateConfig({ ...config(6), deck: "all" })).toEqual([expect.stringMatching(/deck/)]);
    expect(validateConfig({ ...config(6), deal: "fair" })).toEqual([expect.stringMatching(/deal/)]);
    expect(validateConfig({ ...config(6), roleList: "some" })).toEqual([expect.stringMatching(/roleList/)]);
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

  it("looks jobs up by own key only (toString, __proto__ are unknown jobs)", () => {
    for (const job of ["toString", "__proto__", "constructor"]) {
      expect(validateConfig({ ...config(6), job })).toEqual([`unknown job ${job}`]);
      expect(() => roomsFor(job, 6)).toThrow(/unknown job/);
    }
  });

  it("rejects non-boolean eventsEnabled / isBot and other wrong types", () => {
    expect(validateConfig({ ...config(6), eventsEnabled: 0 })).toEqual([expect.stringMatching(/eventsEnabled/)]);
    const players = config(3).players.map((p) => ({ ...p, isBot: "no" }));
    expect(validateConfig({ ...config(3), players })).toEqual([expect.stringMatching(/isBot/)]);
    expect(validateConfig({ ...config(3), seed: 42 })).toEqual(["seed must be a string"]);
    expect(validateConfig({ ...config(3), rolePool: "hacker" })).toEqual([expect.stringMatching(/rolePool/)]);
    expect(validateConfig({ ...config(3), players: "abc" })).toEqual(["players must be an array"]);
  });
});

describe("setup events and visibility — design §17.2", () => {
  it("emits gameCreated, rngSeeded, roomsSet, one roleDealt per seat, the role list, the shop, roundStarted, then rngAdvanced", () => {
    // No Mole, so no police schedule.
    const events = setupEvents(config(3, { rolePool: ["rookie", "lookout", "hacker"] }));
    expect(events.map((e) => e.type)).toEqual([
      "gameCreated",
      "rngSeeded",
      "roomsSet",
      "roleDealt",
      "roleDealt",
      "roleDealt",
      "roleListShown",
      "shopDealt",
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
    expect(setupEvents(config(9, { deal: "random" }))).toEqual(setupEvents(config(9, { deal: "random" })));
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
    expect(() => createGame(config(12, { deck: "everything", eventsEnabled: true }))).not.toThrow();
  });

  it("replaying the log rebuilds the same state, RNG included", () => {
    const cfg = config(7, { deck: "starter" });
    const state = createGame(cfg);
    const rebuilt = replay(cfg, JSON.parse(JSON.stringify(state.log)) as GameEvent[]);
    expect(rebuilt).toEqual(state);
    const full = config(9, { deck: "everything", eventsEnabled: true, roleList: "possible" });
    expect(replay(full, JSON.parse(JSON.stringify(createGame(full).log)) as GameEvent[])).toEqual(createGame(full));
  });

  it("rngSeeded sets the RNG from the seed; rngAdvanced replaces it", () => {
    const cfg = config(3);
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
