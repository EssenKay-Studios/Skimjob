// Crew meetings and votes: regular meetings at the bank's thirds, police
// briefings after raids, the crew's emergency pool in the result window,
// scheduling, ballots and their visibility, sealed votes, quorum and majority,
// shakedowns against the share and their protection. design §9, §4.2, §6.2
import { MAX_SLOT_LENGTH, STARTER_ROLES, type PerkId } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import type { ContentOverrides, GameConfig, GameEvent, GameState, VoteVisibility } from "./types";
import { canSee } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { meetingResult } from "./meeting";
import { viewFor } from "./view";
import { fullGrab } from "./grab.testkit";
import { grantPerks } from "./perks.testkit";

/** One perk per column and no Shield, whatever the seed: a Shield in the shop opens a shakedown window at every meeting. */
const SHOP_NO_SHIELD: readonly PerkId[] = ["peek", "alibi", "extraVote"];

/**
 * Pinned numbers: big grabs, a bank of 6 coins a player (18 for 3 players: a
 * third is gone at 12 or below, two at 6 or below) and bells too big to raid.
 */
const PINS: ContentOverrides = { rooms: { vault: { coins: 6 }, office: { coins: 6 }, lobby: { coins: 2 } }, bank: { coinsPerPlayer: 6 }, alarm: { bulbs: 1000 } };
/** A bank too big for a third to go (no regular meeting) and real bells (a 6-coin Vault grab raids). */
const RAIDS: ContentOverrides = { ...PINS, bank: { coinsPerPlayer: 100 }, alarm: { bulbs: 4 } };
const BIG_BANK: ContentOverrides = { ...PINS, bank: { coinsPerPlayer: 100 } };

function config(players: number, voteVisibility: VoteVisibility = "hiddenThenRevealed", contentOverrides: ContentOverrides = PINS): GameConfig {
  return {
    seed: "meeting-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [...STARTER_ROLES],
    eventsEnabled: false,
    voteVisibility,
    contentOverrides,
  };
}

/** A new game with chosen roles (seat i gets roles[i], Rookie if missing) and a pinned shop. */
function game(players: number, roles: string[] = [], mode?: VoteVisibility, overrides?: ContentOverrides, shop: readonly PerkId[] = SHOP_NO_SHIELD): GameState {
  const cfg = config(players, mode, overrides);
  const log = setupEvents(cfg).map((e, i, all): GameEvent => {
    if (e.type === "shopDealt") return { ...e, perks: shop };
    if (e.type !== "roleDealt") return e;
    const seat = all.slice(0, i).filter((x) => x.type === "roleDealt").length;
    return { ...e, role: roles[seat] ?? "rookie" };
  });
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    const r = handleCommand(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const before = JSON.stringify(state);
  const r = handleCommand(state, command);
  if (r.ok) throw new Error("expected a rejection");
  expect(JSON.stringify(state)).toBe(before);
  return r.reason;
}
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const LAST = <T extends GameEvent["type"]>(s: GameState, type: T) => ofType(s.log, type).at(-1);

const mv = (player: string, room: string, pocket = 0, overrides: ContentOverrides = PINS) => ({ type: "submitMove", player, move: fullGrab(room, pocket, overrides) });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const ALIBIS = (s: GameState) => ({ type: "advance", deadline: { kind: "alibis", round: s.resolvedRound } });
const RESULT = (s: GameState) => ({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } });
const open = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId } });
const close = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId } });
const sched = (meetingId: unknown, slot: unknown = "slot") => ({ type: "scheduleMeeting", meetingId, slot });
const propose = (player: string, slot: unknown) => ({ type: "proposeMeeting", player, slot });
const accept = (player: string, proposalId: unknown) => ({ type: "acceptMeeting", player, proposalId });
const emergency = (player: string) => ({ type: "callEmergency", player });
const choice = (target: string | null) => (target === null ? { kind: "skip" } : { kind: "shakedown", target });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: choice(target) });
const seal = (player: string, target: string | null) => ({ type: "sealVote", player, vote: choice(target) });
/** The server picks the due meeting's slot (`awaitingMeeting`). */
const SCHED = (s: GameState) => sched(s.phase.kind === "awaitingMeeting" ? s.phase.meetingId : null);
const OPEN = (s: GameState) => open(s.scheduledMeeting?.meetingId ?? s.pendingEmergency?.meetingId);
const CLOSE = (s: GameState) => close(s.meeting?.id);
/** A round's deadline and then its alibis' (nobody posts). */
const RESOLVE = [ROUND, ALIBIS];

