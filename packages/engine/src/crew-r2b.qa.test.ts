// QA for role deck v2 R2b (PR #30): boundaries and interplay of the seven new
// crew roles, with tokens for rewards (extension.md "Roles", "Tokens and the
// perk shop"). design §7, §8, §8.1, §10, §11.1, §11.3, §16.1
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { BANK_JOB, STARTER_ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { createGame, rolePoolFor, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { roundHeatDelta } from "./job";
import { viewFor } from "./view";
import { privateTo } from "./types";
import { grantPerks } from "./perks.testkit";

const SEVEN = ["smoothTalker", "muscle", "priest", "bagman", "cleaner", "fixer", "mastermind"];

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "r2b-qa",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [...STARTER_ROLES],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}
/** Seat i gets roles[i] (Rookie if missing). */
function game(players: number, roles: string[], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  const log = setupEvents(cfg).map((e, i, all): GameEvent => {
    if (e.type !== "roleDealt") return e;
    return { ...e, role: roles[all.slice(0, i).filter((x) => x.type === "roleDealt").length] ?? "rookie" };
  });
  return replay(cfg, log);
}
const withStash = (s: GameState, id: string, stash: number): GameState => ({
  ...s,
  players: { ...s.players, [id]: { ...(s.players[id] as PlayerState), stash } },
});
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
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const granted = (s: GameState, player: string) => ofType(s.log, "tokenEarned").filter((e) => e.player === player).map((e) => e.trigger);
const since = (before: GameState, after: GameState) => after.log.slice(before.log.length);
const mv = (player: string, room: string, pocket = 0) => ({ type: "submitMove", player, move: { room, pocket } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
/** Resolve a waiting shakedown nobody cancels (the shop may hold a Shield). */
const settle = (s: GameState): GameState => (s.phase.kind === "shakedownPending" ? run(s, RESOLVE) : s);
const use = (player: string, ability: object) => ({ type: "useAbility", player, ability });
const emergency = (s: GameState, caller: string, meetingId = `emergency-${caller}`) =>
  run(s, { type: "callEmergency", player: caller }, { type: "advance", deadline: { kind: "openMeeting", meetingId } });
const meeting = (s: GameState) => {
  const act = Math.ceil(s.round / 3);
  return run(s, { type: "scheduleMeeting", act, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `act-${act}` } });
};

describe("Muscle cancel vs Shield vs Priest in one shakedown — design §8, §8.3, §11.3", () => {
  // p0 Muscle, p1 Priest, p2 the target (blessed, holding a Shield).
  const pending = (pocket: number) => {
    let s = run(game(5, ["muscle", "priest"], { rolePool: [...STARTER_ROLES, "muscle", "priest"] }), mv("p2", "vault", pocket), ROUND);
    s = grantPerks(run(s, use("p1", { kind: "bless", target: "p2" })), "p2", "shield");
    s = emergency(s, "p3");
    for (const id of ["p0", "p1", "p3", "p4"]) s = run(s, vote(id, "p2"));
    s = run(s, CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    return s;
  };

  it("Muscle cancels a clean blessed Shield holder: Shield kept, no compensation, no blessingPaid, no Priest token; Muscle earns a token", () => {
    const p = pending(0);
    const s = run(p, use("p0", { kind: "cancelShakedown" }), RESOLVE);
    expect(since(p, s).map((e) => e.type)).toEqual(["abilityResolved", "shakedownCancelled", "tokenEarned"]);
    expect(granted(s, "p0")).toEqual(["cancelledClean"]);
    expect(granted(s, "p1")).toEqual([]);
    expect(s.players.p2?.roleState.perks).toEqual(["shield"]);
    expect([s.haul, s.players.p2?.stash]).toEqual([p.haul, p.players.p2?.stash]);
  });

  it("dirty: the Muscle is named, the Shield is still kept", () => {
    const p = pending(BANK_JOB.shakedown.cleanBelow);
    const s = run(p, use("p0", { kind: "cancelShakedown" }), RESOLVE);
    expect(ofType(s.log, "muscleNamed")).toHaveLength(1);
    expect(s.players.p2?.roleState.perks).toEqual(["shield"]);
    expect(granted(s, "p0")).toEqual([]);
  });

  it("no cancel: the Shield is spent, no compensation and no blessing/token; the Muscle gets nothing", () => {
    const p = pending(0);
    const s = run(p, RESOLVE);
    expect(ofType(since(p, s), "perkUsed")[0]?.perk).toMatchObject({ kind: "shield" });
    expect(ofType(s.log, "blessingPaid")).toEqual([]);
    expect([granted(s, "p0"), granted(s, "p1"), s.haul]).toEqual([[], [], p.haul]);
  });

  it("view-diff: Muscle cancel vs Shield cancel look the same to the uninvolved (Priest, p3, p4)", () => {
    const p = pending(0);
    const a = run(p, use("p0", { kind: "cancelShakedown" }), RESOLVE);
    const b = run(p, RESOLVE);
    for (const viewer of ["p1", "p3", "p4"]) expect(viewFor(a, viewer)).toEqual(viewFor(b, viewer));
  });
});

describe("Smooth Talker's Emergency perk vs the one-per-player emergency — design §8.3, §11.1", () => {
  const used = () => run(emergency(game(5, ["smoothTalker"]), "p0"), CLOSE);

  it("refused while a meeting is open or a shakedown is pending: the token is kept", () => {
    let s = grantPerks(used(), "p0", "emergency");
    s = emergency(s, "p1");
    expect(reason(s, { type: "callEmergency", player: "p0" })).toMatch(/meeting is already open/);
    expect(s.players.p0?.roleState.perks).toEqual(["emergency"]);
  });

  it("two tokens → emergency2- and emergency3- ids; a third call is refused", () => {
    let s = grantPerks(used(), "p0", "emergency", "emergency");
    s = run(emergency(s, "p0", "emergency2-p0"), CLOSE);
    s = run(emergency(s, "p0", "emergency3-p0"), CLOSE);
    expect(ofType(s.log, "emergencyMeetingCalled").map((e) => e.meetingId)).toEqual(["emergency-p0", "emergency2-p0", "emergency3-p0"]);
    expect(reason(s, { type: "callEmergency", player: "p0" })).toMatch(/already called/);
  });

  it("a Rookie with its emergency used and no token is refused (the normal rule stands)", () => {
    const s = run(emergency(game(5, ["smoothTalker"]), "p1"), CLOSE);
    expect(reason(s, { type: "callEmergency", player: "p1" })).toMatch(/already called/);
  });

  it("switching its ballot away before the close → no reward (last ballot counts)", () => {
    let s = run(game(5, ["smoothTalker"]), mv("p1", "vault", 6), ROUND);
    s = emergency(s, "p2");
    s = settle(run(s, vote("p0", "p1"), vote("p2", "p1"), vote("p3", "p1"), vote("p4", "p1"), vote("p0", null), CLOSE));
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(false);
    expect(granted(s, "p0")).toEqual([]);
  });
});

describe("Bagman: a token per 3 all-in rounds running — extension.md \"Roles\"", () => {
  const STAY = [mv("p1", "lobby"), mv("p2", "lobby")];
  it("a pocket in the third round restarts the count; the streak runs across a meeting; a second streak earns a second", () => {
    let s = run(game(3, ["bagman"]), mv("p0", "office"), ...STAY, ROUND, mv("p0", "office"), ...STAY, ROUND, mv("p0", "office", 1), ...STAY, ROUND);
    expect(granted(s, "p0")).toEqual([]);
    s = run(meeting(s), CLOSE);
    for (let r = 0; r < 3; r++) s = run(s, mv("p0", "office"), ...STAY, ROUND);
    expect(granted(s, "p0")).toEqual(["allInStreak"]);
    expect(ofType(s.log, "tokenEarned").find((e) => e.player === "p0")?.visibility).toEqual(privateTo("p0"));
    s = run(meeting(s), CLOSE);
    for (let r = 0; r < 2; r++) s = run(s, mv("p0", "office"), ...STAY, ROUND);
    expect(granted(s, "p0")).toEqual(["allInStreak"]);
    s = run(s, mv("p0", "office"), ...STAY, ROUND);
    expect(granted(s, "p0")).toEqual(["allInStreak", "allInStreak"]);
  });

  it("a Rookie handing in everything earns neither +1 nor a token", () => {
    let s = game(3, []);
    for (let r = 0; r < 3; r++) s = run(s, mv("p0", "office"), ...STAY, ROUND);
    expect(granted(s, "p0")).toEqual([]);
    expect(ofType(s.log, "abilityResolved")).toEqual([]);
  });
});

describe("Cleaner: Rooftop weight — design §7, §8", () => {
  it("with another visitor the Rooftop counts 3; its token is on the 2nd and 4th Rooftop rounds only", () => {
    const HOT = [mv("p1", "rooftop"), mv("p2", "vault")];
    const s = run(game(3, ["cleaner"]), mv("p0", "rooftop"), ...HOT, ROUND);
    expect(s.heat).toBe(Math.max(0, roundHeatDelta(BANK_JOB, 3, { vault: 1, rooftop: 3 })));
    let t = s;
    t = run(t, mv("p0", "rooftop"), ROUND, mv("p0", "rooftop"), ROUND);
    expect(granted(t, "p0")).toEqual(["coolingRounds"]);
    t = run(meeting(t), CLOSE, mv("p0", "rooftop"), ROUND);
    expect(granted(t, "p0")).toEqual(["coolingRounds", "coolingRounds"]);
  });
});

describe("Fixer: exactly at the raid threshold, once per game, ¼ stash, a token — extension.md \"Roles\", design §7", () => {
  const VAULT = [mv("p0", "vault"), mv("p1", "vault"), mv("p2", "vault")];
  const delta = roundHeatDelta(BANK_JOB, 3, { vault: 3 });
  const at = (heat: number, stash = 8, extra: Partial<GameConfig> = {}) => ({ ...withStash(game(3, ["fixer"], extra), "p0", stash), heat });

  it("landing on 99 is no raid (no save spent); landing on exactly 100 is stopped", () => {
    const max = BANK_JOB.heat.max;
    const below = run(at(max - 1 - delta), ...VAULT, ROUND);
    expect([below.heat, ofType(below.log, "raidStopped").length, below.players.p0?.roleState.usedThisGame]).toEqual([max - 1, 0, 0]);
    const exact = run(at(max - delta), ...VAULT, ROUND);
    expect(ofType(exact.log, "roundResolved")[0]?.heat).toBe(max);
    expect([exact.heat, ofType(exact.log, "raidStopped").length, exact.phase.kind]).toEqual([95, 1, "planning"]);
  });

  it("loss is round(¼ stash), halves up, never more than the stash", () => {
    for (const [stash, lost] of [[0, 0], [1, 0], [2, 1], [6, 2], [7, 2], [10, 3]] as const) {
      const s = run(at(99, stash), ...VAULT, ROUND);
      expect(ofType(s.log, "abilityResolved").find((e) => e.ability.kind === "fixer")?.ability).toEqual({ kind: "fixer", lost });
      expect(s.players.p0?.stash).toBe(stash - lost + (ofType(s.log, "lootSplit").find((e) => e.player === "p0")?.toStash ?? 0));
    }
  });

  it("a save in an act's last round, then a missed checkpoint's raid: no second save, the heist fails on Heat", () => {
    const POCKET = ["p0", "p1", "p2"].map((id) => mv(id, "lobby", 2));
    let s = run(game(3, ["fixer"]), ...POCKET, ROUND, ...POCKET, ROUND);
    s = run({ ...s, heat: BANK_JOB.heat.max - roundHeatDelta(BANK_JOB, 3, { lobby: 3 }) }, ...POCKET, ROUND);
    expect(ofType(s.log, "raidStopped")).toHaveLength(1);
    expect(s.phase.kind).toBe("awaitingMeeting");
    s = run(meeting(s), CLOSE);
    expect(ofType(s.log, "checkpointChecked")[0]?.met).toBe(false);
    expect(ofType(s.log, "raidStopped")).toHaveLength(1);
    expect(ofType(s.log, "copsRaided")).toHaveLength(1);
    expect(ofType(s.log, "gameEnded")[0]).toMatchObject({ outcome: { reason: "heat", result: "failed" } });
  });

  it("the stop earns a private token, not a perk", () => {
    const s = run(at(99, 8, { rolePool: [...STARTER_ROLES, "fixer"] }), ...VAULT, ROUND);
    expect(granted(s, "p0")).toEqual(["raidStopped"]);
    expect([s.players.p0?.roleState.tokens, s.players.p0?.roleState.perks]).toEqual([1, []]);
  });
});

describe("Mastermind: Rig choice over a foreseen card — design §8.3, §10", () => {
  it("another player's Rig picking the second card flips that one, not the foreseen", () => {
    const cfg = config(3, { rolePool: ["mastermind"], eventsEnabled: true });
    const start = createGame(cfg);
    const mind = start.playerOrder.find((id) => start.players[id]?.role === "mastermind") as string;
    const other = start.playerOrder.find((id) => id !== mind) as string;
    let s = run(start, ...start.playerOrder.map((id) => mv(id, "lobby")), ROUND);
    const foreseen = ofType(s.log, "cardForeseen").at(-1)?.card;
    s = run(grantPerks(s, other, "rig"), use(other, { kind: "rig" }));
    const alt = s.rigs[0]?.cards[1] as string;
    s = run(s, use(other, { kind: "rigPick", card: alt }), ...s.playerOrder.map((id) => mv(id, "lobby")), ROUND);
    expect(ofType(s.log, "eventFlipped").at(-1)?.card).toBe(alt);
    expect(alt).not.toBe(foreseen);
    expect(JSON.stringify(viewFor(s, other))).not.toContain(`"cardForeseen"`);
  });
});

describe("eligibility at 3 and 12 players, events — design §8.1", () => {
  const pool = (n: number, extra: Partial<GameConfig> = {}) => [...rolePoolFor(config(n, { rolePool: SEVEN, ...extra }))];
  it("3: only Bagman, Cleaner, Fixer (+Mastermind with events); 12: all seven", () => {
    expect(pool(3).sort()).toEqual(["bagman", "cleaner", "fixer"]);
    expect(pool(3, { eventsEnabled: true }).sort()).toEqual(["bagman", "cleaner", "fixer", "mastermind"]);
    expect(pool(12).sort()).toEqual(SEVEN.filter((r) => r !== "mastermind").sort());
    expect(pool(12, { eventsEnabled: true }).sort()).toEqual([...SEVEN].sort());
  });

  it("dealt over many seeds: never below the minimum, never Mastermind with events off, each at most once at 12", () => {
    for (let i = 0; i < 40; i++) {
      for (const n of [3, 4, 5, 12]) {
        const events = i % 2 === 0;
        const s = createGame(config(n, { seed: `elig-${i}`, rolePool: SEVEN, eventsEnabled: events }));
        const roles = s.playerOrder.map((id) => s.players[id]?.role as string);
        if (n < 5) for (const r of ["smoothTalker", "muscle", "priest"]) expect(roles).not.toContain(r);
        if (!events) expect(roles).not.toContain("mastermind");
        for (const r of SEVEN) expect(roles.filter((x) => x === r).length).toBeLessThanOrEqual(1);
        if (n === 12 && events) expect(SEVEN.every((r) => roles.includes(r))).toBe(true);
      }
    }
  });
});

describe("12 players with all seven dealt: leaks and determinism — design §13, §17.2", () => {
  const cfg = config(12, { seed: "qa-12", rolePool: SEVEN, eventsEnabled: true, voteVisibility: "secret" });
  const play = (): GameState => {
    let s = createGame(cfg);
    const role = (r: string) => s.playerOrder.find((id) => s.players[id]?.role === r) as string;
    const [priest, bagman, cleaner, muscle] = [role("priest"), role("bagman"), role("cleaner"), role("muscle")];
    const others = s.playerOrder.filter((id) => ![bagman, cleaner].includes(id));
    s = run(s, mv(bagman, "office"), mv(cleaner, "rooftop"), ...others.map((id, i) => mv(id, i % 2 ? "vault" : "office", i % 3)), ROUND);
    s = run(s, use(priest, { kind: "bless", target: others.find((id) => id !== priest) as string }));
    const target = others.find((id) => id !== priest && id !== muscle) as string;
    s = emergency(s, bagman);
    for (const id of s.playerOrder) if (id !== target) s = run(s, vote(id, target));
    s = run(s, CLOSE);
    if (s.pendingShakedown) s = run(s, use(muscle, { kind: "cancelShakedown" }), RESOLVE);
    return run(s, ...s.playerOrder.map((id) => mv(id, "rooftop")), ROUND);
  };

  it("no view holds another player's private or secret event; same seed + commands → same log; replay rebuilds", () => {
    const a = play();
    expect(SEVEN.every((r) => a.playerOrder.some((id) => a.players[id]?.role === r))).toBe(true);
    for (const viewer of a.playerOrder) {
      const json = JSON.stringify(viewFor(a, viewer));
      for (const other of a.playerOrder) {
        if (other === viewer) continue;
        expect(json).not.toContain(`"private:${other}"`);
        expect(json).not.toContain(`"secret:${other}"`);
        expect(json).not.toMatch(new RegExp(`"visibility":\\{"kind":"(private|secret)","player":"${other}"`));
      }
    }
    const b = play();
    expect(b.log).toEqual(a.log);
    expect(replay(a.config, a.log)).toEqual(a);
  });
});
