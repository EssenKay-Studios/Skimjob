// QA for PR #43 (R5): the dark-seat cap is n ÷ 3 rounded (⌊(n + 1) ÷ 3⌋), so 5
// players can deal an accomplice. Real deals over many seeds at 2, 3, 5, 6, 7,
// 11 and 12 players: never over the cap, never an accomplice without a
// saboteur, never more than saboteurs + 1 accomplices. design §8.1 (roles-v2 §3)
import { describe, expect, it } from "vitest";
import { DARK_SIDE_LIMITS, maxDarkSeats } from "@skimjob/content";
import type { GameConfig, GameEvent, MoleSetting } from "./types";
import { createGame, darkSideOdds, limitDarkSide } from "./setup";
import { factionIn, rolesFor } from "./overrides";

const config = (n: number, seed: string, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed,
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isBot: true })),
  job: "bank",
  rolePool: [],
  mole: "on",
  eventsEnabled: true,
  voteVisibility: "hiddenThenRevealed",
  starterMode: false,
  ...extra,
});

const roles = rolesFor({});
/** The dealt dark side, from the real roleDealt events. */
function dealt(c: GameConfig): { saboteurs: number; accomplices: number } {
  const log = createGame(c).log as readonly GameEvent[];
  const deal = log.filter((e): e is Extract<GameEvent, { type: "roleDealt" }> => e.type === "roleDealt");
  expect(deal).toHaveLength(c.players.length);
  return {
    saboteurs: deal.filter((e) => factionIn(roles, e.role) === "saboteur").length,
    accomplices: deal.filter((e) => factionIn(roles, e.role) === "accomplice").length,
  };
}

const saboteurRoles = Object.keys(roles).filter((r) => factionIn(roles, r) === "saboteur").length;
const CAP: Record<number, number> = { 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 2, 8: 3, 9: 3, 10: 3, 11: 4, 12: 4 };
const SEEDS = 250;

describe("R5 dark-seat cap n ÷ 3 rounded — design §8.1", () => {
  it("maxDarkSeats is n ÷ 3 rounded to the nearest at 2–12 (and matches the table)", () => {
    for (let n = 2; n <= 12; n++) {
      expect(maxDarkSeats(n), `n=${n}`).toBe(Math.round(n / 3));
      expect(maxDarkSeats(n), `n=${n}`).toBe(CAP[n]);
    }
    expect(DARK_SIDE_LIMITS.seatRounding).toBe(1);
  });

  it("limitDarkSide: no accomplices without a saboteur, ≤ saboteurs + 1 accomplices, ≤ cap, at every count and every mix up to 6/6", () => {
    for (let n = 2; n <= 12; n++) {
      for (let s = 0; s <= 6; s++) {
        for (let a = 0; a <= 6; a++) {
          const r = limitDarkSide(n, { saboteurs: s, accomplices: a });
          expect(r.saboteurs + r.accomplices).toBeLessThanOrEqual(CAP[n]!);
          expect(r.accomplices).toBeLessThanOrEqual(r.saboteurs + DARK_SIDE_LIMITS.accomplicesOverSaboteurs);
          if (r.saboteurs === 0) expect(r.accomplices).toBe(0);
          expect(r.saboteurs).toBeLessThanOrEqual(s);
          expect(r.accomplices).toBeLessThanOrEqual(a);
        }
      }
    }
  });

  for (const n of [2, 3, 5, 6, 7, 11, 12]) {
    for (const mole of ["on", "maybe"] as MoleSetting[]) {
      it(`${n} players, saboteur setting ${mole}: ${SEEDS} real deals respect every limit`, () => {
        const seen = new Set<string>();
        for (let i = 0; i < SEEDS; i++) {
          const d = dealt(config(n, `r5-deal-${n}-${mole}-${i}`, { mole }));
          seen.add(`${d.saboteurs}/${d.accomplices}`);
          expect(d.saboteurs + d.accomplices, `seed ${i}`).toBeLessThanOrEqual(CAP[n]!);
          expect(d.accomplices).toBeLessThanOrEqual(d.saboteurs + 1);
          if (d.saboteurs === 0) expect(d.accomplices).toBe(0);
          expect(d.saboteurs).toBeLessThanOrEqual(saboteurRoles);
        }
        // Every deal seen is one the odds list (the odds and the deal agree).
        const odds = new Set(darkSideOdds(n, mole, false).filter((o) => o.chance > 0).map((o) => `${o.saboteurs}/${o.accomplices}`));
        for (const mix of seen) expect(odds.has(mix), `${mix} not in ${[...odds]}`).toBe(true);
        if (n <= 3) expect([...seen]).toEqual(["0/0"]);
        if (n === 5 && mole === "on") expect([...seen].sort()).toEqual(["1/0", "1/1"]); // the lifted 5-player cut
        if (n === 5 && mole === "maybe") expect([...seen].sort()).toEqual(["0/0", "1/0", "1/1"]);
        if (n === 6 && mole === "on") expect([...seen].sort()).toEqual(["1/0", "1/1"]);
        if (n === 7 && mole === "on") expect([...seen].sort()).toEqual(["1/1", "2/0"]); // 1/2 is cut to 1/1 at a cap of 2
        // A cap of 4 lets 2/2 through (⌊n ÷ 3⌋ = 3 cut it to 2/1 at 11). The 3/1 row becomes 2/1: only
        // two saboteur roles exist and saboteurs are distinct, so the third seat goes to the crew.
        if (n === 11 || n === 12) expect([...seen].sort()).toEqual(["2/1", "2/2"]);
      });
    }
  }

  it("5 players deals 1/1 about half the time with the saboteur setting on (odds 50/50)", () => {
    const odds = darkSideOdds(5, "on", false);
    expect(odds.map((o) => [o.saboteurs, o.accomplices, o.chance])).toEqual([
      [1, 0, 0.5],
      [1, 1, 0.5],
    ]);
    let both = 0;
    for (let i = 0; i < 400; i++) if (dealt(config(5, `r5-five-${i}`)).accomplices === 1) both++;
    expect(both).toBeGreaterThan(160);
    expect(both).toBeLessThan(240);
  });

  it("there are exactly two saboteur roles (so 3-saboteur rows are capped by the pool)", () => {
    expect(saboteurRoles).toBe(2);
  });

  it("off, starter mode and Duel (2 players) deal crew only", () => {
    for (let i = 0; i < 50; i++) {
      for (const n of [5, 7, 12]) {
        expect(dealt(config(n, `r5-off-${i}`, { mole: "off" }))).toEqual({ saboteurs: 0, accomplices: 0 });
        expect(dealt(config(n, `r5-starter-${i}`, { starterMode: true, mole: "off", eventsEnabled: false }))).toEqual({ saboteurs: 0, accomplices: 0 });
      }
      expect(dealt(config(2, `r5-duel-${i}`, { duel: true }))).toEqual({ saboteurs: 0, accomplices: 0 });
    }
  });

  it("a role pool with no accomplices: 5 players still deal at most 1 dark seat (the saboteur), the rest crew", () => {
    const crewOnly = ["rookie", "lookout", "bagman", "cleaner", "insideMan", "auditor", "detective"];
    for (let i = 0; i < 100; i++) {
      const d = dealt(config(5, `r5-crewpool-${i}`, { rolePool: crewOnly.filter((r) => roles[r] !== undefined) }));
      expect(d).toEqual({ saboteurs: 1, accomplices: 0 });
    }
  });
});
