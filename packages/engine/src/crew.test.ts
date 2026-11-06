// Role deck v2 crew roles, step R2a (docs/roles-v2.md §2, §3): Rookie,
// Inside Man, Lookout, Auditor, Detective and their token rewards
// (extension.md "Roles", "Tokens and the perk shop"); dealing limits for the
// Snitch and Detective. The Snitch's reward is in roles.test.ts.
// design §8, §8.1, §16.1
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { BANK_JOB, POOL_ROLES, ROLES, STARTER_ROLES } from "@skimjob/content";
import { grantPerks } from "./perks.testkit";
import type { GameConfig, GameEvent, GameState } from "./types";
import { privateTo } from "./types";
import { rolePoolFor, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { opensShakedownWindow } from "./meeting";
import { rolesFor } from "./overrides";
import { viewFor } from "./view";
import { V015_NUMBERS } from "./v01-numbers.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "crew-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    // No Muscle in the pool; `run` passes the shop's Shield window (extension.md "Shakedowns").
    rolePool: [...STARTER_ROLES],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
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

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    const r = handleThroughAlibis(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    return passWindow(r.state);
  }, state);
}
/** Nobody here holds a Shield unless a test gives one, so the shakedown window just passes. */
function passWindow(s: GameState): GameState {
  if (s.phase.kind !== "shakedownPending") return s;
  const r = handleThroughAlibis(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.phase.meetingId } });
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}
function reason(state: GameState, command: unknown): string {
  const r = handleThroughAlibis(state, command);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
/** The triggers of the tokens `player` earned. extension.md "Tokens and the perk shop" */
const granted = (s: GameState, player: string) => ofType(s.log, "tokenEarned").filter((e) => e.player === player).map((e) => e.trigger);

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const vote = (player: string, target: string) => ({ type: "castVote", player, vote: { kind: "shakedown", target } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const use = (player: string, ability: object) => ({ type: "useAbility", player, ability });
/** `caller` calls an emergency meeting; everyone else but `target` votes to shake `target` down. */
const shakeDown = (s: GameState, caller: string, target: string): GameState => {
  s = run(s, { type: "callEmergency", player: caller }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `emergency-${caller}` } });
  for (const id of s.playerOrder) if (id !== target) s = run(s, vote(id, target));
  return run(s, CLOSE);
};
/** Play the act's remaining rounds with `moves` each round, then its regular meeting with no votes. */
const finishAct = (s: GameState, ...moves: Cmd[]): GameState => {
  const act = Math.ceil(s.round / 3);
  while (s.round <= act * 3 && s.phase.kind === "planning" && Math.ceil(s.round / 3) === act) {
    const before = s.round;
    s = run(s, ...moves, ROUND);
    if (s.round === before) break; // the act's last round: awaiting its meeting
  }
  return run(s, { type: "scheduleMeeting", act, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `act-${act}` } }, CLOSE);
};
/** extension.md "Shakedowns": one clean line, 6, shared with the Detective's check. */
const cleanBelowPerAct = BANK_JOB.shakedown.cleanBelow;
/** 10 a round: makes every checkpoint at 3 players without much Heat. */
const STEADY = [mv("p0", "office"), mv("p1", "office"), mv("p2", "lobby")];

