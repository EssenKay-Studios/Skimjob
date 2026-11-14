// QA for the Learn the game ruleset (design §14, §19.2 seam 3): crew-size
// boundaries of the deal, bad ruleset values, content overrides on top of the
// ruleset's numbers, determinism and viewFor leaks.
import { MAX_ROLE_COPIES, ROLES, type RoleId } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import { createGame, setupEvents, validateConfig } from "./setup";
import { jobFor } from "./overrides";
import { viewFor } from "./view";
import type { GameConfig } from "./types";

const LEARN_ROLES = ["detective", "hacker", "locksmith", "lookout"];
const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i > 0 }));
const learn = (seed: string, n = 4, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed,
  players: seats(n),
  job: "bank",
  ruleset: "learn",
  eventsEnabled: true,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});

describe("Learn ruleset deal at every crew size it allows — design §11.3, §14", () => {
  it("accepts 3 to 8 players and refuses 9 to 12 (two roles of each kind, at most two copies)", () => {
    for (let n = 3; n <= 8; n++) expect(validateConfig(learn("ok", n)), `${n}`).toEqual([]);
    for (let n = 9; n <= 12; n++) expect(validateConfig(learn("no", n)), `${n}`).toContain(`the ruleset's roles can't deal ${n} players`);
  });

  it("deals only the four Learn roles, balanced by kind, never past the copy cap (3, 5, 7, 8 players)", () => {
    for (const n of [3, 5, 7, 8]) {
      for (let i = 0; i < 25; i++) {
        const state = createGame(learn(`deal-${n}-${i}`, n));
        const dealt = state.playerOrder.map((p) => state.players[p]!.role as RoleId);
        expect(dealt.every((r) => LEARN_ROLES.includes(r)), `${n}/${i}`).toBe(true);
        const counts = new Map<string, number>();
        for (const r of dealt) counts.set(r, (counts.get(r) ?? 0) + 1);
        expect(Math.max(...counts.values()), `${n}/${i}`).toBeLessThanOrEqual(MAX_ROLE_COPIES);
        const eyes = dealt.filter((r) => ROLES[r]!.kind === "eyes").length;
        expect(Math.abs(eyes - (n - eyes)), `${n}/${i}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("sizes the bank by crew: 10 coins a player at 3 and at 8", () => {
    expect(createGame(learn("b3", 3)).bank).toBe(30);
    expect(createGame(learn("b8", 8)).bank).toBe(80);
  });
});

describe("bad ruleset values — design §19.2 seam 3", () => {
  it("refuses non-string, empty, wrong-case and inherited names without throwing", () => {
    for (const ruleset of [5, null, true, {}, "", "constructor", "toString", "hasOwnProperty", "Learn"]) {
      const errors = validateConfig({ ...learn("x"), ruleset });
      expect(errors.some((e) => e.startsWith("unknown ruleset")), String(ruleset)).toBe(true);
    }
  });
});

describe("content overrides on top of the ruleset — design §17.4, §19.2", () => {
  it("a config override of the round cap and bank beats the ruleset's numbers", () => {
    const c = learn("ov", 4, { contentOverrides: { roundCap: 3, bank: { coinsPerPlayer: 7 } } });
    expect(validateConfig(c)).toEqual([]);
    expect(jobFor(c).roundCap).toBe(3);
    expect(createGame(c).bank).toBe(28);
  });

  it("an override of only the round cap keeps the ruleset's bank", () => {
    const c = learn("ov2", 4, { contentOverrides: { roundCap: 4 } });
    expect(jobFor(c).roundCap).toBe(4);
    expect(createGame(c).bank).toBe(40);
  });
});

describe("determinism and visibility — CLAUDE.md engine rules, design §18", () => {
  it("same seed, same setup events", () => {
    expect(setupEvents(learn("same"))).toEqual(setupEvents(learn("same")));
  });

  it("with events off or on, a Learn game sets up the same (its deck is empty either way)", () => {
    const strip = (c: GameConfig) => setupEvents(c).map((e) => (e.type === "gameCreated" ? { ...e, eventsEnabled: null } : e));
    expect(strip(learn("ev", 4, { eventsEnabled: false }))).toEqual(strip(learn("ev")));
  });

  it("each seat sees its own role only, and everyone sees the ruleset", () => {
    const state = createGame(learn("leak"));
    for (const me of state.playerOrder) {
      const view = viewFor(state, me);
      expect(view.me.role).toBe(state.players[me]!.role);
      expect(view.ledger.find((x) => x.event.type === "gameCreated")!.event).toMatchObject({ ruleset: "learn" });
      // No roleDealt for another seat anywhere in the view.
      const dealtTo: string[] = [];
      JSON.stringify(view, (_k, v: unknown) => {
        if (v && typeof v === "object" && (v as { type?: unknown }).type === "roleDealt") dealtTo.push((v as { player: string }).player);
        return v;
      });
      expect(dealtTo.every((p) => p === me), me).toBe(true);
    }
  });
});
