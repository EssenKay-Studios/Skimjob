// Role deck v2 R3b (docs/roles-v2.md §2–§4): the Blackmailer and the Forger
// (accomplices) and the Embezzler (saboteur). design §8, §8.1, §11.2, §11.3, §13
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_POOL, ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { REVEAL, privateTo } from "./types";
import { handleThroughAlibis } from "./alibis.testkit";
import { dealableRoles, rolePoolFor, saboteursFor, setupEvents } from "./setup";
import { dealtKnowledge } from "./accomplices";
import { replay } from "./reduce";
import { seedRng } from "./rng";
import { handleCommand } from "./handle";
import { viewFor } from "./view";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "dark-r3b",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
    job: "bank",
    rolePool: [],
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "open",
    starterMode: false,
    ...extra,
  };
}

/** A new game with seat i dealt roles[i] (Rookie if missing), with the deal's knowledge recomputed for those roles. */
function game(players: number, roles: readonly string[], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  const dealt = cfg.players.map((_, i) => roles[i] ?? "rookie");
  const real = setupEvents(cfg).filter((e) => e.type !== "moleAllies" && e.type !== "alliesLearned" && e.type !== "snitchTargetAssigned");
  const log = real.map((e, i): GameEvent => (e.type === "roleDealt" ? { ...e, role: dealt[real.slice(0, i).filter((x) => x.type === "roleDealt").length] as string } : e));
  const at = log.findIndex((e) => e.type === "roundStarted");
  return replay(cfg, [...log.slice(0, at), ...dealtKnowledge(cfg, dealt, seedRng("x")).value, ...log.slice(at)]);
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
function reason(state: GameState, command: unknown): string {
  const r = handleCommand(state, command);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}
const mv = (player: string, room: string, pocket = 0, extra: Record<string, unknown> = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const watch = (player: string, room: string, extra: Record<string, unknown> = {}) => mv(player, "security", 0, { watch: room, ...extra });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** An emergency called by `caller`, with these ballots (null = skip), closed (and its shakedown window resolved). */
function emergency(s: GameState, caller: PlayerId, ballots: Record<PlayerId, PlayerId | null>): GameState {
  s = run(s, { type: "callEmergency", player: caller }, (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.pendingEmergency?.meetingId } }));
  for (const [player, target] of Object.entries(ballots)) s = run(s, { type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
  s = run(s, (x: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: x.meeting?.id } }));
  return s.phase.kind === "shakedownPending" ? run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.phase.meetingId } }) : s;
}
const lastResult = (s: GameState) => ofType(s.log, "meetingClosed").at(-1);

describe("R3b content and eligibility — v2 §2, §3", () => {
  it("Blackmailer and Forger are accomplices from 7 players, never in Duel; the Embezzler is a saboteur dealt by the setting", () => {
    for (const r of ["blackmailer", "forger"]) {
      expect(ROLES[r]).toMatchObject({ faction: "accomplice", minPlayers: 7, needsMeetings: true });
      expect(DEFAULT_ROLE_POOL).toContain(r);
      expect(rolePoolFor(config(6))).not.toContain(r);
      expect(rolePoolFor(config(7))).toContain(r);
      expect(rolePoolFor(config(2, { duel: true }))).not.toContain(r);
    }
    expect(ROLES.forger).toMatchObject({ knownToSaboteurs: true, rewards: [{ on: "forgedShakenClean", perk: "shield", count: 1 }] });
    // R5 (balance-3.md): take 4 → 1.
    expect(ROLES.embezzler).toMatchObject({ faction: "saboteur", power: { kind: "embezzle", perAct: 1, take: 1 } });
    expect(DEFAULT_ROLE_POOL).not.toContain("embezzler");
    expect(saboteursFor(config(4))).toContain("embezzler");
    // A dealable Forger (a Shield earner) keeps the shakedown window rule independent of who was dealt (design §8.3).
    expect(dealableRoles(config(7, { rolePool: ["forger"] }))).toEqual(["forger", "mole", "embezzler"]);
  });
});

