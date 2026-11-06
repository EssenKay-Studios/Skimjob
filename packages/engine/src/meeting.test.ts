// Crew meetings and votes: scheduling, emergency meetings, ballots and their
// visibility, sealed votes, quorum and majority, shakedowns, the checkpoint
// order and the move to the next act. design §11, §4, §3
import { BANK_JOB, MAX_SLOT_LENGTH, STARTER_ROLES } from "@skimjob/content";
import { handleThroughAlibis } from "./alibis.testkit";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState, VoteVisibility } from "./types";
import { canSee } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { V01_NUMBERS } from "./v01-numbers.testkit";
import { meetingResult } from "./meeting";

function config(players: number, voteVisibility: VoteVisibility = "hiddenThenRevealed"): GameConfig {
  return {
    seed: "meeting-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    // Starter mode: no Muscle and no shop (so no Shield), so no shakedown window (extension.md "Shakedowns").
    rolePool: [...STARTER_ROLES],
    eventsEnabled: false,
    voteVisibility,
    starterMode: true,
    contentOverrides: V01_NUMBERS, // scripted against content 0.1.0 numbers (balance pass 1)
  };
}

/** A new game with chosen roles (seat i gets roles[i], Rookie if missing). */
function game(players: number, roles: string[] = [], mode?: VoteVisibility): GameState {
  const cfg = config(players, mode);
  const log = setupEvents(cfg).map((e, i, all): GameEvent => {
    if (e.type !== "roleDealt") return e;
    const seat = all.slice(0, i).filter((x) => x.type === "roleDealt").length;
    return { ...e, role: roles[seat] ?? "rookie" };
  });
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, typeof c === "function" ? c(s) : c);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const before = JSON.stringify(state);
  const r = handleThroughAlibis(state, command);
  if (r.ok) throw new Error("expected a rejection");
  expect(JSON.stringify(state)).toBe(before);
  return r.reason;
}
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const open = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId } });
const close = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId } });
const sched = (act: unknown, slot: unknown = "slot") => ({ type: "scheduleMeeting", act, slot });
const propose = (player: string, slot: unknown) => ({ type: "proposeMeeting", player, slot });
const accept = (player: string, proposalId: unknown) => ({ type: "acceptMeeting", player, proposalId });
const emergency = (player: string) => ({ type: "callEmergency", player });
const choice = (target: string | null) => (target === null ? { kind: "skip" } : { kind: "shakedown", target });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: choice(target) });
const seal = (player: string, target: string | null) => ({ type: "sealVote", player, vote: choice(target) });
/** Open the current act's meeting (server-picked slot). */
const OPEN_ACT = (s: GameState) => open(`act-${Math.ceil(s.round / 3)}`);
const CLOSE = (s: GameState) => close(s.meeting?.id);
const LAST = <T extends GameEvent["type"]>(s: GameState, type: T) => ofType(s.log, type).at(-1);

/** Rounds of default moves until the act's meeting is awaited, then schedule and open it. */
function toMeeting(s: GameState): GameState {
  while (s.phase.kind === "planning") s = run(s, ROUND);
  return run(s, sched(Math.ceil(s.round / 3)), OPEN_ACT);
}

/**
 * 3 Rookies. Round 1: p0 pockets the Vault's 6; p1 and p2 default to the Lobby.
 * Rounds 2–3: everyone defaults. Haul 16, Heat 19, act-1 target 18.
 */
function act1Meeting(roles: string[] = [], mode?: VoteVisibility): GameState {
  return toMeeting(run(game(3, roles, mode), mv("p0", "vault", 6)));
}

