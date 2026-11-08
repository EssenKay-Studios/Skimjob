// Role deck v2 crew roles, step R2a (docs/roles-v2.md §2, §3): Rookie,
// Lookout, Auditor, Detective and their token rewards
// (extension.md "Roles", "Tokens and the perk shop"); dealing limits for the
// Detective.
// design §8, §8.1, §16.1
import { describe, expect, it } from "vitest";
import { closeResultWindow } from "./alibis.testkit";
import { handleCommand, type CommandResult } from "./handle";
import { POOL_ROLES, ROLES, STARTER_ROLES } from "@skimjob/content";
import { grantPerks } from "./perks.testkit";
import type { GameConfig, GameEvent, GameState } from "./types";
import { privateTo } from "./types";
import { rolePoolFor, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { rolesFor } from "./overrides";
import { viewFor } from "./view";
import { R6_COINS } from "./v01-numbers.testkit";
import { fullGrab } from "./grab.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "crew-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    // `run` passes the shop's Shield window (extension.md "Shakedowns").
    rolePool: [...STARTER_ROLES],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
    contentOverrides: { ...R6_COINS, ...extra.contentOverrides }, // R6 room yields as coins (R6 role rules)
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

/**
 * A command, with a round deadline followed by its alibi deadline (nobody
 * posts). The result window (design §9.3) stays open, so an emergency can be
 * called in it, until a move or a round deadline closes it.
 */
function handleThroughAlibis(state: GameState, command: unknown): CommandResult {
  const c = command as { type?: unknown; deadline?: { kind?: unknown } } | null;
  const planning = c?.type === "submitMove" || c?.deadline?.kind === "round";
  const s = state.phase.kind === "result" && !state.pendingEmergency && planning ? must(closeResultWindow(state)) : state;
  const r = handleCommand(s, command);
  if (!r.ok || r.state.phase.kind !== "alibis" || (command as { deadline?: { kind?: unknown } }).deadline?.kind !== "round") return r;
  return handleCommand(r.state, { type: "advance", deadline: { kind: "alibis", round: r.state.phase.round } });
}
const must = (r: CommandResult): GameState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

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

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, pocket, R6_COINS), ...extra } });
/** The round being planned; from the result window, the next one (closing the window first). */
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.phase.kind === "result" ? s.round + 1 : s.round } });
const vote = (player: string, target: string) => ({ type: "castVote", player, vote: { kind: "shakedown", target } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const use = (player: string, ability: object) => ({ type: "useAbility", player, ability });
/** `caller` calls an emergency meeting in the result window; everyone else but `target` votes to shake `target` down. */
const shakeDown = (s: GameState, caller: string, target: string): GameState => {
  s = run(s, { type: "callEmergency", player: caller }, (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.pendingEmergency?.meetingId } }));
  for (const id of s.playerOrder) if (id !== target) s = run(s, vote(id, target));
  return run(s, CLOSE);
};

describe("Lookout: someone it saw is caught → a token — extension.md \"Roles\"", () => {
  const watched = (pocket: number) => {
    const s = run(game(3, ["lookout"]), mv("p0", "lobby", 0, { ability: { kind: "lookout", rooms: ["vault"] } }), mv("p1", "vault", pocket), ROUND);
    return shakeDown(s, "p2", "p1");
  };

  it("granted when a player its power saw is shaken down dirty", () => {
    const s = watched(1);
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(false);
    expect(granted(s, "p0")).toEqual(["watchedShakenDirty"]);
  });

  it("not when the target is clean, nor for a player it didn't see", () => {
    expect(granted(watched(0), "p0")).toEqual([]);
    let s = run(game(3, ["lookout"]), mv("p0", "lobby", 0, { ability: { kind: "lookout", rooms: ["office"] } }), mv("p1", "vault", 6), ROUND);
    s = shakeDown(s, "p2", "p1");
    expect(granted(s, "p0")).toEqual([]);
  });
});

describe("Auditor: once between meetings, a room's shortfall in the latest round — v2 §2, design §8, §11.2", () => {
  // Round 1: p1 pockets 4 in the Vault, p2 hands in everything in the Vault.
  const played = () => run(game(3, ["auditor"]), mv("p1", "vault", 4), mv("p2", "vault"), ROUND);

  it("private: what the room's visitors pocketed in the latest resolved round", () => {
    const s = run(played(), use("p0", { kind: "audit", room: "vault" }));
    expect(s.log.at(-1)).toEqual({
      type: "abilityResolved",
      visibility: privateTo("p0"),
      player: "p0",
      round: 1,
      ability: { kind: "audit", round: 1, room: "vault", shortfall: 4 },
    });
    expect(JSON.stringify(viewFor(s, "p1"))).not.toMatch(/"audit"/);
  });

  it("once between meetings (back after the next regular meeting); refused before any round, for a room not in play, and for other roles", () => {
    const s = run(played(), use("p0", { kind: "audit", room: "office" }));
    expect(s.log.at(-1)).toMatchObject({ ability: { kind: "audit", room: "office", shortfall: 0 } });
    expect(reason(s, use("p0", { kind: "audit", room: "vault" }))).toMatch(/already audited/);
    expect(reason(game(3, ["auditor"]), use("p0", { kind: "audit", room: "vault" }))).toMatch(/no round has resolved/);
    expect(reason(played(), use("p0", { kind: "audit", room: "moon" }))).toMatch(/room in play/);
    expect(reason(played(), use("p1", { kind: "audit", room: "vault" }))).toMatch(/no audit ability/);
    expect(reason(played(), mv("p0", "vault", 0, { ability: { kind: "audit", room: "vault" } }))).toMatch(/isn't used in a move/);
    // design §9.1: with a bank of 18 the same round takes two-thirds of it, so a regular meeting recharges the audit.
    let t = run(game(3, ["auditor"], { contentOverrides: { bank: { coinsPerPlayer: 6 } } }), mv("p1", "vault", 4), mv("p2", "vault"), ROUND, use("p0", { kind: "audit", room: "office" }));
    expect(t.phase).toMatchObject({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" });
    expect(reason(t, use("p0", { kind: "audit", room: "vault" }))).toMatch(/already audited/);
    t = run(t, { type: "scheduleMeeting", meetingId: "meeting-1", slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "meeting-1" } });
    t = run(t, (x: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: x.meeting?.id } }), ROUND, use("p0", { kind: "audit", room: "vault" }));
    expect(ofType(t.log, "abilityResolved").filter((e) => e.ability.kind === "audit")).toHaveLength(2);
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

describe("Detective: once between meetings, does a player hold anything above the share? — v2 §2, design §8, §9.6", () => {
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
  it("the Detective from 4 players; the Auditor anywhere", () => {
    const at = (n: number, extra: Partial<GameConfig> = {}) => rolePoolFor(config(n, { rolePool: [], deck: "everything", ...extra }));
    for (const r of ["detective"]) {
      expect(at(3)).not.toContain(r);
      expect(at(4)).toContain(r);
    }
    expect(at(3)).toContain("auditor");
    for (const r of ["auditor", "detective"]) expect(POOL_ROLES).toContain(r);
  });
});
