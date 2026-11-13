// QA (PR #44): public lock-in marks and the people-majority meeting lock.
// Owner decisions, 2 Nov. design §5.1, §9.4, §13
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState } from "./types";
import { createGame } from "./setup";
import { handleCommand } from "./handle";
import { closeAlibiWindow } from "./result.testkit";
import { lockedIn, viewFor } from "./view";
import { slotLocks } from "./meeting";
import { fullGrab } from "./grab.testkit";

function config(humans: readonly boolean[], seed = "lockin-qa"): GameConfig {
  return {
    seed,
    players: humans.map((human, i) => ({ id: `p${i}`, name: `P${i}`, isBot: !human })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
  };
}
const crew = (n: number, humans = n) => createGame(config(Array.from({ length: n }, (_, i) => i < humans)));

function run(state: GameState, ...commands: unknown[]): GameState {
  let s = state;
  for (const c of commands) {
    const r = handleCommand(s, c);
    if (!r.ok) throw new Error(`refused ${JSON.stringify(c)}: ${r.reason}`);
    // design §10: a round's alibi window closes at once (nobody posts); these tests are about what follows it.
    const closed = closeAlibiWindow(r.state);
    if (!closed.ok) throw new Error(closed.reason);
    s = closed.state;
  }
  return s;
}
const move = (player: string, room = "lobby", pocket = 0) => ({ type: "submitMove", player, move: fullGrab(room, pocket) });
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const roundDeadline = (round: number) => ({ type: "advance", deadline: { kind: "round", round } });
/** A second room in play (not the lobby) for move changes. */
const other = (s: GameState) => s.rooms.find((r) => r !== "lobby" && r !== "security") ?? "lobby";

describe("a move change after the first lock-in is invisible to others — design §5.1", () => {
  for (const n of [3, 12]) {
    it(`${n} players: every other seat's view is byte-identical before and after a change (room and split)`, () => {
      const s1 = run(crew(n), move("p0", "lobby", 0));
      const views1 = s1.playerOrder.map((p) => JSON.stringify(viewFor(s1, p)));
      const s2 = run(s1, move("p0", other(s1), 0), move("p0", other(s1), 1), move("p0", "lobby", 0));
      expect(since(s1, s2).map((e) => e.type)).toEqual(["moveSubmitted", "moveSubmitted", "moveSubmitted"]);
      s2.playerOrder.forEach((p, i) => {
        if (p === "p0") return;
        expect(JSON.stringify(viewFor(s2, p)), p).toBe(views1[i]);
      });
      // Own view sees its own change; lockedIn and seq unchanged for it too (a change is not a new mark).
      expect(viewFor(s2, "p0").lockedIn).toEqual(["p0"]);
    });
  }

  it("a refused move (bad room) emits nothing, not even a lock-in mark", () => {
    const s0 = crew(3);
    const r = handleCommand(s0, move("p0", "no-such-room"));
    expect(r.ok).toBe(false);
    expect(lockedIn(s0)).toEqual([]);
  });

  it("out of phase: no move and no mark in the result window", () => {
    const s = run(crew(3), move("p0"), move("p1"), roundDeadline(1));
    expect(s.phase.kind).toBe("result");
    expect(handleCommand(s, move("p0")).ok).toBe(false);
    expect(lockedIn(s)).toEqual([]);
  });

  it("a spoofed player id can't lock in someone else's seat when the command names an unknown seat", () => {
    expect(handleCommand(crew(3), move("p9")).ok).toBe(false);
  });
});

describe("the default move never shows as locked in — design §5.1", () => {
  for (const n of [3, 12]) {
    it(`${n} players: only seats that moved are marked; defaults never emit moveLocked and are never in lockedIn`, () => {
      let s = run(crew(n), move("p0"));
      expect(lockedIn(s)).toEqual(["p0"]);
      const before = s;
      s = run(s, roundDeadline(1));
      const evts = since(before, s);
      expect(evts.filter((e) => e.type === "defaultMoveAssigned")).toHaveLength(n - 1);
      expect(evts.filter((e) => e.type === "moveLocked")).toHaveLength(0);
      for (const p of s.playerOrder) expect(viewFor(s, p).lockedIn).toEqual([]);
      // Next round: nobody is marked until they move again.
      s = run(s, { type: "advance", deadline: { kind: "result", round: 1 } });
      expect(lockedIn(s)).toEqual([]);
      s = run(s, move(`p${n - 1}`));
      expect(lockedIn(s)).toEqual([`p${n - 1}`]);
      expect(s.log.at(-2)).toMatchObject({ type: "moveLocked", player: `p${n - 1}`, round: 2 });
    });
  }

  it("12 players: lockedIn is in seat order and complete only once all 12 have moved", () => {
    let s = crew(12, 3);
    const order = [...s.playerOrder].reverse();
    for (const [i, p] of order.entries()) {
      s = run(s, move(p));
      expect(lockedIn(s)).toHaveLength(i + 1);
    }
    expect(lockedIn(s)).toEqual(s.playerOrder);
    expect(s.log.filter((e) => e.type === "moveLocked")).toHaveLength(12);
  });
});

describe("lock-ins and an emergency meeting — design §5.1, §9.3", () => {
  it("no emergency mid-round; in the result window and its meeting nobody is marked and nobody can move", () => {
    let s = run(crew(3), move("p0"), move("p1"));
    expect(handleCommand(s, { type: "callEmergency", player: "p2" }).ok).toBe(false);
    s = run(s, roundDeadline(1), { type: "callEmergency", player: "p2" });
    const meetingId = s.pendingEmergency!.meetingId;
    s = run(s, { type: "advance", deadline: { kind: "openMeeting", meetingId } });
    expect(s.phase.kind).toBe("meeting");
    expect(lockedIn(s)).toEqual([]);
    expect(handleCommand(s, move("p2")).ok).toBe(false); // no moves in a meeting
  });
});

describe("determinism — same seed + same commands = same log", () => {
  it("lock-ins, changes and a person-locked slot replay identically", () => {
    const play = () =>
      run(
        crew(4, 1),
        move("p0"),
        move("p0", "lobby", 1),
        move("p1"),
        move("p2"),
        move("p3"),
        { type: "proposeMeeting", player: "p0", slot: "slot-1" },
        roundDeadline(1),
      );
    expect(JSON.stringify(play().log)).toBe(JSON.stringify(play().log));
  });
});

describe("slot lock by people — design §9.4 (owner decision, 2 Nov)", () => {
  const propose = (player: string, slot = "slot-1") => ({ type: "proposeMeeting", player, slot });
  const accept = (player: string, proposalId = "proposal-1") => ({ type: "acceptMeeting", player, proposalId });

  it("0 humans: more than half the crew (exactly half is not enough)", () => {
    const s = crew(4, 0);
    expect(slotLocks(s, ["p0", "p1"])).toBe(false);
    expect(slotLocks(s, ["p0", "p1", "p2"])).toBe(true);
    const s3 = crew(3, 0);
    expect(slotLocks(s3, ["p0"])).toBe(false);
    expect(slotLocks(s3, ["p0", "p1"])).toBe(true);
    const s12 = crew(12, 0);
    expect(slotLocks(s12, s12.playerOrder.slice(0, 6))).toBe(false);
    expect(slotLocks(s12, s12.playerOrder.slice(0, 7))).toBe(true);
  });

  it("1 human: the human alone locks; every bot together does not", () => {
    const s = crew(12, 1);
    expect(slotLocks(s, s.playerOrder.slice(1))).toBe(false);
    expect(slotLocks(s, ["p0"])).toBe(true);
    // A bot's proposal backed by all 11 bots stays open until the person backs it.
    let g = run(s, propose("p5"), ...s.playerOrder.slice(1).filter((p) => p !== "p5").map((p) => accept(p)));
    expect(g.scheduledMeeting).toBeNull();
    g = run(g, accept("p0"));
    expect(g.scheduledMeeting).toEqual({ meetingId: "meeting-1", slot: "slot-1" });
  });

  it("several humans: exactly half the people is not enough; bots' backing never tips it", () => {
    // 4 people + 8 bots: 2 of 4 people + all 8 bots → open; 3 of 4 → locked.
    const s = crew(12, 4);
    let g = run(s, propose("p0"), accept("p1"), ...s.playerOrder.slice(4).map((p) => accept(p)));
    expect(g.scheduledMeeting).toBeNull();
    g = run(g, accept("p2"));
    expect(g.scheduledMeeting).not.toBeNull();
    // 3 people + 0 bots: 2 locks.
    const t = run(crew(3), propose("p0"));
    expect(t.scheduledMeeting).toBeNull();
    expect(run(t, accept("p1")).scheduledMeeting).not.toBeNull();
    // 2 people + 1 bot: both people needed; the bot's backing never tips it.
    const two = run(crew(3, 2), propose("p1"), accept("p2"));
    expect(two.scheduledMeeting).toBeNull();
    expect(run(two, accept("p0")).scheduledMeeting).not.toBeNull();
  });

  it("once locked, no other proposal can be made or accepted; the lock event is emitted once", () => {
    const s0 = crew(3, 1);
    const s = run(s0, propose("p0"));
    expect(s.log.filter((e) => e.type === "meetingScheduled")).toHaveLength(1);
    expect(handleCommand(s, propose("p1", "slot-1")).ok).toBe(false);
    const late = handleCommand(s, accept("p1"));
    if (late.ok) expect(late.events.some((e) => e.type === "meetingScheduled")).toBe(false);
  });

  it("a bot proposal with people in the crew never locks on its own", () => {
    const s0 = crew(5, 2);
    const s = run(s0, propose("p4"));
    expect(since(s0, s).map((e) => e.type)).toEqual(["meetingProposed"]);
  });
});