describe("scheduling the act's meeting — design §11.1", () => {
  it("any player proposes a slot (counting as an accept); it locks in once more than half the crew accepts", () => {
    let s = game(4);
    s = run(s, propose("p0", "tue-19:00"));
    const proposed = LAST(s, "meetingProposed");
    expect(proposed).toMatchObject({ visibility: { kind: "public" }, by: "p0", act: 1, slot: "tue-19:00" });
    // Deterministic id, not drawn from the RNG: the game's first proposal.
    const id = proposed!.proposalId;
    expect(id).toBe("proposal-1");
    expect(s.proposals).toEqual([{ id, by: "p0", act: 1, slot: "tue-19:00", acceptedBy: ["p0"] }]);

    s = run(s, accept("p1", id)); // 2 of 4: not a majority
    expect(s.scheduledMeeting).toBeNull();
    const before = s;
    s = run(s, accept("p2", id)); // 3 of 4
    expect(since(before, s).map((e) => e.type)).toEqual(["meetingProposalAccepted", "meetingScheduled"]);
    expect(LAST(s, "meetingScheduled")).toMatchObject({ visibility: { kind: "public" }, meetingId: "act-1", act: 1, slot: "tue-19:00", proposalId: id });
    expect(s.scheduledMeeting).toEqual({ meetingId: "act-1", act: 1, slot: "tue-19:00" });
    expect(s.proposals).toEqual([]);
    expect(s.phase).toEqual({ kind: "planning", round: 1 }); // the slot can be locked mid-act
  });

  it("public ids and fields don't depend on hidden events (PR #6 review)", () => {
    // Same public history, different private moves (more moveSubmitted events in one game).
    const quiet = run(game(3), ROUND, propose("p0", "a"));
    const busy = run(game(3), mv("p0", "vault", 6), mv("p0", "office", 1), mv("p1", "lobby"), ROUND, propose("p0", "a"));
    expect(busy.log.length).not.toBe(quiet.log.length);
    expect(LAST(busy, "meetingProposed")).toEqual(LAST(quiet, "meetingProposed"));
    expect(LAST(busy, "meetingProposed")?.proposalId).toBe("proposal-1");
    // Numbered across the whole game, so act 2's proposals don't reuse act 1's ids.
    const act2 = run(toMeeting(quiet), CLOSE, propose("p1", "b"));
    expect(LAST(act2, "meetingProposed")?.proposalId).toBe("proposal-2");
    // Meeting ids are public names only.
    const em = run(quiet, emergency("p2"));
    expect(LAST(em, "emergencyMeetingCalled")?.meetingId).toBe("emergency-p2");
    expect(run(quiet, (x: GameState) => accept("p1", x.proposals[0]!.id)).scheduledMeeting?.meetingId).toBe("act-1");
  });

  it("in a crew of 3, one accept beyond the proposer locks the slot", () => {
    const s = run(game(3), propose("p2", "a"), (x: GameState) => accept("p0", x.proposals[0]!.id));
    expect(s.scheduledMeeting?.slot).toBe("a");
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
    expect(reason(run(s, accept("p1", id)), accept("p1", id))).toMatch(/already accepted/);
    for (const pid of ["nope", 3, undefined, null]) expect(reason(s, accept("p1", pid))).toMatch(/no open proposal/);
    for (const slot of ["", 3, null, undefined, {}]) expect(reason(s, propose("p1", slot))).toMatch(/slot/);
    expect(reason(s, propose("zed", "b"))).toMatch(/unknown player/);
  });

  it("caps a slot's length (free text, stored and sent to everyone) — design §11.1, §17.2", () => {
    const s = game(4);
    expect(handleCommand(s, propose("p0", "x".repeat(MAX_SLOT_LENGTH))).ok).toBe(true);
    expect(reason(s, propose("p0", "x".repeat(MAX_SLOT_LENGTH + 1)))).toBe(`slot must be at most ${MAX_SLOT_LENGTH} characters`);
    // An ISO time, as the server sends, fits.
    expect(handleCommand(s, propose("p0", new Date(0).toISOString())).ok).toBe(true);
  });

  it("the server picks a slot when nobody locked one in (proposalId null)", () => {
    const s = run(game(3), ROUND, sched(1, "auto-1"));
    expect(LAST(s, "meetingScheduled")).toMatchObject({ meetingId: "act-1", act: 1, slot: "auto-1", proposalId: null });
  });

  it("scheduleMeeting is refused once a slot is locked, by the crew or the server (STATUS.md task 6)", () => {
    const byCrew = run(game(3), propose("p0", "a"), (x: GameState) => accept("p1", x.proposals[0]!.id));
    expect(reason(byCrew, sched(1, "b"))).toMatch(/already scheduled/);
    const byServer = run(game(3), sched(1, "a"));
    expect(reason(byServer, sched(1, "b"))).toMatch(/already scheduled/);
    expect(reason(byServer, propose("p0", "c"))).toMatch(/already scheduled/);
  });

  it("scheduleMeeting must name the act being played and a non-empty slot", () => {
    const s = game(3);
    for (const act of [2, 3, 0, "1", null]) expect(reason(s, sched(act))).toMatch(/not being played/);
    expect(reason(s, sched(1, ""))).toMatch(/slot/);
  });
});

