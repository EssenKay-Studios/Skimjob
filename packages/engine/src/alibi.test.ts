// Alibis (design §5.4) and the round-named deadline (task 4 review).
import { describe, expect, it } from "vitest";
import type { Command, GameConfig, GameEvent, GameState } from "./types";
import { canSee } from "./types";
import { createGame } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { fullGrab } from "./grab.testkit";

const cfg: GameConfig = {
  seed: "alibi-seed",
  players: ["p0", "p1", "p2"].map((id) => ({ id, name: id.toUpperCase(), isBot: true })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
};

const alibi = (player: string, room: unknown): Command => ({ type: "postAlibi", player, room }) as Command;
const roundDeadline = (round: unknown): Command => ({ type: "advance", deadline: { kind: "round", round } }) as Command;
const alibiDeadline = (round: unknown): Command => ({ type: "advance", deadline: { kind: "alibis", round } }) as Command;
/** design §9.3: the result window after the alibis closes when nobody calls an emergency. */
const resultDeadline = (round: unknown): Command => ({ type: "advance", deadline: { kind: "result", round } }) as Command;

function ok(state: GameState, command: Command): { state: GameState; events: readonly GameEvent[] } {
  const r = handleCommand(state, command);
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r;
}
const run = (state: GameState, ...commands: Command[]) => commands.reduce((s, c) => ok(s, c).state, state);

function reason(state: GameState, command: Command): string {
  const r = handleCommand(state, command);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}

describe("alibis — design §5.4", () => {
  const afterRound1 = run(createGame(cfg), roundDeadline(1));

  it("after a round resolves, a player posts a public alibi for that round to the ledger", () => {
    const { state, events } = ok(afterRound1, alibi("p0", "vault"));
    expect(events).toEqual([{ type: "alibiPosted", visibility: { kind: "public" }, player: "p0", round: 1, room: "vault" }]);
    for (const viewer of ["p0", "p1", "p2"]) expect(canSee(events[0]!.visibility, viewer, false)).toBe(true);
    expect(state.alibisPosted).toEqual(["p0"]);
    expect(replay(cfg, state.log)).toEqual(state);
  });

  it("an alibi can be a lie: any room in play is accepted, wherever the player really was", () => {
    // Everyone defaulted to the Lobby in round 1.
    expect(afterRound1.log.filter((e) => e.type === "defaultMoveAssigned").every((e) => e.type === "defaultMoveAssigned" && e.move?.room === "lobby")).toBe(true);
    expect(ok(afterRound1, alibi("p1", "vault")).events[0]).toMatchObject({ room: "vault" });
  });

  it("one alibi per player per round; the next round's resolution opens a new one", () => {
    let s = run(afterRound1, alibi("p0", "office"));
    expect(reason(s, alibi("p0", "lobby"))).toMatch(/already posted an alibi for round 1/);
    s = run(s, alibi("p1", "lobby")); // others still can
    s = run(s, alibiDeadline(1), resultDeadline(1), roundDeadline(2));
    expect(s.alibisPosted).toEqual([]);
    expect(ok(s, alibi("p0", "lobby")).events[0]).toMatchObject({ round: 2 });
  });

  it("a round's alibis close at its alibi deadline, before the next round's planning (owner answers, 1 Nov)", () => {
    expect(afterRound1.phase).toEqual({ kind: "alibis", round: 1 });
    // No moves for round 2 until the alibi deadline has passed.
    expect(reason(afterRound1, { type: "submitMove", player: "p0", move: fullGrab("lobby") } as Command)).toMatch(/while a round is being planned/);
    expect(reason(afterRound1, roundDeadline(2))).toMatch(/no round deadline is pending/);
    const { state, events } = ok(afterRound1, alibiDeadline(1));
    expect(events).toEqual([{ type: "alibisClosed", visibility: { kind: "public" }, round: 1 }]);
    // design §9.3: then the result window, and the next round's planning once it closes.
    expect(state.phase).toEqual({ kind: "result", round: 1 });
    expect(reason(state, alibi("p2", "vault"))).toMatch(/alibis for round 1 are closed/);
    expect(run(state, resultDeadline(1)).phase).toEqual({ kind: "planning", round: 2 });
    expect(replay(cfg, state.log)).toEqual(state);
  });

  it("the alibi deadline names its round: a retried, stale or future one is refused", () => {
    const s = run(afterRound1, alibiDeadline(1));
    expect(reason(s, alibiDeadline(1))).toMatch(/no alibi deadline is pending/);
    expect(reason(afterRound1, alibiDeadline(2))).toMatch(/round 2 alibi deadline is not pending/);
    expect(handleCommand(afterRound1, alibiDeadline("1")).ok).toBe(false);
  });

  it("after a round that calls a meeting, its alibis come before the meeting is awaited (design §4.2 step 9)", () => {
    // A bank of 9: round 1's three missed moves take 3, leaving 6, a third gone (design §9.1).
    let s = run(createGame({ ...cfg, contentOverrides: { bank: { coinsPerPlayer: 3 } } }), roundDeadline(1));
    expect(s.phase).toEqual({ kind: "alibis", round: 1 });
    expect(ok(s, alibi("p2", "rooftop")).events[0]).toMatchObject({ round: 1, room: "rooftop" });
    s = run(s, alibiDeadline(1));
    expect(s.phase).toEqual({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" });
    expect(reason(s, alibi("p2", "rooftop"))).toMatch(/closed/);
  });

  it("no emergency can be called in the alibi window, only in the result window after it (design §9.3)", () => {
    expect(reason(afterRound1, { type: "callEmergency", player: "p0" } as Command)).toMatch(/between a round's result and the next planning/);
    const s = run(afterRound1, alibi("p1", "office"), alibiDeadline(1), { type: "callEmergency", player: "p0" } as Command);
    expect(s.pendingEmergency).toEqual({ meetingId: "emergency-1", by: "p0" });
  });

  it("a round that ends the game leaves no alibi window open (design §5.4, PR #21 QA)", () => {
    // A bust in round 1 (design §5.5): a one-bulb bell, one star, and a Vault grab.
    let s = createGame({ ...cfg, contentOverrides: { alarm: { bulbs: 1, bustStars: 1 } } });
    s = run(s, { type: "submitMove", player: "p0", move: { room: "vault", duffel: 1, pocket: 0 } }, roundDeadline(1));
    expect(s.phase.kind).toBe("ended");
    expect(s.alibisOpen).toBe(false);
    expect(viewFor(s, "p0").alibiRound).toBeNull();
    expect(replay(s.config, s.log)).toEqual(s);
  });

  it("is refused before any round has resolved", () => {
    expect(reason(createGame(cfg), alibi("p0", "lobby"))).toMatch(/no round has resolved/);
  });

  const bad: [string, Command][] = [
    ["unknown player", alibi("zed", "lobby")],
    ["prototype key as player", alibi("__proto__", "lobby")],
    ["missing room", { type: "postAlibi", player: "p0" } as unknown as Command],
    ["unknown room", alibi("p0", "kitchen")],
    ["room closed for 3 players", alibi("p0", "depositBoxes")],
    ["prototype key as room", alibi("p0", "constructor")],
    ["room is not a string", alibi("p0", 3)],
  ];
  for (const [name, command] of bad) {
    it(`is refused with state untouched: ${name}`, () => {
      const r = handleCommand(afterRound1, command);
      expect(r.ok).toBe(false);
      expect(afterRound1.alibisPosted).toEqual([]);
    });
  }
});

describe("the round deadline names its round — design §5, task 4 review", () => {
  it("a retried or late deadline is refused instead of resolving the next round early", () => {
    const s = run(createGame(cfg), roundDeadline(1), alibiDeadline(1), resultDeadline(1));
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
    expect(reason(s, roundDeadline(1))).toMatch(/round 1 deadline is not pending \(round 2 is\)/);
    expect(handleCommand(s, roundDeadline(3)).ok).toBe(false);
    expect(run(s, roundDeadline(2)).phase).toEqual({ kind: "alibis", round: 2 });
  });

  for (const [name, round] of [["missing", undefined], ["string", "1"], ["fractional", 1.5]] as const) {
    it(`is refused when the round is ${name}`, () => {
      expect(handleCommand(createGame(cfg), roundDeadline(round)).ok).toBe(false);
    });
  }
});
