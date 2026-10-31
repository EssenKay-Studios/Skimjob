// Content overrides on the game config: validation (untrusted JSON) and their
// effect on the rules. design §17.4 "config overrides"
import { describe, expect, it } from "vitest";
import { BANK_JOB, CONTENT_VERSION, ROLES } from "@skimjob/content";
import type { Command, ContentOverrides, GameConfig, GameEvent, GameState } from "./types";
import { setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { jobFor, overrideJob, overrideRoles, rolesFor, validateOverrides } from "./overrides";
import { ranking } from "./end";
import { viewFor } from "./view";

function config(players: number, contentOverrides?: unknown): GameConfig {
  return {
    seed: "override-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...(contentOverrides !== undefined && { contentOverrides: contentOverrides as ContentOverrides }),
  };
}

/** A new game with chosen roles (seat i gets roles[i], Rookie if missing). */
function game(cfg: GameConfig, roles: string[] = []): GameState {
  const log = setupEvents(cfg).map((e, i, all): GameEvent => {
    if (e.type !== "roleDealt") return e;
    const seat = all.slice(0, i).filter((x) => x.type === "roleDealt").length;
    return { ...e, role: roles[seat] ?? "rookie" };
  });
  return replay(cfg, log);
}

function run(state: GameState, ...commands: Command[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleCommand(s, c);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
    return r.state;
  }, state);
}

const submit = (player: string, move: Record<string, unknown>): Command =>
  ({ type: "submitMove", player, move: { pocket: 0, ...move } }) as Command;
const ROUND = (s: GameState): Command => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const after = (s: GameState, ...commands: ((s: GameState) => Command)[]): GameState =>
  commands.reduce((st, c) => run(st, c(st)), s);

