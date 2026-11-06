// The round loop: moves, default moves, resolution, Heat, information, raids.
// design §5, §6, §7, §8 (starter role powers used in a move)
import { STARTER_ROLES } from "@skimjob/content";
import { handleThroughAlibis } from "./alibis.testkit";
import { describe, expect, it } from "vitest";
import type { Command, GameConfig, GameEvent, GameState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand, withRng } from "./handle";
import { seedRng } from "./rng";
import { V015_NUMBERS } from "./v01-numbers.testkit";

function config(players: number): GameConfig {
  return {
    seed: "round-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [...STARTER_ROLES], // a shakedown window only if the shop holds a Shield
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    contentOverrides: V015_NUMBERS, // content 0.15.0 numbers
  };
}

/** A new game with chosen roles (seat i gets roles[i], Rookie if missing). */
function game(players: number, roles: string[] = []): GameState {
  const cfg = config(players);
  const log = setupEvents(cfg).map((e, i, all): GameEvent => {
    if (e.type !== "roleDealt") return e;
    const seat = all.slice(0, i).filter((x) => x.type === "roleDealt").length;
    return { ...e, role: roles[seat] ?? "rookie" };
  });
  return replay(cfg, log);
}

/** Commands to run; a function is called with the current state (e.g. `ROUND`). */
function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, typeof c === "function" ? c(s) : c);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
    return r.state;
  }, state);
}

/** A submitMove command; `move` is loose on purpose so tests can send malformed moves. */
const submit = (player: string, move: Record<string, unknown>): Command =>
  ({ type: "submitMove", player, move: { pocket: 0, ...move } }) as Command;
/** The deadline for the round being planned in `s`. */
const ROUND = (s: GameState): Command => ({ type: "advance", deadline: { kind: "round", round: s.round } });

/** The events the last command appended. */
function lastEvents(before: GameState, after: GameState): GameEvent[] {
  return after.log.slice(before.log.length);
}

function reason(state: GameState, command: unknown): string {
  const r = handleThroughAlibis(state, command);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}

describe("planning — design §5.1", () => {
  it("a submitted move is private to its player and can be changed until the deadline; the last one counts", () => {
    let s = game(3);
    s = run(s, submit("p0", { room: "vault", pocket: 6 }));
    const ev = s.log.at(-1);
    expect(ev).toMatchObject({ type: "moveSubmitted", player: "p0", round: 1, visibility: { kind: "private", player: "p0" } });
    s = run(s, submit("p0", { room: "office", pocket: 1 }));
    expect(s.moves.p0).toEqual({ room: "office", pocket: 1 });
    const before = s;
    s = run(s, ROUND);
    expect(lastEvents(before, s).find((e) => e.type === "lootSplit" && e.player === "p0")).toMatchObject({ room: "office", loot: 4, toStash: 1, toHaul: 3 });
  });

  it("a player who misses the deadline gets the default move: Lobby, hand everything in", () => {
    const before = game(3);
    const s = run(before, ROUND);
    const defaults = lastEvents(before, s).filter((e) => e.type === "defaultMoveAssigned");
    expect(defaults.map((e) => e.player)).toEqual(["p0", "p1", "p2"]);
    for (const e of defaults) {
      expect(e).toMatchObject({ move: { room: "lobby", pocket: 0 }, visibility: { kind: "private", player: e.player } });
    }
    expect(s.haul).toBe(6);
    expect(s.players.p0?.consecutiveMissedMoves).toBe(1);
  });

  it("missed rounds are counted in a row and reset by submitting (design §15)", () => {
    let s = run(game(3), ROUND, ROUND);
    expect(s.players.p0?.consecutiveMissedMoves).toBe(2);
    s = run(s, submit("p0", { room: "office" }));
    expect(s.players.p0?.consecutiveMissedMoves).toBe(0);
  });

  it("the stored move is normalised: unknown fields are dropped", () => {
    const s = run(game(3), { type: "submitMove", player: "p0", move: { room: "lobby", pocket: 0, junk: 1 } });
    expect(s.moves.p0).toEqual({ room: "lobby", pocket: 0 });
  });
});

