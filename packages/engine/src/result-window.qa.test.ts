// QA (PR #172, S3a.5): adversarial checks of the result window and the crew's
// emergency pool (#167), regular meetings at the bank's thirds and briefings,
// shakedowns against the share, protection until the next regular meeting,
// determinism and what viewFor shows of the new state.
// design §9.1–§9.7, §4.2 steps 9–10, §7.5
import type { PerkId } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import type { ContentOverrides, GameConfig, GameEvent, GameState } from "./types";
import { canSee } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { closeAlibiWindow } from "./result.testkit";
import { viewFor } from "./view";

const NO_BAIL: readonly PerkId[] = ["tail", "softShoes", "plantEvidence"];
const WITH_BAIL: readonly PerkId[] = ["tail", "softShoes", "bail"];

/** A 6-coin Vault that one full grab raids, a quiet 2-coin Lobby; 12 coins a player unless pinned. */
const pins = (coinsPerPlayer = 12): ContentOverrides => ({
  rooms: { vault: { coins: 6 }, lobby: { coins: 2, quietCoins: 2 } },
  bank: { coinsPerPlayer },
  alarm: { bulbs: 4 },
});

function game(n: number, opts: { coins?: number; shop?: readonly PerkId[]; seed?: string } = {}): GameState {
  const cfg: GameConfig = {
    seed: opts.seed ?? "qa-172",
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    contentOverrides: pins(opts.coins),
  };
  const shop = opts.shop ?? NO_BAIL;
  const log = setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "lookout" } : e.type === "shopDealt" ? { ...e, perks: shop } : e));
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    if (Array.isArray(command)) return run(s, ...(command as Cmd[]));
    const r = handleCommand(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    // design §10: a round's alibi window closes at once (nobody posts); these tests are about what follows it.
    const closed = closeAlibiWindow(r.state);
    if (!closed.ok) throw new Error(closed.reason);
    return closed.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const before = JSON.stringify(state);
  const r = handleCommand(state, command);
  if (r.ok) throw new Error(`expected a rejection of ${JSON.stringify(command)}`);
  expect(JSON.stringify(state)).toBe(before);
  return r.reason;
}
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const LAST = <T extends GameEvent["type"]>(s: GameState, type: T) => ofType(s.log, type).at(-1);

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const mv = (player: string, room: string, duffel: number, pocket = 0) => ({ type: "submitMove", player, move: { room, duffel, pocket } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const RESULT = (s: GameState) => ({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const OPEN = (s: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId ?? s.pendingEmergency?.meetingId } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
const SCHED = (s: GameState) => ({ type: "scheduleMeeting", meetingId: s.phase.kind === "awaitingMeeting" ? s.phase.meetingId : null, slot: "auto" });
const emergency = (player: string) => ({ type: "callEmergency", player });
const choice = (target: string | null) => (target === null ? { kind: "skip" } : { kind: "shakedown", target });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: choice(target) });
const seal = (player: string, target: string | null) => ({ type: "sealVote", player, vote: choice(target) });
/** Everyone without a move hands in the Lobby's 2. */
const lobby = (s: GameState) => s.playerOrder.filter((p) => !s.moves[p]).map((p) => mv(p, "lobby", 2));
/** Every other player votes to shake `target` down. */
const against = (s: GameState, target: string) => s.playerOrder.filter((p) => p !== target).map((p) => vote(p, target));

describe("QA: the crew's emergency pool by crew size — design §9.3", () => {
  it.each([
    [3, 1],
    [6, 1],
    [7, 2],
    [12, 2],
  ])("%i players: a pool of %i, public in every view, spent for good and then the window is skipped", (n, pool) => {
    let s = game(n);
    expect(s.emergencies).toBe(pool);
    for (const p of ids(n)) expect(viewFor(s, p).emergencies).toBe(pool);
    // Spend the whole pool, one emergency per round's window, each meeting failing quorum (still spent).
    for (let i = 0; i < pool; i++) {
      s = run(s, lobby, ROUND);
      if (s.phase.kind === "awaitingMeeting") s = run(s, SCHED, OPEN, CLOSE);
      expect(s.phase.kind).toBe("result");
      s = run(s, emergency(`p${i}`), OPEN, CLOSE);
      expect(LAST(s, "meetingClosed")?.result).toEqual({ kind: "noQuorum" });
      expect(s.emergencies).toBe(pool - i - 1);
      expect(s.phase.kind).toBe("planning");
    }
    // Empty pool: the round goes straight to the next one (no window), and nobody can call one, ever.
    const round = s.round;
    s = run(s, lobby, ROUND);
    expect(reason(s, emergency("p1"))).toMatch(/between a round's result and the next planning/);
    if (s.phase.kind === "awaitingMeeting") s = run(s, SCHED, OPEN, CLOSE);
    expect(s.phase).toEqual({ kind: "planning", round: round + 1 });
    expect(reason(s, emergency("p1"))).toMatch(/between a round's result and the next planning/);
    expect(reason(s, RESULT(s))).toMatch(/no result window/);
    // Never refunded: the count equals the pool less the calls, and no event ever raised it.
    expect(s.emergencies).toBe(pool - ofType(s.log, "emergencyMeetingCalled").length);
    expect(s.emergencies).toBe(0);
  });
});

describe("QA: callEmergency outside the result window is refused (#167) — design §9.3", () => {
  const WINDOW = /between a round's result and the next planning/;

  it("in planning (round 1 and later), while a meeting is due, while it is open, during a shakedown window", () => {
    let s = game(7, { shop: WITH_BAIL });
    expect(reason(s, emergency("p0"))).toMatch(WINDOW); // round 1 planning
    s = run(s, mv("p0", "vault", 6), lobby);
    expect(reason(s, emergency("p0"))).toMatch(WINDOW); // planning, moves locked in
    s = run(s, ROUND);
    expect(s.phase).toMatchObject({ kind: "awaitingMeeting", meeting: "briefing" });
    expect(reason(s, emergency("p1"))).toMatch(WINDOW);
    s = run(s, SCHED);
    expect(reason(s, emergency("p1"))).toMatch(WINDOW); // scheduled, not yet open
    s = run(s, OPEN);
    expect(reason(s, emergency("p1"))).toMatch(WINDOW);
    s = run(s, (x: GameState) => against(x, "p0"), CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    expect(reason(s, emergency("p1"))).toMatch(WINDOW);
    s = run(s, RESOLVE);
    // Only now, in the result window.
    expect(s.phase).toEqual({ kind: "result", round: 1 });
    s = run(s, emergency("p1"));
    expect(s.emergencies).toBe(1);
  });

  it("twice in one window is refused even with pool left; the next round's window takes the second; nothing is refunded", () => {
    let s = run(game(12), lobby, ROUND, emergency("p3"));
    expect(reason(s, emergency("p3"))).toMatch(/already been called/);
    expect(reason(s, emergency("p4"))).toMatch(/already been called/);
    expect(reason(s, RESULT(s))).toMatch(/emergency meeting has been called/);
    expect(s.emergencies).toBe(1);
    // Its meeting: everyone skips. The next round starts at once (no second window after round 1).
    s = run(s, OPEN, ...ids(12).map((p) => vote(p, null)), CLOSE);
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
    expect(reason(s, emergency("p4"))).toMatch(WINDOW);
    // 144 coins: round 2 leaves 96 (two-thirds), so its regular meeting comes first, then the window.
    s = run(s, lobby, ROUND);
    expect(s.phase).toMatchObject({ kind: "awaitingMeeting", meeting: "regular" });
    expect(reason(s, emergency("p4"))).toMatch(WINDOW);
    s = run(s, SCHED, OPEN, CLOSE, emergency("p4"), OPEN, CLOSE);
    expect(s.emergencies).toBe(0);
    s = run(s, lobby, ROUND);
    expect(s.phase.kind).toBe("planning"); // the window is skipped
    expect(ofType(s.log, "emergencyMeetingCalled").map((e) => [e.by, e.meetingId])).toEqual([
      ["p3", "emergency-1"],
      ["p4", "emergency-2"],
    ]);
  });

  it("an unknown or missing caller is refused in the window; after the last round nobody can call one", () => {
    let s = run(game(3), lobby, ROUND);
    expect(reason(s, emergency("nobody"))).toMatch(/unknown|not in/i);
    expect(reason(s, { type: "callEmergency" })).toBeTruthy();
    // Play the bank out without spending: no result window after the last round.
    s = run(s, RESULT);
    while (s.phase.kind !== "ended") {
      const k = s.phase.kind;
      s = run(s, ...(k === "planning" ? [lobby, ROUND] : k === "awaitingMeeting" ? [SCHED, OPEN, CLOSE] : [RESULT]));
    }
    expect(s.emergencies).toBe(1);
    expect(reason(s, emergency("p0"))).toMatch(/over/);
  });
});

describe("QA: regular meetings at the bank's thirds — design §9.1, §9.2, §4.2 step 9", () => {
  it("36 coins: the bank at 25 calls nothing; at exactly 24 (two-thirds) it calls a regular meeting", () => {
    const base = run(game(3), lobby, ROUND, RESULT); // 30 left
    const at25 = run(base, mv("p0", "lobby", 1), lobby, ROUND);
    expect([at25.bank, at25.phase.kind, at25.thirds]).toEqual([25, "result", 0]);
    const at24 = run(base, lobby, ROUND);
    expect([at24.bank, at24.thirds]).toEqual([24, 1]);
    expect(at24.phase).toEqual({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" });
    // From 25, a 3-coin round takes it to 22: that round calls the meeting.
    const from25 = run(at25, RESULT, ...ids(3).map((p) => mv(p, "lobby", 1)), ROUND);
    expect([from25.bank, from25.phase.kind, from25.thirds]).toEqual([22, "awaitingMeeting", 1]);
  });

  it("one round crossing both thirds holds one regular meeting, and none later", () => {
    // 9 coins; one round of three Lobby grabs takes 6, leaving 3 = one-third.
    let s = run(game(3, { coins: 3 }), lobby, ROUND);
    expect([s.bank, s.thirds]).toEqual([3, 2]);
    expect(s.phase).toMatchObject({ kind: "awaitingMeeting", meeting: "regular" });
    s = run(s, SCHED, OPEN, CLOSE, RESULT);
    expect(s.stretch).toBe(2);
    while (s.phase.kind !== "ended") {
      const k = s.phase.kind;
      s = run(s, ...(k === "planning" ? [...ids(3).map((p) => mv(p, "lobby", 1)), ROUND] : k === "result" ? [RESULT] : [SCHED, OPEN, CLOSE]));
    }
    expect(ofType(s.log, "meetingOpened").map((e) => e.kind)).toEqual(["regular"]);
  });

  it("a raid in the round that crosses a third: one meeting, counted as regular (recharges, lifts protection, next stretch)", () => {
    // Round 1: a briefing (Vault raid); p1 is shaken down there and protected. 36 − 6 − 4 = 26 left.
    let s = run(game(3), mv("p0", "vault", 6), lobby, ROUND);
    expect(s.phase).toMatchObject({ kind: "awaitingMeeting", meeting: "briefing", meetingId: "meeting-1" });
    s = run(s, SCHED, OPEN, vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect([s.protected, s.stretch]).toEqual([["p1"], 1]);
    s = run(s, RESULT);
    // Round 2 (Vault taped): all Lobby, 26 − 6 = 20 ≤ 24. Round 3 (still taped): 14. Round 4 (Vault back): a raid while 14 − 6 − 4 = 4 ≤ 12 crosses the second third.
    s = run(s, lobby, ROUND);
    expect(s.phase).toMatchObject({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-2" });
    s = run(s, SCHED, OPEN);
    expect([s.protected, s.stretch]).toEqual([[], 2]);
    s = run(s, CLOSE, RESULT, lobby, ROUND);
    expect([s.bank, s.phase.kind]).toEqual([14, "result"]);
    s = run(s, RESULT, mv("p2", "vault", 6), lobby, ROUND);
    expect(ofType(s.log, "roomRaided").length).toBe(2);
    expect([s.bank, s.thirds]).toEqual([4, 2]);
    expect(s.phase).toEqual({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-3" });
    s = run(s, SCHED, OPEN);
    expect(s.meeting?.kind).toBe("regular");
    expect(s.stretch).toBe(3);
    expect(ofType(s.log, "meetingOpened").map((e) => [e.meetingId, e.kind])).toEqual([
      ["meeting-1", "briefing"],
      ["meeting-2", "regular"],
      ["meeting-3", "regular"],
    ]);
  });
});

describe("QA: shakedowns against the share and honesty — design §9.6, §7.1, §7.5", () => {
  it("exactly at the share is clean; above it the excess is set aside and counts toward honesty once, at the next split only", () => {
    // Round 1: p0 pockets 2 (stash 2 + cut), p1 pockets 1, p2 hands in 2. Duffel 3 → cut 1, kitty 0.
    let s = run(game(3), mv("p0", "lobby", 0, 2), mv("p1", "lobby", 1, 1), mv("p2", "lobby", 2), ROUND);
    expect([s.share, s.players.p0?.stash, s.players.p1?.stash, s.players.p2?.stash, s.reached]).toEqual([1, 3, 2, 1, 3]);
    // The pool's emergency: p2 (at the share) is clean, nothing taken, but still protected.
    s = run(s, emergency("p0"), OPEN, vote("p0", "p2"), vote("p1", "p2"), CLOSE);
    expect(LAST(s, "shakedownResolved")).toMatchObject({ target: "p2", stashRevealed: 1, taken: 0, clean: true });
    expect([s.setAside, s.players.p2?.stash, s.protected]).toEqual([0, 1, ["p2"]]);
    // Round 2 crosses the first third (36 − 6 − 6 = 24): the regular meeting shakes down p0 (2 above the share).
    s = run(s, lobby, ROUND, SCHED, OPEN, vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    const sharePre = s.share;
    expect(LAST(s, "shakedownResolved")).toMatchObject({ target: "p0", taken: 2, clean: false });
    expect([s.players.p0?.stash, s.setAside]).toEqual([sharePre, 2]);
    const reachedBefore = s.reached;
    // Round 3: the 2 set aside reach the duffel with 6 handed in: counted once.
    s = run(s, lobby, ROUND);
    expect(LAST(s, "duffelSplit")).toMatchObject({ handedIn: 6, setAside: 2 });
    expect(s.reached).toBe(reachedBefore + 8);
    expect(s.setAside).toBe(0);
    // Round 4: nothing set aside any more; the kitty never counts again.
    const r3 = s.reached;
    while (s.phase.kind !== "planning") s = run(s, s.phase.kind === "awaitingMeeting" ? [SCHED, OPEN, CLOSE] : RESULT);
    s = run(s, lobby, ROUND);
    expect(LAST(s, "duffelSplit")).toMatchObject({ handedIn: 6, setAside: 0 });
    expect(s.reached).toBe(r3 + 6);
    // Honesty never above 1: reached ≤ taken at every round summary.
    for (const e of ofType(s.log, "roundResolved")) expect(e.honesty.reached).toBeLessThanOrEqual(e.honesty.taken);
    expect(LAST(s, "roundResolved")?.honesty).toEqual({ reached: 3 + 6 + 8 + 6, taken: 6 + 6 + 6 + 6 });
  });
});

describe("QA: protection until the next regular meeting opens — design §9.5, §9.7", () => {
  it("live votes for a protected player are refused in briefings and emergencies; sealed ones count as skips there; the next regular meeting lifts it", () => {
    // 7 players. Round 1: p0's Vault raid → briefing; p6 pockets 2 and is shaken down.
    let s = run(game(7), seal("p1", "p6"), mv("p0", "vault", 6), mv("p6", "lobby", 0, 2), lobby, ROUND, SCHED, OPEN);
    // p1's sealed vote was cast as it opened (p6 not yet protected).
    expect(s.meeting?.votes.p1).toEqual({ kind: "shakedown", target: "p6" });
    s = run(s, (x: GameState) => against(x, "p6").filter((c) => c.player !== "p1"), CLOSE);
    expect(s.protected).toEqual(["p6"]);
    // Sealed votes for the protected p6 (and one for p5) before the emergency.
    s = run(s, seal("p2", "p6"), seal("p3", "p6"), seal("p4", "p5"), emergency("p0"), OPEN);
    expect(s.meeting?.votes).toEqual({ p2: { kind: "skip" }, p3: { kind: "skip" }, p4: { kind: "shakedown", target: "p5" } });
    expect(reason(s, vote("p1", "p6"))).toMatch(/protected/);
    expect(reason(s, vote("p6", "p6"))).toMatch(/yourself/);
    // A live vote replaces the sealed skip; protected players still vote.
    s = run(s, vote("p6", "p5"), vote("p2", null), CLOSE);
    expect(LAST(s, "meetingClosed")?.tally).toEqual({ skip: 2, targets: { p5: 2 } });
    expect([s.protected, s.players.p2?.sealedVote, s.players.p3?.sealedVote]).toEqual([["p6"], null, null]);
    // Round 2 (36·7/3·2 = 56 is the line; 84 − 6 − 14 = 64, − 14 = 50): its regular meeting lifts protection as it opens.
    s = run(s, seal("p5", "p6"), lobby, ROUND);
    expect(s.phase).toMatchObject({ kind: "awaitingMeeting", meeting: "regular" });
    expect(reason(s, seal("p5", "p5"))).toMatch(/yourself/);
    s = run(s, SCHED, OPEN);
    expect(s.protected).toEqual([]);
    expect(s.meeting?.votes.p5).toEqual({ kind: "shakedown", target: "p6" });
    s = run(s, vote("p1", "p6"));
    expect(s.meeting?.votes.p1).toEqual({ kind: "shakedown", target: "p6" });
  });

  it("a shakedown passed through the Bail window protects too; a briefing does not lift it; protection after the last regular meeting lasts to the end", () => {
    // 3 players, 9 coins: round 1 crosses both thirds; its regular meeting is the last.
    let s = run(game(3, { coins: 3, shop: WITH_BAIL }), lobby, ROUND, SCHED, OPEN, vote("p1", "p0"), vote("p2", "p0"), CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    s = run(s, RESOLVE);
    expect(s.protected).toEqual(["p0"]);
    s = run(s, RESULT);
    while (s.phase.kind !== "ended") {
      const k = s.phase.kind;
      s = run(s, ...(k === "planning" ? [...ids(3).map((p) => mv(p, "lobby", 1)), ROUND] : [RESULT]));
      if (s.phase.kind !== "ended") expect(s.protected).toEqual(["p0"]);
    }
    expect(viewFor(s, "p1").protected).toEqual(["p0"]);
  });
});

describe("QA: determinism and viewFor of the new state — CLAUDE.md, design §18", () => {
  /** A scripted game: a briefing, an emergency, a regular meeting, shakedowns and sealed votes. */
  function script(seed: string): GameState[] {
    const out: GameState[] = [];
    let s = game(7, { seed, shop: WITH_BAIL });
    const push = (...c: Cmd[]) => {
      for (const x of c) {
        s = run(s, x);
        out.push(s);
      }
    };
    push(seal("p2", "p6"), mv("p0", "vault", 6), mv("p6", "lobby", 0, 2), lobby, ROUND, SCHED, OPEN, (x: GameState) => against(x, "p6"), CLOSE, RESOLVE);
    push(seal("p3", "p6"), emergency("p4"), OPEN, CLOSE);
    let guard = 0;
    while (s.phase.kind !== "ended" && guard++ < 200) {
      const k = s.phase.kind;
      push(...(k === "planning" ? [lobby, ROUND] : k === "awaitingMeeting" ? [SCHED, OPEN] : k === "meeting" ? [CLOSE] : k === "shakedownPending" ? [RESOLVE] : [RESULT]));
    }
    expect(s.phase.kind).toBe("ended");
    return out;
  }

  it("same seed and commands give the same log, and the log replays to the same state", () => {
    const a = script("det-1");
    const b = script("det-1");
    const last = a.at(-1) as GameState;
    expect((b.at(-1) as GameState).log).toEqual(last.log);
    expect(replay(last.config, JSON.parse(JSON.stringify(last.log)) as GameEvent[])).toEqual(last);
  });

  it("every view agrees on the public new fields at every step, and nobody sees another's sealed vote, ballot or stash before the end", () => {
    const states = script("leak-1");
    for (const s of states) {
      const views = ids(7).map((p) => viewFor(s, p));
      const pub = (v: (typeof views)[number]) => JSON.stringify([v.phase, v.stretch, v.emergencies, v.protected, v.pendingEmergency, v.scheduledMeeting, v.round, v.share]);
      for (const v of views) expect(pub(v)).toBe(pub(views[0] as (typeof views)[number]));
      expect(views[0]?.emergencies).toBe(s.emergencies);
      expect(views[0]?.protected).toEqual(s.protected);
      if (s.phase.kind === "ended") continue;
      for (const [i, v] of views.entries()) {
        const me = `p${i}`;
        // No event about another player's hidden choices reaches this view.
        for (const e of [...v.ledger, ...v.caseFile].map((x) => x.event)) {
          if (e.type === "voteSealed" || e.type === "voteCast") expect(e.player).toBe(me);
          if (e.type === "coinsGrabbed" || e.type === "moveSubmitted") expect(e.player).toBe(me);
          expect(canSee(e.visibility, me, false)).toBe(true);
        }
        // Other seats carry no stash, role, sealed vote or ballot.
        for (const other of v.players) expect(Object.keys(other).sort()).toEqual(["id", "isBot", "name"]);
        // Another player's sealed vote (p2, p3 on p6) never shows in this view.
        if (me !== "p2" && me !== "p3") expect(JSON.stringify(v.me.sealedVote)).not.toContain("p6");
      }
    }
  });
});
