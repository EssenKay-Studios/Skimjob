// Alibis (design §5.4) and the round-named deadline (task 4 review).
import { STARTER_ROLES } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import type { Command, GameConfig, GameEvent, GameState } from "./types";
import { canSee } from "./types";
import { createGame } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";

const cfg: GameConfig = {
  seed: "alibi-seed",
  players: ["p0", "p1", "p2"].map((id) => ({ id, name: id.toUpperCase(), isBot: true })),
  job: "bank",
  rolePool: [...STARTER_ROLES], // no Muscle, so no shakedown window (task 12)
  mole: "off",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  starterMode: false,
};

const alibi = (player: string, room: unknown): Command => ({ type: "postAlibi", player, room }) as Command;
const roundDeadline = (round: unknown): Command => ({ type: "advance", deadline: { kind: "round", round } }) as Command;

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
    expect(afterRound1.log.filter((e) => e.type === "defaultMoveAssigned").every((e) => e.type === "defaultMoveAssigned" && e.move.room === "lobby")).toBe(true);
    expect(ok(afterRound1, alibi("p1", "vault")).events[0]).toMatchObject({ room: "vault" });
  });

  it("one alibi per player per round; the next round's resolution opens a new one", () => {
    let s = run(afterRound1, alibi("p0", "office"));
    expect(reason(s, alibi("p0", "lobby"))).toMatch(/already posted an alibi for round 1/);
    s = run(s, alibi("p1", "lobby")); // others still can
    // Still round 1's alibi while round 2 is being planned; round 2's deadline opens round 2's.
    s = run(s, roundDeadline(2));
    expect(s.alibisPosted).toEqual([]);
    expect(ok(s, alibi("p0", "lobby")).events[0]).toMatchObject({ round: 2 });
  });

  it("alibis can be posted while the act's meeting is awaited (after round 3)", () => {
    const s = run(afterRound1, roundDeadline(2), roundDeadline(3));
    expect(s.phase.kind).toBe("awaitingMeeting");
    expect(ok(s, alibi("p2", "rooftop")).events[0]).toMatchObject({ round: 3, room: "rooftop" });
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
    const s = run(createGame(cfg), roundDeadline(1));
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
    expect(reason(s, roundDeadline(1))).toMatch(/round 1 deadline is not pending \(round 2 is\)/);
    expect(handleCommand(s, roundDeadline(3)).ok).toBe(false);
    expect(run(s, roundDeadline(2)).phase).toEqual({ kind: "planning", round: 3 });
  });

  for (const [name, round] of [["missing", undefined], ["string", "1"], ["fractional", 1.5]] as const) {
    it(`is refused when the round is ${name}`, () => {
      expect(handleCommand(createGame(cfg), roundDeadline(round)).ok).toBe(false);
    });
  }
});