/**
 * 3 Rookies. Round 1: p0 pockets the Vault's 6; p1 and p2 miss (the Lobby, 1
 * coin handed in each, design §3.3). The bank drops from 18 to 10, past
 * two-thirds, so the regular meeting opens. The split: 2 coins 3 ways, share 0, kitty 2.
 */
function regularMeeting(roles: string[] = [], mode?: VoteVisibility): GameState {
  return run(game(3, roles, mode), mv("p0", "vault", 6), ...RESOLVE, SCHED, OPEN);
}

describe("regular meetings at the bank's thirds — design §9.1, §4.2 step 9", () => {
  it("a regular meeting follows the round in which the bank first drops to two-thirds, after its alibis; not before", () => {
    // Round 1: everyone misses, 3 coins taken: 15 of 18 left, no third gone.
    let s = run(game(3), ...RESOLVE);
    expect([s.bank, s.thirds, s.meetingDue]).toEqual([15, 0, null]);
    expect(s.phase).toEqual({ kind: "result", round: 1 });
    // Round 2: p0's Vault grab leaves 15 − 6 − 2 = 7: a third is gone.
    s = run(s, RESULT, mv("p0", "vault"), ROUND);
    expect([s.bank, s.thirds, s.meetingDue, s.phase.kind]).toEqual([7, 1, "regular", "alibis"]);
    s = run(s, ALIBIS);
    expect(s.phase).toEqual({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" });
    const before = run(s, SCHED);
    s = run(before, OPEN);
    expect(since(before, s)).toEqual([{ type: "meetingOpened", visibility: { kind: "public" }, meetingId: "meeting-1", kind: "regular" }]);
    expect(s.meeting).toEqual({ id: "meeting-1", kind: "regular", calledBy: null, votes: {}, extraVotes: [], ballotGrants: {} });
    expect([s.meetingDue, s.scheduledMeeting, s.stretch]).toEqual([null, null, 2]);
  });

  it("then again at one-third; a round crossing both thirds calls one regular meeting, and no third calls another", () => {
    // p0 and p1 grab the Vault's 6 each: 18 − 12 − 1 = 5 left, two thirds gone at once.
    let s = run(game(3), mv("p0", "vault"), mv("p1", "vault"), ...RESOLVE);
    expect([s.bank, s.thirds]).toEqual([5, 2]);
    expect(s.phase).toMatchObject({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" });
    s = run(s, SCHED, OPEN, CLOSE, RESULT, mv("p0", "lobby"), ...RESOLVE);
    // 5 − 2 − 2 = 1 left: no third left to cross, so the result window follows.
    expect([s.bank, s.phase.kind]).toEqual([1, "result"]);
    expect(ofType(s.log, "meetingOpened")).toHaveLength(1);

    // One third at a time: 18 → 10 (meeting-1), then 10 → 5 (meeting-2).
    let t = run(regularMeeting(), CLOSE, RESULT, mv("p0", "lobby"), mv("p1", "lobby"), ...RESOLVE);
    expect([t.bank, t.thirds]).toEqual([5, 2]);
    t = run(t, SCHED, OPEN);
    expect(t.meeting).toMatchObject({ id: "meeting-2", kind: "regular" });
    expect(t.stretch).toBe(3);
  });

  it("only a regular meeting recharges \"once between meetings\" powers; an emergency doesn't — design §11.2", () => {
    let s = run(game(3, ["rookie", "auditor"]), ...RESOLVE, { type: "useAbility", player: "p1", ability: { kind: "audit", room: "lobby" } });
    expect(s.players.p1?.roleState.usedThisStretch).toBe(1);
    s = run(s, emergency("p0"), OPEN, CLOSE);
    expect([s.players.p1?.roleState.usedThisStretch, s.stretch, s.phase.kind]).toEqual([1, 1, "planning"]);
    // Round 2: 15 − 6 − 2 = 7, past two-thirds.
    s = run(s, mv("p0", "vault"), ...RESOLVE, SCHED, OPEN);
    expect([s.players.p1?.roleState.usedThisStretch, s.stretch]).toEqual([0, 2]);
  });

  it("no meeting after the round that ends the game (design §6.2)", () => {
    // Everyone grabs everything: the bank (18) runs out in round 1.
    const s = run(game(3), mv("p0", "vault"), mv("p1", "vault"), mv("p2", "vault"), ROUND);
    expect(s.phase.kind).toBe("ended");
    expect(ofType(s.log, "meetingOpened")).toEqual([]);
  });
});

describe("police briefings — design §9.2", () => {
  it("a raid calls a police briefing after the round's alibis; it recharges nothing", () => {
    // p0's 6 Vault coins ring 6: the Vault is raided. The bank (300) is nowhere near a third.
    let s = run(game(3, [], undefined, RAIDS), mv("p0", "vault", 0, RAIDS), ...RESOLVE);
    expect(s.wanted).toBe(1);
    expect(s.phase).toEqual({ kind: "awaitingMeeting", meeting: "briefing", meetingId: "meeting-1" });
    s = run(s, SCHED, OPEN);
    expect(LAST(s, "meetingOpened")).toMatchObject({ meetingId: "meeting-1", kind: "briefing" });
    expect(s.stretch).toBe(1);
    s = run(s, CLOSE);
    expect(s.phase).toEqual({ kind: "result", round: 1 });
  });

  it("two raids in one round call one briefing", () => {
    // The Vault (6 rings) and the Office (5 rings) both raid: Wanted 2, one briefing.
    let s = run(game(3, [], undefined, RAIDS), mv("p0", "vault", 0, RAIDS), mv("p1", "office", 0, RAIDS), ...RESOLVE);
    expect(s.wanted).toBe(2);
    s = run(s, SCHED, OPEN, CLOSE, RESULT);
    expect(ofType(s.log, "meetingOpened").map((e) => e.kind)).toEqual(["briefing"]);
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
  });

  it("a raid in the round that crosses a third: one meeting, and it counts as regular", () => {
    const both: ContentOverrides = { ...PINS, alarm: { bulbs: 4 } };
    const s = run(game(3, [], undefined, both), mv("p0", "vault", 0, both), ...RESOLVE);
    expect([s.wanted, s.bank]).toEqual([1, 10]);
    expect(s.phase).toEqual({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" });
    expect(run(s, SCHED, OPEN).stretch).toBe(2);
  });
});

describe("the emergency pool and the result window — design §9.3, §4.2 step 10", () => {
  it("the crew's pool: 1 for 3–6 players, 2 for 7–12, public", () => {
    for (const [n, pool] of [[3, 1], [6, 1], [7, 2], [12, 2]] as const) {
      const s = game(n, [], undefined, BIG_BANK);
      expect(s.emergencies).toBe(pool);
      expect(viewFor(s, "p1").emergencies).toBe(pool);
    }
  });

  it("refused during planning, a round's alibis, a due or open meeting; allowed in the result window (#167)", () => {
    let s = game(3);
    expect(s.phase.kind).toBe("planning");
    const only = /only be called between a round's result and the next planning/;
    expect(reason(s, emergency("p0"))).toMatch(only);
    s = run(s, mv("p0", "vault", 6), ROUND);
    expect(s.phase.kind).toBe("alibis");
    expect(reason(s, emergency("p0"))).toMatch(only);
    s = run(s, ALIBIS);
    expect(s.phase.kind).toBe("awaitingMeeting");
    expect(reason(s, emergency("p0"))).toMatch(only);
    s = run(s, SCHED, OPEN);
    expect(reason(s, emergency("p0"))).toMatch(only);
    s = run(s, CLOSE);
    expect(s.phase).toEqual({ kind: "result", round: 1 });
    expect(handleCommand(s, emergency("p0")).ok).toBe(true);
  });

  it("any player spends one, named publicly; one per window; the window waits for its meeting, then the next round", () => {
    let s = run(game(3, [], undefined, BIG_BANK), ...RESOLVE);
    expect(s.phase).toEqual({ kind: "result", round: 1 });
    s = run(s, emergency("p1"));
    expect(LAST(s, "emergencyMeetingCalled")).toEqual({ type: "emergencyMeetingCalled", visibility: { kind: "public" }, by: "p1", meetingId: "emergency-1" });
    expect([s.pendingEmergency, s.emergencies, viewFor(s, "p2").emergencies]).toEqual([{ meetingId: "emergency-1", by: "p1" }, 0, 0]);
    expect(reason(s, emergency("p2"))).toMatch(/already been called/);
    // No round clock runs: the window's deadline is refused until the emergency's meeting closes.
    expect(reason(s, RESULT(s))).toMatch(/next round starts when it closes/);
    s = run(s, open("emergency-1"));
    expect(s.meeting).toMatchObject({ kind: "emergency", calledBy: "p1" });
    // It stays spent although nobody votes (no quorum), and the next round starts as it closes.
    s = run(s, CLOSE);
    expect(LAST(s, "meetingClosed")?.result).toEqual({ kind: "noQuorum" });
    expect([s.phase, s.emergencies]).toEqual([{ kind: "planning", round: 2 }, 0]);
  });

  it("with the pool empty the result window is skipped: the next round starts as the alibis close", () => {
    let s = run(game(3, [], undefined, BIG_BANK), ...RESOLVE, emergency("p0"), OPEN, CLOSE);
    s = run(s, ...RESOLVE);
    expect(s.phase).toEqual({ kind: "planning", round: 3 });
    expect(reason(s, emergency("p1"))).toMatch(/between a round's result/);
    // And after a regular meeting too: it closes straight into the next round.
    const t = run(regularMeeting(), CLOSE, emergency("p2"), OPEN, CLOSE, mv("p0", "lobby"), mv("p1", "lobby"), ...RESOLVE, SCHED, OPEN, CLOSE);
    expect(t.phase).toEqual({ kind: "planning", round: 3 });
  });

  it("7–12 players: the second emergency waits for a later window", () => {
    let s = run(game(7, [], undefined, BIG_BANK), ...RESOLVE, emergency("p0"), OPEN, CLOSE);
    expect(s.emergencies).toBe(1);
    s = run(s, ...RESOLVE);
    expect(s.phase).toEqual({ kind: "result", round: 2 });
    s = run(s, emergency("p3"));
    expect([LAST(s, "emergencyMeetingCalled")?.meetingId, s.emergencies]).toEqual(["emergency-2", 0]);
  });

  it("the result window's deadline is refused when stale, retried or outside the window", () => {
    let s = run(game(3, [], undefined, BIG_BANK), ROUND);
    expect(reason(s, { type: "advance", deadline: { kind: "result", round: 1 } })).toMatch(/no result window/);
    s = run(s, ALIBIS);
    for (const round of [0, 2, "1", null]) expect(reason(s, { type: "advance", deadline: { kind: "result", round } })).toMatch(/not open/);
    s = run(s, RESULT);
    expect(reason(s, { type: "advance", deadline: { kind: "result", round: 1 } })).toMatch(/no result window/);
  });
});

describe("scheduling — design §9.4", () => {
  it("any player proposes a slot for the next meeting (counting as an accept); it locks once more than half the crew accepts", () => {
    let s = game(4);
    s = run(s, propose("p0", "tue-19:00"));
    const proposed = LAST(s, "meetingProposed");
    expect(proposed).toEqual({ type: "meetingProposed", visibility: { kind: "public" }, proposalId: "proposal-1", by: "p0", slot: "tue-19:00" });
    const id = proposed!.proposalId;
    expect(s.proposals).toEqual([{ id, by: "p0", slot: "tue-19:00", acceptedBy: ["p0"] }]);
    s = run(s, accept("p1", id)); // 2 of 4: not a majority
    expect(s.scheduledMeeting).toBeNull();
    const before = s;
    s = run(s, accept("p2", id)); // 3 of 4
    expect(since(before, s).map((e) => e.type)).toEqual(["meetingProposalAccepted", "meetingScheduled"]);
    expect(LAST(s, "meetingScheduled")).toEqual({ type: "meetingScheduled", visibility: { kind: "public" }, meetingId: "meeting-1", slot: "tue-19:00", proposalId: id });
    expect([s.scheduledMeeting, s.proposals, s.phase]).toEqual([{ meetingId: "meeting-1", slot: "tue-19:00" }, [], { kind: "planning", round: 1 }]);
  });

  it("a locked slot opens only once a round calls the meeting and its alibis close", () => {
    let s = run(game(3), propose("p0", "a"), (x: GameState) => accept("p1", x.proposals[0]!.id));
    expect(reason(s, open("meeting-1"))).toMatch(/opens once a round calls it/);
    s = run(s, mv("p0", "vault"), ROUND);
    expect(reason(s, open("meeting-1"))).toMatch(/opens once a round calls it/);
    s = run(s, ALIBIS, open("meeting-1"));
    expect(s.meeting).toMatchObject({ id: "meeting-1", kind: "regular" });
  });

  it("public ids don't depend on hidden events (PR #6 review)", () => {
    const quiet = run(game(3), ROUND, propose("p0", "a"));
    const busy = run(game(3), mv("p0", "vault", 6), mv("p0", "office", 1), mv("p1", "lobby"), ROUND, propose("p0", "a"));
    expect(busy.log.length).not.toBe(quiet.log.length);
    expect(LAST(busy, "meetingProposed")).toEqual(LAST(quiet, "meetingProposed"));
    // Numbered across the whole game.
    const later = run(regularMeeting(), CLOSE, propose("p1", "b"));
    expect(LAST(later, "meetingProposed")?.proposalId).toBe("proposal-1");
    expect(run(later, (x: GameState) => accept("p2", x.proposals[0]!.id)).scheduledMeeting?.meetingId).toBe("meeting-2");
  });

  it("competing proposals; the first to a majority wins and the rest are dropped", () => {
    let s = run(game(3), ROUND, propose("p0", "a"), propose("p1", "b"));
    const [a, b] = s.proposals;
    s = run(s, accept("p2", b!.id));
    expect(s.scheduledMeeting?.slot).toBe("b");
    expect(reason(s, accept("p1", a!.id))).toMatch(/already scheduled/);
    expect(reason(s, propose("p2", "c"))).toMatch(/already scheduled/);
  });

  it("refuses a duplicate slot, a repeat accept, unknown proposals and bad slots", () => {
    const s = run(game(4), propose("p0", "a"));
    const id = s.proposals[0]!.id;
    expect(reason(s, propose("p1", "a"))).toMatch(/already proposed/);
    expect(reason(s, accept("p0", id))).toMatch(/already accepted/);
    for (const pid of ["nope", 3, undefined, null]) expect(reason(s, accept("p1", pid))).toMatch(/no open proposal/);
    for (const slot of ["", 3, null, undefined, {}]) expect(reason(s, propose("p1", slot))).toMatch(/slot/);
    expect(reason(s, propose("zed", "b"))).toMatch(/unknown player/);
  });

  it("caps a slot's length (free text, stored and sent to everyone)", () => {
    const s = game(4);
    expect(handleCommand(s, propose("p0", "x".repeat(MAX_SLOT_LENGTH))).ok).toBe(true);
    expect(reason(s, propose("p0", "x".repeat(MAX_SLOT_LENGTH + 1)))).toBe(`slot must be at most ${MAX_SLOT_LENGTH} characters`);
  });

  it("the server picks a slot only for the due meeting, once (proposalId null)", () => {
    let s = game(3);
    expect(reason(s, sched("meeting-1"))).toMatch(/no meeting is due/);
    s = run(s, mv("p0", "vault"), ...RESOLVE);
    for (const id of ["meeting-2", "act-1", 1, null]) expect(reason(s, sched(id))).toMatch(/is not due/);
    expect(reason(s, sched("meeting-1", ""))).toMatch(/slot/);
    s = run(s, sched("meeting-1", "auto-1"));
    expect(LAST(s, "meetingScheduled")).toMatchObject({ meetingId: "meeting-1", slot: "auto-1", proposalId: null });
    expect(reason(s, sched("meeting-1", "b"))).toMatch(/already scheduled/);
  });

  it("stale, retried and unknown meeting deadlines are refused", () => {
    let s = run(game(3), mv("p0", "vault"), ...RESOLVE);
    expect(reason(s, ROUND(s))).toMatch(/no round deadline/);
    expect(reason(s, open("meeting-1"))).toMatch(/not waiting to open/); // nothing scheduled yet
    s = run(s, SCHED);
    for (const id of ["meeting-2", "emergency-1", 1, undefined]) expect(reason(s, open(id))).toMatch(/not waiting/);
    expect(reason(s, close("meeting-1"))).toMatch(/not open/);
    s = run(s, open("meeting-1"));
    expect(reason(s, open("meeting-1"))).toMatch(/already open/);
    expect(reason(s, ROUND(s))).toMatch(/no round deadline/);
    s = run(s, close("meeting-1"));
    expect(reason(s, close("meeting-1"))).toMatch(/not open/);
    expect(reason(s, open("meeting-1"))).toMatch(/not waiting/);
  });
});

describe("ballots — design §9.5", () => {
  it("a vote names another player or skips; the last ballot counts", () => {
    let s = regularMeeting();
    expect(reason(s, vote("p0", "p0"))).toMatch(/yourself/);
    for (const target of ["zed", "__proto__", 3]) expect(reason(s, { type: "castVote", player: "p0", vote: { kind: "shakedown", target } })).toMatch(/unknown player/);
    for (const v of [null, "skip", { kind: "pass" }, []]) expect(reason(s, { type: "castVote", player: "p0", vote: v })).toMatch(/vote must be/);
    s = run(s, vote("p1", "p0"), vote("p1", null), vote("p2", "p0"));
    expect(s.meeting?.votes).toEqual({ p1: { kind: "skip" }, p2: { kind: "shakedown", target: "p0" } });
    s = run(s, CLOSE);
    expect(LAST(s, "meetingClosed")).toMatchObject({ tally: { skip: 1, targets: { p0: 1 } }, result: { kind: "noMajority" } });
  });

  it("votes are refused outside a meeting, and every command before the game starts", () => {
    expect(reason(game(3), vote("p0", "p1"))).toMatch(/no meeting is open/);
    const unstarted = replay(config(3), setupEvents(config(3)).filter((e) => e.type !== "roundStarted"));
    for (const c of [propose("p0", "a"), sched("meeting-1"), emergency("p0"), seal("p0", "p1")]) expect(reason(unstarted, c)).toMatch(/not started/);
  });

  it("hidden then revealed (default): ballots are private while cast, then every ballot goes to the ledger", () => {
    const s = run(regularMeeting([], "hiddenThenRevealed"), vote("p2", "p0"), vote("p1", "p0"), CLOSE);
    for (const e of ofType(s.log, "voteCast")) expect(e.visibility).toEqual({ kind: "private", player: e.player });
    const closed = LAST(s, "meetingClosed")!;
    expect(Object.keys(closed.ballots ?? {})).toEqual(["p1", "p2"]);
  });

  it("open: ballots are public as they are cast", () => {
    const s = run(regularMeeting([], "open"), vote("p1", "p0"));
    expect(LAST(s, "voteCast")?.visibility).toEqual({ kind: "public" });
    expect(LAST(run(s, CLOSE), "meetingClosed")?.ballots).toEqual({ p1: { kind: "shakedown", target: "p0" } });
  });

  it("secret: ballots and sealed votes are secret to the voter (even after the game); only the tally is shown", () => {
    let s = run(game(3, [], "secret"), mv("p0", "vault", 6), seal("p2", "p0"), ...RESOLVE, SCHED, OPEN, vote("p1", "p0"));
    const ballots = ofType(s.log, "voteCast");
    expect(ballots.map((e) => [e.player, e.sealed])).toEqual([["p2", true], ["p1", false]]);
    for (const e of [...ballots, LAST(s, "voteSealed")!]) {
      expect(e.visibility).toEqual({ kind: "secret", player: e.player });
      for (const viewer of ["p0", "p1", "p2"]) expect(canSee(e.visibility, viewer, true)).toBe(viewer === e.player);
    }
    s = run(s, CLOSE);
    expect(LAST(s, "meetingClosed")).toMatchObject({ ballots: null, tally: { skip: 0, targets: { p0: 2 } }, result: { kind: "shakedown", target: "p0" } });
  });

  it("a sealed vote is private, cast as the next meeting opens (an emergency too), and is then used up", () => {
    let s = run(game(3, [], undefined, BIG_BANK), seal("p2", "p1"), seal("p2", "p0"), ...RESOLVE);
    expect(LAST(s, "voteSealed")).toEqual({ type: "voteSealed", visibility: { kind: "private", player: "p2" }, player: "p2", vote: { kind: "shakedown", target: "p0" } });
    s = run(s, emergency("p1"), OPEN);
    expect(s.log.at(-1)).toEqual({ type: "voteCast", visibility: { kind: "private", player: "p2" }, meetingId: "emergency-1", player: "p2", vote: { kind: "shakedown", target: "p0" }, sealed: true });
    expect(s.players.p2?.sealedVote).toBeNull();
    // A voter who turns up can override it live; sealed votes count towards quorum and the majority.
    s = run(s, vote("p2", null), CLOSE);
    expect(LAST(s, "meetingClosed")?.ballots).toEqual({ p2: { kind: "skip" } });
    expect(reason(game(3), seal("p0", "p0"))).toMatch(/yourself/);
  });
});

describe("quorum and majority — design §9.5", () => {
  const m = (entries: [string, number][]) => new Map(entries);
  it.each([
    ["fewer than half the crew voted", 4, 1, 0, m([["a", 1]]), { kind: "noQuorum" }],
    ["exactly half the crew is a quorum", 4, 2, 0, m([["a", 2]]), { kind: "shakedown", target: "a" }],
    ["half the votes cast is not a majority", 4, 4, 2, m([["a", 2]]), { kind: "noMajority" }],
    ["a 2–2 split", 4, 4, 0, m([["a", 2], ["b", 2]]), { kind: "noMajority" }],
    ["more than half of the votes cast", 5, 3, 0, m([["a", 2], ["b", 1]]), { kind: "shakedown", target: "a" }],
    ["a skip majority", 4, 4, 3, m([["a", 1]]), { kind: "skipped" }],
    ["nobody voted", 3, 0, 0, m([]), { kind: "noQuorum" }],
  ] as const)("%s", (_name, crew, cast, skip, targets, expected) => {
    expect(meetingResult(crew, cast, skip, targets)).toEqual(expected);
  });

  it.each([
    ["12p: 4 of 12, the rest scattered, is no shakedown", 12, 12, 3, m([["a", 4], ["b", 3], ["c", 2]]), 12, { kind: "noMajority" }],
    ["12p: 7 of 12 is a majority", 12, 12, 1, m([["a", 7], ["b", 4]]), 12, { kind: "shakedown", target: "a" }],
    ["10p: weight counts: 5 ballots weighing 6 of 11", 10, 10, 3, m([["a", 6], ["b", 2]]), 11, { kind: "shakedown", target: "a" }],
  ] as const)("big crews: %s", (_name, crew, cast, skip, targets, weight, expected) => {
    expect(meetingResult(crew, cast, skip, targets, weight)).toEqual(expected);
  });

  it("no shakedown without a quorum; a skip majority shakes nobody down", () => {
    const s = run(regularMeeting(), vote("p1", "p0"), CLOSE);
    expect(LAST(s, "meetingClosed")).toMatchObject({ result: { kind: "noQuorum" }, tally: { skip: 0, targets: { p0: 1 } } });
    const t = run(regularMeeting(), vote("p0", null), vote("p1", null), vote("p2", "p0"), CLOSE);
    expect(LAST(t, "meetingClosed")?.result).toEqual({ kind: "skipped" });
    expect([...ofType(s.log, "shakedownResolved"), ...ofType(t.log, "shakedownResolved")]).toEqual([]);
  });
});

describe("shakedowns against the share — design §9.6, §7.1, §7.5", () => {
  it("the stash is revealed; what it holds above the share is set aside, and counts toward honesty as it reaches the next split", () => {
    const s = regularMeeting();
    expect([s.share, s.kitty, s.reached, s.players.p0?.stash]).toEqual([0, 2, 2, 6]);
    let after = run(s, vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(LAST(after, "shakedownResolved")).toEqual({ type: "shakedownResolved", visibility: { kind: "public" }, meetingId: "meeting-1", target: "p0", stashRevealed: 6, taken: 6, clean: false });
    expect([after.players.p0?.stash, after.setAside, after.reached]).toEqual([0, 6, 2]);
    expect(after.phase).toEqual({ kind: "result", round: 1 });
    // Round 2, everyone misses: 3 handed in + the 6 set aside + the kitty's 2 = 11, cut 3, kitty 2.
    after = run(after, RESULT, ROUND);
    expect(LAST(after, "duffelSplit")).toMatchObject({ handedIn: 3, setAside: 6, kittyIn: 2, cut: 3, kitty: 2 });
    expect([after.setAside, after.reached, after.players.p0?.stash]).toEqual([0, 2 + 3 + 6, 3]);
    expect(LAST(after, "roundResolved")?.honesty).toEqual({ reached: 11, taken: 11 });
  });

  it("a target at or below the share is clean: nothing is taken and nothing is paid", () => {
    const s = run(regularMeeting(), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(LAST(s, "shakedownResolved")).toMatchObject({ target: "p1", stashRevealed: 0, taken: 0, clean: true });
    expect([s.players.p1?.stash, s.setAside, s.kitty]).toEqual([0, 0, 2]);
  });

  it("then the result window, and the next round", () => {
    const s = regularMeeting();
    const after = run(s, vote("p1", "p0"), vote("p2", "p0"), CLOSE, RESULT);
    // Token grants are not what this checks (extension.md "Tokens and the perk shop").
    expect(since(s, after).map((e) => e.type).filter((t) => t !== "tokenEarned")).toEqual(["voteCast", "voteCast", "meetingClosed", "shakedownResolved", "roundStarted"]);
    expect(LAST(after, "roundStarted")).toEqual({ type: "roundStarted", visibility: { kind: "public" }, round: 2 });
  });
});

describe("shakedown protection — design §9.7", () => {
  it("a passed shakedown protects its target (public) through briefings and emergencies, until the next regular meeting opens", () => {
    let s = run(regularMeeting(), vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect([s.protected, viewFor(s, "p1").protected]).toEqual([["p0"], ["p0"]]);
    // p2 leaves a sealed vote on p0: it counts as a skip while p0 is protected.
    s = run(s, seal("p2", "p0"), emergency("p1"), OPEN);
    expect(s.meeting?.votes).toEqual({ p2: { kind: "skip" } });
    expect(reason(s, vote("p1", "p0"))).toBe("that player is protected until the next regular meeting");
    s = run(s, CLOSE);
    expect(s.protected).toEqual(["p0"]);
    // Round 2: 10 − 2 − 2 − 1 = 5, past one-third: the next regular meeting lifts it.
    s = run(s, mv("p0", "lobby"), mv("p1", "lobby"), seal("p1", "p0"), ...RESOLVE, SCHED, OPEN);
    expect(s.protected).toEqual([]);
    expect(s.meeting?.votes).toEqual({ p1: { kind: "shakedown", target: "p0" } });
    expect(handleCommand(s, vote("p2", "p0")).ok).toBe(true);
  });

  it("a briefing doesn't lift it", () => {
    const pins: ContentOverrides = { ...BIG_BANK, alarm: { bulbs: 4 } };
    // Round 1: p0 quietly pockets the Lobby's 2; p1's emergency shakes them down.
    let s = run(game(3, [], undefined, pins), mv("p0", "lobby", 2, pins), ...RESOLVE, emergency("p1"), OPEN, vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(s.protected).toEqual(["p0"]);
    // Round 2: p1 raids the Vault; the briefing keeps p0 protected.
    s = run(s, mv("p1", "vault", 0, pins), ...RESOLVE, SCHED, OPEN);
    expect(s.meeting?.kind).toBe("briefing");
    expect(s.protected).toEqual(["p0"]);
    expect(reason(s, vote("p2", "p0"))).toMatch(/protected/);
  });

  it("a shakedown that falls through (the Shield until Bail, design §12) protects its target too", () => {
    let s = game(3, [], undefined, PINS, ["peek", "shield", "extraVote"]);
    s = grantPerks(run(s, mv("p0", "vault", 6), ...RESOLVE, SCHED, OPEN), "p0", "shield");
    s = run(s, vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(s.phase).toEqual({ kind: "shakedownPending", meetingId: "meeting-1", target: "p0" });
    s = run(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "meeting-1" } });
    expect(LAST(s, "shakedownCancelled")).toEqual({ type: "shakedownCancelled", visibility: { kind: "public" }, meetingId: "meeting-1", target: "p0" });
    expect([s.protected, s.players.p0?.stash, s.phase]).toEqual([["p0"], 6, { kind: "result", round: 1 }]);
  });
});

describe("determinism and the event log — design §19.1", () => {
  const script = (): GameState => {
    let s = run(game(4, ["hacker", "lookout", "priest"]), mv("p3", "vault", 6), seal("p2", "p3"), propose("p1", "x"));
    s = run(s, (x: GameState) => accept("p0", x.proposals[0]!.id), (x: GameState) => accept("p3", x.proposals[0]!.id), ...RESOLVE);
    s = run(s, OPEN, vote("p0", "p3"), vote("p1", "p3"), CLOSE, emergency("p0"), OPEN, vote("p0", null), CLOSE);
    return s;
  };

  it("same seed + same commands → same log; replay (also via JSON) rebuilds the state", () => {
    const a = script();
    expect(script().log).toEqual(a.log);
    expect(replay(a.config, a.log)).toEqual(a);
    expect(replay(a.config, JSON.parse(JSON.stringify(a.log)) as GameEvent[])).toEqual(a);
    expect(a.phase).toEqual({ kind: "planning", round: 2 });
  });

  it("meetings draw no randomness", () => {
    const s = script();
    expect(s.rng).toEqual(game(4).rng);
  });

  it("a player called toString can be voted for and shaken down (__proto__ is refused at setup)", () => {
    const cfg: GameConfig = { ...config(3), players: [{ id: "toString", name: "T", isBot: false }, { id: "p1", name: "P1", isBot: true }, { id: "p2", name: "P2", isBot: true }] };
    const log = setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "rookie" } : e.type === "shopDealt" ? { ...e, perks: SHOP_NO_SHIELD } : e));
    let s = run(replay(cfg, log), mv("toString", "vault", 6), ...RESOLVE, SCHED, OPEN, vote("p1", "toString"), vote("p2", "toString"), seal("toString", "p1"));
    s = run(s, CLOSE);
    expect(Object.hasOwn(LAST(s, "meetingClosed")!.tally.targets, "toString")).toBe(true);
    expect(s.players["toString"]).toMatchObject({ stash: s.share, sealedVote: { kind: "shakedown", target: "p1" } });
    expect(s.protected).toEqual(["toString"]);
    expect(replay(cfg, s.log)).toEqual(s);
  });
});
