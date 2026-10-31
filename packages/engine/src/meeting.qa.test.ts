// QA (PR #6): full 9-round games with all three meetings at 3, 4 and 12
// players; quorum, ties, absentees and sealed votes at the boundaries;
// emergency-meeting timing; stale and wrong-id deadlines; shakedown edge cases;
// the missed-checkpoint raid; ballot visibility per mode; determinism.
// design §11, §4, §3
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState, VoteVisibility } from "./types";
import { canSee } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { V01_NUMBERS } from "./v01-numbers.testkit";

function config(players: number, voteVisibility: VoteVisibility = "hiddenThenRevealed"): GameConfig {
  return {
    seed: "qa-meeting",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    mole: "off",
    eventsEnabled: false,
    voteVisibility,
    starterMode: false,
    contentOverrides: V01_NUMBERS, // scripted against content 0.1.0 numbers (balance pass 1)
  };
}

/** Seat i is dealt roles[i] (Rookie if missing). */
function game(players: number, roles: string[] = [], mode?: VoteVisibility): GameState {
  const cfg = config(players, mode);
  let seat = 0;
  const log = setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "rookie" } : e));
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleCommand(s, typeof c === "function" ? c(s) : c);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
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
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const LAST = <T extends GameEvent["type"]>(s: GameState, type: T) => ofType(s.log, type).at(-1);

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const open = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId } });
const close = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId } });
const CLOSE = (s: GameState) => close(s.meeting?.id);
const sched = (act: unknown, slot = "auto") => ({ type: "scheduleMeeting", act, slot });
const propose = (player: string, slot: string) => ({ type: "proposeMeeting", player, slot });
const accept = (player: string) => (s: GameState) => ({ type: "acceptMeeting", player, proposalId: s.proposals[0]?.id });
const emergency = (player: string) => ({ type: "callEmergency", player });
const choice = (target: string | null) => (target === null ? { kind: "skip" } : { kind: "shakedown", target });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: choice(target) });
const seal = (player: string, target: string | null) => ({ type: "sealVote", player, vote: choice(target) });

/** Default rounds until the act's meeting is awaited; then the server schedules and opens it. */
function toActMeeting(s: GameState): GameState {
  while (s.phase.kind === "planning") s = run(s, ROUND);
  const act = Math.ceil(s.round / 3);
  return run(s, sched(act), open(`act-${act}`));
}

/** design §11.1: the slot locks only once more than half the crew accepted (the proposer included). */
function lockByVote(s: GameState, slot: string): GameState {
  const n = s.playerOrder.length;
  const from = s.log.length;
  s = run(s, propose("p0", slot));
  for (let i = 1; s.scheduledMeeting === null; i++) {
    expect(i * 2).toBeLessThanOrEqual(n); // not locked at exactly half
    s = run(s, accept(`p${i}`));
  }
  expect(s.proposals).toEqual([]);
  expect(LAST(s, "meetingScheduled")?.proposalId).not.toBeNull();
  expect(ofType(s.log.slice(from), "meetingProposalAccepted").length + 1).toBe(Math.floor(n / 2) + 1);
  return s;
}

/**
 * A full 9-round game exercising every kind of meeting:
 * - Act 1 slot voted in; p1's emergency in round 2 (notice period across a round deadline) ends `skipped`;
 *   p2 seals a vote on p0; the Act 1 meeting shakes p0 down (everyone but p0, who is absent).
 * - Act 2 slot picked by the server; p0's emergency in the awaited phase ends `noMajority` (tie);
 *   the Act 2 meeting is all-skip.
 * - Act 3 slot voted in; the final meeting has fewer than half the crew voting (no quorum).
 */
