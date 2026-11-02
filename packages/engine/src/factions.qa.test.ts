// QA (PR #25, role deck v2 R1): dealing at every crew size × saboteur setting ×
// uniqueRoles × starter/Duel, with the shipped roles and with an R3-like table
// (accomplices, three saboteurs); and the win rule's ties across factions.
// design §3, §8.1 (docs/roles-v2.md §0, §3)
import { describe, expect, it } from "vitest";
import { ROLES, maxDarkSeats, type RoleDef, type RoleId } from "@skimjob/content";
import type { GameConfig, GameState, MoleSetting, PlayerState } from "./types";
import { createGame, darkSideOdds, dealRoles } from "./setup";
import { seedRng } from "./rng";
import { factionIn, type RoleTable } from "./overrides";
import { outcomeFor } from "./end";

const SETTINGS: readonly MoleSetting[] = ["off", "maybe", "on"];

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "faction-qa",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    mole: "on",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...extra,
  };
}

const as = (role: RoleId, faction: RoleDef["faction"], id: RoleId = role): RoleDef => ({ ...(ROLES[role] as RoleDef), id, faction });
/** R3-like: two accomplices in the pool, three saboteurs. */
const TABLE: RoleTable = {
  ...ROLES,
  fence: as("fence", "accomplice"),
  hacker: as("hacker", "accomplice"),
  embezzler: as("mole", "saboteur", "embezzler"),
  thirdSab: as("mole", "saboteur", "thirdSab"),
};

function check(dealt: readonly RoleId[], n: number, table: RoleTable, mole: MoleSetting, starter: boolean) {
  const count = (f: RoleDef["faction"]) => dealt.filter((r) => factionIn(table, r) === f).length;
  const [sab, acc] = [count("saboteur"), count("accomplice")];
  expect(dealt).toHaveLength(n);
  expect(sab + acc).toBeLessThanOrEqual(maxDarkSeats(n));
  if (sab === 0) expect(acc).toBe(0);
  expect(acc).toBeLessThanOrEqual(sab + 1);
  if (mole === "off" || starter || n <= 3) expect(sab + acc).toBe(0);
  // "on" always deals at least one saboteur from 4 players; "maybe" too from 9.
  if (!starter && n >= 4 && (mole === "on" || (mole === "maybe" && n >= 9))) expect(sab).toBeGreaterThanOrEqual(1);
  const sabs = dealt.filter((r) => factionIn(table, r) === "saboteur");
  expect(new Set(sabs).size).toBe(sabs.length);
  return `${sab}/${acc}`;
}