describe("validateOverrides — configs are untrusted JSON (design §17.4)", () => {
  const errs = (raw: unknown) => validateOverrides(raw, BANK_JOB);

  it("accepts no overrides and a full, valid override", () => {
    expect(errs(undefined)).toEqual([]);
    expect(errs(null)).toEqual([]);
    expect(errs({})).toEqual([]);
    expect(
      errs({
        rooms: { vault: { loot: 7, heatPressure: 25.5 }, depositBoxes: { capacity: { max: 3, crowdedLoot: 2 } } },
        heat: { max: 120, perRound: 3.5, missedCheckpoint: 10 },
        checkpoints: { perPlayer: [5, 12, 20] },
        shakedown: { cleanBelowPerAct: 2.5, compensationPerAct: 4 },
        roles: { rookie: { stashMultiplier: 1.3 }, lookout: { extraRooms: 2 }, fence: { perAct: 6 }, insider: { perLootOverFinalTarget: 0.5 } },
      }),
    ).toEqual([]);
  });

  it("rejects non-objects and unknown sections", () => {
    expect(errs(5)).toEqual(["contentOverrides must be an object"]);
    expect(errs([])).toEqual(["contentOverrides must be an object"]);
    expect(errs({ events: {} })).toEqual(["contentOverrides.events is not an overridable section"]);
    expect(errs({ rooms: [] })).toEqual(["contentOverrides.rooms must be an object"]);
    expect(errs({ heat: "hot" })).toEqual(["contentOverrides.heat must be an object"]);
  });

  it("rejects rooms the job doesn't have, including prototype keys from JSON.parse", () => {
    expect(errs({ rooms: { casinoFloor: { loot: 3 } } })).toEqual(["contentOverrides.rooms.casinoFloor: job bank has no such room"]);
    expect(errs(JSON.parse('{"rooms":{"__proto__":{"loot":3}}}'))).toHaveLength(1);
    expect(errs({ rooms: { toString: { loot: 3 } } })).toHaveLength(1);
  });

  it("rejects bad numbers: fractions where loot is counted, NaN, Infinity, strings, negatives", () => {
    expect(errs({ rooms: { vault: { loot: 6.5 } } })).toEqual(["contentOverrides.rooms.vault.loot must be a whole number, 0 or more"]);
    expect(errs({ rooms: { vault: { loot: -1 } } })).toHaveLength(1);
    expect(errs({ rooms: { vault: { loot: "6" } } })).toHaveLength(1);
    expect(errs({ rooms: { vault: { heatPressure: Number.NaN } } })).toHaveLength(1);
    expect(errs({ heat: { perRound: Number.POSITIVE_INFINITY } })).toHaveLength(1);
    expect(errs({ heat: { max: 0 } })).toHaveLength(1);
    expect(errs({ shakedown: { compensationPerAct: 1.5 } })).toHaveLength(1);
    expect(errs({ roles: { rookie: { stashMultiplier: -0.1 } } })).toHaveLength(1);
  });

  it("rejects unknown fields, so a typo isn't silently ignored", () => {
    expect(errs({ rooms: { vault: { lot: 7 } } })).toEqual(["contentOverrides.rooms.vault.lot is not an overridable field"]);
    expect(errs({ heat: { perround: 3 } })).toHaveLength(1);
    expect(errs({ rooms: { vault: { name: "Big vault" } } })).toHaveLength(1);
    expect(errs({ checkpoints: { perAct: [1, 2, 3] } })).toHaveLength(1);
  });

  it("checkpoints need one whole number per act", () => {
    expect(errs({ checkpoints: { perPlayer: [6, 14] } })).toHaveLength(1);
    expect(errs({ checkpoints: { perPlayer: [6, 14, 22.5] } })).toHaveLength(1);
    expect(errs({ checkpoints: { perPlayer: "6,14,22" } })).toHaveLength(1);
  });

  it("capacity only for rooms that have one; powers only for the role that has them", () => {
    expect(errs({ rooms: { vault: { capacity: { max: 2 } } } })).toEqual(["contentOverrides.rooms.vault.capacity: the Vault has no capacity"]);
    expect(errs({ rooms: { depositBoxes: { capacity: { max: 0 } } } })).toHaveLength(1);
    expect(errs({ roles: { fence: { extraRooms: 2 } } })).toEqual(["contentOverrides.roles.fence.extraRooms is not an overridable field"]);
    expect(errs({ roles: { lookout: { perAct: 2 } } })).toHaveLength(1);
    expect(errs({ roles: { mole: { stashMultiplier: 2 } } })).toEqual(["contentOverrides.roles.mole: no such role"]);
  });

  it("a crowded room can't pay more than its loot (checkMove bounds pockets by loot, design §6.2)", () => {
    expect(errs({ rooms: { depositBoxes: { loot: 2 } } })).toEqual(["contentOverrides.rooms.depositBoxes: crowded loot (3) can't be more than loot (2)"]);
    expect(errs({ rooms: { depositBoxes: { capacity: { crowdedLoot: 6 } } } })).toHaveLength(1);
    expect(errs({ rooms: { depositBoxes: { loot: 2, capacity: { crowdedLoot: 2 } } } })).toEqual([]);
  });

  it("validateConfig reports override errors, and setupEvents refuses them", () => {
    expect(validateConfig(config(4, { heat: { perRound: "4" } }))).toEqual(["contentOverrides.heat.perRound must be a finite number"]);
    expect(validateConfig(config(4, { heat: { perRound: 5 } }))).toEqual([]);
    expect(validateConfig(config(4, null))).toEqual([]);
    expect(() => setupEvents(config(4, { rooms: { moon: {} } }))).toThrow(/no such room/);
  });
});

describe("merging overrides (design §17.4)", () => {
  it("changes only the named numbers and never the shipped content", () => {
    const before = JSON.stringify([BANK_JOB, ROLES]);
    const job = overrideJob(BANK_JOB, { rooms: { vault: { loot: 9 }, depositBoxes: { capacity: { crowdedLoot: 1 } } }, heat: { perRound: 2 } });
    expect(job.rooms.vault).toEqual({ ...BANK_JOB.rooms.vault, loot: 9 });
    expect(job.rooms.depositBoxes?.capacity).toEqual({ max: 2, crowdedLoot: 1 });
    expect(job.heat).toEqual({ ...BANK_JOB.heat, perRound: 2 });
    expect(job.checkpoints).toBe(BANK_JOB.checkpoints);
    const roles = overrideRoles(ROLES, { roles: { lookout: { extraRooms: 2, stashMultiplier: 1.1 } } });
    expect(roles.lookout?.power).toEqual({ kind: "lookout", extraRooms: 2 });
    expect(roles.lookout?.scoring).toEqual({ stashMultiplier: 1.1, perLootOverFinalTarget: 0 });
    expect(roles.rookie).toBe(ROLES.rookie);
    expect(JSON.stringify([BANK_JOB, ROLES])).toBe(before);
  });

  it("no overrides plays the shipped content", () => {
    expect(jobFor(config(4))).toBe(BANK_JOB);
    expect(rolesFor(config(4, null))).toBe(ROLES);
  });
});