describe("Blackmailer — v2 §2: a right guess steals the victim's vote at the next meeting", () => {
  // p0 Blackmailer, p1 Lookout, p2 Embezzler (saboteur), the rest Rookies.
  const base = game(7, ["blackmailer", "lookout", "embezzler"]);
  const guess = (target: string, role: string) => mv("p0", "lobby", 0, { ability: { kind: "blackmail", target, role } });
  // Four ballots for p4, two skips: a shakedown (4 × 2 > 6), unless p1's vote is the Blackmailer's.
  const ballots = { p0: null, p1: "p4", p3: "p4", p5: "p4", p6: "p4", p2: null };

  it("the victim is told only that its vote is compromised; nobody else hears anything", () => {
    const s = run(base, guess("p1", "lookout"), ROUND);
    const fresh = since(base, s);
    expect(ofType(fresh, "voteCompromised")).toEqual([{ type: "voteCompromised", visibility: privateTo("p1"), player: "p1", round: 1 }]);
    expect(ofType(fresh, "abilityResolved").find((e) => e.player === "p0")?.ability).toEqual({ kind: "blackmail", target: "p1", role: "lookout", correct: true });
    for (const id of ["p3", "p4"]) expect(JSON.stringify(viewFor(s, id))).not.toMatch(/blackmail|voteCompromised/);
    expect(JSON.stringify(viewFor(s, "p1"))).not.toMatch(/blackmail/);
  });

  it("at the next meeting the victim's ballot weighs 0 and the Blackmailer's carries it (the tally still counts ballots)", () => {
    const plain = emergency(run(base, guess("p1", "rookie"), ROUND), "p3", ballots);
    expect(lastResult(plain)?.result).toEqual({ kind: "shakedown", target: "p4" });
    const stolen = emergency(run(base, guess("p1", "lookout"), ROUND), "p3", ballots);
    expect(lastResult(stolen)).toMatchObject({ tally: { skip: 2, targets: { p4: 4 } }, result: { kind: "noMajority" } });
    // Only that meeting: the next one counts every ballot again.
    const after = emergency(stolen, "p5", ballots);
    expect(lastResult(after)?.result).toEqual({ kind: "shakedown", target: "p4" });
  });

  it("the Blackmailer gains exactly +1, whatever the victim's weight: a Smooth Talker victim (×2) counts 0 (v2 §2, design §8; owner, 2 Nov)", () => {
    const talker = game(7, ["blackmailer", "smoothTalker"]);
    const guess = (role: string) => mv("p0", "lobby", 0, { ability: { kind: "blackmail", target: "p1", role } });
    // p0 and p1 (×2) for p4; p2, p3, p5 skip. Unstolen: 3 vs 3, no majority. Stolen: p4 weighs 0 + 1 + 1 = 2
    // against 3 skips (2 × 3 > 5): skipped. Had the Blackmailer taken p1's full weight (2), it would be 3 vs 3 again.
    const votes = { p0: "p4", p1: "p4", p2: null, p3: null, p5: null };
    expect(lastResult(emergency(run(talker, guess("rookie"), ROUND), "p3", votes))?.result).toEqual({ kind: "noMajority" });
    const stolen = emergency(run(talker, guess("smoothTalker"), ROUND), "p3", votes);
    expect(lastResult(stolen)).toMatchObject({ tally: { skip: 3, targets: { p4: 2 } }, result: { kind: "skipped" } });
  });

  it("the victim's vote is lost even if the Blackmailer doesn't vote", () => {
    const s = emergency(run(base, guess("p1", "lookout"), ROUND), "p3", { p1: "p4", p3: "p4", p5: "p4", p6: null, p2: null });
    expect(lastResult(s)?.result).toEqual({ kind: "noMajority" });
  });

  it("guessing a saboteur makes them mutual allies (once)", () => {
    const s = run(base, guess("p2", "embezzler"), ROUND);
    expect(ofType(since(base, s), "alliesLearned")).toEqual([
      { type: "alliesLearned", visibility: privateTo("p0"), player: "p0", allies: ["p2"], via: "blackmail" },
      { type: "alliesLearned", visibility: privateTo("p2"), player: "p2", allies: ["p0"], via: "blackmail" },
    ]);
    expect([s.players.p0?.roleState.allies, s.players.p2?.roleState.allies]).toEqual([["p2"], ["p0"]]);
    const wrong = run(base, guess("p2", "mole"), ROUND);
    expect(ofType(since(base, wrong), "alliesLearned")).toEqual([]);
  });

  it("refuses bad guesses (PR #28: own keys, types), once per act", () => {
    expect(reason(base, guess("__proto__", "rookie"))).toMatch(/unknown player/);
    expect(reason(base, guess("p1", "constructor"))).toMatch(/unknown role/);
    expect(reason(base, mv("p0", "lobby", 0, { ability: { kind: "blackmail", target: { toString: null }, role: "rookie" } }))).toMatch(/unknown player/);
    expect(reason(run(base, guess("p1", "rookie"), ROUND), guess("p1", "lookout"))).toMatch(/already blackmailed/);
  });
});

