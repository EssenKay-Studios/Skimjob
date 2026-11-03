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
    rolePool: [...STARTER_ROLES], // no Muscle, so no shakedown window (task 12)
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    contentOverrides: V015_NUMBERS, // the Fence's safe scripted at 5 an act (content 0.15.0)
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
    let s = run(game(2), ROUND, ROUND);
    expect(s.players.p0?.consecutiveMissedMoves).toBe(2);
    s = run(s, submit("p0", { room: "office" }));
    expect(s.players.p0?.consecutiveMissedMoves).toBe(0);
  });

  it("the stored move is normalised: unknown fields are dropped", () => {
    const s = run(game(2), { type: "submitMove", player: "p0", move: { room: "lobby", pocket: 0, junk: 1 } });
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
    const after = run(game(2), ROUND, ROUND, ROUND);
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
    const s = run(game(2), submit("p0", { room: "rooftop" }), submit("p1", { room: "rooftop" }), ROUND);
    expect(s.heat).toBe(0); // 4 − 20 = −16, clamped once
    const summary = s.log.find((e) => e.type === "roundResolved");
    expect(summary).toMatchObject({ heatDelta: 0, heat: 0 });
  });

  it("is clamped once per round, after all sources: Vault and Rooftop cancel before clamping", () => {
    // 4 + (20 − 20) / 2 = 4: if the Rooftop were clamped on its own first, this would differ at Heat 0.
    const s = run(game(2), submit("p0", { room: "vault" }), submit("p1", { room: "rooftop" }), ROUND);
    expect(s.heat).toBe(4);
  });

  it("Heat at 100 means the cops raid and the game ends (§5.2 step 6, §3)", () => {
    const hot: GameState = { ...game(2), heat: 90 };
    const s = run(hot, submit("p0", { room: "vault" }), submit("p1", { room: "vault" }), ROUND);
    expect(s.heat).toBe(100); // 90 + 24, capped
    expect(s.log.slice(-2).map((e) => e.type)).toEqual(["copsRaided", "gameEnded"]);
    expect(s.phase).toMatchObject({ kind: "ended", outcome: { result: "failed", reason: "heat" } });
    expect(reason(s, submit("p0", { room: "lobby" }))).toMatch(/over/);
  });

  it("Heat just under 100 does not raid", () => {
    const s = run({ ...game(2), heat: 95 }, ROUND);
    expect(s.heat).toBe(99);
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
  });
});

describe("rounds and acts — design §4", () => {
  it("rounds 1–3 run in planning, then the game waits for the act's meeting", () => {
    let s = game(2);
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
    const s = run(game(2), submit("p0", { room: "vault", pocket: 6 }), ROUND);
    expect(s.moves).toEqual({});
  });
});

