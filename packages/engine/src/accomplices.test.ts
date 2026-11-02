// Role deck v2 accomplices, step R3a (docs/roles-v2.md §2, §3): Getaway
// Driver, Fence, Hacker, the Mole's tip-off reward, what each learns about
// its allies (private `alliesLearned`), dealing by faction with the n ÷ 3 (rounded) cap,
// and the R1 follow-up (a Recharge never refills the Fence's safe). design §7, §8, §8.1, §8.3
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { ACCOMPLICE_V2_ROLES, BANK_JOB, ROLES, maxDarkSeats } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { privateTo } from "./types";
import { createGame, darkSideOdds, setupEvents } from "./setup";
import { replay } from "./reduce";
import { roundHeatDelta } from "./job";
import { viewFor } from "./view";
import { grantPerks } from "./perks.testkit";
import { V013_NUMBERS } from "./v01-numbers.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "r3a-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: ["rookie", "lookout"],
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...extra,
  };
}

/** Seat i gets roles[i] (Rookie if missing). Setup's own knowledge events are dropped (they were for the real deal). */
function game(players: number, roles: string[], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  const log = setupEvents(cfg)
    .filter((e) => e.type !== "alliesLearned" && e.type !== "moleAllies")
    .map((e, i, all): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[all.slice(0, i).filter((x) => x.type === "roleDealt").length] ?? "rookie" } : e));
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    const r = handleThroughAlibis(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const r = handleThroughAlibis(state, command);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}
const learned = (s: GameState, player?: string) =>
  s.log.filter((e): e is Extract<GameEvent, { type: "alliesLearned" }> => e.type === "alliesLearned" && (player === undefined || e.player === player));
const granted = (s: GameState, player: string) => s.log.filter((e) => e.type === "perkGranted" && e.player === player).map((e) => (e as { perk: string }).perk);
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const withHeat = (s: GameState, heat: number): GameState => ({ ...s, heat });
const withSafe = (s: GameState, id: string, safe: number, stash = 0): GameState => ({
  ...s,
  players: { ...s.players, [id]: { ...(s.players[id] as PlayerState), safe, stash } },
});

describe("accomplices: content and dealing — v2 §2, §3, design §8.1", () => {
  it("the Getaway Driver, Fence and Hacker are accomplices, each with one main number", () => {
    for (const id of ACCOMPLICE_V2_ROLES) expect(ROLES[id]?.faction, id).toBe("accomplice");
    // R5 (balance-3.md): reverse ×1 → ×0, its Rooftop visit cools nothing.
    expect(ROLES.getawayDriver?.power).toEqual({ kind: "getaway", room: "rooftop", reverse: 0, revealHeat: 75 });
    expect(ROLES.fence?.power).toEqual({ kind: "fenceSafe", perAct: 5, revealSafe: 10 });
    expect(ROLES.hacker).toMatchObject({ power: { kind: "loopCameras", perAct: 1 }, knowsSaboteurs: 1, rewards: [{ on: "loopHidSaboteur", perk: "peek", count: 1 }] });
  });

  it("never dealt without a saboteur: an accomplice-only pool with the setting off deals Rookies", () => {
    for (let i = 0; i < 10; i++) {
      const s = createGame(config(9, { seed: `off-${i}`, rolePool: [...ACCOMPLICE_V2_ROLES] }));
      expect(Object.values(s.players).map((p) => p.role)).toEqual(Array(9).fill("rookie"));
    }
  });

  it("the dark-seat cap (n ÷ 3 rounded, R5) trims the §3 weight table only at 7 and 9–10 players", () => {
    const mixes = (n: number) => darkSideOdds(n, "on", false).map((o) => `${o.saboteurs}/${o.accomplices}`);
    expect([4, 5, 6, 7, 8, 9, 10, 11, 12].map(maxDarkSeats)).toEqual([1, 2, 2, 2, 3, 3, 3, 4, 4]);
    expect(mixes(4)).toEqual(["1/0"]);
    expect(mixes(5)).toEqual(["1/0", "1/1"]); // R5: a 5-player game can deal an accomplice
    expect(mixes(6)).toEqual(["1/0", "1/1"]);
    expect(mixes(7)).toEqual(["1/1", "2/0", "1/1"]); // 1/2 → 1/1
    expect(mixes(8)).toEqual(["1/1", "2/0", "1/2"]);
    for (const n of [9, 10]) expect(mixes(n)).toEqual(["2/1", "1/2", "2/1"]); // 2/2 → 2/1
    expect(mixes(11)).toEqual(["2/2", "2/1", "3/1"]);
    expect(mixes(12)).toEqual(["2/2", "2/1", "3/1"]);
  });

  it("real deals stay within the cap and deal accomplices only with a saboteur", () => {
    for (const n of [5, 7, 9, 11, 12]) {
      for (let i = 0; i < 15; i++) {
        const s = createGame(config(n, { seed: `cap-${n}-${i}`, mole: "on", rolePool: [] }));
        const factions = Object.values(s.players).map((p) => ROLES[p.role]?.faction);
        const dark = factions.filter((f) => f !== "crew").length;
        expect(dark).toBeLessThanOrEqual(maxDarkSeats(n));
        if (factions.includes("accomplice")) expect(factions).toContain("saboteur");
      }
    }
  });
});