describe("Forger — v2 §2: a fake sighting on that round's watch feeds", () => {
  // p0 Forger, p1 Lookout, p2 Hacker, p3 Mole; p4–p6 Rookies.
  const base = game(7, ["forger", "lookout", "hacker", "mole"]);
  const forge = (target: string, room: string, at = "lobby") => mv("p0", at, 0, { ability: { kind: "forge", target, room } });
  const watched = (s: GameState, player: string) => ofType(s.log, "roomWatched").filter((e) => e.player === player);

  it("the planted player shows on Security and Lookout feeds of the room, in seat order, like a real sighting; not to room-mates", () => {
    const s = run(base, forge("p5", "vault"), watch("p4", "vault"), mv("p1", "office", 0, { ability: { kind: "lookout", rooms: ["vault"] } }), mv("p6", "vault"), mv("p3", "vault"), ROUND);
    expect(watched(s, "p4")).toEqual([{ type: "roomWatched", visibility: privateTo("p4"), player: "p4", round: 1, source: "security", room: "vault", seen: ["p3", "p5", "p6"] }]);
    expect(watched(s, "p1")[0]?.seen).toEqual(["p3", "p5", "p6"]);
    // Room-mates in the Vault see only who is really there.
    expect(ofType(s.log, "roomSighting").find((e) => e.player === "p6")?.others).toEqual(["p3"]);
    // Only the reveal tells it apart (design §13).
    expect(ofType(s.log, "sightingForged")).toEqual([{ type: "sightingForged", visibility: REVEAL, forger: "p0", round: 1, target: "p5", room: "vault", shownTo: ["p1", "p4"] }]);
    for (const id of s.playerOrder) expect(JSON.stringify(viewFor(s, id)), id).not.toMatch(/sightingForged/);
    expect(ofType(since(base, s), "abilityResolved").find((e) => e.player === "p0")?.ability).toEqual({ kind: "forge", target: "p5", room: "vault" });
  });

  it("nothing changes for a player really in the room, for the planted player's own feed, under a camera loop or in a Power cut", () => {
    const there = run(base, forge("p5", "vault"), watch("p4", "vault"), mv("p5", "vault"), ROUND);
    expect(watched(there, "p4")[0]?.seen).toEqual(["p5"]);
    const self = run(base, forge("p4", "vault"), watch("p4", "vault"), ROUND);
    expect(watched(self, "p4")[0]?.seen).toEqual([]);
    const looped = run(base, forge("p5", "vault"), watch("p4", "vault"), mv("p2", "lobby", 0, { ability: { kind: "loopCameras", room: "vault" } }), ROUND);
    expect(watched(looped, "p4")[0]?.seen).toEqual([]);
    expect(ofType(looped.log, "sightingForged")[0]?.shownTo).toEqual([]);
    const blackout: GameState = { ...base, card: { round: 1, id: "powerCut", room: null, offer: null } };
    expect(watched(run(blackout, forge("p5", "vault"), watch("p4", "vault"), ROUND), "p4")).toEqual([]);
  });

  it("the saboteurs are told the Forger at the deal; the Forger knows nobody", () => {
    expect(ofType(base.log, "alliesLearned").filter((e) => e.player === "p3")).toEqual([
      { type: "alliesLearned", visibility: privateTo("p3"), player: "p3", allies: ["p0"], via: "deal" },
    ]);
    expect(base.players.p0?.roleState.allies).toEqual([]);
  });

  it("a forged player shaken down clean earns the Forger a Shield; dirty earns nothing", () => {
    const s = run(base, forge("p5", "vault"), ROUND);
    const clean = emergency(s, "p4", { p1: "p5", p4: "p5", p6: "p5", p0: "p5" });
    expect(ofType(since(s, clean), "shakedownResolved")[0]).toMatchObject({ target: "p5", clean: true });
    expect(ofType(since(s, clean), "perkGranted")).toEqual([{ type: "perkGranted", visibility: privateTo("p0"), player: "p0", perk: "shield" }]);
    const dirty = run(base, forge("p5", "vault"), mv("p5", "vault", 6), ROUND);
    const shaken = emergency(dirty, "p4", { p1: "p5", p4: "p5", p6: "p5", p0: "p5" });
    expect(ofType(since(dirty, shaken), "shakedownResolved")[0]).toMatchObject({ target: "p5", clean: false });
    expect(ofType(since(dirty, shaken), "perkGranted").filter((e) => e.player === "p0")).toEqual([]);
  });

  it("refuses bad forgeries (PR #28), once per act", () => {
    expect(reason(base, forge("__proto__", "vault"))).toMatch(/unknown player/);
    expect(reason(base, forge("p5", "tellerLine"))).toMatch(/room in play/);
    expect(reason(base, forge("p5", "__proto__"))).toMatch(/room in play/);
    expect(reason(base, mv("p1", "lobby", 0, { ability: { kind: "forge", target: "p5", room: "vault" } }))).toMatch(/no forge/);
    expect(reason(run(base, forge("p5", "vault"), ROUND), forge("p5", "vault"))).toMatch(/already forged/);
  });
});