describe("opening and closing the act's meeting — design §11.1, §4.1, §11.4", () => {
  it("the regular meeting opens only after the act's last round has resolved (provisional)", () => {
    let s = run(game(3), sched(1));
    for (const round of [1, 2]) {
      expect(reason(s, open("act-1"))).toMatch(/opens after round 3 and its alibi deadline/);
      s = run(s, ROUND);
      expect(s.round).toBe(round + 1);
    }
    expect(reason(s, open("act-1"))).toMatch(/after round 3/);
    s = run(s, ROUND);
    expect(s.phase).toEqual({ kind: "awaitingMeeting", act: 1 });
    const before = s;
    s = run(s, open("act-1"));
    expect(since(before, s)).toEqual([{ type: "meetingOpened", visibility: { kind: "public" }, meetingId: "act-1", kind: "regular", act: 1 }]);
    expect(s.phase).toEqual({ kind: "meeting", meetingId: "act-1" });
    expect(s.scheduledMeeting).toBeNull();
    expect(s.meeting).toEqual({ id: "act-1", kind: "regular", act: 1, calledBy: null, votes: {}, extraVotes: [], ballotGrants: {} });
  });

  it("all three deadline kinds are refused when stale, retried or unknown", () => {
    let s = run(game(3), ROUND, ROUND, ROUND);
    expect(reason(s, ROUND(s))).toMatch(/no round deadline/);
    expect(reason(s, open("act-1"))).toMatch(/not waiting to open/); // nothing scheduled yet
    s = run(s, sched(1));
    for (const id of ["act-2", "emergency-p0", 1, undefined]) expect(reason(s, open(id))).toMatch(/not waiting/);
    expect(reason(s, close("act-1"))).toMatch(/not open/);
    s = run(s, open("act-1"));
    expect(reason(s, open("act-1"))).toMatch(/already open/); // retried
    expect(reason(s, ROUND(s))).toMatch(/paused/);
    expect(reason(s, close("act-2"))).toMatch(/not open/);
    s = run(s, close("act-1"));
    expect(reason(s, close("act-1"))).toMatch(/not open/); // retried
    expect(reason(s, open("act-1"))).toMatch(/not waiting/);
    expect(s.phase).toEqual({ kind: "planning", round: 4 });
  });

  it("after the act's meeting and checkpoint, the next act starts at round 4 (Fence allowance reset)", () => {
    let s = run(game(3, ["fence"]), mv("p0", "vault", 6, { ability: { kind: "fenceSafe", amount: 5 } }), ROUND, ROUND, ROUND);
    expect(s.players.p0).toMatchObject({ safe: 5, roleState: expect.objectContaining({ usedThisAct: 5 }) });
    s = run(s, sched(1), open("act-1"));
    const before = s;
    s = run(s, close("act-1"));
    expect(since(before, s).map((e) => e.type)).toEqual(["meetingClosed", "checkpointChecked", "roundStarted"]);
    expect(LAST(s, "roundStarted")).toMatchObject({ round: 4, act: 2 });
    expect(s.phase).toEqual({ kind: "planning", round: 4 });
    expect(s.players.p0).toMatchObject({ safe: 5, roleState: expect.objectContaining({ usedThisAct: 0 }) });
    // Act 2 has its own meeting, which can be proposed and scheduled anew.
    s = run(s, propose("p1", "act2-slot"), (x: GameState) => accept("p0", x.proposals[0]!.id));
    expect(s.scheduledMeeting).toEqual({ meetingId: "act-2", act: 2, slot: "act2-slot" });
  });
});