describe("Getaway Driver — v2 §2, design §7", () => {
  it("its Rooftop visit adds reverse × the Heat a visitor would remove, hidden in the round's total", () => {
    const heatOf = (role: string, extra: Partial<GameConfig> = {}) =>
      run(withHeat(game(3, [role], extra), 30), mv("p0", "rooftop"), mv("p1", "lobby"), mv("p2", "lobby"), ROUND).heat;
    expect(heatOf("rookie")).toBe(30 + roundHeatDelta(BANK_JOB, 3, { rooftop: 1, lobby: 2 }));
    // reverse ×1 (content 0.13.0): it adds what a visitor would remove.
    const x1 = { contentOverrides: V013_NUMBERS };
    expect(heatOf("getawayDriver", x1)).toBe(30 + roundHeatDelta(BANK_JOB, 3, { rooftop: -1, lobby: 2 }));
    expect(heatOf("getawayDriver", x1)).toBeGreaterThan(heatOf("rookie"));
    // reverse ×0 (R5): it cools nothing, as if it had stayed away.
    expect(heatOf("getawayDriver")).toBe(30 + roundHeatDelta(BANK_JOB, 3, { lobby: 2 }));
    expect(heatOf("getawayDriver")).toBeGreaterThan(heatOf("rookie"));
    // Elsewhere it plays like anyone.
    const lobby = run(withHeat(game(3, ["getawayDriver"]), 30), mv("p0", "lobby"), ROUND);
    expect(lobby.heat).toBe(30 + roundHeatDelta(BANK_JOB, 3, { lobby: 3 }));
  });

  it("Heat at 75 or more: it learns the saboteurs and they learn it, privately and once", () => {
    let s = withHeat(game(6, ["getawayDriver", "mole", "rookie", "mole"]), 72);
    s = run(s, mv("p0", "rooftop"), ROUND);
    expect(s.heat).toBeGreaterThanOrEqual(75);
    expect(learned(s).map((e) => [e.player, e.allies, e.via])).toEqual([
      ["p0", ["p1", "p3"], "getaway"],
      ["p1", ["p0"], "getaway"],
      ["p3", ["p0"], "getaway"],
    ]);
    expect(s.players.p1?.roleState.allies).toEqual(["p0"]);
    expect(viewFor(s, "p2").caseFile.some((l) => l.event.type === "alliesLearned")).toBe(false);
    expect(JSON.stringify(viewFor(s, "p2"))).not.toContain("getaway");
    s = run(s, ROUND);
    expect(learned(s)).toHaveLength(3);
  });

  it("below 75, or with no saboteur, nothing", () => {
    expect(learned(run(withHeat(game(6, ["getawayDriver", "mole"]), 50), ROUND))).toEqual([]);
    expect(learned(run(withHeat(game(6, ["getawayDriver"]), 80), ROUND))).toEqual([]);
  });

  it("a missed checkpoint's Heat penalty can trigger it too (design §11.5)", () => {
    let s = game(3, ["getawayDriver", "mole"]);
    s = run(s, ROUND, ROUND, ROUND);
    s = withHeat(s, 65);
    s = run(s, { type: "scheduleMeeting", act: 1, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } });
    s = run(s, (x: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: x.meeting?.id } }));
    const check = s.log.find((e) => e.type === "checkpointChecked");
    expect(check).toMatchObject({ met: false, heatPenalty: BANK_JOB.heat.missedCheckpoint });
    expect(learned(s).map((e) => e.player)).toEqual(["p0", "p1"]);
  });
});

