// Alibis, the alibi window, its "no alibi" facts and trust marks (design §4.1, §10), and the
// round-named deadline (task 4 review).
import { describe, expect, it } from "vitest";
import type { Command, GameConfig, GameEvent, GameState } from "./types";
import { canSee } from "./types";
import { createGame } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { marksOf } from "./said";

const cfg: GameConfig = {
  seed: "alibi-seed",
  players: ["p0", "p1", "p2"].map((id) => ({ id, name: id.toUpperCase(), isBot: true })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
};

const alibi = (player: string, room: unknown, round: unknown = 1): Command => ({ type: "postAlibi", player, round, room }) as Command;
const mark = (player: string, target: unknown, m: unknown, round: unknown = 1): Command => ({ type: "markAlibi", player, round, target, mark: m }) as Command;
const roundDeadline = (round: unknown): Command => ({ type: "advance", deadline: { kind: "round", round } }) as Command;
const alibiDeadline = (round: unknown): Command => ({ type: "advance", deadline: { kind: "alibi", round } }) as Command;
/** design §9.3: the result window closes when nobody calls an emergency. */
const resultDeadline = (round: unknown): Command => ({ type: "advance", deadline: { kind: "result", round } }) as Command;
const move = (player: string, room: string, duffel = 1): Command => ({ type: "submitMove", player, move: { room, duffel, pocket: 0 } }) as Command;

function ok(state: GameState, command: Command): { state: GameState; events: readonly GameEvent[] } {
  const r = handleCommand(state, command);
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r;
}
const run = (state: GameState, ...commands: Command[]) => commands.reduce((s, c) => ok(s, c).state, state);

function reason(state: GameState, command: Command): string {
  const before = JSON.stringify(state);
  const r = handleCommand(state, command);
  if (r.ok) throw new Error("expected a rejection");
  expect(JSON.stringify(state)).toBe(before);
  return r.reason;
}

describe("the alibi window — design §4.1, §10", () => {
  const afterRound1 = run(createGame(cfg), roundDeadline(1));

  it("a round resolves into its alibi window; planning starts only when it closes", () => {
    expect(afterRound1.phase).toEqual({ kind: "alibi", round: 1 });
    // Moves, perks and emergencies wait for planning and the result window.
    expect(reason(afterRound1, move("p0", "lobby"))).toMatch(/while a round is being planned/);
    expect(reason(afterRound1, { type: "callEmergency", player: "p0" } as Command)).toMatch(/result/);
    const closed = run(afterRound1, alibiDeadline(1));
    expect(closed.phase).toEqual({ kind: "result", round: 1 });
    expect(run(closed, resultDeadline(1)).phase).toEqual({ kind: "planning", round: 2 });
  });

  it("the window's deadline names its round: a stale, future or malformed one is refused", () => {
    for (const round of [0, 2, "1", 1.5, null]) expect(reason(afterRound1, alibiDeadline(round))).toMatch(/alibi window is not open/);
    const closed = run(afterRound1, alibiDeadline(1));
    expect(reason(closed, alibiDeadline(1))).toMatch(/alibi window is not open/);
  });

  it("after the window, the meeting the round called is awaited (design §4.2 step 9)", () => {
    // A bank of 9: round 1's three missed moves take a third (design §9.1).
    const s = run(createGame({ ...cfg, contentOverrides: { bank: { coinsPerPlayer: 3 } } }), roundDeadline(1));
    expect(s.phase).toEqual({ kind: "alibi", round: 1 });
    expect(run(s, alibiDeadline(1)).phase).toEqual({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" });
  });

  it("with the crew's emergency pool empty, the next round starts as the window closes (design §9.3)", () => {
    let s = run(afterRound1, alibiDeadline(1), { type: "callEmergency", player: "p0" } as Command);
    s = run(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-1" } } as Command, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-1" } } as Command);
    expect(s.emergencies).toBe(0);
    s = run(s, roundDeadline(2));
    expect(s.phase).toEqual({ kind: "alibi", round: 2 });
    expect(run(s, alibiDeadline(2)).phase).toEqual({ kind: "planning", round: 3 });
  });

  it("no window after a round that ends the game (design §6.2)", () => {
    // A bust in round 1 (design §5.5): a one-bulb bell, one star, and a Vault grab.
    const s = run(createGame({ ...cfg, contentOverrides: { alarm: { bulbs: 1, bustStars: 1 } } }), move("p0", "vault"), roundDeadline(1));
    expect(s.phase.kind).toBe("ended");
    expect(reason(s, alibi("p0", "lobby"))).toMatch(/over/);
    expect(replay(s.config, s.log)).toEqual(s);
  });
});

describe("alibis — design §10", () => {
  const afterRound1 = run(createGame(cfg), roundDeadline(1));

  it("in the window, a player posts a public said alibi (a room and the round) to the ledger", () => {
    const { state, events } = ok(afterRound1, alibi("p0", "vault"));
    expect(events).toEqual([{ type: "said", visibility: { kind: "public" }, statement: { kind: "alibi", player: "p0", round: 1, room: "vault" } }]);
    for (const viewer of ["p0", "p1", "p2"]) {
      expect(canSee(events[0]!.visibility, viewer, false)).toBe(true);
      expect(viewFor(state, viewer).ledger.at(-1)?.event).toEqual(events[0]);
    }
    expect({ ...state, log: afterRound1.log }).toEqual(afterRound1);
    expect(replay(cfg, state.log)).toEqual(state);
  });

  it("an alibi can be a lie: any room in play is accepted, wherever the player really was", () => {
    // Everyone defaulted to the Lobby in round 1.
    expect(afterRound1.log.filter((e) => e.type === "defaultMoveAssigned").every((e) => e.type === "defaultMoveAssigned" && e.move?.room === "lobby")).toBe(true);
    expect(ok(afterRound1, alibi("p1", "vault")).events[0]).toMatchObject({ statement: { room: "vault" } });
  });

  it("one alibi per player per round, never changed; others still post theirs", () => {
    const s = run(afterRound1, alibi("p0", "office"));
    expect(reason(s, alibi("p0", "lobby"))).toMatch(/already posted an alibi for round 1/);
    expect(ok(s, alibi("p1", "lobby")).events).toHaveLength(1);
  });

  it("only in that round's window: not before, not once it closes, not for an older round (owner, 13 Nov)", () => {
    expect(reason(createGame(cfg), alibi("p0", "lobby"))).toMatch(/alibi window for round 1 is not open/);
    const result1 = run(afterRound1, alibiDeadline(1));
    expect(reason(result1, alibi("p0", "lobby"))).toMatch(/alibi window for round 1 is not open/);
    const planning2 = run(result1, resultDeadline(1));
    expect(reason(planning2, alibi("p0", "lobby"))).toMatch(/not open/);
    expect(reason(planning2, alibi("p0", "lobby", 2))).toMatch(/not open/);
    // Round 2's window takes round 2's alibi, never round 1's.
    const window2 = run(planning2, roundDeadline(2));
    expect(reason(window2, alibi("p0", "lobby", 1))).toMatch(/alibi window for round 1 is not open/);
    expect(ok(window2, alibi("p0", "lobby", 2)).events[0]).toMatchObject({ statement: { round: 2 } });
    for (const round of [0, -1, 1.5, "1", null, {}]) expect(reason(afterRound1, alibi("p0", "lobby", round))).toMatch(/not open/);
  });

  const bad: [string, Command][] = [
    ["unknown player", alibi("zed", "lobby")],
    ["prototype key as player", alibi("__proto__", "lobby")],
    ["missing room", { type: "postAlibi", player: "p0", round: 1 } as unknown as Command],
    ["unknown room", alibi("p0", "kitchen")],
    ["room closed for 3 players", alibi("p0", "depositBoxes")],
    ["prototype key as room", alibi("p0", "constructor")],
    ["room is not a string", alibi("p0", 3)],
  ];
  for (const [name, command] of bad) {
    it(`is refused with state untouched: ${name}`, () => {
      reason(afterRound1, command);
    });
  }
});

describe("no answer is a fact: the window's close — design §10", () => {
  // Round 1: p0 in the Vault, p1 in the Office, p2 misses (the Lobby, design §3.3).
  const window1 = run(createGame(cfg), move("p0", "vault"), move("p1", "office"), roundDeadline(1));

  it("one public event at the close names everyone without an alibi in the room they were really in, in seat order", () => {
    const s = run(window1, alibi("p1", "lobby"));
    const { events } = ok(s, alibiDeadline(1));
    expect(events[0]).toEqual({
      type: "alibiWindowClosed",
      visibility: { kind: "public" },
      round: 1,
      noAlibi: [
        { player: "p0", room: "vault" },
        { player: "p2", room: "lobby" },
      ],
    });
    for (const viewer of ["p0", "p1", "p2"]) expect(canSee(events[0]!.visibility, viewer, false)).toBe(true);
  });

  it("a raided room's visitors are shown there too; everyone posted: an empty list", () => {
    const raided = run(createGame({ ...cfg, contentOverrides: { alarm: { bulbs: 1 } } }), move("p0", "vault"), roundDeadline(1));
    expect(raided.log.some((e) => e.type === "roomRaided")).toBe(true);
    expect(ok(raided, alibiDeadline(1)).events[0]).toMatchObject({ noAlibi: [{ player: "p0", room: "vault" }, { player: "p1", room: "lobby" }, { player: "p2", room: "lobby" }] });
    const all = run(window1, alibi("p0", "lobby"), alibi("p1", "lobby"), alibi("p2", "lobby"));
    expect(ok(all, alibiDeadline(1)).events[0]).toMatchObject({ noAlibi: [] });
  });

  it("a player who sat the round out (taped-off Lobby, design §3.3) was in no room, so has no fact", () => {
    // Taped-off Lobby: set the tape straight into the state for this one check.
    const planning = { ...createGame(cfg), taped: { lobby: 1 } } as GameState;
    const s = run(planning, move("p0", "vault"), move("p1", "office"), roundDeadline(1));
    expect(ok(s, alibiDeadline(1)).events[0]).toMatchObject({ noAlibi: [{ player: "p0", room: "vault" }, { player: "p1", room: "office" }] });
  });

  it("the close draws nothing and replays", () => {
    const { state } = ok(window1, alibiDeadline(1));
    expect(state.rng).toEqual(window1.rng);
    expect(replay(cfg, state.log)).toEqual(state);
  });
});

describe("trust marks — design §10", () => {
  const result1 = run(createGame(cfg), roundDeadline(1), alibi("p1", "vault"), alibiDeadline(1));

  it("set, change and clear a mark, on a past round too; each is a secret event for the marker", () => {
    let s = result1;
    const set = ok(s, mark("p0", "p1", "liar"));
    expect(set.events).toEqual([{ type: "alibiMarked", visibility: { kind: "secret", player: "p0" }, player: "p0", round: 1, target: "p1", mark: "liar" }]);
    s = run(set.state, mark("p0", "p1", "trusted"));
    expect(marksOf(s.log, "p0")).toEqual(new Map([["1/p1", "trusted"]]));
    s = run(s, mark("p0", "p1", null));
    expect(marksOf(s.log, "p0")).toEqual(new Map());
    // Later, in round 2's planning, round 1 can still be marked; a mark is per round and per player.
    s = run(s, resultDeadline(1), mark("p0", "p1", "liar"), roundDeadline(2), alibiDeadline(2), mark("p0", "p1", "trusted", 2), mark("p0", "p2", "liar", 2));
    expect(marksOf(s.log, "p0")).toEqual(
      new Map([
        ["1/p1", "liar"],
        ["2/p1", "trusted"],
        ["2/p2", "liar"],
      ]),
    );
    expect(replay(cfg, s.log)).toEqual(s);
  });

  it("refused: yourself, an unplayed round, the round whose window is still open, a bad target or mark, or no change", () => {
    expect(reason(result1, mark("p0", "p0", "liar"))).toMatch(/your own/);
    expect(reason(result1, mark("p0", "p1", "liar", 2))).toMatch(/round 2 has not been played/);
    for (const round of [0, 1.5, "1", null]) expect(reason(result1, mark("p0", "p1", "liar", round))).toMatch(/has not been played/);
    expect(reason(run(createGame(cfg), roundDeadline(1)), mark("p0", "p1", "liar"))).toMatch(/card is not out yet/);
    for (const target of ["zed", "__proto__", 3]) expect(reason(result1, mark("p0", target, "liar"))).toMatch(/unknown player/);
    for (const m of ["suspicious", "", true, undefined]) expect(reason(result1, mark("p0", "p1", m))).toMatch(/trusted, liar or null/);
    expect(reason(result1, mark("p0", "p1", null))).toMatch(/already your mark/);
    expect(reason(run(result1, mark("p0", "p1", "liar")), mark("p0", "p1", "liar"))).toMatch(/already your mark/);
  });

  it("leak: only the marker ever sees their marks, during the game and after it ends (design §18)", () => {
    let s = run(result1, mark("p0", "p1", "liar"), mark("p2", "p0", "trusted"));
    const seen = (viewer: string, state: GameState) => {
      const v = viewFor(state, viewer);
      const all = [...v.ledger, ...v.caseFile, ...(v.reveal?.log ?? [])].map((e) => e.event);
      return all.filter((e) => e.type === "alibiMarked").map((e) => e.type === "alibiMarked" && e.player);
    };
    expect(seen("p0", s)).toEqual(["p0"]);
    expect(seen("p1", s)).toEqual([]);
    expect(seen("p2", s)).toEqual(["p2"]);
    // The game ends (a bust): the reveal opens private events, never secret ones.
    s = run(s, resultDeadline(1));
    s = { ...s, config: { ...s.config, contentOverrides: { alarm: { bulbs: 1, bustStars: 1 } } } };
    s = run(s, move("p1", "vault"), roundDeadline(2));
    expect(s.phase.kind).toBe("ended");
    expect(seen("p1", s)).toEqual([]);
    expect(seen("p0", s).every((p) => p === "p0")).toBe(true);
    expect(seen("p2", s).every((p) => p === "p2")).toBe(true);
    expect(JSON.stringify(viewFor(s, "p1"))).not.toContain("alibiMarked");
  });
});

describe("the round deadline names its round — design §5, task 4 review", () => {
  it("a retried or late deadline is refused instead of resolving the next round early", () => {
    const s = run(createGame(cfg), roundDeadline(1), alibiDeadline(1), resultDeadline(1));
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
    expect(reason(s, roundDeadline(1))).toMatch(/round 1 deadline is not pending \(round 2 is\)/);
    expect(handleCommand(s, roundDeadline(3)).ok).toBe(false);
    expect(run(s, roundDeadline(2)).phase).toEqual({ kind: "alibi", round: 2 });
  });

  for (const [name, round] of [["missing", undefined], ["string", "1"], ["fractional", 1.5]] as const) {
    it(`is refused when the round is ${name}`, () => {
      expect(handleCommand(createGame(cfg), roundDeadline(round)).ok).toBe(false);
    });
  }
});
