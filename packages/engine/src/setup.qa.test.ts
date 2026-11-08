// QA (PR #2): adversarial tests for seeded RNG, setup and replay.
// design §3.1, §11.3, §16, §17.2
import { describe, expect, it } from "vitest";
import { ROLES, type RoleId } from "@skimjob/content";
import type { GameConfig, GameEvent } from "./types";
import { canSee } from "./types";
import { createGame, roomsFor, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { nextUint32, seedRng } from "./rng";


function config(players: number, overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "qa-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i > 0 })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const roles = (cfg: GameConfig): RoleId[] => Object.values(createGame(cfg).players).map((p) => p.role);
const count = (list: readonly string[], x: string): number => list.filter((r) => r === x).length;

describe("QA determinism — design §17.2", () => {
  it("same config gives identical events and state at 3, 8, 12 players; config and content untouched", () => {
    const rolesBefore = JSON.stringify(ROLES);
    for (const n of [3, 8, 12]) {
      const cfg = deepFreeze(config(n));
      const events = setupEvents(cfg);
      expect(setupEvents(JSON.parse(JSON.stringify(cfg)) as GameConfig)).toEqual(events);
      expect(createGame(cfg)).toEqual(createGame(cfg));
    }
    expect(JSON.stringify(ROLES)).toBe(rolesBefore);
  });

  it("different seeds (even one character apart) give different RNG states", () => {
    const finals = new Set<string>();
    for (let s = 0; s < 200; s++) finals.add(JSON.stringify(createGame(config(12, { seed: `seed-${s}` })).rng));
    expect(finals.size).toBe(200);
    expect(setupEvents(config(12, { seed: "ab" })).at(-1)).not.toEqual(setupEvents(config(12, { seed: "ba" })).at(-1));
  });
});

describe("QA replay rebuilds identical state, RNG included — design §17.2", () => {
  it("replaying a JSON round-tripped log equals the live state at 3, 5, 9, 12 players", () => {
    for (const n of [3, 5, 9, 12]) {
      const cfg = config(n, { seed: `replay-${n}` });
      const live = createGame(cfg);
      const rebuilt = replay(cfg, JSON.parse(JSON.stringify(live.log)) as GameEvent[]);
      expect(rebuilt).toEqual(live);
      // The next draw after replay is the same draw the live game would make.
      expect(nextUint32(rebuilt.rng)).toEqual(nextUint32(live.rng));
    }
  });

  it("the RNG after setup has moved on from the seed, and a prefix replay stops at the seed", () => {
    const cfg = config(6);
    const live = createGame(cfg);
    expect(live.rng).not.toEqual(seedRng(cfg.seed));
    const seededAt = live.log.findIndex((e) => e.type === "rngSeeded");
    expect(replay(cfg, live.log.slice(0, seededAt + 1)).rng).toEqual(seedRng(cfg.seed));
  });
});

describe("QA rooms by player count — design §3.1", () => {
  it("3/4 → 5 rooms, 5/8 → 7, 9/12 → 8; roomsSet is public and matches state", () => {
    const expected: Record<number, number> = { 3: 5, 4: 5, 5: 7, 8: 7, 9: 8, 12: 8 };
    for (const [n, size] of Object.entries(expected).map(([k, v]) => [Number(k), v] as const)) {
      const state = createGame(config(n));
      expect(state.rooms).toHaveLength(size);
      expect(new Set(state.rooms).size).toBe(size);
      expect(state.rooms).toEqual(roomsFor("bank", n));
      const roomsSet = state.log.find((e) => e.type === "roomsSet");
      expect(roomsSet).toMatchObject({ visibility: { kind: "public" }, rooms: state.rooms });
    }
  });
});

describe("QA role dealing — design §11.3", () => {
  it("invariants for every size 3–12, many seeds: one role a seat, at most two copies, two only at 11–12", () => {
    for (let n = 3; n <= 12; n++) {
      for (let s = 0; s < 15; s++) {
        const dealt = roles(config(n, { seed: `inv-${n}-${s}` }));
        expect(dealt).toHaveLength(n);
        for (const r of dealt) expect(Object.keys(ROLES)).toContain(r);
        for (const r of Object.keys(ROLES)) expect(count(dealt, r)).toBeLessThanOrEqual(n <= 10 ? 1 : 2);
      }
    }
  });
});

describe("QA config validation — design §1, §16", () => {
  it("accepts exactly 3 and exactly 12; rejects 2 and 13", () => {
    expect(validateConfig(config(3))).toEqual([]);
    expect(validateConfig(config(12, { roleList: "hidden" }))).toEqual([]);
    expect(() => setupEvents(config(2))).toThrow(/players/);
    expect(() => setupEvents(config(0))).toThrow(/players/);
    expect(() => setupEvents(config(13))).toThrow(/players/);
  });

  it("rejects duplicate ids even when names differ", () => {
    const cfg = config(3);
    const players = [cfg.players[0]!, { ...cfg.players[0]!, name: "Someone else" }, cfg.players[2]!];
    expect(() => setupEvents({ ...cfg, players })).toThrow(/unique/);
  });
});

describe("QA RNG state is never in a player's view — design §17.2", () => {
  it("no event visible to any seat during the game carries a seed or RNG words", () => {
    for (const n of [3, 12]) {
      const cfg = config(n);
      const log = createGame(cfg).log;
      for (const viewer of cfg.players.map((p) => p.id)) {
        for (const e of log.filter((ev) => canSee(ev.visibility, viewer, false))) {
          expect(Object.keys(e)).not.toContain("seed");
          expect(Object.keys(e)).not.toContain("words");
        }
      }
      // Reveal-only, so they open up only after the game (design §13).
      const revealed = log.filter((e) => canSee(e.visibility, "p0", true)).map((e) => e.type);
      expect(revealed).toEqual(expect.arrayContaining(["rngSeeded", "rngAdvanced"]));
    }
  });
});