describe("QA: dealing, the full matrix — design §8.1", () => {
  it("shipped roles via createGame: 2–12 × off/maybe/on × uniqueRoles; starter; Duel", () => {
    for (let n = 2; n <= 12; n++) {
      for (const mole of SETTINGS) {
        for (const uniqueRoles of [true, false]) {
          for (let i = 0; i < 6; i++) {
            const s: GameState = createGame(config(n, { mole, uniqueRoles, seed: `m-${n}-${mole}-${uniqueRoles}-${i}` }));
            check(s.playerOrder.map((id) => (s.players[id] as PlayerState).role), n, ROLES, mole, false);
          }
        }
        const starter = createGame(config(n, { starterMode: true, mole: "off", seed: `st-${n}` }));
        check(starter.playerOrder.map((id) => (starter.players[id] as PlayerState).role), n, ROLES, "off", true);
      }
    }
    for (const mole of SETTINGS) {
      for (let i = 0; i < 10; i++) {
        const s = createGame(config(2, { duel: true, mole, seed: `duel-${mole}-${i}` }));
        const roles = s.playerOrder.map((id) => (s.players[id] as PlayerState).role);
        check(roles, 2, ROLES, mole, false);
        for (const r of roles) expect(["muscle", "smoothTalker", "snitch"]).not.toContain(r);
      }
    }
  });

  it("R3-like table: limits hold everywhere, with and without uniqueRoles; 11–12p reach 3/1 (R5 cap), 10p never does", () => {
    const seen = new Map<number, Set<string>>();
    for (let n = 2; n <= 12; n++) {
      seen.set(n, new Set());
      for (const mole of SETTINGS) {
        for (const uniqueRoles of [true, false]) {
          for (let i = 0; i < 40; i++) {
            const seed = `t-${n}-${mole}-${uniqueRoles}-${i}`;
            const dealt = dealRoles(config(n, { mole, uniqueRoles, seed, rolePool: ["rookie", "lookout", "fence", "hacker", "snitch"] }), seedRng(seed), TABLE).value;
            seen.get(n)?.add(check(dealt, n, TABLE, mole, false));
          }
        }
      }
    }
    expect(seen.get(12)).toContain("3/1");
    expect(seen.get(11)).toContain("3/1"); // R5: 11 ÷ 3 rounded = 4 seats (⌊11/3⌋ = 3 cut it to 3/0)
    expect(seen.get(10)).not.toContain("3/1");
    expect([...(seen.get(5) ?? [])].sort()).toEqual(["0/0", "1/0", "1/1"]); // R5: 5 ÷ 3 rounded = 2 seats
  });

  it("the odds sum to 1 at every size and setting, and stay inside the limits", () => {
    for (let n = 2; n <= 12; n++) {
      for (const mole of SETTINGS) {
        for (const starter of [false, true]) {
          const odds = darkSideOdds(n, mole, starter);
          expect(odds.reduce((t, o) => t + o.chance, 0)).toBeCloseTo(1, 9);
          for (const o of odds) {
            expect(o.saboteurs + o.accomplices).toBeLessThanOrEqual(maxDarkSeats(n));
            expect(o.accomplices).toBeLessThanOrEqual(o.saboteurs === 0 ? 0 : o.saboteurs + 1);
          }
        }
      }
    }
  });
});

describe("QA: win rule, ties across factions — design §3 (role deck v2 §0)", () => {
  /** A 6-seat game with chosen roles and stashes (no other tie-break differences). */
  const ended = (roles: RoleId[], stashes: number[]): GameState => {
    const s = createGame(config(6, { mole: "off" }));
    const players = Object.fromEntries(s.playerOrder.map((id, i) => [id, { ...(s.players[id] as PlayerState), role: roles[i] as RoleId, stash: stashes[i] as number }]));
    return { ...s, players, haul: 10_000 };
  };
  const roles = ["mole", "fence", "lookout", "lookout", "lookout", "lookout"];

  it("failure: a saboteur and an accomplice tied on top share the win; crew above them get nothing", () => {
    const s = ended(roles, [10, 10, 30, 0, 0, 0]);
    for (const reason of ["heat", "target"] as const) expect([...outcomeFor(s, reason, TABLE).winners].sort()).toEqual(["p0", "p1"]);
  });

  it("failure: the accomplice alone, when it beats the saboteur", () => {
    expect(outcomeFor(ended(roles, [5, 12, 30, 0, 0, 0]), "heat", TABLE).winners).toEqual(["p1"]);
  });

  it("success: a dark seat tied with the top crew seat never shares it; tied crew seats do", () => {
    const s = ended(roles, [30, 30, 30, 30, 0, 0]);
    expect([...outcomeFor(s, null, TABLE).winners].sort()).toEqual(["p2", "p3"]);
  });

  it("failure with no dark side dealt: nobody, whatever the stashes", () => {
    const s = ended(["lookout", "lookout", "lookout", "lookout", "lookout", "lookout"], [10, 10, 30, 0, 0, 0]);
    expect(outcomeFor(s, "heat", TABLE).winners).toEqual([]);
    expect(outcomeFor(s, "target", TABLE).winners).toEqual([]);
    expect(outcomeFor(s, null, TABLE).winners).toEqual(["p2"]);
  });
});