describe("Fence — v2 §2, design §8", () => {
  it("its safe reaching 10 tells it one saboteur, once", () => {
    let s = withSafe(game(6, ["fence", "mole", "rookie", "mole"]), "p0", 9, 3);
    s = run(s, mv("p0", "lobby", 0, { ability: { kind: "fenceSafe", amount: 1 } }), ROUND);
    expect(s.players.p0?.safe).toBe(10);
    const told = learned(s, "p0");
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ via: "fence", visibility: privateTo("p0") });
    expect(["p1", "p3"]).toContain(told[0]?.allies[0]);
    expect(learned(s).filter((e) => e.player !== "p0")).toEqual([]); // the saboteur isn't told
    s = run(s, mv("p0", "lobby", 0, { ability: { kind: "fenceSafe", amount: 1 } }), ROUND);
    expect(learned(s, "p0")).toHaveLength(1);
  });

  it("below 10, nothing", () => {
    const s = run(withSafe(game(6, ["fence", "mole"]), "p0", 8, 3), mv("p0", "lobby", 0, { ability: { kind: "fenceSafe", amount: 1 } }), ROUND);
    expect(learned(s)).toEqual([]);
  });

  it("a Recharge never refills its per-act safe allowance (R1 follow-up, design §8.3)", () => {
    let s = grantPerks(withSafe(game(3, ["fence"]), "p0", 0, 6), "p0", "recharge");
    s = run(s, mv("p0", "lobby", 0, { ability: { kind: "fenceSafe", amount: 5 } }), ROUND);
    expect(s.players.p0?.roleState.usedThisAct).toBe(5);
    expect(reason(s, { type: "useAbility", player: "p0", ability: { kind: "recharge" } })).toMatch(/Fence's safe/);
    expect(s.players.p0?.roleState.perks).toEqual(["recharge"]);
    expect(reason(s, mv("p0", "lobby", 0, { ability: { kind: "fenceSafe", amount: 1 } }))).toMatch(/safe takes/);
  });
});

describe("Hacker — v2 §2, design §8", () => {
  it("is told one saboteur at the deal, privately (real deals)", () => {
    let seen = 0;
    for (let i = 0; i < 40 && seen < 3; i++) {
      const cfg = config(9, { seed: `hack-${i}`, mole: "on", rolePool: ["hacker", "lookout", "auditor", "bagman", "cleaner"] });
      const log = setupEvents(cfg);
      const s = createGame(cfg);
      const hacker = s.playerOrder.find((id) => s.players[id]?.role === "hacker");
      if (!hacker) continue;
      seen++;
      const saboteurs = s.playerOrder.filter((id) => s.players[id]?.role === "mole" || s.players[id]?.role === "embezzler");
      const told = log.filter((e) => e.type === "alliesLearned");
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ player: hacker, via: "deal", visibility: privateTo(hacker) });
      expect(saboteurs).toContain((told[0]?.type === "alliesLearned" ? told[0].allies : [])[0]);
      expect(viewFor(s, hacker).me.roleState.allies).toEqual((told[0]?.type === "alliesLearned" ? told[0].allies : []));
      for (const id of s.playerOrder) if (id !== hacker) expect(viewFor(s, id).caseFile.some((l) => l.event.type === "alliesLearned"), id).toBe(false);
    }
    expect(seen).toBe(3);
  });

  it("its loop hid a saboteur from a Security watcher → Peek", () => {
    const loop = { ability: { kind: "loopCameras", room: "vault" } };
    const s = run(game(4, ["hacker", "mole"]), mv("p0", "lobby", 0, loop), mv("p1", "vault", 3), { type: "submitMove", player: "p2", move: { room: "security", pocket: 0, watch: "vault" } }, ROUND);
    expect(s.log.find((e) => e.type === "roomWatched" && e.player === "p2")).toMatchObject({ room: "vault", seen: [] });
    expect(granted(s, "p0")).toEqual(["peek"]);
  });

  it("no Peek when nobody watched the room, or no saboteur was in it", () => {
    const loop = { ability: { kind: "loopCameras", room: "vault" } };
    const unwatched = run(game(4, ["hacker", "mole"]), mv("p0", "lobby", 0, loop), mv("p1", "vault", 3), ROUND);
    expect(granted(unwatched, "p0")).toEqual([]);
    const crewOnly = run(game(4, ["hacker", "mole"]), mv("p0", "lobby", 0, loop), mv("p3", "vault", 3), { type: "submitMove", player: "p2", move: { room: "security", pocket: 0, watch: "vault" } }, ROUND);
    expect(granted(crewOnly, "p0")).toEqual([]);
  });
});

describe("Mole: each tip-off names one accomplice it didn't know — v2 §2, design §8", () => {
  it("one per tip-off, never twice the same, nothing once all are known", () => {
    let s = game(9, ["mole", "fence", "hacker"]);
    const tip = (x: GameState) => run(x, mv("p0", "lobby", 0, { ability: { kind: "tipOff" } }), ROUND);
    s = tip(s);
    expect(learned(s, "p0").map((e) => e.via)).toEqual(["tipOff"]);
    const first = learned(s, "p0")[0]?.allies[0];
    expect(["p1", "p2"]).toContain(first);
    expect(learned(s).filter((e) => e.player !== "p0")).toEqual([]); // the accomplice isn't told
    s = run(s, ROUND, ROUND);
    s = run(s, { type: "scheduleMeeting", act: 1, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } });
    s = run(s, (x: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: x.meeting?.id } }));
    s = tip(s);
    expect(new Set(s.players.p0?.roleState.allies)).toEqual(new Set(["p1", "p2"]));
    const count = learned(s, "p0").length;
    s = run(s, ROUND, ROUND);
    s = run(s, { type: "scheduleMeeting", act: 2, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-2" } });
    s = run(s, (x: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: x.meeting?.id } }));
    if (s.phase.kind === "planning") expect(learned(tip(s), "p0")).toHaveLength(count);
  });
});