describe("Rookie and Inside Man: target met earns a token — extension.md \"Roles\"", () => {
  it("each meeting 1/2 target met: a token each for the Rookie and the Inside Man, privately, before the next round", () => {
    const s = finishAct(game(3, ["rookie", "insideMan", "lookout"]), ...STEADY);
    expect(ofType(s.log, "checkpointChecked")[0]?.met).toBe(true);
    expect(granted(s, "p0")).toEqual(["checkpointMade"]);
    expect(granted(s, "p1")).toEqual(["checkpointMade"]);
    expect(granted(s, "p2")).toEqual([]);
    expect(ofType(s.log, "tokenEarned")[0]?.visibility).toEqual(privateTo("p0"));
    expect(s.players.p0?.roleState.tokens).toBe(1);
    expect(viewFor(s, "p2").caseFile.some(({ event }) => event.type === "tokenEarned")).toBe(false);
  });

  it("a missed checkpoint earns nothing; nor does the final check", () => {
    const missed = finishAct(game(3, ["rookie", "insideMan"]), ...["p0", "p1", "p2"].map((p) => mv(p, "rooftop")));
    expect(ofType(missed.log, "checkpointChecked")[0]?.met).toBe(false);
    expect(ofType(missed.log, "tokenEarned")).toEqual([]);
    let s = game(3, ["rookie"]);
    for (let act = 1; act <= 3; act++) s = finishAct(s, ...STEADY);
    expect(s.phase.kind).toBe("ended");
    expect(ofType(s.log, "checkpointChecked").map((c) => c.met)).toEqual([true, true, true]);
    expect(granted(s, "p0")).toEqual(["checkpointMade", "checkpointMade"]);
  });

  it("the count per trigger is the role's one tunable number (content override `rewardCount`, design §17.4)", () => {
    const overrides = { roles: { rookie: { rewardCount: 2 } } };
    expect(validateConfig(config(3, { contentOverrides: overrides }))).toEqual([]);
    expect(validateConfig(config(3, { contentOverrides: { roles: { fence: { rewardCount: -1 } } } }))).toEqual([expect.stringMatching(/fence\.rewardCount/)]);
    const s = finishAct(game(3, ["rookie"], { contentOverrides: overrides }), ...STEADY);
    expect(granted(s, "p0")).toEqual(["checkpointMade", "checkpointMade"]);
    expect(s.players.p0?.roleState.tokens).toBe(2);
    expect(rolesFor({ contentOverrides: overrides }).rookie?.rewards?.[0]?.count).toBe(2);
  });
});

describe("Lookout: someone it saw is caught → a token — extension.md \"Roles\"", () => {
  const watched = (pocket: number) => {
    const s = run(game(3, ["lookout"]), mv("p0", "lobby", 0, { ability: { kind: "lookout", rooms: ["vault"] } }), mv("p1", "vault", pocket), ROUND);
    return shakeDown(s, "p2", "p1");
  };

  it("granted when a player its power saw is shaken down dirty", () => {
    const s = watched(cleanBelowPerAct);
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(false);
    expect(granted(s, "p0")).toEqual(["watchedShakenDirty"]);
  });

  it("not when the target is clean, nor for a player it didn't see", () => {
    expect(granted(watched(cleanBelowPerAct - 1), "p0")).toEqual([]);
    let s = run(game(3, ["lookout"]), mv("p0", "lobby", 0, { ability: { kind: "lookout", rooms: ["office"] } }), mv("p1", "vault", 6), ROUND);
    s = shakeDown(s, "p2", "p1");
    expect(granted(s, "p0")).toEqual([]);
  });
});