function fullGame(n: number, mode: VoteVisibility): GameState {
  const crew = ids(n);
  let s = game(n, [], mode);
  // Act 1
  s = lockByVote(s, "act1-slot");
  s = run(s, mv("p0", "vault", 4), ROUND); // round 1: p0 pockets 4
  s = run(s, emergency("p1"), mv("p2", "lobby"), ROUND); // notice period spans round 2's deadline
  expect(s.phase).toEqual({ kind: "planning", round: 3 });
  s = run(s, open("emergency-p1"), ...crew.map((p) => vote(p, null)), CLOSE);
  expect(LAST(s, "meetingClosed")?.result).toEqual({ kind: "skipped" });
  expect(s.phase).toEqual({ kind: "planning", round: 3 });
  s = run(s, seal("p2", "p0"), ROUND);
  expect(s.phase).toEqual({ kind: "awaitingMeeting", act: 1 });
  s = run(s, open("act-1"));
  expect(s.meeting?.votes).toEqual({ p2: { kind: "shakedown", target: "p0" } });
  s = run(s, ...crew.slice(1).filter((p) => p !== "p2").map((p) => vote(p, "p0")), CLOSE);
  expect(LAST(s, "shakedownResolved")).toMatchObject({ meetingId: "act-1", target: "p0", stashRevealed: 4, clean: false });
  expect(s.phase).toEqual({ kind: "planning", round: 4 });
  // Act 2
  s = run(s, ROUND, ROUND, ROUND, sched(2, "server-pick"), emergency("p0"), open("emergency-p0"));
  // A tie: the first half votes for the last seat, the second half for p0 (odd crews: the last seat skips).
  const half = Math.floor(n / 2);
  s = run(s, ...crew.map((p, i) => vote(p, i < half ? `p${n - 1}` : i < 2 * half ? "p0" : null)), CLOSE);
  expect(LAST(s, "meetingClosed")).toMatchObject({ result: { kind: "noMajority" }, tally: { targets: { p0: half, [`p${n - 1}`]: half } } });
  expect(s.phase).toEqual({ kind: "awaitingMeeting", act: 2 });
  s = run(s, open("act-2"), ...crew.map((p) => vote(p, null)), CLOSE);
  expect(LAST(s, "meetingClosed")?.result).toEqual({ kind: "skipped" });
  // Act 3
  if (s.phase.kind === "ended") return s;
  s = lockByVote(s, "act3-slot");
  s = run(s, ROUND, ROUND, ROUND, open("act-3"));
  // Fewer than half the crew turns up.
  const turnout = Math.ceil(n / 2) - 1;
  s = run(s, ...crew.slice(1, 1 + turnout).map((p) => vote(p, "p0")), CLOSE);
  expect(LAST(s, "meetingClosed")?.result).toEqual({ kind: "noQuorum" });
  return s;
}

