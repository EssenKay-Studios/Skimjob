// QA (PR #301, issue #294): the alibi window's close at 12 players, trust marks in every later phase,
// a 12-way mark leak check and determinism with marks. design §4.1, §10, §18
import { NO_RAIDS } from "./v01-numbers.testkit";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameState } from "./types";
import { createGame } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { marksOf } from "./said";
import { fullGrab } from "./grab.testkit";

const config = (players: number, seed = "qa-window"): GameConfig => ({
  seed,
  players: Array.from({ length: players }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    isBot: true,
  })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  contentOverrides: NO_RAIDS,
});

type Cmd = unknown | ((s: GameState) => unknown);
function ok(state: GameState, command: Cmd): GameState {
  const r = handleCommand(
    state,
    typeof command === "function" ? command(state) : command,
  );
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.state;
}
const run = (s: GameState, ...cs: Cmd[]) => cs.reduce<GameState>(ok, s);
const ROUND = (s: GameState) => ({
  type: "advance",
  deadline: { kind: "round", round: s.round },
});
const ALIBI = (s: GameState) => ({
  type: "advance",
  deadline: { kind: "alibi", round: s.resolvedRound },
});
const RESULT = (s: GameState) => ({
  type: "advance",
  deadline: { kind: "result", round: s.resolvedRound },
});
const alibi = (player: string, room: string, round = 1) => ({
  type: "postAlibi",
  player,
  round,
  room,
});
const mark = (
  player: string,
  target: string,
  m: "trusted" | "liar" | null,
  round = 1,
) => ({ type: "markAlibi", player, round, target, mark: m });
const move = (player: string, room: string) => ({
  type: "submitMove",
  player,
  move: fullGrab(room),
});

describe("QA the alibi window's close at 12 players — design §10", () => {
  it("everyone who posted nothing is listed once, in seat order, in their real room; posters are not", () => {
    let s = createGame(config(12));
    // Rooms with coins in play at 12 (Security and the Rooftop take none, so a full grab there is refused).
    const rooms = s.rooms.filter((r) => !["security", "rooftop"].includes(r));
    s = run(
      s,
      ...s.playerOrder.map((p, i) => move(p, rooms[i % rooms.length]!)),
      ROUND,
    );
    expect(s.phase).toEqual({ kind: "alibi", round: 1 });
    // The even seats post (a lie or the truth); the odd seats stay silent.
    const posters = s.playerOrder.filter((_, i) => i % 2 === 0);
    s = run(s, ...posters.map((p) => alibi(p, "lobby")));
    const r = handleCommand(s, ALIBI(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const closed = r.events.find((e) => e.type === "alibiWindowClosed");
    const silent = s.playerOrder.flatMap((p, i) =>
      i % 2 === 1 ? [{ player: p, room: rooms[i % rooms.length] }] : [],
    );
    expect(closed).toMatchObject({ round: 1, noAlibi: silent });
    // Once closed, nobody (posted or not) can post for that round.
    for (const p of s.playerOrder)
      expect(handleCommand(r.state, alibi(p, "vault")).ok).toBe(false);
  });
});

describe("QA trust marks in later phases — design §10", () => {
  it("an older round can be marked in the next round's alibi window, and during a meeting", () => {
    // A bank of 9: round 1's three missed moves take a third and call a meeting (design §9.1).
    let s = run(
      createGame({
        ...config(3),
        contentOverrides: { ...NO_RAIDS, bank: { coinsPerPlayer: 3 } },
      }),
      ROUND,
      alibi("p1", "vault"),
      ALIBI,
    );
    expect(s.phase.kind).toBe("awaitingMeeting");
    s = run(s, mark("p0", "p1", "liar"));
    s = run(
      s,
      { type: "scheduleMeeting", meetingId: "meeting-1", slot: "now" },
      {
        type: "advance",
        deadline: { kind: "openMeeting", meetingId: "meeting-1" },
      },
    );
    expect(s.phase.kind).toBe("meeting");
    s = run(s, mark("p0", "p1", "trusted"), mark("p2", "p1", "liar"));
    expect(marksOf(s.log, "p0")).toEqual(new Map([["1/p1", "trusted"]]));
    expect(marksOf(s.log, "p2")).toEqual(new Map([["1/p1", "liar"]]));
  });

  it("in round 2's open window, round 1 can be marked but round 2 cannot", () => {
    let s = run(createGame(config(3)), ROUND, ALIBI, RESULT, ROUND);
    expect(s.phase).toEqual({ kind: "alibi", round: 2 });
    s = run(s, mark("p0", "p1", "liar", 1));
    const r = handleCommand(s, mark("p0", "p1", "liar", 2));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/card is not out yet/);
  });
});

describe("QA trust-mark leak at 12 players — design §10, §18", () => {
  it("every player marks every other; each view holds only its own marks, mid-game", () => {
    let s = run(createGame(config(12)), ROUND, ALIBI);
    const ids = s.playerOrder;
    for (const p of ids)
      for (const t of ids)
        if (p !== t) s = ok(s, mark(p, t, t < p ? "liar" : "trusted"));
    for (const viewer of ids) {
      const v = viewFor(s, viewer);
      const events = [...v.ledger, ...v.caseFile, ...(v.reveal?.log ?? [])].map(
        (e) => e.event,
      );
      const marks = events.filter((e) => e.type === "alibiMarked");
      expect(marks).toHaveLength(ids.length - 1);
      expect(
        marks.every((e) => e.type === "alibiMarked" && e.player === viewer),
      ).toBe(true);
    }
  });
});

describe("QA determinism with alibis and marks — design §2", () => {
  it("same seed and commands give the same log; replay rebuilds the state", () => {
    const play = () => {
      let s = createGame(config(6, "det-marks"));
      s = run(
        s,
        move("p0", "vault"),
        move("p1", "office"),
        ROUND,
        alibi("p0", "lobby"),
        alibi("p2", "vault"),
        ALIBI,
      );
      s = run(
        s,
        mark("p1", "p0", "liar"),
        mark("p3", "p2", "trusted"),
        mark("p1", "p0", null),
        RESULT,
      );
      return run(
        s,
        move("p4", "vault"),
        ROUND,
        alibi("p4", "office", 2),
        ALIBI,
        mark("p5", "p4", "liar", 2),
      );
    };
    const a = play();
    expect(a.log).toEqual(play().log);
    expect(replay(a.config, a.log)).toEqual(a);
  });
});