describe("Auditor: once per act, a room's shortfall in the latest round — v2 §2, design §8", () => {
  // Round 1: p1 pockets 4 in the Vault, p2 hands in everything in the Vault.
  const played = () => run(game(3, ["auditor"]), mv("p1", "vault", 4), mv("p2", "vault"), ROUND);

  it("private: what the room's visitors pocketed in the latest resolved round", () => {
    const s = run(played(), use("p0", { kind: "audit", room: "vault" }));
    expect(s.log.at(-1)).toEqual({
      type: "abilityResolved",
      visibility: privateTo("p0"),
      player: "p0",
      round: 2,
      ability: { kind: "audit", round: 1, room: "vault", shortfall: 4 },
    });
    expect(JSON.stringify(viewFor(s, "p1"))).not.toMatch(/"audit"/);
  });

  it("once per act (back next act); refused before any round, for a room not in play, and for other roles", () => {
    const s = run(played(), use("p0", { kind: "audit", room: "office" }));
    expect(s.log.at(-1)).toMatchObject({ ability: { kind: "audit", room: "office", shortfall: 0 } });
    expect(reason(s, use("p0", { kind: "audit", room: "vault" }))).toMatch(/already audited/);
    expect(reason(game(3, ["auditor"]), use("p0", { kind: "audit", room: "vault" }))).toMatch(/no round has resolved/);
    expect(reason(played(), use("p0", { kind: "audit", room: "moon" }))).toMatch(/room in play/);
    expect(reason(played(), use("p1", { kind: "audit", room: "vault" }))).toMatch(/no audit ability/);
    expect(reason(played(), mv("p0", "vault", 0, { ability: { kind: "audit", room: "vault" } }))).toMatch(/isn't used in a move/);
    const next = run(finishAct(s), use("p0", { kind: "audit", room: "vault" }));
    expect(ofType(next.log, "abilityResolved").filter((e) => e.ability.kind === "audit")).toHaveLength(2);
  });

  it("a visitor of the audited room in that round caught → a token; anyone else → nothing (extension.md \"Roles\")", () => {
    let s = run(played(), use("p0", { kind: "audit", room: "vault" }), mv("p1", "office", 4), ROUND);
    s = shakeDown(s, "p2", "p1");
    expect(granted(s, "p0")).toEqual(["auditedShakenDirty"]);
    // p1 audited in the Office (round 1: nobody there), then caught dirty: no token.
    let t = run(played(), use("p0", { kind: "audit", room: "office" }), mv("p1", "office", 4), ROUND);
    t = shakeDown(t, "p2", "p1");
    expect(ofType(t.log, "shakedownResolved")[0]?.clean).toBe(false);
    expect(granted(t, "p0")).toEqual([]);
  });
});

describe("Detective: once per act, is a stash at or above the clean threshold? — v2 §2, design §8", () => {
  it("private yes/no against this act's threshold, counting the Fence safe like the clean check", () => {
    let s = run(game(3, ["detective", "fence"], { contentOverrides: V015_NUMBERS }), mv("p1", "vault", 6, { ability: { kind: "fenceSafe", amount: 4 } }), mv("p2", "vault", cleanBelowPerAct - 1), ROUND);
    s = run(s, use("p0", { kind: "checkStash", target: "p1" }));
    expect(s.log.at(-1)).toEqual({
      type: "abilityResolved",
      visibility: privateTo("p0"),
      player: "p0",
      round: 2,
      ability: { kind: "checkStash", target: "p1", threshold: cleanBelowPerAct, dirty: true },
    });
    expect(JSON.stringify(viewFor(s, "p1"))).not.toMatch(/checkStash/);
    expect(reason(s, use("p0", { kind: "checkStash", target: "p2" }))).toMatch(/already checked/);
    const t = run(game(3, ["detective"]), mv("p2", "vault", cleanBelowPerAct - 1), ROUND, use("p0", { kind: "checkStash", target: "p2" }));
    expect(t.log.at(-1)).toMatchObject({ ability: { dirty: false } });
  });

  it("refused on yourself, an unknown player, or for other roles", () => {
    const s = game(3, ["detective"]);
    expect(reason(s, use("p0", { kind: "checkStash", target: "p0" }))).toMatch(/another player/);
    expect(reason(s, use("p0", { kind: "checkStash", target: "zz" }))).toMatch(/unknown player/);
    expect(reason(s, use("p1", { kind: "checkStash", target: "p0" }))).toMatch(/no checkStash ability/);
  });

  it("a checked player caught → a token (extension.md \"Roles\")", () => {
    let s = run(game(3, ["detective"]), mv("p1", "vault", 6), ROUND, use("p0", { kind: "checkStash", target: "p1" }));
    s = shakeDown(s, "p2", "p1");
    expect(granted(s, "p0")).toEqual(["checkedShakenDirty"]);
    expect(s.players.p0?.roleState.tokens).toBe(1);
  });

  it("a Shield (bought) cancels a shakedown of its holder (extension.md \"Tokens and the perk shop\")", () => {
    let s = grantPerks(run(game(3, ["detective"]), mv("p0", "vault", 6), ROUND), "p0", "shield");
    s = shakeDown(s, "p1", "p0");
    expect(ofType(s.log, "shakedownCancelled")).toHaveLength(1);
    expect(s.players.p0?.stash).toBe(6);
  });
});

describe("dealing limits — v2 §3, design §8.1", () => {
  it("Snitch and Detective from 4 players; the Auditor anywhere", () => {
    const at = (n: number, extra: Partial<GameConfig> = {}) => rolePoolFor(config(n, { rolePool: [], deck: "everything", ...extra }));
    for (const r of ["snitch", "detective"]) {
      expect(at(3)).not.toContain(r);
      expect(at(4)).toContain(r);
    }
    expect(at(3)).toContain("auditor");
    for (const r of ["auditor", "detective"]) expect(POOL_ROLES).toContain(r);
  });

  it("the shakedown window opens when the shop holds a Shield or a Muscle could be dealt (extension.md \"Shakedowns\")", () => {
    expect(opensShakedownWindow(ROLES, ["rookie", "detective"], ["shield"])).toBe(true);
    expect(opensShakedownWindow(ROLES, ["rookie", "muscle"], [])).toBe(true);
    expect(opensShakedownWindow(ROLES, ["rookie", "auditor", "lookout", "insideMan", "snitch", "detective"], ["peek", "alibi", "ballot"])).toBe(false);
  });
});