describe("starter role powers in a move — design §8", () => {
  it("the Inside Man can't pocket loot", () => {
    const s = game(2, ["insideMan"]);
    expect(reason(s, submit("p0", { room: "vault", pocket: 1 }))).toMatch(/can't pocket/);
    expect(run(s, submit("p0", { room: "vault", pocket: 0 }), ROUND).players.p0?.totalHandedIn).toBe(6);
  });

  it("the Lookout also sees who was in an extra room", () => {
    const before = run(
      game(3, ["lookout"]),
      submit("p0", { room: "lobby", ability: { kind: "lookout", rooms: ["vault"] } }),
      submit("p1", { room: "vault" }),
    );
    const events = lastEvents(before, run(before, ROUND));
    expect(events.find((e) => e.type === "roomWatched")).toMatchObject({ player: "p0", source: "lookout", room: "vault", seen: ["p1"], visibility: { kind: "private", player: "p0" } });
    expect(events.find((e) => e.type === "abilityResolved")).toMatchObject({ player: "p0", ability: { kind: "lookout", rooms: ["vault"] } });
  });

  it("the Lookout can watch at most `extraRooms` (1) rooms in play, each once", () => {
    const s = game(3, ["lookout"]);
    const look = (rooms: unknown) => submit("p0", { room: "lobby", ability: { kind: "lookout", rooms } });
    expect(reason(s, look([]))).toMatch(/1 to 1/);
    expect(reason(s, look(["vault", "office"]))).toMatch(/1 to 1/);
    expect(reason(s, look(["serverRoom"]))).toMatch(/in play/);
    expect(reason(s, look("vault"))).toMatch(/1 to 1/);
    expect(reason(s, submit("p0", { room: "lobby", ability: { kind: "fenceSafe", amount: 1 } }))).toMatch(/no fenceSafe/);
  });

  it("the Fence moves stash (including this round's pocket) into the safe", () => {
    const s = run(game(2, ["fence"]), submit("p0", { room: "vault", pocket: 4, ability: { kind: "fenceSafe", amount: 3 } }), ROUND);
    expect(s.players.p0).toMatchObject({ stash: 1, safe: 3, roleState: expect.objectContaining({ usedThisAct: 3 }) });
  });

  it("the safe move is capped by the stash", () => {
    const s = run(game(2, ["fence"]), submit("p0", { room: "vault", pocket: 2, ability: { kind: "fenceSafe", amount: 5 } }), ROUND);
    expect(s.players.p0).toMatchObject({ stash: 0, safe: 2, roleState: expect.objectContaining({ usedThisAct: 2 }) });
    expect(s.log.find((e) => e.type === "abilityResolved")).toMatchObject({ ability: { kind: "fenceSafe", amount: 2 } });
  });

  it("the safe takes at most 5 per act, and the allowance resets with the next act", () => {
    let s = run(game(2, ["fence"]), submit("p0", { room: "vault", pocket: 6, ability: { kind: "fenceSafe", amount: 4 } }), ROUND);
    expect(reason(s, submit("p0", { room: "vault", ability: { kind: "fenceSafe", amount: 2 } }))).toMatch(/1 to 1/);
    expect(reason(s, submit("p0", { room: "vault", ability: { kind: "fenceSafe", amount: 0 } }))).toMatch(/1 to 1/);
    s = run(s, submit("p0", { room: "vault", ability: { kind: "fenceSafe", amount: 1 } }), ROUND, ROUND);
    expect(s.players.p0).toMatchObject({ safe: 5, roleState: expect.objectContaining({ usedThisAct: 5 }) });
    // Act 2 begins after the act-1 meeting (design §11); its roundStarted resets the allowance.
    const act2 = replay(s.config, [...s.log, { type: "roundStarted", visibility: { kind: "public" }, round: 4, act: 2 }]);
    expect(act2.players.p0).toMatchObject({ safe: 5, roleState: expect.objectContaining({ usedThisAct: 0 }) });
  });
});

describe("determinism and the event log — design §17.2", () => {
  it("replaying the log rebuilds the same state", () => {
    const s = run(
      game(6, ["fence", "lookout", "insideMan"]),
      submit("p0", { room: "depositBoxes", pocket: 3, ability: { kind: "fenceSafe", amount: 2 } }),
      submit("p1", { room: "security", watch: "depositBoxes", ability: { kind: "lookout", rooms: ["vault"] } }),
      submit("p3", { room: "vault", pocket: 6 }),
      ROUND,
      submit("p4", { room: "serverRoom" }),
      ROUND,
    );
    expect(replay(s.config, s.log)).toEqual(s);
  });

  it("the round loop draws no randomness, so no rngAdvanced is added", () => {
    const before = game(3);
    expect(lastEvents(before, run(before, ROUND)).some((e) => e.type === "rngAdvanced")).toBe(false);
  });

  it("withRng appends rngAdvanced with the post-draw state whenever a handler draws", () => {
    const rng = seedRng("x");
    const out = withRng(rng, (draw) => {
      draw.int(10);
      draw.shuffle([1, 2, 3]);
      return [{ type: "roundStarted", visibility: { kind: "public" }, round: 2, act: 1 }];
    });
    expect(Array.isArray(out) && out.map((e) => e.type)).toEqual(["roundStarted", "rngAdvanced"]);
    const last = Array.isArray(out) ? out.at(-1) : undefined;
    expect(last).toMatchObject({ visibility: { kind: "reveal" } });
    expect(last?.type === "rngAdvanced" && last.words).not.toEqual(rng.words);
    expect(withRng(rng, () => [])).toEqual([]);
    expect(withRng(rng, (draw) => (draw.int(2), "nope"))).toBe("nope");
  });
});

describe("player ids", () => {
  // Ids are record keys everywhere, so unsafe ones are refused at setup (PR #9 QA: a __proto__ seat lost entries in a copied view).
  it("ids shaped like prototype keys, or outside [A-Za-z0-9_-]{1,32}, are refused at setup", () => {
    for (const id of ["__proto__", "constructor", "prototype", "has space", "a.b", "x".repeat(33), "é"]) {
      const cfg: GameConfig = { ...config(2), players: [{ id, name: "X", isBot: false }, { id: "p1", name: "P1", isBot: true }] };
      expect(() => setupEvents(cfg), id).toThrow(/player ids must match/);
    }
  });

  it("other ids that are also Object.prototype names play like anyone else", () => {
    const cfg: GameConfig = { ...config(2), players: [{ id: "toString", name: "T", isBot: false }, { id: "hasOwnProperty", name: "H", isBot: true }] };
    const log = setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "rookie" } : e));
    const s = run(replay(cfg, log), submit("toString", { room: "office", pocket: 1 }), ROUND);
    expect(Object.hasOwn(s.players, "toString")).toBe(true);
    expect(s.players["toString"]).toMatchObject({ stash: 1, totalHandedIn: 3 });
    expect(s.haul).toBe(5);
    expect(replay(cfg, s.log)).toEqual(s);
  });
});