describe("emergency meetings — design §11.1, §4.1", () => {
  it("one per player per game; it opens mid-act after the notice period, pausing rounds, then planning resumes", () => {
    let s = run(game(3), mv("p0", "office", 1), emergency("p1"));
    expect(LAST(s, "emergencyMeetingCalled")).toEqual({ type: "emergencyMeetingCalled", visibility: { kind: "public" }, by: "p1", meetingId: "emergency-p1" });
    expect(s.pendingEmergency).toEqual({ meetingId: "emergency-p1", by: "p1" });
    expect(s.players.p1?.emergencyMeetingUsed).toBe(true);
    expect(reason(s, emergency("p2"))).toMatch(/already been called/);
    // The notice period is the server's; until it opens, planning carries on.
    s = run(s, mv("p2", "lobby"));
    s = run(s, open("emergency-p1"));
    expect(s.phase).toEqual({ kind: "meeting", meetingId: "emergency-p1" });
    expect(s.meeting).toMatchObject({ kind: "emergency", act: 1, calledBy: "p1" });
    expect(s.pendingEmergency).toBeNull();
    // Rounds are paused: no deadline, no moves.
    expect(reason(s, ROUND(s))).toMatch(/paused/);
    expect(reason(s, mv("p0", "vault"))).toMatch(/planned/);
    expect(reason(s, emergency("p2"))).toMatch(/already open/);
    s = run(s, close("emergency-p1"));
    expect(s.phase).toEqual({ kind: "planning", round: 1 });
    expect(s.moves).toEqual({ p0: { room: "office", pocket: 1 }, p2: { room: "lobby", pocket: 0 } });
    // No checkpoint after an emergency meeting.
    expect(ofType(s.log, "checkpointChecked")).toEqual([]);
    expect(reason(s, emergency("p1"))).toMatch(/already called your emergency meeting/);
    expect(run(s, emergency("p2")).pendingEmergency?.meetingId).toBe("emergency-p2");
  });

  it("an emergency shakedown works like the regular one, with the current act's numbers", () => {
    const s = run(game(3), mv("p0", "vault", 6), ROUND, emergency("p1"), open("emergency-p1"), vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(LAST(s, "shakedownResolved")).toMatchObject({ meetingId: "emergency-p1", target: "p0", stashRevealed: 6, taken: 6, clean: false, compensation: 0 });
    expect(s.players.p0).toMatchObject({ stash: 0, timesShakenDown: 1 });
    expect(s.haul).toBe(10);
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
  });

  it("called while the act's meeting is awaited, it returns there; the regular can't open while it's open", () => {
    let s = run(game(3), ROUND, ROUND, ROUND, sched(1), emergency("p0"), open("emergency-p0"));
    expect(reason(s, open("act-1"))).toMatch(/emergency-p0 is already open/);
    s = run(s, close("emergency-p0"));
    expect(s.phase).toEqual({ kind: "awaitingMeeting", act: 1 });
    s = run(s, open("act-1"));
    expect(s.meeting?.kind).toBe("regular");
  });

  it("a pending emergency waits out the regular meeting and opens in the next act", () => {
    let s = run(game(3), ROUND, ROUND, ROUND, sched(1), emergency("p1"), open("act-1"));
    expect(reason(s, open("emergency-p1"))).toMatch(/already open/);
    s = run(s, close("act-1"), open("emergency-p1"));
    expect(s.meeting).toMatchObject({ id: "emergency-p1", act: 2 });
    expect(run(s, close("emergency-p1")).phase).toEqual({ kind: "planning", round: 4 });
  });
});

describe("ballots — design §11.2", () => {
  it("a vote names another player or skips; the last ballot counts", () => {
    let s = act1Meeting();
    expect(reason(s, vote("p0", "p0"))).toMatch(/yourself/);
    for (const target of ["zed", "__proto__", 3]) expect(reason(s, { type: "castVote", player: "p0", vote: { kind: "shakedown", target } })).toMatch(/unknown player/);
    for (const v of [null, "skip", { kind: "pass" }, []]) expect(reason(s, { type: "castVote", player: "p0", vote: v })).toMatch(/vote must be/);
    expect(reason(s, vote("zed", null))).toMatch(/unknown player/);
    s = run(s, vote("p1", "p0"), vote("p1", null), vote("p2", "p0"));
    expect(s.meeting?.votes).toEqual({ p1: { kind: "skip" }, p2: { kind: "shakedown", target: "p0" } });
    s = run(s, CLOSE);
    expect(LAST(s, "meetingClosed")).toMatchObject({ tally: { skip: 1, targets: { p0: 1 } }, result: { kind: "noMajority" } });
  });

  it("votes are refused outside a meeting, and every command before the game starts", () => {
    expect(reason(game(3), vote("p0", "p1"))).toMatch(/no meeting is open/);
    const unstarted = replay(config(3), setupEvents(config(3)).filter((e) => e.type !== "roundStarted"));
    expect(unstarted.phase.kind).toBe("setup");
    for (const c of [propose("p0", "a"), sched(1), emergency("p0"), seal("p0", "p1")]) expect(reason(unstarted, c)).toMatch(/not started/);
  });

  it("hidden then revealed (default): ballots are private while cast, then every ballot goes to the ledger", () => {
    const s = run(act1Meeting([], "hiddenThenRevealed"), vote("p2", "p0"), vote("p1", "p0"), CLOSE);
    for (const e of ofType(s.log, "voteCast")) expect(e.visibility).toEqual({ kind: "private", player: e.player });
    const closed = LAST(s, "meetingClosed")!;
    expect(closed.visibility).toEqual({ kind: "public" });
    // Seat order, whatever order they were cast in.
    expect(Object.keys(closed.ballots ?? {})).toEqual(["p1", "p2"]);
    expect(closed.ballots).toEqual({ p1: { kind: "shakedown", target: "p0" }, p2: { kind: "shakedown", target: "p0" } });
  });

  it("open: ballots are public as they are cast", () => {
    const s = run(act1Meeting([], "open"), vote("p1", "p0"));
    expect(LAST(s, "voteCast")?.visibility).toEqual({ kind: "public" });
    expect(LAST(run(s, CLOSE), "meetingClosed")?.ballots).toEqual({ p1: { kind: "shakedown", target: "p0" } });
  });

  it("secret: ballots and sealed votes are secret to the voter (even after the game); only the tally is shown", () => {
    let s = run(game(3, [], "secret"), mv("p0", "vault", 6), seal("p2", "p0"));
    expect(LAST(s, "voteSealed")?.visibility).toEqual({ kind: "secret", player: "p2" });
    s = run(toMeeting(s), vote("p1", "p0"));
    const ballots = ofType(s.log, "voteCast");
    expect(ballots.map((e) => [e.player, e.sealed])).toEqual([["p2", true], ["p1", false]]);
    for (const e of [...ballots, LAST(s, "voteSealed")!]) {
      expect(e.visibility).toEqual({ kind: "secret", player: e.player });
      for (const viewer of ["p0", "p1", "p2"]) expect(canSee(e.visibility, viewer, true)).toBe(viewer === e.player);
    }
    s = run(s, CLOSE);
    expect(LAST(s, "meetingClosed")).toMatchObject({ ballots: null, tally: { skip: 0, targets: { p0: 2 } }, result: { kind: "shakedown", target: "p0" } });
  });
});

describe("sealed votes — design §11.2", () => {
  it("a sealed vote is private, is cast as the next meeting opens, and is then used up", () => {
    let s = run(game(3), seal("p2", "p1"), seal("p2", "p0")); // re-sealing replaces it
    expect(LAST(s, "voteSealed")).toEqual({ type: "voteSealed", visibility: { kind: "private", player: "p2" }, player: "p2", vote: { kind: "shakedown", target: "p0" } });
    expect(s.players.p2?.sealedVote).toEqual({ kind: "shakedown", target: "p0" });
    s = toMeeting(s);
    expect(s.log.slice(-2)).toEqual([
      expect.objectContaining({ type: "meetingOpened" }),
      { type: "voteCast", visibility: { kind: "private", player: "p2" }, meetingId: "act-1", player: "p2", vote: { kind: "shakedown", target: "p0" }, sealed: true },
    ]);
    expect(s.players.p2?.sealedVote).toBeNull();
    s = toMeeting(run(s, CLOSE));
    expect(s.meeting?.votes).toEqual({}); // not carried into the act-2 meeting
  });

  it("a voter who turns up can override their sealed vote live", () => {
    const s = run(game(3), seal("p1", "p0"));
    const after = run(toMeeting(s), vote("p1", null), CLOSE);
    expect(LAST(after, "meetingClosed")?.ballots).toEqual({ p1: { kind: "skip" } });
  });

  it("sealed votes count towards quorum and the majority", () => {
    const s = run(game(4), mv("p3", "vault", 6), seal("p0", "p3"), seal("p1", "p3"));
    const after = run(toMeeting(s), CLOSE);
    expect(LAST(after, "meetingClosed")).toMatchObject({ result: { kind: "shakedown", target: "p3" }, tally: { skip: 0, targets: { p3: 2 } } });
  });

  it("an emergency meeting uses up the sealed vote too (provisional)", () => {
    let s = run(game(3), seal("p0", "p1"), emergency("p2"), open("emergency-p2"));
    expect(s.meeting?.votes).toEqual({ p0: { kind: "shakedown", target: "p1" } });
    s = toMeeting(run(s, close("emergency-p2")));
    expect(s.meeting?.votes).toEqual({});
  });

  it("a sealed vote is checked like a ballot", () => {
    const s = game(3);
    expect(reason(s, seal("p0", "p0"))).toMatch(/yourself/);
    expect(reason(s, seal("p0", "zed"))).toMatch(/unknown player/);
    expect(reason(s, { type: "sealVote", player: "p0" })).toMatch(/vote must be/);
  });
});

describe("quorum and majority — design §11.2", () => {
  const m = (entries: [string, number][]) => new Map(entries);
  it.each([
    ["fewer than half the crew voted", 4, 1, 0, m([["a", 1]]), { kind: "noQuorum" }],
    ["exactly half the crew is a quorum", 4, 2, 0, m([["a", 2]]), { kind: "shakedown", target: "a" }],
    ["half the votes cast is not a majority", 4, 4, 2, m([["a", 2]]), { kind: "noMajority" }],
    ["a 2–2 split", 4, 4, 0, m([["a", 2], ["b", 2]]), { kind: "noMajority" }],
    ["more than half of the votes cast", 5, 3, 0, m([["a", 2], ["b", 1]]), { kind: "shakedown", target: "a" }],
    ["a skip majority", 4, 4, 3, m([["a", 1]]), { kind: "skipped" }],
    ["nobody voted", 2, 0, 0, m([]), { kind: "noQuorum" }],
    ["one of two players is a quorum", 2, 1, 0, m([["a", 1]]), { kind: "shakedown", target: "a" }],
  ] as const)("%s", (_name, crew, cast, skip, targets, expected) => {
    expect(meetingResult(crew, cast, skip, targets)).toEqual(expected);
  });

  // extension.md "Voting": one rule at every crew size, more than half the weight cast (the ⅓ plurality from 9 is gone).
  it.each([
    ["9p: 3 of 9 is no longer enough", 9, 9, 2, m([["a", 3], ["b", 2], ["c", 2]]), 9, { kind: "noMajority" }],
    ["12p: 4 of 12, the rest scattered, is no shakedown", 12, 12, 3, m([["a", 4], ["b", 3], ["c", 2]]), 12, { kind: "noMajority" }],
    ["12p: 7 of 12 is a majority", 12, 12, 1, m([["a", 7], ["b", 4]]), 12, { kind: "shakedown", target: "a" }],
    ["10p: weight counts: 5 ballots weighing 6 of 11", 10, 10, 3, m([["a", 6], ["b", 2]]), 11, { kind: "shakedown", target: "a" }],
  ] as const)("big crews: %s", (_name, crew, cast, skip, targets, weight, expected) => {
    expect(meetingResult(crew, cast, skip, targets, weight)).toEqual(expected);
  });

  it("no shakedown without a quorum, even if every vote names the same player", () => {
    const s = run(act1Meeting(), vote("p1", "p0"), CLOSE);
    expect(LAST(s, "meetingClosed")).toMatchObject({ result: { kind: "noQuorum" }, tally: { skip: 0, targets: { p0: 1 } } });
    expect(ofType(s.log, "shakedownResolved")).toEqual([]);
  });

  it("a skip majority shakes nobody down", () => {
    const s = run(act1Meeting(), vote("p0", null), vote("p1", null), vote("p2", "p0"), CLOSE);
    expect(LAST(s, "meetingClosed")?.result).toEqual({ kind: "skipped" });
    expect(ofType(s.log, "shakedownResolved")).toEqual([]);
  });
});

describe("shakedowns — design §11.3, extension.md \"Shakedowns (fixed numbers)\"", () => {
  it("the stash is revealed and taken into the Haul", () => {
    const s = act1Meeting();
    expect([s.haul, s.players.p0?.stash]).toEqual([16, 6]);
    const after = run(s, vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(LAST(after, "shakedownResolved")).toEqual({
      type: "shakedownResolved",
      visibility: { kind: "public" },
      meetingId: "act-1",
      target: "p0",
      stashRevealed: 6,
      safeRevealed: 0,
      taken: 6,
      clean: false,
      compensation: 0,
    });
    expect(after.players.p0).toMatchObject({ stash: 0, timesShakenDown: 1 });
    expect(after.haul).toBe(22);
  });

  it("the Fence safe is shown but not taken, and counts toward the clean check: a full safe isn't clean (owner answers, 1 Nov)", () => {
    const s = toMeeting(run(game(3, ["fence"]), mv("p0", "vault", 6, { ability: { kind: "fenceSafe", amount: 5 } })));
    expect(s.players.p0).toMatchObject({ stash: 1, safe: 5 });
    const after = run(s, vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(LAST(after, "shakedownResolved")).toMatchObject({ stashRevealed: 1, safeRevealed: 5, taken: 1, clean: false, compensation: 0 });
    expect(after.players.p0).toMatchObject({ stash: 0, safe: 5 });
  });

  it("a Fence whose stash and safe together are below the threshold is clean and compensated", () => {
    const s = toMeeting(run(game(3, ["fence"]), mv("p0", "lobby", 2, { ability: { kind: "fenceSafe", amount: 1 } })));
    expect(s.players.p0).toMatchObject({ stash: 1, safe: 1 });
    const after = run(s, vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(LAST(after, "shakedownResolved")).toMatchObject({ stashRevealed: 1, safeRevealed: 1, taken: 1, clean: true, compensation: 8 });
    expect(after.players.p0).toMatchObject({ stash: 8, safe: 1 });
  });

  it("clean below 6: the crew pays the target 8 out of the Haul", () => {
    const s = run(act1Meeting(), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(LAST(s, "shakedownResolved")).toMatchObject({ target: "p1", stashRevealed: 0, taken: 0, clean: true, compensation: 8 });
    expect(s.players.p1).toMatchObject({ stash: 8, timesShakenDown: 1 });
    expect(s.haul).toBe(8);
  });

  it("a stash of 5 is clean; 6 (the line) is not", () => {
    const s = toMeeting(run(game(3), mv("p0", "vault", 5)));
    const after = run(s, vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(LAST(after, "shakedownResolved")).toMatchObject({ stashRevealed: 5, clean: true, compensation: 8 });
    expect(BANK_JOB.shakedown).toMatchObject({ cleanBelow: 6, payout: 8 });
  });

  it("the line and payout don't scale with the act: Act 2 is still clean below 6 and pays 8", () => {
    let s = run(game(3), mv("p0", "office", 4)); // p0 stash 4
    s = run(toMeeting(s), CLOSE);
    s = run(s, emergency("p1"), open("emergency-p1"), vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(LAST(s, "shakedownResolved")).toMatchObject({ stashRevealed: 4, clean: true, compensation: 8 });
  });

  it("compensation never takes the Haul below zero (provisional)", () => {
    let s = game(3);
    for (let i = 0; i < 3; i++) s = run(s, mv("p0", "rooftop"), mv("p1", "rooftop"), mv("p2", "rooftop"), ROUND);
    expect(s.haul).toBe(0);
    s = run(s, sched(1), open("act-1"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(LAST(s, "shakedownResolved")).toMatchObject({ clean: true, compensation: 0 });
    expect(s.haul).toBe(0);
  });
});

describe("order at a checkpoint — design §11.4, §11.5", () => {
  it("meeting → shakedown → checkpoint: a shakedown can rescue the checkpoint", () => {
    const s = act1Meeting();
    const rescued = run(s, vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    // Starter mode: no tokens for the target met (extension.md "Tokens and the perk shop").
    expect(since(s, rescued).map((e) => e.type)).toEqual(["voteCast", "voteCast", "meetingClosed", "shakedownResolved", "checkpointChecked", "roundStarted"]);
    expect(LAST(rescued, "checkpointChecked")).toEqual({ type: "checkpointChecked", visibility: { kind: "public" }, act: 1, target: 18, haul: 22, met: true, heatPenalty: 0 });
    expect(rescued.heat).toBe(19);
  });

  it("a missed Act 1 checkpoint adds +15 Heat", () => {
    const s = run(act1Meeting(), CLOSE);
    expect(LAST(s, "checkpointChecked")).toMatchObject({ act: 1, target: 18, haul: 16, met: false, heatPenalty: 15 });
    expect(s.heat).toBe(34);
    expect(LAST(s, "roundStarted")).toMatchObject({ round: 4, act: 2 });
  });

  it("the missed-checkpoint penalty is clamped once and a raid at 100 ends the game", () => {
    let s = { ...game(3), heat: 80 };
    for (let i = 0; i < 3; i++) s = run(s, mv("p0", "lobby", 2), ROUND); // p1 and p2 default to the Lobby: Haul 12 of 18, Heat 92
    expect([s.haul, s.heat]).toEqual([12, 92]);
    const before = run(s, sched(1), open("act-1"));
    const after = run(before, CLOSE);
    expect(since(before, after).map((e) => e.type)).toEqual(["meetingClosed", "checkpointChecked", "copsRaided", "gameEnded"]);
    expect(LAST(after, "checkpointChecked")).toMatchObject({ met: false, heatPenalty: 8 });
    expect(LAST(after, "copsRaided")).toMatchObject({ round: 3, heat: 100 });
    expect(after.phase).toMatchObject({ kind: "ended", outcome: { result: "failed", reason: "heat" } });
  });
});

describe("the final meeting comes before the final check — design §3, §4, §11.4", () => {
  /** p0 in the Vault, p1 on the Rooftop, p2 in the Lobby: Haul +8 and Heat +4 a round. Act 3: p0 pockets everything if `greedy`. */
  function toFinalMeeting(greedy: boolean): GameState {
    let s = game(3);
    for (let round = 1; round <= 9; round++) {
      s = run(s, mv("p0", "vault", greedy && round > 6 ? 6 : 0), mv("p1", "rooftop"), mv("p2", "lobby"), ROUND);
      if (round % 3 === 0) s = run(s, sched(round / 3), OPEN_ACT);
      if (round % 3 === 0 && round < 9) s = run(s, CLOSE);
    }
    expect(s.meeting).toMatchObject({ id: "act-3", act: 3 });
    return s;
  }

  it("Haul at the final target after the final meeting: the heist succeeds (no Heat penalty)", () => {
    const s = toFinalMeeting(false);
    const after = run(s, CLOSE);
    expect(since(s, after).map((e) => e.type)).toEqual(["meetingClosed", "checkpointChecked", "gameEnded"]);
    expect(LAST(after, "checkpointChecked")).toMatchObject({ act: 3, target: 66, haul: 72, met: true, heatPenalty: 0 });
    // Nobody pocketed; p0 handed in more (tie-break 2, end.test.ts).
    expect(after.phase).toMatchObject({ kind: "ended", outcome: { result: "success", winners: ["p0"] } });
  });

  it("missing the final target fails the heist, with no Heat penalty", () => {
    const s = toFinalMeeting(true);
    const after = run(s, CLOSE);
    expect(LAST(after, "checkpointChecked")).toMatchObject({ act: 3, haul: 54, met: false, heatPenalty: 0 });
    expect(after.heat).toBe(s.heat);
    expect(after.phase).toMatchObject({ kind: "ended", outcome: { result: "failed", reason: "target" } });
  });

  it("the final meeting can rescue the heist by shaking down the greediest player", () => {
    const s = run(toFinalMeeting(true), vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(LAST(s, "shakedownResolved")).toMatchObject({ target: "p0", taken: 18, clean: false });
    expect(LAST(s, "checkpointChecked")).toMatchObject({ act: 3, haul: 72, met: true });
    expect(s.phase).toMatchObject({ kind: "ended", outcome: { result: "success" } });
  });
});

describe("determinism and the event log — design §17.2", () => {
  const script = (): GameState => {
    let s = run(game(4, ["fence", "lookout", "insideMan"]), mv("p3", "vault", 6), seal("p2", "p3"), propose("p1", "x"));
    s = run(s, (x: GameState) => accept("p0", x.proposals[0]!.id), (x: GameState) => accept("p3", x.proposals[0]!.id), ROUND);
    s = run(s, emergency("p0"), open("emergency-p0"), vote("p0", "p3"), vote("p1", "p3"), CLOSE, ROUND, ROUND, OPEN_ACT, vote("p0", null), CLOSE);
    return s;
  };

  it("same seed + same commands → same log; replay (also via JSON) rebuilds the state", () => {
    const a = script();
    const b = script();
    expect(b.log).toEqual(a.log);
    expect(replay(a.config, a.log)).toEqual(a);
    expect(replay(a.config, JSON.parse(JSON.stringify(a.log)) as GameEvent[])).toEqual(a);
    expect(a.phase).toEqual({ kind: "planning", round: 4 });
  });

  it("meetings draw no randomness", () => {
    const s = script();
    expect(s.rng).toEqual(game(4).rng);
    expect(ofType(s.log, "rngAdvanced")).toHaveLength(ofType(game(4).log, "rngAdvanced").length);
  });

  it("a player called toString can be voted for and shaken down (__proto__ is refused at setup)", () => {
    const cfg: GameConfig = { ...config(3), players: [{ id: "toString", name: "T", isBot: false }, { id: "p1", name: "P1", isBot: true }, { id: "p2", name: "P2", isBot: true }] };
    const log = setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "rookie" } : e));
    let s = run(replay(cfg, log), mv("toString", "vault", 6), ROUND, ROUND, ROUND, sched(1), open("act-1"), vote("p1", "toString"), vote("p2", "toString"), seal("toString", "p1"));
    s = run(s, CLOSE);
    const closed = LAST(s, "meetingClosed")!;
    expect(Object.hasOwn(closed.tally.targets, "toString")).toBe(true);
    expect(Object.hasOwn(closed.ballots ?? {}, "p1")).toBe(true);
    expect(s.players["toString"]).toMatchObject({ stash: 0, timesShakenDown: 1, sealedVote: { kind: "shakedown", target: "p1" } });
    expect(replay(cfg, s.log)).toEqual(s);
  });
});