describe("QA: full 9-round games with all three meetings — design §11, §4, §3", () => {
  const cases: [number, VoteVisibility][] = [
    [3, "hiddenThenRevealed"],
    [4, "open"],
    [12, "secret"],
  ];

  it.each(cases)("%i players (%s): three regular meetings, two emergencies, ended; deterministic and replayable", (n, mode) => {
    const a = fullGame(n, mode);
    expect(a.phase.kind).toBe("ended");
    const opened = ofType(a.log, "meetingOpened");
    expect(opened.map((e) => [e.meetingId, e.kind, e.act])).toEqual([
      ["emergency-p1", "emergency", 1],
      ["act-1", "regular", 1],
      ["emergency-p0", "emergency", 2],
      ["act-2", "regular", 2],
      ["act-3", "regular", 3],
    ]);
    expect(ofType(a.log, "meetingClosed")).toHaveLength(5);
    // One checkpoint per act, after the regular meeting; rounds 1–9 each resolved once.
    expect(ofType(a.log, "checkpointChecked").map((e) => e.act)).toEqual([1, 2, 3]);
    expect(ofType(a.log, "roundResolved").map((e) => e.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ofType(a.log, "checkpointChecked").at(-1)?.heatPenalty).toBe(0);
    // Same seed + same commands → same log; replay (via JSON too) rebuilds the state.
    expect(fullGame(n, mode).log).toEqual(a.log);
    expect(replay(a.config, JSON.parse(JSON.stringify(a.log)) as GameEvent[])).toEqual(a);
    // Every command is refused once the game is over.
    for (const c of [vote("p1", "p0"), seal("p1", "p0"), emergency("p2"), propose("p1", "z"), sched(3), open("act-3"), close("act-3")]) {
      expect(reason(a, c)).toMatch(/over/);
    }
  });
});

describe("QA: quorum, ties and absent players at the boundaries — design §11.2", () => {
  it("12 players: 6 ballots (exactly half) is a quorum, 5 is not; absentees don't count as votes", () => {
    const s = toActMeeting(run(game(12), mv("p0", "vault", 6)));
    const six = run(s, ...ids(12).slice(1, 7).map((p) => vote(p, "p0")), CLOSE);
    expect(LAST(six, "meetingClosed")).toMatchObject({ result: { kind: "shakedown", target: "p0" }, tally: { skip: 0, targets: { p0: 6 } } });
    const five = run(s, ...ids(12).slice(1, 6).map((p) => vote(p, "p0")), CLOSE);
    expect(LAST(five, "meetingClosed")?.result).toEqual({ kind: "noQuorum" });
    expect(ofType(five.log, "shakedownResolved")).toEqual([]);
  });

  it("3 players: one ballot is no quorum, two are; a 1–1 split between targets is no majority", () => {
    const s = toActMeeting(game(3));
    expect(LAST(run(s, vote("p1", "p0"), CLOSE), "meetingClosed")?.result).toEqual({ kind: "noQuorum" });
    expect(LAST(run(s, vote("p1", "p0"), vote("p2", "p0"), CLOSE), "meetingClosed")?.result).toEqual({ kind: "shakedown", target: "p0" });
    expect(LAST(run(s, vote("p1", "p0"), vote("p0", "p1"), CLOSE), "meetingClosed")?.result).toEqual({ kind: "noMajority" });
  });

  it("12 players: 6 vs 6 between two targets and 6 shakedown vs 6 skip are both no majority; 7 of 12 passes", () => {
    const s = toActMeeting(game(12));
    const crew = ids(12);
    const tie = run(s, ...crew.map((p, i) => vote(p, i < 6 ? "p11" : "p0")), CLOSE);
    expect(LAST(tie, "meetingClosed")).toMatchObject({ result: { kind: "noMajority" }, tally: { skip: 0, targets: { p0: 6, p11: 6 } } });
    const vsSkip = run(s, ...crew.map((p, i) => vote(p, i < 6 ? null : "p0")), CLOSE);
    expect(LAST(vsSkip, "meetingClosed")?.result).toEqual({ kind: "noMajority" });
    const seven = run(s, ...crew.map((p, i) => vote(p, i < 5 ? null : "p0")), CLOSE);
    expect(LAST(seven, "meetingClosed")?.result).toEqual({ kind: "shakedown", target: "p0" });
  });

  it("an all-skip meeting still runs the checkpoint; a sealed vote overridden live counts once", () => {
    let s = run(game(4), seal("p1", "p0"));
    s = toActMeeting(s);
    s = run(s, ...ids(4).map((p) => vote(p, null)), CLOSE);
    expect(LAST(s, "meetingClosed")).toMatchObject({ result: { kind: "skipped" }, tally: { skip: 4, targets: {} } });
    expect(ofType(s.log, "checkpointChecked")).toHaveLength(1);
  });
});

describe("QA: emergency meetings — design §11.1", () => {
  it("one per player per game, even after it closed and in a later act", () => {
    let s = run(game(3), emergency("p0"), open("emergency-p0"), CLOSE);
    s = toActMeeting(s);
    expect(reason(s, emergency("p1"))).toMatch(/already open/);
    s = run(s, CLOSE);
    expect(s.round).toBe(4);
    expect(reason(s, emergency("p0"))).toMatch(/already called/);
    expect(run(s, emergency("p1")).pendingEmergency?.by).toBe("p1");
  });

  it("during the notice period: moves, round deadlines, alibis, proposals and sealing go on; a second call is refused", () => {
    let s = run(game(4), emergency("p3"));
    s = run(s, mv("p0", "vault", 1), ROUND, { type: "postAlibi", player: "p0", room: "lobby" }, propose("p1", "x"), seal("p2", "p3"));
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
    expect(reason(s, emergency("p0"))).toMatch(/already been called/);
    s = run(s, open("emergency-p3"));
    expect(s.meeting?.votes).toEqual({ p2: { kind: "shakedown", target: "p3" } });
  });

  it("while the regular meeting is pending (scheduled, awaited): the regular opens first if the server says so", () => {
    let s = run(game(3), sched(1), ROUND, ROUND, ROUND, emergency("p2"));
    expect(s.phase.kind).toBe("awaitingMeeting");
    s = run(s, open("act-1"));
    expect(reason(s, open("emergency-p2"))).toMatch(/already open/);
    expect(reason(s, close("emergency-p2"))).toMatch(/not open/);
    s = run(s, close("act-1"));
    expect(s.pendingEmergency?.meetingId).toBe("emergency-p2");
    s = run(s, open("emergency-p2"));
    expect(s.meeting).toMatchObject({ act: 2, calledBy: "p2" });
  });

  it("an emergency called in the final act's awaited phase can still open before the final meeting", () => {
    let s = game(2);
    for (let act = 1; act <= 2; act++) s = run(toActMeeting(s), CLOSE);
    while (s.phase.kind === "planning") s = run(s, ROUND);
    s = run(s, emergency("p0"), open("emergency-p0"), CLOSE);
    expect(s.phase).toEqual({ kind: "awaitingMeeting", act: 3 });
    expect(ofType(s.log, "checkpointChecked")).toHaveLength(2);
    s = run(s, sched(3), open("act-3"), CLOSE);
    expect(s.phase.kind).toBe("ended");
  });
});

describe("QA: stale, duplicate and wrong-id deadlines — design §4.1", () => {
  it("are refused without changing state", () => {
    let s = run(game(3), emergency("p1"));
    expect(reason(s, open("emergency-p0"))).toMatch(/not waiting/); // p0 never called one
    expect(reason(s, open("act-1"))).toMatch(/not waiting/); // nothing scheduled
    expect(reason(s, close("emergency-p1"))).toMatch(/not open/); // not open yet
    s = run(s, open("emergency-p1"));
    for (const id of ["act-1", "emergency-p0", undefined, null, { id: "emergency-p1" }]) expect(reason(s, close(id))).toMatch(/not open/);
    expect(reason(s, { type: "advance", deadline: { kind: "closeMeeting" } })).toMatch(/not open/);
    s = run(s, CLOSE);
    expect(reason(s, close("emergency-p1"))).toMatch(/not open/); // duplicate
    expect(reason(s, open("emergency-p1"))).toMatch(/not waiting/); // stale re-open
    s = toActMeeting(s);
    expect(reason(s, ROUND(s))).toMatch(/paused/);
    expect(reason(s, { type: "advance", deadline: { kind: "round", round: 4 } })).toMatch(/paused/);
    s = run(s, CLOSE);
    // Act 1 is over: its deadlines and its schedule are stale.
    expect(reason(s, close("act-1"))).toMatch(/not open/);
    expect(reason(s, open("act-1"))).toMatch(/not waiting/);
    expect(reason(s, sched(1))).toMatch(/not being played/);
    expect(reason(s, { type: "advance", deadline: { kind: "round", round: 3 } })).toMatch(/not pending/);
    expect(reason(s, open("act-2"))).toMatch(/not waiting/); // not scheduled yet
    s = run(s, sched(2));
    expect(reason(s, open("act-2"))).toMatch(/after round 6/); // too early
  });
});

describe("QA: shakedowns — design §11.3", () => {
  it("Fence: only the stash outside the safe is revealed and taken; the safe is untouched", () => {
    let s = run(game(3, ["fence"]), mv("p0", "vault", 6, { ability: { kind: "fenceSafe", amount: 2 } }), ROUND);
    s = run(s, mv("p0", "vault", 6), ROUND); // stash 10, safe 2
    expect(s.players.p0).toMatchObject({ stash: 10, safe: 2 });
    s = toActMeeting(s);
    const haul = s.haul;
    s = run(s, vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(LAST(s, "shakedownResolved")).toMatchObject({ stashRevealed: 10, taken: 10, clean: false, compensation: 0 });
    expect(JSON.stringify(LAST(s, "shakedownResolved"))).not.toMatch(/safe/);
    expect(s.players.p0).toMatchObject({ stash: 0, safe: 2 });
    expect(s.haul).toBe(haul + 10);
  });

  it.each([
    [2, 6, false],
    [2, 5, true],
    [3, 9, false],
    [3, 8, true],
  ])("Act %i: a stash of %i is clean=%s (threshold 3 × act); clean pays 5 × act", (act, stash, clean) => {
    let s = game(3);
    for (let a = 1; a < act; a++) s = run(toActMeeting(s), CLOSE);
    // Give p0 exactly `stash`, pocketing up to 3 of the Vault's loot in each round of the act.
    let left = stash;
    while (s.phase.kind === "planning") {
      const take = Math.min(left, 3);
      s = run(s, mv("p0", "vault", take), ROUND);
      left -= take;
    }
    expect(s.players.p0?.stash).toBe(stash);
    s = run(s, sched(act), open(`act-${act}`), vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(LAST(s, "shakedownResolved")).toMatchObject({ stashRevealed: stash, clean, compensation: clean ? 5 * act : 0 });
  });

  it("compensation larger than a non-empty Haul empties the Haul and never goes negative (provisional)", () => {
    // Round 1: both in the Lobby; p1 pockets 1 (Haul 3). Then nobody loots.
    let s = run(game(2), mv("p0", "lobby", 0), mv("p1", "lobby", 1), ROUND);
    expect(s.players.p1?.stash).toBe(1);
    const haul = s.haul;
    expect(haul).toBeGreaterThan(0);
    expect(haul + 1).toBeLessThan(5);
    s = run(s, mv("p0", "rooftop"), mv("p1", "rooftop"), ROUND, mv("p0", "rooftop"), mv("p1", "rooftop"), ROUND);
    expect(s.haul).toBe(haul);
    s = run(s, sched(1), open("act-1"), vote("p0", "p1"), CLOSE);
    expect(LAST(s, "shakedownResolved")).toMatchObject({ stashRevealed: 1, clean: true, compensation: haul + 1 });
    expect(s.haul).toBe(0);
    expect(s.players.p1?.stash).toBe(haul + 1);
    expect(LAST(s, "checkpointChecked")).toMatchObject({ haul: 0, met: false });
  });
});

describe("QA: missed checkpoint and the raid at 100 — design §11.5, §7", () => {
  /** Two players in Security (no loot, no pressure) for three rounds from a chosen Heat; the Act 1 checkpoint is missed. */
  function missFrom(heat: number): GameState {
    let s = { ...game(2), heat };
    for (let r = 0; r < 3; r++) s = run(s, mv("p0", "security", 0, { watch: "vault" }), mv("p1", "security", 0, { watch: "vault" }), ROUND);
    return run(s, sched(1), open("act-1"));
  }

  it("Heat landing exactly on 100 from the +15 is a raid; one below is not", () => {
    const probe = missFrom(0);
    const gain = probe.heat; // Heat gained over the three rounds
    const at = run(missFrom(85 - gain), CLOSE);
    expect(LAST(at, "checkpointChecked")).toMatchObject({ met: false, heatPenalty: 15 });
    expect(LAST(at, "copsRaided")).toMatchObject({ heat: 100 });
    expect(at.phase).toMatchObject({ kind: "ended", outcome: { result: "failed", reason: "heat" } });
    const below = run(missFrom(84 - gain), CLOSE);
    expect(below.heat).toBe(99);
    expect(ofType(below.log, "copsRaided")).toEqual([]);
    expect(below.phase).toEqual({ kind: "planning", round: 4 });
  });

  it("a missed Act 2 checkpoint adds +15 too, and the shortfall carries over", () => {
    let s = run(toActMeeting(game(2)), CLOSE);
    const heat = s.heat;
    s = toActMeeting(s);
    const before = s.heat;
    s = run(s, CLOSE);
    expect(LAST(s, "checkpointChecked")).toMatchObject({ act: 2, target: 28, met: false, heatPenalty: 15 });
    expect(s.heat).toBe(before + 15);
    expect(heat).toBeLessThan(before);
  });
});

describe("QA: ballot visibility per mode, during and after the game — design §11.2, §17.2", () => {
  /** p2 seals a vote on p0; p1 votes live; the game then ends at the Act 3 meeting. */
  function played(mode: VoteVisibility): GameState {
    let s = run(game(3, [], mode), seal("p2", "p0"));
    s = run(toActMeeting(s), vote("p1", "p0"), CLOSE);
    for (let act = 2; act <= 3; act++) s = run(toActMeeting(s), CLOSE);
    expect(s.phase.kind).toBe("ended");
    return s;
  }
  const crew = ids(3);
  const seen = (e: GameEvent, over: boolean) => crew.filter((p) => canSee(e.visibility, p, over));

  it.each(["hiddenThenRevealed", "open", "secret"] as const)("%s", (mode) => {
    const s = played(mode);
    const sealed = ofType(s.log, "voteSealed");
    const cast = ofType(s.log, "voteCast");
    expect(cast.map((e) => [e.player, e.sealed])).toEqual([["p2", true], ["p1", false]]);
    const closed = ofType(s.log, "meetingClosed");
    expect(closed.every((e) => seen(e, false).length === 3)).toBe(true);
    for (const e of sealed) {
      // A sealed vote is never public before the meeting opens.
      expect(seen(e, false)).toEqual([e.player]);
      expect(seen(e, true)).toEqual(mode === "secret" ? [e.player] : crew);
    }
    for (const e of cast) {
      expect(seen(e, false)).toEqual(mode === "open" ? crew : [e.player]);
      expect(seen(e, true)).toEqual(mode === "secret" ? [e.player] : crew);
    }
    if (mode === "secret") {
      expect(closed.every((e) => e.ballots === null)).toBe(true);
      // Nothing visible to p0, during or after, says who voted how.
      for (const over of [false, true]) {
        const visible = s.log.filter((e) => canSee(e.visibility, "p0", over));
        expect(visible.filter((e) => e.type === "voteCast" || e.type === "voteSealed")).toEqual([]);
        expect(JSON.stringify(visible.filter((e) => e.type !== "gameCreated"))).not.toMatch(/"p1":\{"kind"|"p2":\{"kind"/);
      }
    } else {
      expect(closed[0]?.ballots).toEqual({ p1: { kind: "shakedown", target: "p0" }, p2: { kind: "shakedown", target: "p0" } });
    }
  });
});
