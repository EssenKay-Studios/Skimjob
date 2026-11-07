// Content overrides on the game config: validation (untrusted JSON) and their
// effect on the rules. design §17.4 "config overrides"
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { BANK_JOB, CONTENT_VERSION, EVENTS, ROLES, STARTER_ROLES } from "@skimjob/content";
import type { Command, ContentOverrides, GameConfig, GameEvent, GameState } from "./types";
import { setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { eventsFor, jobFor, overrideEvents, overrideJob, overrideRoles, rolesFor, validateOverrides } from "./overrides";
import { ranking } from "./end";
import { viewFor } from "./view";

function config(players: number, contentOverrides?: unknown): GameConfig {
  return {
    seed: "override-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [...STARTER_ROLES], // a shakedown window only if the shop holds a Shield
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
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
    const r = handleThroughAlibis(s, c);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
    return r.state;
  }, state);
}

/** A submitMove; with no `duffel`, the rest of the room's 1-coin-or-more grab goes into the duffel. */
const submit = (player: string, move: Record<string, unknown>): Command =>
  ({ type: "submitMove", player, move: { duffel: 1, pocket: 0, ...move } }) as Command;
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
        rooms: { vault: { coins: 7, quietCoins: 1 } },
        bank: { coinsPerPlayer: 20 },
        alarm: { bulbs: 5, tapedRounds: 3, bustStars: 4 },
        checkpoints: { perPlayer: [5, 12, 20] },
        shakedown: { cleanBelow: 5, payout: 4 },
        perks: { peek: { cost: 3 } },
        roles: { rookie: { rewardCount: 2 }, lookout: { extraRooms: 2 }, hacker: { perAct: 6 }, mole: { perAct: 2 } },
      }),
    ).toEqual([]);
  });

  it("rejects non-objects and unknown sections", () => {
    expect(errs(5)).toEqual(["contentOverrides must be an object"]);
    expect(errs([])).toEqual(["contentOverrides must be an object"]);
    expect(errs({ deck: {} })).toEqual(["contentOverrides.deck is not an overridable section"]);
    expect(errs({ rooms: [] })).toEqual(["contentOverrides.rooms must be an object"]);
    expect(errs({ alarm: "loud" })).toEqual(["contentOverrides.alarm must be an object"]);
    // R6 Heat and police activity are gone (design §5).
    expect(errs({ heat: {} })).toEqual(["contentOverrides.heat is not an overridable section"]);
    expect(errs({ police: {} })).toEqual(["contentOverrides.police is not an overridable section"]);
  });

  it("rejects rooms the job doesn't have, including prototype keys from JSON.parse", () => {
    expect(errs({ rooms: { casinoFloor: { coins: 3 } } })).toEqual(["contentOverrides.rooms.casinoFloor: job bank has no such room"]);
    expect(errs(JSON.parse('{"rooms":{"__proto__":{"coins":3}}}'))).toHaveLength(1);
    expect(errs({ rooms: { toString: { coins: 3 } } })).toHaveLength(1);
  });

  it("rejects bad numbers: fractions where coins are counted, NaN, Infinity, strings, negatives", () => {
    expect(errs({ rooms: { vault: { coins: 6.5 } } })).toEqual(["contentOverrides.rooms.vault.coins must be a whole number, 1 or more"]);
    expect(errs({ rooms: { vault: { coins: -1 } } })).toHaveLength(1);
    expect(errs({ rooms: { vault: { coins: "6" } } })).toHaveLength(1);
    expect(errs({ bank: { coinsPerPlayer: 0 } })).toEqual(["contentOverrides.bank.coinsPerPlayer must be a whole number, 1 or more"]);
    expect(errs({ bank: { coinsPerPlayer: 2.5 } })).toHaveLength(1);
    expect(errs({ bank: { perPlayer: 16 } })).toEqual(["contentOverrides.bank.perPlayer is not an overridable field"]);
    expect(errs({ rooms: { vault: { quietCoins: Number.NaN } } })).toHaveLength(1);
    expect(errs({ rooms: { vault: { quietCoins: -1 } } })).toHaveLength(1);
    expect(errs({ alarm: { bulbs: Number.POSITIVE_INFINITY } })).toHaveLength(1);
    expect(errs({ alarm: { bulbs: 0 } })).toEqual(["contentOverrides.alarm.bulbs must be a whole number, 1 or more"]);
    expect(errs({ alarm: { tapedRounds: 0 } })).toHaveLength(1);
    expect(errs({ alarm: { bustStars: 1.5 } })).toHaveLength(1);
    expect(errs({ shakedown: { payout: 1.5 } })).toHaveLength(1);
    // extension.md "One vote rule": no plurality numbers any more.
    expect(errs({ shakedown: { pluralityFromPlayers: 10 } })).toHaveLength(1);
    expect(errs({ perks: { peek: { cost: -1 } } })).toHaveLength(1);
    expect(errs({ perks: { jetpack: { cost: 1 } } })).toEqual(["contentOverrides.perks.jetpack: no such perk"]);
    expect(errs({ roles: { mole: { perAct: 0 } } })).toHaveLength(1);
  });

  it("rejects unknown fields, so a typo isn't silently ignored", () => {
    expect(errs({ rooms: { vault: { lot: 7 } } })).toEqual(["contentOverrides.rooms.vault.lot is not an overridable field"]);
    expect(errs({ alarm: { bulb: 3 } })).toHaveLength(1);
    expect(errs({ rooms: { vault: { name: "Big vault" } } })).toHaveLength(1);
    expect(errs({ checkpoints: { perAct: [1, 2, 3] } })).toHaveLength(1);
  });

  it("checkpoints need one whole number per act", () => {
    expect(errs({ checkpoints: { perPlayer: [6, 14] } })).toHaveLength(1);
    expect(errs({ checkpoints: { perPlayer: [6, 14, 22.5] } })).toHaveLength(1);
    expect(errs({ checkpoints: { perPlayer: "6,14,22" } })).toHaveLength(1);
  });

  it("a coin room keeps 1 coin or more and a no-coin room stays at 0 (design §3.2); powers only for the role that has them", () => {
    expect(errs({ rooms: { lobby: { coins: 0 } } })).toEqual(["contentOverrides.rooms.lobby.coins must be a whole number, 1 or more"]);
    expect(errs({ rooms: { rooftop: { coins: 2 } } })).toEqual(["contentOverrides.rooms.rooftop.coins is not an overridable field"]);
    expect(errs({ rooms: { security: { coins: 0 } } })).toEqual(["contentOverrides.rooms.security.coins is not an overridable field"]);
    expect(errs({ rooms: { rooftop: { quietCoins: 1 } } })).toEqual(["contentOverrides.rooms.rooftop.quietCoins is not an overridable field"]);
    expect(errs({ rooms: { depositBoxes: { capacity: { max: 2 } } } })).toEqual(["contentOverrides.rooms.depositBoxes.capacity is not an overridable field"]);
    expect(errs({ roles: { hacker: { extraRooms: 2 } } })).toEqual(["contentOverrides.roles.hacker.extraRooms is not an overridable field"]);
    expect(errs({ roles: { lookout: { perAct: 2 } } })).toHaveLength(1);
    expect(errs({ roles: { wizard: { rewardCount: 2 } } })).toEqual(["contentOverrides.roles.wizard: no such role"]);
    expect(errs({ roles: { mole: { perAct: 2 } } })).toEqual([]);
    expect(errs({ roles: { mole: { perGame: 3 } } })).toEqual(["contentOverrides.roles.mole.perGame is not an overridable field"]);
    expect(errs({ roles: { fixer: { stopAt: 90 } } })).toEqual(["contentOverrides.roles.fixer.stopAt is not an overridable field"]);
  });

  it("event cards: each card tunes only its own effect's numbers (design §10, balance pass 2)", () => {
    expect(errs({ events: { shiftChange: { extraCoins: 2 } } })).toEqual([]);
    expect(errs({ events: { shiftChange: { lootMultiplier: 2 } } })).toEqual(["contentOverrides.events.shiftChange.lootMultiplier is not an overridable field"]);
    expect(errs({ events: { shiftChange: { extraCoins: 0.5 } } })).toHaveLength(1);
    expect(errs({ events: { shiftChange: { loss: 3 } } })).toEqual(["contentOverrides.events.shiftChange.loss is not an overridable field"]);
    // Police patrol has left the deck.
    expect(errs({ events: { policePatrol: { amount: 10 } } })).toEqual(["contentOverrides.events.policePatrol: no such event card"]);
    expect(errs({ events: { audit: { amount: 1 } } })).toHaveLength(1);
    expect(errs({ events: { shiftChange: { heatMultiplier: 2 } } })).toEqual(["contentOverrides.events.shiftChange.heatMultiplier is not an overridable field"]);
    expect(errs({ events: { shiftChange: { extraCoins: Infinity } } })).toHaveLength(1);
    expect(errs({ events: { meteor: { amount: 1 } } })).toEqual(["contentOverrides.events.meteor: no such event card"]);
    expect(errs({ events: [] })).toHaveLength(1);
    const tuned = overrideEvents(EVENTS, { events: { shiftChange: { extraCoins: 3 } } });
    expect(tuned.shiftChange?.effect).toEqual({ kind: "roomSurge", room: "vault", extraCoins: 3 });
    expect(tuned.audit).toBe(EVENTS.audit);
    expect(eventsFor({ contentOverrides: null })).toBe(EVENTS);
  });

  it("validateConfig reports override errors, and setupEvents refuses them", () => {
    expect(validateConfig(config(4, { alarm: { bulbs: "4" } } as never))).toEqual(["contentOverrides.alarm.bulbs must be a whole number, 1 or more"]);
    expect(validateConfig(config(4, { alarm: { bulbs: 5 } }))).toEqual([]);
    expect(validateConfig(config(4, null))).toEqual([]);
    expect(() => setupEvents(config(4, { rooms: { moon: {} } }))).toThrow(/no such room/);
  });
});