describe("Embezzler — v2 §2: a take from the Haul, hidden in the round's Haul change", () => {
  // p0 Embezzler, p1 Fence (an accomplice), p2 Detective, the rest Rookies.
  const base = game(7, ["embezzler", "fence", "detective"]);
  const take = (at = "lobby") => mv("p0", at, 0, { ability: { kind: "embezzle" } });
  const TAKE = (ROLES.embezzler?.power as { take: number }).take;
  const vaultAll = (s: GameState) => s.playerOrder.filter((id) => id !== "p0").map((id) => mv(id, "vault"));

  it("moves its take (content: 1 since R5) from the Haul (after the splits) to its stash; only the Embezzler is told, the rest is in the Haul change", () => {
    const plain = run(base, ...vaultAll(base), ROUND);
    const took = run(base, take(), ...vaultAll(base), ROUND);
    const rr = (s: GameState) => ofType(s.log, "roundResolved")[0];
    expect((rr(plain)?.haulDelta ?? 0) - (rr(took)?.haulDelta ?? 0)).toBe(TAKE);
    expect(took.players.p0?.stash).toBe((plain.players.p0?.stash ?? 0) + TAKE);
    expect(ofType(since(base, took), "abilityResolved").find((e) => e.player === "p0")).toMatchObject({ visibility: privateTo("p0"), ability: { kind: "embezzle", amount: TAKE } });
    expect(JSON.stringify(viewFor(took, "p3"))).not.toMatch(/embezzle/);
    // design §8 (v2 §2, PR #36 review): capped at this round's inflow, so the public Haul change is never negative
    // (with the 0.13.0 take of 4, more than the round's inflow of 2).
    const stocked: GameState = { ...game(7, ["embezzler", "fence", "detective"], { contentOverrides: { roles: { embezzler: { take: 4 } } } }), haul: 30 };
    const thin = run(stocked, take("rooftop"), mv("p1", "lobby"), ...base.playerOrder.slice(2).map((id) => mv(id, "rooftop")), ROUND);
    expect(ofType(thin.log, "abilityResolved").find((e) => e.player === "p0")?.ability).toEqual({ kind: "embezzle", amount: 2 });
    expect(ofType(thin.log, "roundResolved")[0]).toMatchObject({ haulDelta: 0, haul: 30 });
    // Nothing handed in: nothing taken.
    const empty = run(base, take("rooftop"), ...base.playerOrder.slice(1).map((id) => mv(id, "rooftop")), ROUND);
    expect(ofType(empty.log, "abilityResolved").find((e) => e.player === "p0")?.ability).toEqual({ kind: "embezzle", amount: 0 });
  });

  it("its first take names one accomplice it didn't know; later ones don't", () => {
    const two = game(7, ["embezzler", "fence", "detective", "hacker"]);
    let s = run(two, take(), ROUND);
    const first = ofType(since(two, s), "alliesLearned");
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ visibility: privateTo("p0"), player: "p0", via: "embezzle" });
    expect(["p1", "p3"]).toContain(first[0]?.allies[0]);
    // On to Act 2 (a meeting nobody votes in), then a second take.
    s = run(s, ROUND, ROUND, { type: "scheduleMeeting", act: 1, slot: "s" }, (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.scheduledMeeting?.meetingId } }));
    s = run(s, (x: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: x.meeting?.id } }));
    expect(s.round).toBe(4);
    const later = run(s, take(), ROUND);
    expect(ofType(since(s, later), "abilityResolved").find((e) => e.player === "p0")?.ability.kind).toBe("embezzle");
    expect(ofType(since(s, later), "alliesLearned")).toEqual([]);
  });

  it("a shakedown always finds it dirty while it holds a take, and returns the whole stash to the Haul; the Detective agrees", () => {
    const s = run(base, take(), ROUND);
    expect(s.players.p0?.stash).toBe(TAKE);
    const check = run(s, { type: "useAbility", player: "p2", ability: { kind: "checkStash", target: "p0" } });
    // Threshold 3 in Act 1: the take alone is below it, yet it reads dirty; and so with the stash forced to 1.
    expect(ofType(since(s, check), "abilityResolved")[0]?.ability).toMatchObject({ dirty: true });
    const low: GameState = { ...s, players: { ...s.players, p0: { ...(s.players.p0 as NonNullable<typeof s.players.p0>), stash: 1 } } };
    const lowCheck = run(low, { type: "useAbility", player: "p2", ability: { kind: "checkStash", target: "p0" } });
    expect(ofType(since(low, lowCheck), "abilityResolved")[0]?.ability).toMatchObject({ dirty: true });
    const shaken = emergency(low, "p3", { p1: "p0", p2: "p0", p3: "p0", p4: "p0" });
    expect(ofType(since(low, shaken), "shakedownResolved")[0]).toMatchObject({ target: "p0", stashRevealed: 1, taken: 1, clean: false, compensation: 0 });
    // After the shakedown returned the take, a small stash is clean again.
    const again = emergency(run(shaken, mv("p0", "lobby", 1), ROUND), "p4", { p1: "p0", p2: "p0", p3: "p0", p4: "p0" });
    expect(ofType(since(shaken, again), "shakedownResolved")[0]).toMatchObject({ target: "p0", clean: true });
  });

  it("once per act; refused for other roles", () => {
    expect(reason(run(base, take(), ROUND), take())).toMatch(/already embezzled/);
    expect(reason(base, mv("p1", "lobby", 0, { ability: { kind: "embezzle" } }))).toMatch(/no embezzle/);
  });
});
