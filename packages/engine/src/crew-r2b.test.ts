// Role deck v2 crew roles, step R2b (docs/roles-v2.md §2, §3): Smooth Talker,
// Priest, Fixer and their token rewards
// (extension.md "Roles", "Tokens and the perk shop"); eligibility; the PR #26
// review notes (Auditor, Detective, a bought Peek); a view-diff with these
// roles dealt. design §7, §8, §8.1, §10, §11.3, §16.1
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { BANK_JOB, ROLES, STARTER_ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import { createGame, rolePoolFor, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { roundHeatDelta } from "./job";
import { viewFor } from "./view";
import { grantPerks } from "./perks.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "r2b-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    // `run` passes the shakedown window a dealt Shield opens (extension.md "Shakedowns").
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

const withStashes = (s: GameState, stashes: Record<string, number>): GameState => ({
  ...s,
  players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, stash: stashes[id] ?? p.stash }])) as Record<string, PlayerState>,
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
/** Resolve a waiting shakedown nobody cancels. */
const settle = (s: GameState): GameState => (s.phase.kind === "shakedownPending" ? run(s, RESOLVE) : s);
function reason(state: GameState, command: unknown): string {
  const r = handleThroughAlibis(state, command);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
/** The triggers of the tokens `player` earned. extension.md "Tokens and the perk shop" */
const granted = (s: GameState, player: string) => ofType(s.log, "tokenEarned").filter((e) => e.player === player).map((e) => e.trigger);
const since = (before: GameState, after: GameState) => after.log.slice(before.log.length);

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
const use = (player: string, ability: object) => ({ type: "useAbility", player, ability });
const emergency = (s: GameState, caller: string, meetingId = `emergency-${caller}`) =>
  run(s, { type: "callEmergency", player: caller }, { type: "advance", deadline: { kind: "openMeeting", meetingId } });
/** `caller` calls an emergency meeting; everyone else but `target` votes to shake `target` down. */
const shakeDown = (s: GameState, caller: string, target: string): GameState => {
  s = emergency(s, caller);
  for (const id of s.playerOrder) if (id !== target) s = run(s, vote(id, target));
  return settle(run(s, CLOSE));
};
/** Play the act's remaining rounds with `moves` each round, then its regular meeting (`inMeeting`, then closed). */
const finishAct = (s: GameState, moves: Cmd[] = [], inMeeting: (s: GameState) => GameState = (x) => x): GameState => {
  const act = Math.ceil(s.round / 3);
  while (s.phase.kind === "planning" && Math.ceil(s.round / 3) === act) {
    const before = s.round;
    s = run(s, ...moves, ROUND);
    if (s.round === before) break;
  }
  s = run(s, { type: "scheduleMeeting", act, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `act-${act}` } });
  return settle(run(inMeeting(s), CLOSE));
};
/** extension.md "Shakedowns": a fixed clean line and payout. */
const { cleanBelow: cleanBelowPerAct, payout: compensationPerAct } = BANK_JOB.shakedown;

describe("Smooth Talker: on the winning side of a dirty shakedown → a token — extension.md \"Roles\"", () => {
  const caught = (stVote: string | null) => {
    let s = run(game(5, ["smoothTalker"]), mv("p1", "vault", 6), ROUND);
    s = emergency(s, "p2");
    return settle(run(s, vote("p0", stVote), vote("p2", "p1"), vote("p3", "p1"), vote("p4", "p1"), CLOSE));
  };

  it("voted for the dirty target → a private token", () => {
    const s = caught("p1");
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(false);
    expect(granted(s, "p0")).toEqual(["wonDirtyShakedown"]);
    expect(ofType(s.log, "tokenEarned")[0]?.visibility).toEqual(privateTo("p0"));
    expect(viewFor(s, "p1").caseFile.some(({ event }) => event.type === "tokenEarned")).toBe(false);
  });

  it("a bought Emergency is spent by calling a second emergency meeting (its own id)", () => {
    let s = grantPerks(run(game(5, ["smoothTalker"]), ROUND), "p0", "emergency");
    s = run(emergency(s, "p0"), CLOSE); // its own one per game: no perk spent
    expect(s.players.p0?.roleState.perks).toEqual(["emergency"]);
    const before = s;
    s = emergency(s, "p0", "emergency2-p0");
    expect(since(before, s).slice(0, 2)).toEqual([
      { type: "perkUsed", visibility: privateTo("p0"), player: "p0", round: 2, perk: { kind: "emergency", meetingId: "emergency2-p0" } },
      { type: "emergencyMeetingCalled", visibility: PUBLIC, by: "p0", meetingId: "emergency2-p0" },
    ]);
    s = run(s, CLOSE);
    expect(s.players.p0?.roleState.perks).toEqual([]);
    expect(reason(s, { type: "callEmergency", player: "p0" })).toMatch(/already called/);
    expect(reason(s, use("p0", { kind: "emergency" }))).toMatch(/spent by calling/);
  });

  it("not when it voted otherwise, nor for a clean target; its ballot still counts ×2 (its one number)", () => {
    expect(granted(caught(null), "p0")).toEqual([]);
    let s = emergency(game(5, ["smoothTalker"]), "p2");
    s = settle(run(s, vote("p0", "p1"), vote("p2", "p1"), vote("p3", "p1"), CLOSE));
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(true);
    expect(granted(s, "p0")).toEqual([]);
    expect(ROLES.smoothTalker?.power).toEqual({ kind: "voteWeight", weight: 2 });
  });
});