describe("merging overrides (design §17.4)", () => {
  it("changes only the named numbers and never the shipped content", () => {
    const before = JSON.stringify([BANK_JOB, ROLES]);
    const job = overrideJob(BANK_JOB, { rooms: { vault: { coins: 9 } }, bank: { coinsPerPlayer: 5 }, alarm: { bustStars: 2 } });
    expect(job.rooms.vault).toEqual({ ...BANK_JOB.rooms.vault, coins: 9 });
    expect(job.rooms.office).toBe(BANK_JOB.rooms.office);
    expect(job.bank).toEqual({ coinsPerPlayer: 5 });
    expect(job.alarm).toEqual({ ...BANK_JOB.alarm, bustStars: 2 });
    expect(job.checkpoints).toBe(BANK_JOB.checkpoints);
    const roles = overrideRoles(ROLES, { roles: { lookout: { extraRooms: 2, rewardCount: 3 } } });
    expect(roles.lookout?.power).toEqual({ kind: "lookout", extraRooms: 2 });
    expect(roles.lookout?.rewards).toEqual([{ on: "watchedShakenDirty", count: 3 }]);
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
    const overrides = { alarm: { bulbs: 7 } };
    const created = setupEvents(config(3, overrides))[0];
    expect(created).toMatchObject({ type: "gameCreated", visibility: { kind: "public" }, contentVersion: CONTENT_VERSION, contentOverrides: overrides });
    expect(setupEvents(config(3))[0]).toMatchObject({ contentOverrides: null });
    // Every player sees the rules they play by.
    const s = game(config(3, overrides));
    expect(viewFor(s, "p1").ledger[0]?.event).toMatchObject({ contentOverrides: overrides });
  });

  it("room coins and noise, the bank and the alarm numbers change resolution (design §3.1, §5, §6.1)", () => {
    const s0 = game(config(3, { rooms: { vault: { coins: 9, quietCoins: 9 } }, bank: { coinsPerPlayer: 20 }, alarm: { bulbs: 2 } }));
    expect(s0.bank).toBe(60);
    const s1 = after(s0, () => submit("p0", { room: "vault", duffel: 0, pocket: 9 }), () => submit("p1", { room: "vault", duffel: 9 }), () => submit("p2", { room: "vault", duffel: 9 }), ROUND);
    expect(s1.players.p0?.stash).toBe(9);
    expect(s1.haul).toBe(18);
    expect(s1.bank).toBe(60 - 27);
    // A silent Vault: no ring, so no raid.
    expect(s1.bells.vault).toBe(0);
    expect(s1.wanted).toBe(0);
    // Two Office grabs of 2 ring twice: a 2-bulb bell raids. design §5.3
    const s2 = after(s1, () => submit("p0", { room: "office", duffel: 2 }), () => submit("p1", { room: "office", duffel: 2 }), ROUND);
    expect(s2.taped).toEqual({ office: 4 });
    expect(s2.wanted).toBe(1);
    // A grab above the overridden limit is refused, like the shipped one.
    expect(handleThroughAlibis(s1, submit("p0", { room: "vault", duffel: 0, pocket: 10 })).ok).toBe(false);
  });

  it("checkpoint targets change (design §11.5)", () => {
    const s0 = game(config(3, { checkpoints: { perPlayer: [1, 2, 3] } }));
    let s = s0;
    for (let i = 0; i < 3; i++) s = after(s, () => submit("p0", { room: "lobby" }), () => submit("p1", { room: "lobby" }), () => submit("p2", { room: "lobby" }), ROUND);
    s = run(s, { type: "scheduleMeeting", act: 1, slot: "x" });
    s = run(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } });
    s = run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "act-1" } });
    expect(s.log.find((e) => e.type === "checkpointChecked")).toMatchObject({ target: 3, met: true });
  });

  it("shakedown numbers change the clean line and payout (extension.md \"Shakedowns\")", () => {
    // Clean below 10; a clean target is paid 2.
    const s0 = game(config(3, { shakedown: { cleanBelow: 10, payout: 2 } }));
    let s = s0;
    for (let i = 0; i < 3; i++) {
      s = after(s, () => submit("p0", { room: "vault", duffel: i < 2 ? 0 : 3, pocket: i < 2 ? 3 : 0 }), () => submit("p1", { room: "lobby" }), () => submit("p2", { room: "lobby" }), ROUND);
    }
    s = run(s, { type: "scheduleMeeting", act: 1, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } });
    s = run(
      s,
      { type: "castVote", player: "p1", vote: { kind: "shakedown", target: "p0" } },
      { type: "castVote", player: "p2", vote: { kind: "shakedown", target: "p0" } },
      { type: "advance", deadline: { kind: "closeMeeting", meetingId: "act-1" } },
    );
    // A stash of 6 would be caught with the shipped numbers (clean below 6); here it's clean.
    expect(s.log.find((e) => e.type === "shakedownResolved")).toMatchObject({ target: "p0", stashRevealed: 6, clean: true, compensation: 2 });
  });

  it("role numbers change powers (design §8)", () => {
    const cfg = config(5, { roles: { lookout: { extraRooms: 2 } } });
    const s0 = game(cfg, ["lookout", "rookie"]);
    // The Lookout may now watch two rooms.
    const s1 = run(s0, submit("p0", { room: "lobby", ability: { kind: "lookout", rooms: ["vault", "office"] } }));
    expect(s1.moves.p0?.ability).toEqual({ kind: "lookout", rooms: ["vault", "office"] });
  });
});
