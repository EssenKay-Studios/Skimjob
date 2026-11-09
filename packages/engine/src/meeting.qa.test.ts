// QA (PR #6, S3a.5): full games with every kind of meeting (briefings,
// regular meetings at the bank's thirds, emergencies from the crew's pool) at
// 3, 7 and 12 players; quorum, ties, absentees and sealed votes at the
// boundaries; emergency timing; stale and wrong-id deadlines; shakedowns at the
// share; ballot visibility per mode; determinism.
// design §9, §4.2, §6.2
import type { PerkId } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import type { ContentOverrides, GameConfig, GameEvent, GameState, VoteVisibility } from "./types";
import { canSee } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { fullGrab } from "./grab.testkit";

/** One perk per tier and no Bail, whatever the seed: Bail in the shop opens a Bail choice window after every passed shakedown (design §9.6). */
const SHOP_NO_BAIL: readonly PerkId[] = ["tail", "softShoes", "plantEvidence"];

/**
 * 12 coins a player, a 6-coin Vault whose grab raids it (6 rings on a 4-bulb
 * bell), a 2-coin quiet Lobby. With everyone in the Lobby a round takes 2 per
 * player, so the bank's thirds go every couple of rounds.
 */
const PINS: ContentOverrides = { rooms: { vault: { coins: 6 }, lobby: { coins: 2, quietCoins: 2 } }, bank: { coinsPerPlayer: 12 }, alarm: { bulbs: 4 } };

function config(players: number, voteVisibility: VoteVisibility = "hiddenThenRevealed"): GameConfig {
  return {
    seed: "qa-meeting",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility,
    contentOverrides: PINS,
  };
}

/** Seat i is dealt roles[i] (a Lookout if missing: its power acts only when used). */
function game(players: number, roles: string[] = [], mode?: VoteVisibility): GameState {
  const cfg = config(players, mode);
  let seat = 0;
  const log = setupEvents(cfg).map(
    (e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "lookout" } : e.type === "shopDealt" ? { ...e, perks: SHOP_NO_BAIL } : e),
  );
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    // A step may be several commands, worked out from the state as it reaches them.
    if (Array.isArray(command)) return run(s, ...(command as Cmd[]));
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
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const LAST = <T extends GameEvent["type"]>(s: GameState, type: T) => ofType(s.log, type).at(-1);

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const mv = (player: string, room: string, pocket = 0) => ({ type: "submitMove", player, move: fullGrab(room, pocket, PINS) });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const ALIBIS = (s: GameState) => ({ type: "advance", deadline: { kind: "alibis", round: s.resolvedRound } });
const RESULT = (s: GameState) => ({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } });
const open = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId } });
const close = (meetingId: unknown) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId } });
const CLOSE = (s: GameState) => close(s.meeting?.id);
const OPEN = (s: GameState) => open(s.scheduledMeeting?.meetingId ?? s.pendingEmergency?.meetingId);
const sched = (meetingId: unknown, slot = "auto") => ({ type: "scheduleMeeting", meetingId, slot });
const SCHED = (s: GameState) => sched(s.phase.kind === "awaitingMeeting" ? s.phase.meetingId : null);
const propose = (player: string, slot: string) => ({ type: "proposeMeeting", player, slot });
const emergency = (player: string) => ({ type: "callEmergency", player });
const choice = (target: string | null) => (target === null ? { kind: "skip" } : { kind: "shakedown", target });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: choice(target) });
const seal = (player: string, target: string | null) => ({ type: "sealVote", player, vote: choice(target) });
/** Everyone without a move hands in the Lobby's 2. */
const lobby = (s: GameState) => s.playerOrder.filter((p) => !s.moves[p]).map((p) => mv(p, "lobby"));

/** Round 1 in the Lobby, then an emergency in its result window: a meeting open with nothing taken above the share. */
function toMeeting(s: GameState): GameState {
  s = run(s, ...lobby(s), ROUND, ALIBIS);
  return run(s, emergency("p0"), OPEN);
}

/**
 * Plays to the end with every kind of meeting: round 1's Vault raid calls a
 * briefing; the bank's thirds call two regular meetings (rounds 2 and 4);
 * emergencies are called in odd rounds' result windows while the pool lasts.
 * `meet` casts each meeting's ballots (all skip by default).
 */
