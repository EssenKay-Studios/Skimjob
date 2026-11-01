// QA for role deck v2 R3a (PR #32): accomplices, what the dark side learns,
// the win rule with accomplices, dealing caps, Double-cross, hostile values.
// design §3, §7, §8, §8.1, §10 (v2 §2, §3)
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { BANK_JOB, ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { privateTo } from "./types";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { roundHeatDelta } from "./job";
import { viewFor } from "./view";
import { outcomeFor } from "./end";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "r3a-qa",
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
/** Seat i gets roles[i] (Rookie if missing); setup's knowledge events dropped. */
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
const refused = (s: GameState, command: unknown) => !handleThroughAlibis(s, command).ok;
const learned = (s: GameState, player?: string) =>
  s.log.filter((e): e is Extract<GameEvent, { type: "alliesLearned" }> => e.type === "alliesLearned" && (player === undefined || e.player === player));
const peeks = (s: GameState, player: string) => s.log.filter((e) => e.type === "perkGranted" && e.player === player).length;
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const withHeat = (s: GameState, heat: number): GameState => ({ ...s, heat });
const setP = (s: GameState, id: string, patch: Partial<PlayerState>): GameState => ({ ...s, players: { ...s.players, [id]: { ...(s.players[id] as PlayerState), ...patch } } });
const faction = (role: string) => ROLES[role]?.faction ?? "crew";

describe("QA win rule with accomplices — design §3 (v2 §0)", () => {
  // p0 Fence (accomplice), p1 Mole, p2/p3 crew; the Fence has the biggest stash + safe.
  const base = () => setP(setP(setP(game(4, ["fence", "mole", "rookie", "lookout"]), "p0", { stash: 2, safe: 20 }), "p1", { stash: 10 }), "p2", { stash: 15 });
  it("failure: the best saboteur-or-accomplice wins (an accomplice can beat the Mole; safe counts)", () => {
    expect(outcomeFor(base(), "heat").winners).toEqual(["p0"]);
    expect(outcomeFor(setP(base(), "p1", { stash: 30 }), "target").winners).toEqual(["p1"]);
  });
  it("success: no accomplice or saboteur wins, however big its stash", () => {
    expect(outcomeFor(base(), null).winners).toEqual(["p2"]);
  });
  it("a Getaway Driver's Rooftop Heat that triggers the raid fails the heist: the dark side wins, the reveal still lands", () => {
    let s = setP(withHeat(game(3, ["getawayDriver", "mole"]), 99), "p0", { stash: 5 });
    s = run(s, mv("p0", "rooftop"), mv("p1", "lobby"), mv("p2", "lobby"), ROUND);
    expect(s.phase.kind).toBe("ended");
    const out = s.phase.kind === "ended" ? s.phase.outcome : null;
    expect(out).toMatchObject({ result: "failed", winners: ["p0"] });
    expect(learned(s).map((e) => e.player)).toEqual(["p0", "p1"]);
  });
});

describe("QA dealing and dealt knowledge at 6–12 players — design §8.1 (v2 §3)", () => {
  it("never more than ⌊n/3⌋ dark, accomplices only with a saboteur; at the deal only the Hacker knows one saboteur and the saboteurs know only each other", () => {
    let hackers = 0;
    for (let n = 6; n <= 12; n++) {
      for (let i = 0; i < 12; i++) {
        const cfg = config(n, { seed: `deal-${n}-${i}`, mole: i % 3 === 0 ? "maybe" : "on", rolePool: [], uniqueRoles: i % 4 !== 1, eventsEnabled: i % 2 === 0 });
        const s = createGame(cfg);
        const roleOf = (id: string) => (s.players[id] as PlayerState).role;
        const fs = s.playerOrder.map((id) => faction(roleOf(id)));
        expect(fs.filter((f) => f !== "crew").length, `${n}/${i}`).toBeLessThanOrEqual(Math.floor(n / 3));
        if (fs.includes("accomplice")) expect(fs).toContain("saboteur");
        const sabs = s.playerOrder.filter((id) => faction(roleOf(id)) === "saboteur");
        for (const id of s.playerOrder) {
          const allies = (s.players[id] as PlayerState).roleState.allies;
          const r = roleOf(id);
          if (faction(r) === "saboteur") expect(new Set(allies)).toEqual(new Set(sabs.filter((x) => x !== id)));
          else if (r === "hacker" && sabs.length > 0) {
            hackers++;
            expect(allies).toHaveLength(1);
            expect(sabs).toContain(allies[0]);
          } else expect(allies, `${n}/${i} ${id} ${r}`).toEqual([]);
        }
      }
    }
    expect(hackers).toBeGreaterThan(0);
  });
});

describe("QA Getaway Driver — v2 §2, design §7", () => {
  it("reveal boundary: Heat ending at 74 → nothing; exactly 75 → reveal", () => {
    const delta = roundHeatDelta(BANK_JOB, 6, { lobby: 6 });
    const at = (end: number) => learned(run(withHeat(game(6, ["getawayDriver", "mole"]), end - delta), ROUND));
    expect(at(74)).toEqual([]);
    expect(at(75).map((e) => e.player)).toEqual(["p0", "p1"]);
  });

  it("its Rooftop Heat is hidden: a crew player's view differs from a Rookie-on-the-Rooftop game only in the Heat number", () => {
    const viewAfter = (role: string) => {
      const s = run(withHeat(game(4, [role]), 20), mv("p0", "rooftop"), mv("p1", "lobby"), mv("p2", "vault"), mv("p3", "lobby"), ROUND);
      return JSON.stringify(viewFor(s, "p3")).replace(/"heat":-?\d+/g, '"heat":H').replace(/"heatDelta":-?\d+/g, '"heatDelta":D');
    };
    expect(viewAfter("getawayDriver")).toBe(viewAfter("rookie"));
  });

  it("with a Cleaner also on the Rooftop, the Driver still adds Heat (counts stack)", () => {
    const heat = (roles: string[]) => run(withHeat(game(4, roles), 30), mv("p0", "rooftop"), mv("p1", "rooftop"), mv("p2", "lobby"), mv("p3", "lobby"), ROUND).heat;
    expect(heat(["getawayDriver", "cleaner"])).toBe(30 + roundHeatDelta(BANK_JOB, 4, { rooftop: -1 + 2, lobby: 2 }));
    expect(heat(["getawayDriver", "cleaner"])).toBeGreaterThan(heat(["rookie", "cleaner"]));
  });
});

describe("QA Hacker loop vs Security, Lookout, Power cut — design §8, §10", () => {
  const loop = { ability: { kind: "loopCameras", room: "vault" } };
  it("a Lookout's extra room isn't fooled by the loop, and earns the Hacker no Peek", () => {
    const s = run(game(4, ["hacker", "mole", "lookout"]), mv("p0", "lobby", 0, loop), mv("p1", "vault", 2), mv("p2", "lobby", 0, { ability: { kind: "lookout", rooms: ["vault"] } }), ROUND);
    expect(s.log.find((e) => e.type === "roomWatched" && e.player === "p2" && e.source === "lookout")).toMatchObject({ room: "vault", seen: ["p1"] });
    expect(peeks(s, "p0")).toBe(0);
  });
  it("in a Power cut nothing is watched, so no Peek", () => {
    let s = game(4, ["hacker", "mole"], { eventsEnabled: true });
    s = { ...s, card: { round: s.round, id: "powerCut", room: null, offer: null } };
    s = run(s, mv("p0", "lobby", 0, loop), mv("p1", "vault", 2), { type: "submitMove", player: "p2", move: { room: "security", pocket: 0, watch: "vault" } }, mv("p3", "lobby"), ROUND);
    expect(s.log.some((e) => e.type === "roomWatched")).toBe(false);
    expect(peeks(s, "p0")).toBe(0);
  });
  it("two Security watchers on the looped room: both see it empty, one Peek", () => {
    const sec = (p: string) => ({ type: "submitMove", player: p, move: { room: "security", pocket: 0, watch: "vault" } });
    const s = run(game(5, ["hacker", "mole"]), mv("p0", "lobby", 0, loop), mv("p1", "vault", 2), sec("p2"), sec("p3"), mv("p4", "vault"), ROUND);
    for (const p of ["p2", "p3"]) expect(s.log.find((e) => e.type === "roomWatched" && e.player === p)).toMatchObject({ seen: [] });
    expect(peeks(s, "p0")).toBe(1);
  });
});

describe("QA Double-cross with the dark side — design §10 (v2 §2, provisional)", () => {
  const swap = (s: GameState, a: string, b: string) => run({ ...s, card: { round: s.round, id: "doubleCross", room: null, offer: { players: [a, b], accepted: [a, b] } } }, ROUND);
  it("Hacker ↔ crew: the ex-Hacker keeps its saboteur, the new Hacker knows nobody, the Mole is untouched", () => {
    let s = game(6, ["hacker", "mole", "rookie", "mole"]);
    s = replay(s.config, [...s.log.filter((e) => e.type !== "roundStarted"), { type: "alliesLearned", visibility: privateTo("p0"), player: "p0", allies: ["p1"], via: "deal" }, ...s.log.filter((e) => e.type === "roundStarted")]);
    s = swap(s, "p0", "p2");
    expect(s.players.p2?.role).toBe("hacker");
    expect(s.players.p0?.roleState.allies).toEqual(["p1"]);
    expect(s.players.p2?.roleState.allies).toEqual([]);
    expect(new Set(s.players.p1?.roleState.allies)).toEqual(new Set(["p3"]));
  });
  it("Mole ↔ crew after the Driver reveal: the other Mole gets new mates plus the Driver; the new Mole gets its mate", () => {
    // p0 Mole, p1 Mole, p2 Driver, p3 crew.
    let s = withHeat(game(6, ["mole", "mole", "getawayDriver", "rookie"]), 80);
    s = replay(s.config, [...s.log.filter((e) => e.type !== "roundStarted"), { type: "moleAllies", visibility: privateTo("p0"), player: "p0", allies: ["p1"] }, { type: "moleAllies", visibility: privateTo("p1"), player: "p1", allies: ["p0"] }, ...s.log.filter((e) => e.type === "roundStarted")]);
    s = run(withHeat(s, 80), ROUND);
    expect(new Set(s.players.p1?.roleState.allies)).toEqual(new Set(["p0", "p2"]));
    s = swap(s, "p0", "p3");
    expect(s.players.p3?.role).toBe("mole");
    expect(new Set(s.players.p1?.roleState.allies)).toEqual(new Set(["p3", "p2"]));
    expect(s.players.p3?.roleState.allies).toEqual(["p1"]);
    expect(s.players.p0?.roleState.allies).toContain("p2"); // learned stays with the player
    // Views stay consistent: allies known ⊆ what the case file told them.
    for (const id of s.playerOrder) {
      const v = viewFor(s, id);
      const told = new Set<string>();
      for (const { event: e } of v.caseFile) {
        if (e.type === "moleAllies" || e.type === "alliesLearned") e.allies.forEach((a) => told.add(a));
        if (e.type === "doubleCrossResolved" && e.swap) e.swap.roleState.allies.forEach((a) => told.add(a));
      }
      for (const a of v.me.roleState.allies) expect(told, `${id} knows ${a}`).toContain(a);
    }
  });
  it("Driver ↔ crew after its reveal: the new Driver is revealed next round (Heat still ≥ 75)", () => {
    let s = run(withHeat(game(6, ["getawayDriver", "mole", "rookie"]), 80), ROUND);
    expect(learned(s, "p0")).toHaveLength(1);
    s = swap(withHeat(s, 80), "p0", "p2");
    expect(s.players.p2?.role).toBe("getawayDriver");
    const fresh = learned(s).filter((e) => e.player === "p2" || e.allies.includes("p2"));
    expect(fresh.map((e) => [e.player, e.allies])).toEqual([["p2", ["p1"]], ["p1", ["p2"]]]);
  });
});

describe("QA hostile values — design §17.4", () => {
  it("bad override values for the new numbers are refused at setup", () => {
    const bad = [
      { getawayDriver: { revealHeat: -1 } },
      { getawayDriver: { reverse: 1.5 } },
      { getawayDriver: { revealHeat: "75" } },
      { getawayDriver: { reverse: Number.NaN } },
      { fence: { revealSafe: Number.POSITIVE_INFINITY } },
      { fence: { revealHeat: 5 } }, // not the Fence's number
      { hacker: { revealSafe: 1 } },
    ];
    for (const roles of bad) expect(() => createGame(config(6, { contentOverrides: { roles } as never })), JSON.stringify(roles)).toThrow(/invalid game config/);
  });
  it("the Driver's power isn't a move ability; other roles can't borrow accomplice abilities", () => {
    const s = game(4, ["getawayDriver", "rookie", "fence"]);
    expect(refused(s, mv("p0", "rooftop", 0, { ability: { kind: "getaway" } }))).toBe(true);
    expect(refused(s, mv("p0", "lobby", 0, { ability: { kind: "loopCameras", room: "vault" } }))).toBe(true);
    expect(refused(s, mv("p1", "lobby", 0, { ability: { kind: "fenceSafe", amount: 1 } }))).toBe(true);
    for (const amount of [-1, 0.5, "1", Number.NaN, 1e9]) expect(refused(s, mv("p2", "lobby", 0, { ability: { kind: "fenceSafe", amount } })), String(amount)).toBe(true);
  });
});

describe("QA determinism with the dark side — CLAUDE.md engine rules", () => {
  it("same seed + same commands → identical log (tip-off, Fence, Driver reveals drawing from the RNG)", () => {
    const play = () => {
      let s = setP(withHeat(game(9, ["mole", "fence", "hacker", "getawayDriver", "mole"]), 74), "p1", { stash: 6, safe: 5 });
      s = run(s, mv("p0", "lobby", 0, { ability: { kind: "tipOff" } }), mv("p1", "lobby", 0, { ability: { kind: "fenceSafe", amount: 5 } }), mv("p3", "rooftop"), ROUND);
      s = run(s, ROUND);
      return s.log;
    };
    const a = play();
    expect(a.filter((e) => e.type === "alliesLearned").map((e) => (e as { via: string }).via).sort()).toEqual(["fence", "getaway", "getaway", "getaway", "tipOff"]);
    expect(JSON.stringify(play())).toBe(JSON.stringify(a));
  });
});