describe("Priest: once per act, bless a player; a clean shakedown of them is paid by the bank — v2 §2, design §8", () => {
  it("blessed and shaken down clean: the compensation goes back into the Haul (`blessingPaid`), and the Priest earns a token", () => {
    const blessed = run(game(5, ["priest"]), mv("p0", "office"), mv("p1", "office"), ROUND, use("p0", { kind: "bless", target: "p1" }));
    expect(blessed.log.at(-1)).toEqual({ type: "abilityResolved", visibility: privateTo("p0"), player: "p0", round: 2, ability: { kind: "bless", target: "p1", act: 1 } });
    expect(JSON.stringify(viewFor(blessed, "p1"))).not.toMatch(/"bless"/);
    const s = shakeDown(blessed, "p2", "p1");
    expect(ofType(s.log, "shakedownResolved")[0]).toMatchObject({ clean: true, compensation: compensationPerAct });
    expect(ofType(s.log, "blessingPaid")).toEqual([{ type: "blessingPaid", visibility: PUBLIC, meetingId: "emergency-p2", target: "p1", amount: compensationPerAct }]);
    expect(s.haul).toBe(blessed.haul);
    expect(s.players.p1?.stash).toBe(compensationPerAct);
    expect(granted(s, "p0")).toEqual(["blessedShakenClean"]);
    // Unblessed, the Haul pays.
    const plain = shakeDown(run(game(5, ["priest"]), mv("p0", "office"), mv("p1", "office"), ROUND), "p2", "p1");
    expect(plain.haul).toBe(blessed.haul - compensationPerAct);
  });

  it("a blessing covers its act only; once per act; refused on yourself, an unknown player and for other roles", () => {
    const fresh = game(5, ["priest"]);
    expect(reason(fresh, use("p0", { kind: "bless", target: "p0" }))).toMatch(/another player/);
    expect(reason(fresh, use("p0", { kind: "bless", target: "zz" }))).toMatch(/unknown player/);
    expect(reason(fresh, use("p1", { kind: "bless", target: "p2" }))).toMatch(/no bless ability/);
    expect(reason(fresh, mv("p0", "lobby", 0, { ability: { kind: "bless", target: "p1" } }))).toMatch(/isn't used in a move/);
    let s = run(fresh, mv("p1", "office"), ROUND, use("p0", { kind: "bless", target: "p1" }));
    expect(reason(s, use("p0", { kind: "bless", target: "p2" }))).toMatch(/already blessed/);
    s = shakeDown(finishAct(s), "p2", "p1");
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(true);
    expect(ofType(s.log, "blessingPaid")).toEqual([]);
  });

  it("blessed but caught dirty → no blessing next act (back the act after)", () => {
    let s = run(game(5, ["priest"]), mv("p1", "vault", 6), ROUND, use("p0", { kind: "bless", target: "p1" }));
    s = shakeDown(s, "p2", "p1");
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(false);
    expect(granted(s, "p0")).toEqual([]);
    s = finishAct(s);
    expect(reason(s, use("p0", { kind: "bless", target: "p2" }))).toMatch(/caught dirty/);
    s = finishAct(s);
    expect(run(s, use("p0", { kind: "bless", target: "p2" })).log.at(-1)).toMatchObject({ ability: { kind: "bless", act: 3 } });
  });
});

describe("Fixer: once per game a raid stops at 95 Heat; it loses ¼ of its stash and earns a token — extension.md \"Roles\"", () => {
  const hot = (s: GameState, heat: number): GameState => ({ ...s, heat });
  const ALL_VAULT = [mv("p1", "vault"), mv("p2", "vault")];

  it("mid-round: public `raidStopped` (no name), Heat 95, the Fixer pays privately and gets a token; the next raid ends the game", () => {
    const before = hot(withStashes(game(3, ["fixer"]), { p0: 8 }), 99);
    const s = run(before, mv("p0", "lobby"), ...ALL_VAULT, ROUND);
    const events = since(before, s);
    expect(ofType(events, "roundResolved")[0]?.heat).toBe(100);
    expect(ofType(events, "raidStopped")).toEqual([{ type: "raidStopped", visibility: PUBLIC, round: 1, heat: 95 }]);
    expect(ofType(events, "abilityResolved")[0]).toEqual({ type: "abilityResolved", visibility: privateTo("p0"), player: "p0", round: 1, ability: { kind: "fixer", lost: 2 } });
    expect(ofType(events, "copsRaided")).toEqual([]);
    expect([s.heat, s.players.p0?.stash, s.phase.kind]).toEqual([95, 6, "planning"]);
    expect(granted(s, "p0")).toEqual(["raidStopped"]);
    expect(JSON.stringify(viewFor(s, "p1"))).not.toMatch(/"kind":"fixer"|tokenEarned/);
    const again = run(hot(s, 99), mv("p0", "lobby"), ...ALL_VAULT, ROUND);
    expect(ofType(since(s, again), "copsRaided")).toHaveLength(1);
    expect(again.phase.kind).toBe("ended");
  });

  it("also stops a missed checkpoint's raid; the next round starts", () => {
    const s = finishAct(game(3, ["fixer"]), [mv("p0", "rooftop"), mv("p1", "rooftop"), mv("p2", "rooftop")], (m) => hot(m, 90));
    const check = ofType(s.log, "checkpointChecked")[0];
    expect(check?.met).toBe(false);
    expect(ofType(s.log, "raidStopped")).toHaveLength(1);
    expect([s.heat, s.round, s.phase.kind]).toEqual([95, 4, "planning"]);
  });

  it("the threshold is its one number (`stopAt`); without a Fixer the raid ends the game", () => {
    const tuned = { contentOverrides: { roles: { fixer: { stopAt: 80 } } } };
    expect(validateConfig(config(3, tuned))).toEqual([]);
    const s = run(hot(game(3, ["fixer"], tuned), 99), mv("p0", "lobby"), ...ALL_VAULT, ROUND);
    expect(s.heat).toBe(80);
    expect(run(hot(game(3, []), 99), mv("p0", "lobby"), ...ALL_VAULT, ROUND).phase.kind).toBe("ended");
  });
});

describe("PR #26 review notes — v2 §2, design §8, §8.3", () => {
  it("the Auditor can't audit the same round twice across acts", () => {
    let s = run(game(3, ["auditor"]), mv("p1", "vault", 4), ROUND, ROUND, ROUND);
    expect(s.phase.kind).toBe("awaitingMeeting");
    s = run(s, use("p0", { kind: "audit", room: "vault" }));
    s = run(s, { type: "scheduleMeeting", act: 1, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } }, CLOSE);
    expect(s.round).toBe(4);
    expect(reason(s, use("p0", { kind: "audit", room: "office" }))).toMatch(/already audited round 3/);
    expect(run(s, ROUND, use("p0", { kind: "audit", room: "office" })).log.at(-1)).toMatchObject({ ability: { kind: "audit", round: 4 } });
  });

  it("a held Peek is spent: the role, privately", () => {
    let s = run(game(3, ["lookout", "rookie", "auditor"]), mv("p0", "lobby", 0, { ability: { kind: "lookout", rooms: ["vault"] } }), mv("p1", "vault", 6), ROUND);
    s = grantPerks(shakeDown(s, "p2", "p1"), "p0", "peek");
    expect(granted(s, "p0")).toEqual(["watchedShakenDirty"]);
    s = run(s, use("p0", { kind: "peek", target: "p2" }));
    expect(s.log.at(-1)).toEqual({ type: "perkUsed", visibility: privateTo("p0"), player: "p0", round: 2, perk: { kind: "peek", target: "p2", role: "auditor" } });
    expect(s.players.p0?.roleState.perks).toEqual([]);
    for (const id of ["p1", "p2"]) expect(JSON.stringify(viewFor(s, id))).not.toMatch(/"peek"/);
  });
});

