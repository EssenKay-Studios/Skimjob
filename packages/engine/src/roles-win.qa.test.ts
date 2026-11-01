// QA (PR #13): Auditor and Mole through every real ending (success, missed final
// target, raid mid-round, raid at a checkpoint), ties between Moles and others,
// tip-off edges (refusals write nothing, re-submits, per-act limits, overrides),
// Mole dealing per player count, a counterfactual Mole-deal leak check and
// determinism. design §3, §8, §8.1
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { V06_NUMBERS } from "./v01-numbers.testkit";
import { MOLE_ROLE } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, MoleSetting, Outcome, PlayerId, PlayerState } from "./types";
import { darkSideOdds, moleAllies, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "qa-win",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: ["rookie", "lookout", "fence", "auditor"], // no Muscle window, no Snitch
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...extra,
  };
}

/** Seat i gets roles[i] (Lookout if missing: plain scoring, so ties are exact). */
function game(players: number, roles: string[], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  let seat = 0;
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "lookout" } : e)));
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const cmd = typeof c === "function" ? c(s) : c;
    const r = handleThroughAlibis(s, cmd);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(cmd)}: ${r.reason}`);
    return r.state;
  }, state);
}
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const TIP = { ability: { kind: "tipOff" } };
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const OPEN = (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const SCHED = (s: GameState) => ({ type: "scheduleMeeting", act: Math.ceil(s.round / 3), slot: "x" });

type Patch = Partial<Pick<PlayerState, "stash" | "timesShakenDown" | "totalHandedIn">>;
const withPlayers = (s: GameState, patch: Record<PlayerId, Patch>): GameState => ({
  ...s,
  players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, ...(patch[id] ?? {}) }])),
});
/** Every player into `room`, pocket 0 (equal hand-ins, so the tie-breaks stay level). */
const allIn = (s: GameState, room = "lobby"): Cmd[] => s.playerOrder.map((id) => mv(id, room));
/** Play rounds and meetings (checkpoints met, Heat held at 0) up to the final meeting, open. */
function toFinalMeeting(s: GameState): GameState {
  for (let act = 1; act <= 3; act++) {
    for (let r = 0; r < 3; r++) s = run({ ...s, heat: 0 }, ...allIn(s), ROUND);
    s = run({ ...s, haul: 10_000, heat: 0 }, SCHED, OPEN);
    if (act < 3) s = run(s, CLOSE);
  }
  return s;
}
const outcome = (s: GameState): Outcome => {
  if (s.phase.kind !== "ended") throw new Error(`not ended (${s.phase.kind})`);
  return s.phase.outcome;
};
const sorted = (ids: readonly PlayerId[]) => [...ids].sort();

// p0 Mole, p1 Auditor, p2 Lookout, p3 Lookout.
const ROLES4 = ["mole", "auditor", "lookout", "lookout"];

describe("success at the final meeting — design §3", () => {
  const ending = (patch: Record<PlayerId, Patch>, roles = ROLES4) => {
    const s = toFinalMeeting(game(roles.length, roles));
    return outcome(run(withPlayers({ ...s, haul: 10_000 }, patch), CLOSE));
  };

  it("a top-stash Mole is ranked first but never wins; the best non-Mole does", () => {
    const o = ending({ p0: { stash: 50 }, p1: { stash: 10 }, p2: { stash: 20 } });
    expect(o.result).toBe("success");
    expect(o.ranking[0]?.player).toBe("p0");
    expect(o.winners).toEqual(["p2"]);
  });

  it("a Mole tied with a Lookout on every tie-break: the Lookout wins alone", () => {
    expect(ending({ p0: { stash: 20 }, p2: { stash: 20 } }).winners).toEqual(["p2"]);
  });

  it("a Mole ahead on tie-breaks over two tied non-Moles: they share it", () => {
    const o = ending({ p0: { stash: 20 }, p2: { stash: 20, timesShakenDown: 1 }, p3: { stash: 20, timesShakenDown: 1 } });
    expect(o.ranking[0]?.player).toBe("p0");
    expect(sorted(o.winners)).toEqual(["p2", "p3"]);
  });

  it("the Auditor wins a success with the top score; a lower Auditor doesn't", () => {
    expect(ending({ p0: { stash: 5 }, p1: { stash: 30 }, p2: { stash: 20 } }).winners).toEqual(["p1"]);
    expect(ending({ p1: { stash: 10 }, p2: { stash: 20 } }).winners).toEqual(["p2"]);
  });

  it("two Moles at 9 players never win a success", () => {
    const roles = ["mole", "mole", "auditor"];
    const o = ending({ p0: { stash: 40 }, p1: { stash: 40 }, p2: { stash: 3 }, p5: { stash: 7 } }, [...roles, ...Array(6).fill("lookout")]);
    expect(o.winners).toEqual(["p5"]);
  });
});

describe("missed final target — design §3, §8", () => {
  it("only the Mole(s) win; a top-stash Auditor gets nothing", () => {
    const s = toFinalMeeting(game(5, ["mole", "auditor", "mole", "lookout", "lookout"]));
    const o = outcome(run(withPlayers({ ...s, haul: 0 }, { p1: { stash: 99 } }), CLOSE));
    expect(o).toMatchObject({ result: "failed", reason: "target" });
    expect(sorted(o.winners)).toEqual(["p0", "p2"]);
  });

  it("with no Mole dealt, nobody wins a missed target, Auditor included", () => {
    const s = toFinalMeeting(game(3, ["auditor", "lookout", "lookout"]));
    expect(outcome(run(withPlayers({ ...s, haul: 0 }, { p0: { stash: 99 } }), CLOSE)).winners).toEqual([]);
  });
});

describe("Heat raid mid-round — design §3, §7, §8", () => {
  const raid = (roles: string[], patch: Record<PlayerId, Patch>) => {
    const s = withPlayers({ ...game(roles.length, roles), heat: 99 }, patch);
    const after = run(s, ...allIn(s, "vault"), ROUND);
    expect(after.log.some((e) => e.type === "copsRaided")).toBe(true);
    const o = outcome(after);
    expect(o).toMatchObject({ result: "failed", reason: "heat" });
    return o;
  };

  it("Auditor tied with the Mole on every tie-break: only the Mole wins (the Auditor is crew, role deck v2 R1)", () => {
    expect(raid(ROLES4, { p0: { stash: 10 }, p1: { stash: 10 } }).winners).toEqual(["p0"]);
  });

  it("Auditor level on stash but shaken down more than the Mole: only the Mole wins", () => {
    expect(raid(ROLES4, { p0: { stash: 10 }, p1: { stash: 10, timesShakenDown: 1 } }).winners).toEqual(["p0"]);
  });

  it("Auditor level with a Lookout on top: the crew can't win a failure; the Mole does (design §3)", () => {
    expect(raid(ROLES4, { p1: { stash: 10 }, p2: { stash: 10 } }).winners).toEqual(["p0"]);
  });

  it("no saboteur dealt: nobody wins a Heat failure, a top-stash Auditor included (design §3)", () => {
    expect(raid(["auditor", "lookout", "lookout"], { p0: { stash: 5 } }).winners).toEqual([]);
    expect(raid(["auditor", "lookout", "lookout"], { p1: { stash: 5 } }).winners).toEqual([]);
  });
});

describe("Heat raid at a checkpoint — design §3, §11.4", () => {
  it("a missed Act 1 checkpoint pushes Heat to 100: the Mole with the bigger stash wins, not the top Auditor (design §3)", () => {
    const roles = ["mole", "auditor", "mole", ...Array(6).fill("lookout")];
    let s = game(9, roles);
    for (let r = 0; r < 3; r++) s = run({ ...s, heat: 0 }, ...allIn(s), ROUND);
    s = run(withPlayers({ ...s, haul: 0, heat: 85 }, { p1: { stash: 12 }, p0: { stash: 11 } }), SCHED, OPEN, CLOSE);
    expect(s.log.some((e) => e.type === "copsRaided")).toBe(true);
    const o = outcome(s);
    expect(o).toMatchObject({ result: "failed", reason: "heat" });
    expect(o.winners).toEqual(["p0"]);
  });
});

describe("tip-off edges — design §8", () => {
  const mole3 = () => game(3, ["mole", "auditor", "lookout"]);

  it("a refused tip-off writes nothing (no event anyone could see), for a Mole and a non-Mole alike", () => {
    const used = run(mole3(), mv("p0", "lobby", 0, TIP), ROUND);
    for (const [s, p] of [[used, "p0"], [mole3(), "p1"], [mole3(), "p2"]] as const) {
      const r = handleThroughAlibis(s, mv(p, "lobby", 0, TIP));
      expect(r.ok).toBe(false);
      expect(r).not.toHaveProperty("events");
      expect(r).not.toHaveProperty("state");
    }
  });

  it("re-submitting without the tip-off in the same round drops it; the Mole can still use it later this act", () => {
    const s0 = mole3();
    const s = run(s0, mv("p0", "lobby", 0, TIP), mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby"), ROUND);
    const plain = run(s0, mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby"), ROUND);
    expect(s.heat).toBe(plain.heat);
    expect(s.players.p0?.roleState.usedThisAct).toBe(0);
    expect(s.log.some((e) => e.type === "abilityResolved")).toBe(false);
    expect(() => run(s, mv("p0", "lobby", 0, TIP))).not.toThrow();
  });

  it("a Mole that misses its move doesn't tip off", () => {
    const s = run(mole3(), mv("p1", "lobby"), mv("p2", "lobby"), ROUND);
    expect(s.players.p0?.roleState.usedThisAct).toBe(0);
    expect(s.log.some((e) => e.type === "abilityResolved")).toBe(false);
  });

  it("round 3 and round 4 are different acts: a tip-off in each is allowed", () => {
    let s = run(mole3(), ROUND, ROUND, mv("p0", "lobby", 0, TIP), ROUND);
    s = run(s, SCHED, OPEN, CLOSE, mv("p0", "lobby", 0, TIP), ROUND);
    expect(s.log.filter((e) => e.type === "abilityResolved" && e.ability.kind === "tipOff").map((e) => (e as { round: number }).round)).toEqual([3, 4]);
  });

  it("two Moles tipping off in one round add both, and only each Mole hears of its own", () => {
    // Pins the 0.6.0 tip-off (+10; balance pass 2 made it +6).
    const s0 = game(4, ["mole", "mole", "lookout", "lookout"], { contentOverrides: V06_NUMBERS });
    const plain = run(s0, ...allIn(s0), ROUND);
    const tipped = run(s0, mv("p0", "lobby", 0, TIP), mv("p1", "lobby", 0, TIP), mv("p2", "lobby"), mv("p3", "lobby"), ROUND);
    expect(tipped.heat - plain.heat).toBe(20);
    expect(viewFor(tipped, "p0").caseFile.filter((l) => l.event.type === "abilityResolved")).toHaveLength(1);
    expect(viewFor(tipped, "p2").caseFile.filter((l) => l.event.type === "abilityResolved")).toHaveLength(0);
  });

  it("a perAct override of 2 allows two tip-offs an act, refuses a third", () => {
    let s = game(3, ["mole"], { contentOverrides: { roles: { mole: { perAct: 2 } } } });
    s = run(s, mv("p0", "lobby", 0, TIP), ROUND, mv("p0", "lobby", 0, TIP), ROUND);
    expect(handleThroughAlibis(s, mv("p0", "lobby", 0, TIP))).toMatchObject({ ok: false });
  });

  it("tip-off override fields are refused on other roles, and perAct 0 is refused", () => {
    expect(validateConfig(config(3, { contentOverrides: { roles: { driver: { heat: 5 } } } }))).not.toEqual([]);
    expect(validateConfig(config(3, { contentOverrides: { roles: { lookout: { heat: 5 } } } }))).not.toEqual([]);
    expect(validateConfig(config(3, { contentOverrides: { roles: { mole: { perAct: 0 } } } }))).not.toEqual([]);
  });

  it("Heat stays capped at 100 when a tip-off overshoots", () => {
    const s = run({ ...mole3(), heat: 98 }, mv("p0", "vault", 0, TIP), mv("p1", "vault"), mv("p2", "vault"), ROUND);
    expect(s.heat).toBe(100);
  });
});

describe("Mole dealing — design §8.1", () => {
  const SETTINGS: MoleSetting[] = ["off", "maybe", "on"];
  const expected = (n: number, m: MoleSetting): number[] =>
    // design §8.1 (role deck v2 §3): a saboteur from 4 players; "maybe" is 0 or 1 at 4–8, like "on" at 9–12.
    // Counted as saboteurs (min 1): since R3b the Mole or the Embezzler, each at most once.
    m === "off" || n <= 3 ? [0] : m === "maybe" && n <= 8 ? [0, 1] : [1];

  it("Mole options per player count and setting, 2–12; starter mode never deals one", () => {
    for (let n = 2; n <= 12; n++) {
      for (const m of SETTINGS) {
        const moles = [...new Set(darkSideOdds(n, m, false).map((o) => Math.min(1, o.saboteurs)))].sort();
        expect(moles, `${n}p ${m}`).toEqual(expected(n, m));
        expect(darkSideOdds(n, m, true)).toEqual([{ saboteurs: 0, accomplices: 0, chance: 1 }]);
      }
    }
  });

  it("dealt Mole counts match, and 'maybe' reaches both counts at 4, 6 and 8 players", () => {
    for (const n of [2, 4, 5, 6, 8, 9, 10, 12]) {
      for (const m of SETTINGS) {
        const seen = new Set<number>();
        for (let i = 0; i < 24; i++) {
          const ev = setupEvents(config(n, { mole: m, rolePool: [], seed: `deal-${n}-${m}-${i}` }));
          seen.add(Math.min(1, ev.filter((e) => e.type === "roleDealt" && (e.role === MOLE_ROLE || e.role === "embezzler")).length));
        }
        const want = expected(n, m);
        for (const c of seen) expect(want, `${n}p ${m}`).toContain(c);
        if (m === "maybe" && (n === 4 || n === 6 || n === 8)) expect([...seen].sort()).toEqual(want);
      }
    }
  });

  it("the Mole can't be put in the role pool, and starter mode refuses a Mole setting", () => {
    expect(validateConfig(config(6, { rolePool: ["rookie", MOLE_ROLE] }))).not.toEqual([]);
    expect(validateConfig(config(6, { starterMode: true, rolePool: [], mole: "on" }))).not.toEqual([]);
  });
});

/**
 * The shipped Mole rules deal at most one Mole (design §8.1, owner answers 1 Nov).
 * For content that deals two: `cfg`'s setup with a second seat (not a Snitch)
 * turned Mole and the `moleAllies` setup would then emit.
 */
function withTwoMoles(cfg: GameConfig): GameEvent[] {
  // Since R3b the setting may deal an Embezzler beside the Mole: it is made a Mole here, and the setup's own moleAllies dropped.
  const events = setupEvents(cfg)
    .filter((e) => e.type !== "moleAllies")
    .map((e): GameEvent => (e.type === "roleDealt" && e.role === "embezzler" ? { ...e, role: MOLE_ROLE } : e));
  const dealt = events.filter((e): e is Extract<GameEvent, { type: "roleDealt" }> => e.type === "roleDealt");
  const already = dealt.filter((e) => e.role === MOLE_ROLE).length;
  const extra = already === 2 ? undefined : dealt.find((e) => e.role !== MOLE_ROLE && e.role !== "snitch");
  if ((!extra && already !== 2) || already < 1 || already > 2) throw new Error("withTwoMoles needs one or two saboteurs dealt");
  const roles = dealt.map((e) => (e === extra ? MOLE_ROLE : e.role));
  const swapped = events.map((e): GameEvent => (e === extra ? { ...extra, role: MOLE_ROLE } : e));
  const at = swapped.indexOf(swapped.filter((e) => e.type === "roleDealt").at(-1) as GameEvent) + 1;
  return [...swapped.slice(0, at), ...moleAllies(cfg, roles), ...swapped.slice(at)];
}

describe("counterfactual: who the Moles are never shows in another player's view — design §8.1, §17.2", () => {
  it("12 players: a non-Mole's views match those of the same game with the two Moles swapped for Lookouts", () => {
    const cfg = config(12, { mole: "on" });
    const real = withTwoMoles(cfg);
    const moles = real.flatMap((e) => (e.type === "roleDealt" && e.role === MOLE_ROLE ? [e.player] : []));
    expect(moles).toHaveLength(2);
    expect(real.filter((e) => e.type === "moleAllies")).toHaveLength(2);
    const noMoles = real.filter((e) => e.type !== "moleAllies").map((e): GameEvent => (e.type === "roleDealt" && e.role === MOLE_ROLE ? { ...e, role: "lookout" } : e));
    let a = replay(cfg, real);
    let b = replay(cfg, noMoles);
    const viewers = a.playerOrder.filter((id) => !moles.includes(id));
    const same = () => {
      for (const v of viewers) expect(JSON.stringify(viewFor(a, v)), v).toBe(JSON.stringify(viewFor(b, v)));
    };
    same();
    const script: Cmd[] = [...allIn(a, "vault"), ROUND, ...allIn(a), ROUND, ...allIn(a), ROUND, SCHED, OPEN, CLOSE];
    for (const c of script) {
      a = run(a, c);
      b = run(b, c);
      same();
    }
  });
});

describe("determinism with Moles — design §17.2", () => {
  it("same seed and commands (tip-offs included) give the same log, and replay rebuilds the state", () => {
    const play = () => {
      const cfg = config(9, { mole: "on", rolePool: [] });
      let s = replay(cfg, setupEvents(cfg));
      for (let r = 0; r < 3; r++) {
        s = run(s, ...s.playerOrder.map((id) => mv(id, "lobby", 0, s.players[id]?.role === MOLE_ROLE && r === 1 ? TIP : {})), ROUND);
      }
      return s;
    };
    const a = play();
    const b = play();
    expect(b.log).toEqual(a.log);
    expect(a.log.filter((e) => e.type === "abilityResolved" && e.ability.kind === "tipOff")).toHaveLength(1);
    expect(replay(a.config, a.log)).toEqual(a);
  });
});