describe("rejected commands leave state untouched", () => {
  const s = game(3);
  const cases: [string, unknown][] = [
    ["not an object", 7],
    ["no type", { player: "p0" }],
    ["unknown command", { type: "teleport" }],
    ["unsupported command", { type: "useAbility", player: "p0" }],
    ["unknown player", submit("zed", { room: "lobby" })],
    ["missing move", { type: "submitMove", player: "p0" }],
    ["unknown room", submit("p0", { room: "kitchen" })],
    ["room not in play for 3 players (closed)", submit("p0", { room: "depositBoxes" })],
    ["prototype key as room", submit("p0", { room: "constructor" })],
    ["negative pocket", submit("p0", { room: "vault", pocket: -1 })],
    ["pocket over the room's loot", submit("p0", { room: "vault", pocket: 7 })],
    ["fractional pocket", submit("p0", { room: "vault", pocket: 1.5 })],
    ["NaN pocket", submit("p0", { room: "vault", pocket: Number.NaN })],
    ["infinite pocket", submit("p0", { room: "vault", pocket: Number.POSITIVE_INFINITY })],
    ["string pocket", submit("p0", { room: "vault", pocket: "2" })],
    ["Security without a watched room", submit("p0", { room: "security" })],
    ["Security watching a closed room", submit("p0", { room: "security", watch: "serverRoom" })],
    ["watching from outside Security", submit("p0", { room: "vault", watch: "office" })],
    ["a Rookie using an ability", submit("p0", { room: "vault", ability: { kind: "lookout", rooms: ["office"] } })],
    ["advance without a deadline", { type: "advance" }],
    ["unknown deadline", { type: "advance", deadline: { kind: "lunch" } }],
    ["meeting deadline (none pending)", { type: "advance", deadline: { kind: "openMeeting", meetingId: "m1" } }],
  ];
  for (const [name, command] of cases) {
    it(name, () => {
      const r = handleThroughAlibis(s, command);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toEqual(expect.any(String));
      expect(s.log).toHaveLength(game(3).log.length);
    });
  }

  it("moves and round deadlines are refused outside planning (after an act's last round)", () => {
    const after = run(game(3), ROUND, ROUND, ROUND);
    expect(after.phase).toEqual({ kind: "awaitingMeeting", act: 1 });
    expect(reason(after, submit("p0", { room: "lobby" }))).toMatch(/planned/);
    expect(reason(after, ROUND(after))).toMatch(/no round deadline/);
  });
});

describe("resolution — design §5.2, §6", () => {
  it("splits go to the Haul and the stash; the round summary is public and the splits private", () => {
    const before = run(game(3), submit("p0", { room: "vault", pocket: 2 }), submit("p1", { room: "office" }), submit("p2", { room: "lobby", pocket: 2 }));
    const s = run(before, ROUND);
    expect(s.haul).toBe(4 + 4 + 0);
    expect(s.players.p0).toMatchObject({ stash: 2, totalHandedIn: 4 });
    expect(s.players.p2).toMatchObject({ stash: 2, totalHandedIn: 0 });
    const events = lastEvents(before, s);
    for (const e of events.filter((x) => x.type === "lootSplit")) expect(e.visibility).toEqual({ kind: "private", player: e.player });
    expect(events.find((e) => e.type === "roundResolved")).toEqual({
      type: "roundResolved",
      visibility: { kind: "public" },
      round: 1,
      haulDelta: 8,
      haul: 8,
      heatDelta: 11, // 4 + 20 × 1/3 = 10.67 → 11 (design §7)
      heat: 11,
      heatParts: { base: 4, rooms: { vault: 7 }, events: 0 }, // extension.md "What the app works out for you"
    });
  });

  it("events follow the resolution order: splits, Heat summary after information, then the next round", () => {
    const before = run(game(3), submit("p0", { room: "security", watch: "vault" }));
    const types = lastEvents(before, run(before, ROUND)).map((e) => e.type);
    expect(types).toEqual([
      "defaultMoveAssigned",
      "defaultMoveAssigned",
      "lootSplit",
      "lootSplit",
      "lootSplit",
      "roomSighting",
      "roomSighting",
      "roomSighting",
      "roomWatched",
      "roundResolved",
      // design §5.4: the round's alibi deadline (here passed at once by the test helper), then the next round.
      "alibisClosed",
      "roundStarted",
    ]);
  });

  it("Deposit boxes pay 5 to up to 2 people, and 4 to everyone there when more go (R5; was 3); pocket is capped at the real yield (§6.2)", () => {
    const two = run(game(5), submit("p0", { room: "depositBoxes", pocket: 5 }), submit("p1", { room: "depositBoxes" }), ROUND);
    expect(two.players.p0?.stash).toBe(5);
    expect(two.players.p1?.totalHandedIn).toBe(5);
    const three = run(
      game(5),
      submit("p0", { room: "depositBoxes", pocket: 5 }),
      submit("p1", { room: "depositBoxes" }),
      submit("p2", { room: "depositBoxes" }),
      ROUND,
    );
    expect(three.players.p0).toMatchObject({ stash: 4, totalHandedIn: 0 });
    expect(three.players.p1).toMatchObject({ stash: 0, totalHandedIn: 4 });
  });

  it("each player learns who else was in their room (§5.2 step 5)", () => {
    const before = run(game(4), submit("p0", { room: "vault" }), submit("p1", { room: "vault" }), submit("p2", { room: "office" }));
    const sightings = lastEvents(before, run(before, ROUND)).filter((e) => e.type === "roomSighting");
    expect(sightings.map((e) => [e.player, e.room, e.others])).toEqual([
      ["p0", "vault", ["p1"]],
      ["p1", "vault", ["p0"]],
      ["p2", "office", []],
      ["p3", "lobby", []],
    ]);
    for (const e of sightings) expect(e.visibility).toEqual({ kind: "private", player: e.player });
  });

  it("Security sees everyone in the watched room, privately (§6.1)", () => {
    const before = run(game(4), submit("p0", { room: "security", watch: "vault" }), submit("p1", { room: "vault" }), submit("p2", { room: "vault" }));
    const watched = lastEvents(before, run(before, ROUND)).filter((e) => e.type === "roomWatched");
    expect(watched).toEqual([
      { type: "roomWatched", visibility: { kind: "private", player: "p0" }, player: "p0", round: 1, source: "security", room: "vault", seen: ["p1", "p2"], offline: false },
    ]);
  });

  it("the Server room learns how many pocketed, not who (§6.2)", () => {
    const before = run(
      game(5),
      submit("p0", { room: "serverRoom" }),
      submit("p1", { room: "vault", pocket: 1 }),
      submit("p2", { room: "office", pocket: 4 }),
      submit("p3", { room: "office" }),
    );
    const counts = lastEvents(before, run(before, ROUND)).filter((e) => e.type === "pocketCount");
    expect(counts).toEqual([{ type: "pocketCount", visibility: { kind: "private", player: "p0" }, player: "p0", round: 1, pocketed: 2 }]);
  });
});