describe("view-diff with the seven dealt, and determinism — design §13, §17.2", () => {
  const SEVEN = ["smoothTalker", "priest", "auditor", "fixer", "lookout"];
  const SEATS = ["smoothTalker", "rookie", "priest", "auditor", "fixer", "rookie", "lookout"];
  // A: the Priest blesses p7, who is then caught dirty (so it is barred next act); B: it blesses p6. Same public play.
  const play = (a: boolean): GameState => {
    let s = game(8, SEATS, { rolePool: SEVEN, voteVisibility: "secret" });
    s = run(s, mv("p7", "vault", 6), mv("p3", "office"), mv("p4", "rooftop"), ROUND, use("p2", { kind: "bless", target: a ? "p7" : "p6" }));
    s = shakeDown(s, "p1", "p7");
    return finishAct(s);
  };

  it("uninvolved players' views and rejections are the same whether or not the blessing went bad", () => {
    const [a, b] = [play(true), play(false)];
    expect(ofType(a.log, "shakedownResolved")[0]?.clean).toBe(false);
    expect(reason(a, use("p2", { kind: "bless", target: "p5" }))).toMatch(/caught dirty/);
    expect(run(b, use("p2", { kind: "bless", target: "p5" })).log.at(-1)).toMatchObject({ ability: { kind: "bless" } });
    expect(granted(a, "p0")).toEqual(["wonDirtyShakedown"]); // the Smooth Talker voted p7 in both
    for (const viewer of a.playerOrder.filter((id) => id !== "p2")) {
      expect(viewFor(a, viewer)).toEqual(viewFor(b, viewer));
      expect(reason(a, use(viewer, { kind: "bless", target: "p5" }))).toBe(reason(b, use(viewer, { kind: "bless", target: "p5" })));
    }
    for (const viewer of a.playerOrder) {
      const json = JSON.stringify(viewFor(a, viewer));
      for (const other of a.playerOrder) if (other !== viewer) expect(json).not.toContain(`"private:${other}"`);
    }
  });

  it("same seed + same commands → identical log, and replay rebuilds the state", () => {
    const [a, b] = [play(true), play(true)];
    expect(a.log).toEqual(b.log);
    expect(replay(a.config, a.log)).toEqual(a);
  });
});

