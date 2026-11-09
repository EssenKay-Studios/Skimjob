// Alibis (design §11.3) and the round-named deadline (task 4 review).
import { describe, expect, it } from "vitest";
import type { Command, GameConfig, GameEvent, GameState } from "./types";
import { canSee } from "./types";
import { createGame } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";

const cfg: GameConfig = {
  seed: "alibi-seed",
  players: ["p0", "p1", "p2"].map((id) => ({ id, name: id.toUpperCase(), isBot: true })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
};

const alibi = (player: string, room: unknown, round: unknown = 1): Command => ({ type: "postAlibi", player, round, room }) as Command;
const roundDeadline = (round: unknown): Command => ({ type: "advance", deadline: { kind: "round", round } }) as Command;
/** design §9.3: the result window closes when nobody calls an emergency. */
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

describe("alibis — design §11.3", () => {
  const afterRound1 = run(createGame(cfg), roundDeadline(1));

  it("after a round resolves, a player posts a public said alibi (a room and a round) to the ledger", () => {
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

  it("one alibi per player per round; another round takes its own", () => {
    let s = run(afterRound1, alibi("p0", "office"));
    expect(reason(s, alibi("p0", "lobby"))).toMatch(/already posted an alibi for round 1/);
    s = run(s, alibi("p1", "lobby")); // others still can
    s = run(s, resultDeadline(1), roundDeadline(2));
    expect(reason(s, alibi("p0", "lobby"))).toMatch(/already posted an alibi for round 1/);
    expect(ok(s, alibi("p0", "lobby", 2)).events[0]).toMatchObject({ statement: { round: 2 } });
  });

  it("any time: for any resolved round, in every phase (owner, 6 Nov)", () => {
    // The round resolves straight into the result window (design §9.3); planning follows when it closes.
    expect(afterRound1.phase).toEqual({ kind: "result", round: 1 });
    expect(ok(afterRound1, alibi("p2", "vault")).events).toHaveLength(1);
    const planning2 = run(afterRound1, resultDeadline(1));
    expect(planning2.phase).toEqual({ kind: "planning", round: 2 });
    expect(ok(planning2, alibi("p2", "vault")).events).toHaveLength(1);
    // Rounds 1 and 2 resolved: an alibi for round 1 is still taken in round 3's planning.
    const planning3 = run(planning2, roundDeadline(2), resultDeadline(2));
    expect(ok(planning3, alibi("p2", "office")).events[0]).toMatchObject({ statement: { round: 1 } });
    // While a meeting the round called is awaited, too. A bank of 9: round 1's three missed moves take a third (design §9.1).
    const awaiting = run(createGame({ ...cfg, contentOverrides: { bank: { coinsPerPlayer: 3 } } }), roundDeadline(1));
    expect(awaiting.phase).toEqual({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" });
    expect(ok(awaiting, alibi("p2", "rooftop")).events[0]).toMatchObject({ statement: { round: 1, room: "rooftop" } });
  });

  it("only a round that has resolved: not the one being planned, a future one, or a malformed round", () => {
    expect(reason(createGame(cfg), alibi("p0", "lobby"))).toMatch(/round 1 has not resolved/);
    const planning2 = run(afterRound1, resultDeadline(1));
    expect(reason(planning2, alibi("p0", "lobby", 2))).toMatch(/round 2 has not resolved/);
    for (const round of [0, -1, 1.5, "1", null, {}]) expect(reason(planning2, alibi("p0", "lobby", round))).toMatch(/has not resolved/);
  });

  it("the emergency comes in the result window right after the round (design §9.3)", () => {
    const s = run(afterRound1, alibi("p1", "office"), { type: "callEmergency", player: "p0" } as Command);
    expect(s.pendingEmergency).toEqual({ meetingId: "emergency-1", by: "p0" });
  });

  it("after a round that ends the game, alibis are refused (design §6.2)", () => {
    // A bust in round 1 (design §5.5): a one-bulb bell, one star, and a Vault grab.
    let s = createGame({ ...cfg, contentOverrides: { alarm: { bulbs: 1, bustStars: 1 } } });
    s = run(s, { type: "submitMove", player: "p0", move: { room: "vault", duffel: 1, pocket: 0 } }, roundDeadline(1));
    expect(s.phase.kind).toBe("ended");
    expect(reason(s, alibi("p0", "lobby"))).toMatch(/over/);
    expect(replay(s.config, s.log)).toEqual(s);
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
      expect(handleCommand(afterRound1, command).ok).toBe(false);
    });
  }
});

describe("the round deadline names its round — design §5, task 4 review", () => {
  it("a retried or late deadline is refused instead of resolving the next round early", () => {
    const s = run(createGame(cfg), roundDeadline(1), resultDeadline(1));
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
    expect(reason(s, roundDeadline(1))).toMatch(/round 1 deadline is not pending \(round 2 is\)/);
    expect(handleCommand(s, roundDeadline(3)).ok).toBe(false);
    expect(run(s, roundDeadline(2)).phase).toEqual({ kind: "result", round: 2 });
  });

  for (const [name, round] of [["missing", undefined], ["string", "1"], ["fractional", 1.5]] as const) {
    it(`is refused when the round is ${name}`, () => {
      expect(handleCommand(createGame(cfg), roundDeadline(round)).ok).toBe(false);
    });
  }
});
