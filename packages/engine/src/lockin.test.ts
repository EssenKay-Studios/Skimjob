// Owner decisions (2 Nov): lock-ins are public (design §5.1) and a meeting
// slot locks on a majority of the crew's people, not its bots (design §9.4).
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState } from "./types";
import { canSee } from "./types";
import { createGame } from "./setup";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { fullGrab } from "./grab.testkit";

function config(humans: readonly boolean[]): GameConfig {
  return {
    seed: "lockin-seed",
    players: humans.map((human, i) => ({ id: `p${i}`, name: `P${i}`, isBot: !human })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
  };
}

function run(state: GameState, ...commands: unknown[]): GameState {
  let s = state;
  for (const c of commands) {
    const r = handleCommand(s, c);
    if (!r.ok) throw new Error(`refused ${JSON.stringify(c)}: ${r.reason}`);
    s = r.state;
  }
  return s;
}

const move = (player: string, room = "lobby") => ({ type: "submitMove", player, move: fullGrab(room) });
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);

describe("public lock-in marks — design §5.1 (owner decision, 2 Nov)", () => {
  it("a player's first move of the round emits public moveLocked (no room or split); a change emits nothing new", () => {
    const s0 = createGame(config([true, true, false]));
    const s1 = run(s0, move("p0", "office"));
    const first = since(s0, s1);
    expect(first.map((e) => e.type)).toEqual(["moveLocked", "moveSubmitted"]);
    expect(first[0]).toEqual({ type: "moveLocked", visibility: { kind: "public" }, player: "p0", round: 1 });
    for (const viewer of s1.playerOrder) expect(canSee(first[0]!.visibility, viewer, false)).toBe(true);
    const s2 = run(s1, move("p0", "vault"));
    expect(since(s1, s2).map((e) => e.type)).toEqual(["moveSubmitted"]);
  });

  it("every view lists who has locked in this round, in seat order; bots lock in like anyone; the mark clears with the next round", () => {
    let s = run(createGame(config([true, true, false])), move("p2"), move("p0"));
    for (const viewer of s.playerOrder) expect(viewFor(s, viewer).lockedIn).toEqual(["p0", "p2"]);
    // Others never see the move itself.
    expect(JSON.stringify(viewFor(s, "p1"))).not.toContain('"lobby","pocket"');
    s = run(s, move("p1"), { type: "advance", deadline: { kind: "round", round: 1 } });
    expect(viewFor(s, "p1").lockedIn).toEqual([]); // resolved: alibis
    s = run(s, { type: "advance", deadline: { kind: "alibis", round: 1 } });
    expect(viewFor(s, "p1").lockedIn).toEqual([]); // the result window (design §9.3)
    s = run(s, { type: "advance", deadline: { kind: "result", round: 1 } });
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
    expect(viewFor(s, "p0").lockedIn).toEqual([]);
    s = run(s, move("p1"));
    expect(s.log.at(-2)).toEqual({ type: "moveLocked", visibility: { kind: "public" }, player: "p1", round: 2 });
  });

  it("a missed move (default at the deadline) never shows as locked in", () => {
    const s = run(createGame(config([true, true, true])), move("p0"), { type: "advance", deadline: { kind: "round", round: 1 } });
    expect(s.log.filter((e) => e.type === "moveLocked").map((e) => (e as { player: string }).player)).toEqual(["p0"]);
  });
});

describe("meeting slot lock: a majority of the people — design §9.4 (owner decision, 2 Nov)", () => {
  const propose = (player: string, slot = "slot-1") => ({ type: "proposeMeeting", player, slot });
  const accept = (player: string, proposalId = "proposal-1") => ({ type: "acceptMeeting", player, proposalId });

  it("bots' backing doesn't count: 2 people + 3 bots need both people", () => {
    let s = run(createGame(config([true, true, false, false, false])), propose("p0"), accept("p2"), accept("p3"), accept("p4"));
    expect(s.scheduledMeeting).toBeNull(); // 4 of 5 seats, but only 1 of 2 people
    s = run(s, accept("p1"));
    expect(s.scheduledMeeting).toEqual({ meetingId: "meeting-1", slot: "slot-1" });
  });

  it("one person among bots locks a slot by proposing it", () => {
    const s0 = createGame(config([false, true, false, false]));
    const s = run(s0, propose("p1", "2026-11-02T19:00Z"));
    expect(since(s0, s).map((e) => e.type)).toEqual(["meetingProposed", "meetingScheduled"]);
    expect(s.scheduledMeeting?.slot).toBe("2026-11-02T19:00Z");
  });

  it("a bot's proposal locks only once a majority of the people back it", () => {
    let s = run(createGame(config([true, true, true, false])), propose("p3"), accept("p0"));
    expect(s.scheduledMeeting).toBeNull();
    s = run(s, accept("p1")); // 2 of 3 people
    expect(s.scheduledMeeting?.slot).toBe("slot-1");
  });

  it("with no people at all (simulator), more than half the crew still locks it", () => {
    let s = run(createGame(config([false, false, false, false])), propose("p0"), accept("p1"));
    expect(s.scheduledMeeting).toBeNull();
    s = run(s, accept("p2"));
    expect(s.scheduledMeeting?.slot).toBe("slot-1");
  });
});