describe("powers refused while a shakedown is pending (a Shield in the shop opens the window) — v2 §2, design §8, §8.3", () => {
  const pendingOn = (roles: string[], pool: string[], pocket: number) => {
    let s = run({ ...game(5, roles, { rolePool: pool }), shop: ["peek", "shield", "extraVote"] }, mv("p1", "vault", pocket), ROUND);
    s = emergency(s, "p2");
    for (const id of ["p0", "p2", "p3", "p4"]) s = run(s, vote(id, "p1"));
    s = run(s, CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    return s;
  };

  it("the Priest can't bless a player whose shakedown is already pending (the window is public)", () => {
    const s = pendingOn(["priest"], [...STARTER_ROLES, "priest"], 0);
    expect(reason(s, use("p0", { kind: "bless", target: "p1" }))).toMatch(/pending/);
  });

  it("the Detective can't check a player whose shakedown is pending (a sure Shield); others yes", () => {
    const s = pendingOn(["detective"], [...STARTER_ROLES, "detective"], 6);
    expect(reason(s, use("p0", { kind: "checkStash", target: "p1" }))).toMatch(/pending/);
    expect(run(s, use("p0", { kind: "checkStash", target: "p2" })).log.at(-1)).toMatchObject({ ability: { kind: "checkStash", target: "p2" } });
  });
});
