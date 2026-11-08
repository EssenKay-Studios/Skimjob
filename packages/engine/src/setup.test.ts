// Deterministic setup: rooms by player count, dealing roles, RNG on replay.
// design §3.1, §11.3, §16, §17.2 (the deal itself: roles.test.ts)
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameConfig, GameEvent } from "./types";
import { canSee } from "./types";
import { createGame, dealRoles, roomsFor, setupEvents, validateConfig } from "./setup";
import { applyEvent, initialState, replay } from "./reduce";
import { seedRng } from "./rng";

function config(players: number, overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "test-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i > 0 })),
    job: "bank",
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

  it("9–12 players: adds Manager's office too (8) (design §3.1)", () => {
    for (const n of [9, 10, 11, 12]) {
      expect(roomsFor("bank", n)).toEqual([...CORE, "depositBoxes", "serverRoom", "managersOffice"]);
    }
  });

  it("the game state holds the rooms for its crew size", () => {
    expect(createGame(config(6)).rooms).toHaveLength(7);
  });
});

describe("dealing roles — design §11.3", () => {
  it("every seat gets exactly one role", () => {
    for (let n = 3; n <= 12; n++) {
      const state = createGame(config(n));
      expect(Object.keys(state.players).sort()).toEqual(state.playerOrder.slice().sort());
      expect(state.log.filter((e) => e.type === "roleDealt")).toHaveLength(n);
    }
  });

  it("dealRoles is pure: the same config and RNG deal the same roles and leave the same RNG", () => {
    const cfg = config(11);
    expect(dealRoles(cfg, seedRng("x"))).toEqual(dealRoles(cfg, seedRng("x")));
    expect(dealRoles(cfg, seedRng("x")).value).toHaveLength(11);
  });

  it("the deal is shuffled across seats", () => {
    const lookoutSeats = new Set<number>();
    // At 10 players every role is dealt once (design §11.3), so the Lookout's seat shows the shuffle.
    for (let s = 0; s < 40; s++) lookoutSeats.add(rolesOf(config(10, { seed: `seat${s}` })).indexOf("lookout"));
    expect(lookoutSeats.size).toBeGreaterThan(5);
    expect(lookoutSeats.has(-1)).toBe(false);
  });
});

describe("config validation — design §1, §15", () => {
  it("rejects fewer than 3 or more than 12 players", () => {
    expect(() => setupEvents(config(2))).toThrow();
    expect(() => setupEvents(config(13))).toThrow();
  });

  it("rejects duplicate or empty player ids", () => {
    const dup = config(3);
    expect(() => setupEvents({ ...dup, players: [dup.players[0]!, dup.players[0]!, dup.players[1]!] })).toThrow(/unique/);
    expect(() => setupEvents({ ...dup, players: [{ id: "", name: "x", isBot: false }, ...dup.players.slice(1)] })).toThrow();
  });

  it("rejects an unknown job", () => {
    expect(() => setupEvents(config(3, { job: "casino" }))).toThrow(/job/);
  });

  it("rejects an unknown role-list setting (design §11.3)", () => {
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
    expect(validateConfig({ ...config(3), players: "abc" })).toEqual(["players must be an array"]);
  });
});

describe("setup events and visibility — design §17.2", () => {
  it("emits gameCreated, rngSeeded, roomsSet, bankFilled, one roleDealt per seat, the role list, the shop, roundStarted, then rngAdvanced", () => {
    const events = setupEvents(config(3));
    expect(events.map((e) => e.type)).toEqual([
      "gameCreated",
      "rngSeeded",
      "roomsSet",
      "bankFilled",
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
    expect(setupEvents(config(9))).toEqual(setupEvents(config(9)));
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
    expect(() => createGame(config(12, { eventsEnabled: true }))).not.toThrow();
  });

  it("replaying the log rebuilds the same state, RNG included", () => {
    const cfg = config(7);
    const state = createGame(cfg);
    const rebuilt = replay(cfg, JSON.parse(JSON.stringify(state.log)) as GameEvent[]);
    expect(rebuilt).toEqual(state);
    const full = config(9, { eventsEnabled: true, roleList: "possible" });
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

  it("after setup, round 1 is open for planning — design §4.1, §3.2", () => {
    const state = createGame(config(3));
    expect(state.phase).toEqual({ kind: "planning", round: 1 });
    expect(state.round).toBe(1);
  });
});