describe("Double-cross keeps what a player learned — design §10 (provisional)", () => {
  it("a swap elsewhere doesn't wipe a Mole's learned accomplice", () => {
    let s = game(6, ["mole", "fence", "rookie", "lookout"]);
    s = run(s, mv("p0", "lobby", 0, { ability: { kind: "tipOff" } }), ROUND);
    expect(s.players.p0?.roleState.allies).toEqual(["p1"]);
    s = { ...s, card: { round: s.round, id: "doubleCross", room: null, offer: { players: ["p2", "p3"], accepted: ["p2", "p3"] } } };
    s = run(s, ROUND);
    expect(s.players.p2?.role).toBe("lookout");
    expect(s.players.p0?.roleState.allies).toEqual(["p1"]);
  });
});

describe("PR #32 QA: who a loop must fool, and the Driver's reveal around a Double-cross — v2 §2, design §8, §10", () => {
  const loop = { kind: "loopCameras", room: "vault" };
  const watchVault = (player: string, extra: object = {}) => ({ type: "submitMove", player, move: { room: "security", pocket: 0, watch: "vault", ...extra } });

  it("no Peek for fooling its own Security watch (QA bug 1), nor a saboteur's", () => {
    const self = run(game(4, ["hacker", "mole"]), watchVault("p0", { ability: loop }), mv("p1", "vault", 2), ROUND);
    expect(self.log.find((e) => e.type === "roomWatched" && e.player === "p0")).toMatchObject({ seen: [] });
    expect(granted(self, "p0")).toEqual([]);
    const mole = run(game(6, ["hacker", "mole", "mole"]), mv("p0", "lobby", 0, { ability: loop }), mv("p1", "vault", 2), watchVault("p2"), ROUND);
    expect(granted(mole, "p0")).toEqual([]);
    // A crew watcher next to it still counts.
    const both = run(game(4, ["hacker", "mole"]), watchVault("p0", { ability: loop }), mv("p1", "vault", 2), watchVault("p2"), ROUND);
    expect(granted(both, "p0")).toEqual(["peek"]);
  });

  const swap = (s: GameState, a: string, b: string): GameState =>
    run({ ...s, card: { round: s.round, id: "doubleCross", room: null, offer: { players: [a, b], accepted: [a, b] } } }, ROUND);

  it("the reveal tells the saboteurs as they are at that moment: a Mole swapped in before it learns the Driver, one swapped in after doesn't", () => {
    // Before: p1's Mole card goes to p2, then Heat runs high.
    let s = swap(game(6, ["getawayDriver", "mole", "rookie"]), "p1", "p2");
    s = run(withHeat(s, 74), mv("p0", "rooftop"), ROUND);
    expect(learned(s).map((e) => [e.player, e.allies])).toEqual([["p0", ["p2"]], ["p2", ["p0"]]]);
    // After: the reveal happened, then the Mole card moves on; nobody is re-told.
    const after = swap(s, "p2", "p3");
    expect(after.players.p3?.role).toBe("mole");
    expect(learned(after)).toHaveLength(2);
    expect(after.players.p3?.roleState.allies).toEqual([]);
    expect(after.players.p2?.roleState.allies).toEqual(["p0"]); // what p2 learned stays with p2
    expect(after.players.p0?.roleState.allies).toEqual(["p2"]);
  });

  it("dark players swapping with crew: the old holder keeps what it learned, the new holder gets none of it, nobody else is told", () => {
    let s = game(9, ["mole", "fence", "hacker", "rookie", "lookout"]);
    s = { ...s, players: { ...s.players, p2: { ...(s.players.p2 as PlayerState), roleState: { ...(s.players.p2 as PlayerState).roleState, allies: ["p0"] } } } };
    s = run(s, mv("p0", "lobby", 0, { ability: { kind: "tipOff" } }), ROUND);
    const tipped = [...(s.players.p0?.roleState.allies ?? [])];
    expect(tipped).toHaveLength(1);
    const before = s.log.length;
    s = swap(s, "p0", "p3");
    s = swap(s, "p2", "p4");
    expect([s.players.p3?.role, s.players.p4?.role]).toEqual(["mole", "hacker"]);
    expect(s.players.p0?.roleState.allies).toEqual(tipped);
    expect(s.players.p3?.roleState.allies).toEqual([]);
    expect(s.players.p4?.roleState.allies).toEqual([]);
    expect(s.log.slice(before).filter((e) => e.type === "moleAllies" || e.type === "alliesLearned")).toEqual([]);
  });
});