function fullGame(n: number, mode: VoteVisibility, meet: (s: GameState) => Cmd[] = (s) => s.playerOrder.map((p) => vote(p, null)), first: Cmd[] = []): GameState {
  let s = run(game(n, [], mode), ...first);
  const callers = ["p1", "p2"];
  while (s.phase.kind !== "ended") {
    const p = s.phase;
    if (p.kind === "planning") s = run(s, ...(p.round === 1 ? [mv("p0", "vault")] : []), (x: GameState) => lobby(x), ROUND);
    else if (p.kind === "alibis") s = run(s, ALIBIS);
    else if (p.kind === "awaitingMeeting") s = run(s, SCHED, OPEN);
    else if (p.kind === "meeting") s = run(s, ...meet(s), CLOSE);
    else if (p.kind === "result") s = run(s, s.pendingEmergency ? OPEN : p.round % 2 === 1 ? emergency(callers.shift() as string) : RESULT);
    else throw new Error(`unexpected phase ${p.kind}`);
  }
  return s;
}

describe("QA: full games with every kind of meeting — design §9, §6.2", () => {
  it.each([
    [3, "hiddenThenRevealed" as const],
    [7, "open" as const],
    [12, "secret" as const],
  ])("%i players (%s): a briefing, two regular meetings at the thirds, the crew's emergencies; ended, deterministic, replayable", (n, mode) => {
    const a = fullGame(n, mode);
    const kinds = ofType(a.log, "meetingOpened").map((e) => [e.meetingId, e.kind]);
    const second = n >= 7 ? [["emergency-2", "emergency"]] : [];
    expect(kinds).toEqual([["meeting-1", "briefing"], ["emergency-1", "emergency"], ["meeting-2", "regular"], ...second, ["meeting-3", "regular"]]);
    expect(ofType(a.log, "emergencyMeetingCalled").map((e) => e.by)).toEqual(n >= 7 ? ["p1", "p2"] : ["p1"]);
    expect([a.emergencies, a.stretch, a.wanted]).toEqual([0, 3, 1]);
    // The bank runs out in round 6; no meeting after the last round (design §6.2).
    expect(ofType(a.log, "roundResolved").map((e) => e.round)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(a.bank).toBe(0);
    expect(fullGame(n, mode).log).toEqual(a.log);
    expect(replay(a.config, JSON.parse(JSON.stringify(a.log)) as GameEvent[])).toEqual(a);
    for (const c of [vote("p1", "p0"), seal("p1", "p0"), emergency("p2"), propose("p1", "z"), sched("meeting-4"), open("meeting-3"), close("meeting-3"), RESULT(a)]) {
      expect(reason(a, c)).toMatch(/over/);
    }
  });
});

describe("QA: quorum, ties and absent players at the boundaries — design §9.5", () => {
  it("12 players: 6 ballots (exactly half) is a quorum, 5 is not; absentees don't count as votes", () => {
    const s = toMeeting(game(12));
    const six = run(s, ...ids(12).slice(1, 7).map((p) => vote(p, "p0")), CLOSE);
    expect(LAST(six, "meetingClosed")).toMatchObject({ result: { kind: "shakedown", target: "p0" }, tally: { skip: 0, targets: { p0: 6 } } });
    expect(LAST(six, "shakedownResolved")).toMatchObject({ target: "p0", taken: 0, clean: true });
    const five = run(s, ...ids(12).slice(1, 6).map((p) => vote(p, "p0")), CLOSE);
    expect(LAST(five, "meetingClosed")?.result).toEqual({ kind: "noQuorum" });
    expect(ofType(five.log, "shakedownResolved")).toEqual([]);
  });

  it("3 players: one ballot is no quorum, two are; a 1–1 split between targets is no majority", () => {
    const s = toMeeting(game(3));
    expect(LAST(run(s, vote("p1", "p0"), CLOSE), "meetingClosed")?.result).toEqual({ kind: "noQuorum" });
    expect(LAST(run(s, vote("p1", "p0"), vote("p2", "p0"), CLOSE), "meetingClosed")?.result).toEqual({ kind: "shakedown", target: "p0" });
    expect(LAST(run(s, vote("p1", "p0"), vote("p0", "p1"), CLOSE), "meetingClosed")?.result).toEqual({ kind: "noMajority" });
  });

  it("12 players: a 6 vs 6 tie between two targets is no shakedown; 6 shakedown vs 6 skip is none either (skip must be outvoted, design §9.5); 7 of 12 passes", () => {
    const s = toMeeting(game(12));
    const crew = ids(12);
    const tie = run(s, ...crew.map((p, i) => vote(p, i < 6 ? "p11" : "p0")), CLOSE);
    expect(LAST(tie, "meetingClosed")).toMatchObject({ result: { kind: "noMajority" }, tally: { skip: 0, targets: { p0: 6, p11: 6 } } });
    const vsSkip = run(s, ...crew.map((p, i) => vote(p, i < 6 ? null : "p0")), CLOSE);
    expect(LAST(vsSkip, "meetingClosed")?.result).toEqual({ kind: "noMajority" });
    // 4 / 4 / 4 between three targets: each has ⅓, but it's a tie.
    const three = run(s, ...crew.map((p, i) => vote(p, i < 4 ? "p11" : i < 8 ? "p0" : "p1")), CLOSE);
    expect(LAST(three, "meetingClosed")?.result).toEqual({ kind: "noMajority" });
    const seven = run(s, ...crew.map((p, i) => vote(p, i < 5 ? null : "p0")), CLOSE);
    expect(LAST(seven, "meetingClosed")?.result).toEqual({ kind: "shakedown", target: "p0" });
  });

  it("an all-skip emergency goes on to the next round; a sealed vote overridden live counts once", () => {
    let s = run(game(4), seal("p1", "p0"));
    s = toMeeting(s);
    s = run(s, ...ids(4).map((p) => vote(p, null)), CLOSE);
    expect(LAST(s, "meetingClosed")).toMatchObject({ result: { kind: "skipped" }, tally: { skip: 4, targets: {} } });
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
  });
});

describe("QA: emergency meetings — design §9.3", () => {
  it("the pool is the crew's: once spent, nobody else can call one, in any later window", () => {
    let s = run(toMeeting(game(3)), CLOSE);
    for (let i = 0; i < 3; i++) {
      s = run(s, ...lobby(s), ROUND);
      expect(reason(s, emergency("p1"))).toMatch(/between a round's result and the next planning/);
      s = run(s, ALIBIS);
      if (s.phase.kind === "awaitingMeeting") s = run(s, SCHED, OPEN, CLOSE);
      expect(s.phase.kind).toBe("planning");
    }
  });

  it("during the notice period: proposals and sealing go on; a second call, the window's deadline and moves are refused", () => {
    let s = run(game(7), ...lobby(game(7)), ROUND, { type: "postAlibi", player: "p0", room: "lobby" }, ALIBIS, emergency("p3"));
    expect(s.phase).toEqual({ kind: "result", round: 1 });
    s = run(s, propose("p1", "x"), seal("p2", "p3"));
    expect(reason(s, emergency("p0"))).toMatch(/already been called/);
    expect(reason(s, RESULT(s))).toMatch(/emergency meeting has been called/);
    expect(reason(s, mv("p0", "lobby"))).toMatch(/while a round is being planned/);
    s = run(s, open("emergency-1"));
    expect(s.meeting?.votes).toEqual({ p2: { kind: "shakedown", target: "p3" } });
    expect(s.emergencies).toBe(1);
  });

  it("after a regular meeting closes, its result window takes an emergency; the next round starts when that closes", () => {
    let s = game(3);
    while (s.phase.kind !== "awaitingMeeting") s = run(s, ...(s.phase.kind === "planning" ? [...lobby(s), ROUND] : s.phase.kind === "alibis" ? [ALIBIS] : [RESULT]));
    s = run(s, SCHED, OPEN, CLOSE);
    expect(s.phase.kind).toBe("result");
    s = run(s, emergency("p2"), OPEN);
    expect(s.meeting).toMatchObject({ kind: "emergency", calledBy: "p2" });
    s = run(s, CLOSE);
    expect(s.phase).toEqual({ kind: "planning", round: s.resolvedRound + 1 });
  });
});

describe("QA: stale, duplicate and wrong-id deadlines — design §4.1", () => {
  it("are refused without changing state", () => {
    let s = run(game(3), ...lobby(game(3)), ROUND, ALIBIS, emergency("p1"));
    expect(reason(s, open("emergency-2"))).toMatch(/not waiting/);
    expect(reason(s, open("meeting-1"))).toMatch(/not waiting/); // nothing scheduled
    expect(reason(s, close("emergency-1"))).toMatch(/not open/); // not open yet
    s = run(s, open("emergency-1"));
    for (const id of ["meeting-1", "emergency-2", undefined, null, { id: "emergency-1" }]) expect(reason(s, close(id))).toMatch(/not open/);
    expect(reason(s, { type: "advance", deadline: { kind: "closeMeeting" } })).toMatch(/not open/);
    expect(reason(s, ROUND(s))).toMatch(/no round deadline/);
    s = run(s, CLOSE);
    expect(reason(s, close("emergency-1"))).toMatch(/not open/); // duplicate
    expect(reason(s, open("emergency-1"))).toMatch(/not waiting/); // stale re-open
    expect(reason(s, { type: "advance", deadline: { kind: "round", round: 1 } })).toMatch(/not pending/);
    expect(reason(s, { type: "advance", deadline: { kind: "alibis", round: 1 } })).toMatch(/no alibi deadline/);
    expect(reason(s, { type: "advance", deadline: { kind: "result", round: 1 } })).toMatch(/no result window/);
    expect(reason(s, sched("meeting-1"))).toMatch(/no meeting is due/);
  });
});

describe("QA: shakedowns at the share — design §9.6", () => {
  it.each([
    [0, true],
    [1, false],
    [2, false],
  ])("%i pocketed above the share: clean=%s, and exactly that is taken", (pocketed, clean) => {
    // Round 1: everyone in the Lobby, p0 pocketing `pocketed` of its 2. 3 players: the split is 6 − pocketed.
    let s = run(game(3), mv("p0", "lobby", pocketed), mv("p1", "lobby"), mv("p2", "lobby"), ROUND, ALIBIS, emergency("p1"), OPEN);
    const share = s.share;
    expect(s.players.p0?.stash).toBe(share + pocketed);
    s = run(s, vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(LAST(s, "shakedownResolved")).toMatchObject({ stashRevealed: share + pocketed, taken: pocketed, clean });
    expect([s.players.p0?.stash, s.setAside, s.protected]).toEqual([share, pocketed, ["p0"]]);
  });

  it("coins a briefing's and an emergency's shakedowns set aside after one round all land in the next split, counting toward honesty once", () => {
    // 7 players. Round 1: p0 and p1 each pocket the Lobby's 2; p2's Vault grab is raided (seized); the rest hand in 2 each.
    let s = game(7);
    s = run(s, mv("p0", "lobby", 2), mv("p1", "lobby", 2), mv("p2", "vault"), (x: GameState) => lobby(x), ROUND, ALIBIS);
    expect(s.phase).toMatchObject({ kind: "awaitingMeeting", meeting: "briefing" });
    s = run(s, SCHED, OPEN, ...ids(7).filter((p) => p !== "p0").map((p) => vote(p, "p0")), CLOSE);
    s = run(s, emergency("p3"), OPEN, ...ids(7).filter((p) => p !== "p1").map((p) => vote(p, "p1")), CLOSE);
    expect([s.setAside, s.reached, s.protected]).toEqual([4, 8, ["p0", "p1"]]);
    s = run(s, (x: GameState) => lobby(x), ROUND);
    expect(LAST(s, "duffelSplit")).toMatchObject({ handedIn: 14, setAside: 4 });
    expect(s.reached).toBe(8 + 14 + 4);
    expect(LAST(s, "roundResolved")?.honesty).toEqual({ reached: 26, taken: 12 + 14 });
  });
});

describe("QA: ballot visibility per mode, during and after the game — design §9.5, §18", () => {
  /** p2 seals a vote on p0; p1 votes live; the game then plays to the round cap (design §6.2). */
  function played(mode: VoteVisibility): GameState {
    // p2's sealed vote is cast in the first meeting (the briefing); p1 votes live there.
    return fullGame(3, mode, (m) => (m.meeting?.id === "meeting-1" ? [vote("p1", "p0")] : []), [seal("p2", "p0")]);
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