describe("overrides in play (design §17.4)", () => {
  it("gameCreated is public and carries the content version and overrides", () => {
    const overrides = { heat: { perRound: 7 } };
    const created = setupEvents(config(3, overrides))[0];
    expect(created).toMatchObject({ type: "gameCreated", visibility: { kind: "public" }, contentVersion: CONTENT_VERSION, contentOverrides: overrides });
    expect(setupEvents(config(3))[0]).toMatchObject({ contentOverrides: null });
    // Every player sees the rules they play by.
    const s = game(config(3, overrides));
    expect(viewFor(s, "p1").ledger[0]?.event).toMatchObject({ contentOverrides: overrides });
  });

  it("room loot and Heat numbers change resolution (design §6, §7)", () => {
    const s0 = game(config(2, { rooms: { vault: { loot: 9, heatPressure: 0 } }, heat: { perRound: 10 } }));
    const s1 = after(s0, () => submit("p0", { room: "vault", pocket: 9 }), () => submit("p1", { room: "vault" }), ROUND);
    expect(s1.players.p0?.stash).toBe(9);
    expect(s1.haul).toBe(9);
    expect(s1.heat).toBe(10);
    // A pocket above the overridden loot is refused, like the shipped one.
    expect(handleCommand(s1, submit("p0", { room: "vault", pocket: 10 })).ok).toBe(false);
  });

  it("checkpoint targets and the missed-checkpoint penalty change (design §11.5)", () => {
    const s0 = game(config(2, { checkpoints: { perPlayer: [1, 2, 3] }, heat: { missedCheckpoint: 0 } }));
    let s = s0;
    for (let i = 0; i < 3; i++) s = after(s, () => submit("p0", { room: "lobby" }), () => submit("p1", { room: "lobby" }), ROUND);
    s = run(s, { type: "scheduleMeeting", act: 1, slot: "x" });
    s = run(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } });
    s = run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "act-1" } });
    expect(s.log.find((e) => e.type === "checkpointChecked")).toMatchObject({ target: 2, met: true });
  });

  it("shakedown numbers change the clean threshold and compensation (design §11.3)", () => {
    // Clean below 10 × act; a clean target is paid 2 × act.
    const s0 = game(config(3, { shakedown: { cleanBelowPerAct: 10, compensationPerAct: 2 } }));
    let s = s0;
    for (let i = 0; i < 3; i++) {
      s = after(s, () => submit("p0", { room: "vault", pocket: i === 0 ? 6 : 0 }), () => submit("p1", { room: "lobby" }), () => submit("p2", { room: "lobby" }), ROUND);
    }
    s = run(s, { type: "scheduleMeeting", act: 1, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } });
    s = run(
      s,
      { type: "castVote", player: "p1", vote: { kind: "shakedown", target: "p0" } },
      { type: "castVote", player: "p2", vote: { kind: "shakedown", target: "p0" } },
      { type: "advance", deadline: { kind: "closeMeeting", meetingId: "act-1" } },
    );
    // A stash of 6 would be caught with the shipped numbers (clean below 3); here it's clean.
    expect(s.log.find((e) => e.type === "shakedownResolved")).toMatchObject({ target: "p0", stashRevealed: 6, clean: true, compensation: 2 });
  });

  it("role numbers change powers and scoring (design §8)", () => {
    const cfg = config(5, { roles: { lookout: { extraRooms: 2 }, rookie: { stashMultiplier: 2 } } });
    const s0 = game(cfg, ["lookout", "rookie"]);
    // The Lookout may now watch two rooms.
    const s1 = run(s0, submit("p0", { room: "lobby", ability: { kind: "lookout", rooms: ["vault", "office"] } }));
    expect(s1.moves.p0?.ability).toEqual({ kind: "lookout", rooms: ["vault", "office"] });
    const s2 = after(s1, () => submit("p1", { room: "office", pocket: 3 }), ROUND);
    expect(ranking(s2).find((e) => e.player === "p1")?.score).toBe(6);
  });
});