describe("Heat — design §7", () => {
  it("baseline +4 when nobody is in a Heat room", () => {
    expect(run(game(3), ROUND).heat).toBe(4);
  });

  it("Rooftop removes Heat, but Heat never goes below 0", () => {
    const s = run(game(3), submit("p0", { room: "rooftop" }), submit("p1", { room: "rooftop" }), ROUND);
    expect(s.heat).toBe(0); // 4 − 20 × 2/3 ≈ −9, clamped once
    const summary = s.log.find((e) => e.type === "roundResolved");
    expect(summary).toMatchObject({ heatDelta: 0, heat: 0 });
  });

  it("is clamped once per round, after all sources: Vault and Rooftop cancel before clamping", () => {
    // 4 + (20 − 20) / 3 = 4: if the Rooftop were clamped on its own first, this would differ at Heat 0.
    const s = run(game(3), submit("p0", { room: "vault" }), submit("p1", { room: "rooftop" }), ROUND);
    expect(s.heat).toBe(4);
  });

  it("Heat at 100 means the cops raid and the game ends (§5.2 step 6, §3)", () => {
    const hot: GameState = { ...game(3), heat: 90 };
    const s = run(hot, submit("p0", { room: "vault" }), submit("p1", { room: "vault" }), ROUND);
    expect(s.heat).toBe(100); // 90 + 4 + 20 × 2/3 ≈ 107, capped
    expect(s.log.slice(-2).map((e) => e.type)).toEqual(["copsRaided", "gameEnded"]);
    expect(s.phase).toMatchObject({ kind: "ended", outcome: { result: "failed", reason: "heat" } });
    expect(reason(s, submit("p0", { room: "lobby" }))).toMatch(/over/);
  });

  it("Heat just under 100 does not raid", () => {
    const s = run({ ...game(3), heat: 95 }, ROUND);
    expect(s.heat).toBe(99);
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
  });
});

describe("rounds and acts — design §4", () => {
  it("rounds 1–3 run in planning, then the game waits for the act's meeting", () => {
    let s = game(3);
    for (const round of [1, 2, 3]) {
      expect(s.phase).toEqual({ kind: "planning", round });
      s = run(s, ROUND);
    }
    expect(s.phase).toEqual({ kind: "awaitingMeeting", act: 1 });
    expect(s.log.filter((e) => e.type === "roundStarted").map((e) => e.type === "roundStarted" && [e.round, e.act])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
  });

  it("moves are cleared between rounds", () => {
    const s = run(game(3), submit("p0", { room: "vault", pocket: 6 }), ROUND);
    expect(s.moves).toEqual({});
  });
});

