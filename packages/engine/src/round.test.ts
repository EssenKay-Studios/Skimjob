// The round loop: moves (rooms, coins and grabs), missed moves, the bank and
// the short bank, resolution, information. design §3, §4.2, §6.1 (bells: bells.test.ts)
import { STARTER_ROLES } from "@skimjob/content";
import { handleThroughAlibis } from "./alibis.testkit";
import { describe, expect, it } from "vitest";
import type { Command, GameConfig, GameEvent, GameState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand, withRng } from "./handle";
import { randomInt, seedRng } from "./rng";
import { viewFor } from "./view";
import { NO_RAIDS } from "./v01-numbers.testkit";

function config(players: number, contentOverrides: GameConfig["contentOverrides"] = null): GameConfig {
  return {
    seed: "round-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [...STARTER_ROLES], // a shakedown window only if the shop holds a Shield
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    contentOverrides,
  };
}

/** A new game with chosen roles (seat i gets roles[i], Rookie if missing). */
function game(players: number, roles: string[] = [], contentOverrides: GameConfig["contentOverrides"] = null): GameState {
  const cfg = config(players, contentOverrides);
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

/** A submitMove command (empty bags unless given); `move` is loose on purpose so tests can send malformed moves. */
const submit = (player: string, move: Record<string, unknown>): Command =>
  ({ type: "submitMove", player, move: { duffel: 0, pocket: 0, ...move } }) as Command;
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

describe("planning — design §3.2", () => {
  it("a submitted move is private to its player and can be changed until the deadline; the last one counts", () => {
    let s = game(3);
    s = run(s, submit("p0", { room: "vault", pocket: 3 }));
    const ev = s.log.at(-1);
    expect(ev).toMatchObject({ type: "moveSubmitted", player: "p0", round: 1, visibility: { kind: "private", player: "p0" } });
    s = run(s, submit("p0", { room: "office", duffel: 1, pocket: 1 }));
    expect(s.moves.p0).toEqual({ room: "office", duffel: 1, pocket: 1 });
    const before = s;
    s = run(s, ROUND);
    expect(lastEvents(before, s).find((e) => e.type === "coinsGrabbed" && e.player === "p0")).toMatchObject({ room: "office", duffel: 1, pocket: 1 });
  });

  it("a missed move is the Lobby, 1 coin, handed in (design §3.3)", () => {
    const before = game(3);
    const s = run(before, ROUND);
    const defaults = lastEvents(before, s).filter((e) => e.type === "defaultMoveAssigned");
    expect(defaults.map((e) => e.player)).toEqual(["p0", "p1", "p2"]);
    for (const e of defaults) {
      expect(e).toMatchObject({ move: { room: "lobby", duffel: 1, pocket: 0 }, visibility: { kind: "private", player: e.player } });
    }
    expect(s.reached).toBe(3);
    expect(s.bank).toBe(48 - 3);
    // design §7.2: the 3 handed in split 1 each.
    expect(s.players.p0).toMatchObject({ stash: 1, consecutiveMissedMoves: 1 });
  });

  it("missed rounds are counted in a row and reset by submitting (design §16)", () => {
    let s = run(game(3), ROUND, ROUND);
    expect(s.players.p0?.consecutiveMissedMoves).toBe(2);
    s = run(s, submit("p0", { room: "office", duffel: 2 }));
    expect(s.players.p0?.consecutiveMissedMoves).toBe(0);
  });

  it("the stored move is normalised: unknown fields are dropped", () => {
    const s = run(game(3), { type: "submitMove", player: "p0", move: { room: "lobby", duffel: 1, pocket: 0, junk: 1 } });
    expect(s.moves.p0).toEqual({ room: "lobby", duffel: 1, pocket: 0 });
  });

  it("grab 1 coin up to the room's limit, split any way between the duffel and the pocket (design §3.1, §3.2)", () => {
    const limits = { lobby: 1, office: 2, vault: 3, depositBoxes: 2, serverRoom: 2, managersOffice: 2 };
    const s = game(9);
    for (const [room, limit] of Object.entries(limits)) {
      for (let pocket = 0; pocket <= limit; pocket++) {
        for (const grab of [1, limit]) if (pocket <= grab) expect(handleThroughAlibis(s, submit("p0", { room, duffel: grab - pocket, pocket })).ok, `${room} ${grab}/${pocket}`).toBe(true);
      }
      expect(reason(s, submit("p0", { room, duffel: limit + 1 }))).toMatch(new RegExp(`at most ${limit}`));
      expect(reason(s, submit("p0", { room, duffel: limit, pocket: 1 }))).toMatch(new RegExp(`at most ${limit}`));
      // design §3.2: a move in a coin room asks for at least 1 coin.
      expect(reason(s, submit("p0", { room }))).toMatch(/at least 1 coin/);
    }
  });

  it("Security and the Rooftop grab nothing (design §3.1, §3.2)", () => {
    const s = game(3);
    expect(handleThroughAlibis(s, submit("p0", { room: "rooftop" })).ok).toBe(true);
    expect(handleThroughAlibis(s, submit("p0", { room: "security", watch: "vault" })).ok).toBe(true);
    expect(reason(s, submit("p0", { room: "rooftop", duffel: 1 }))).toMatch(/no coins to grab/);
    expect(reason(s, submit("p0", { room: "security", pocket: 1, watch: "vault" }))).toMatch(/no coins to grab/);
  });
});

describe("rejected commands leave state untouched", () => {
  const s = game(3);
  const cases: [string, unknown][] = [
    ["not an object", 7],
    ["no type", { player: "p0" }],
    ["unknown command", { type: "teleport" }],
    ["unsupported command", { type: "useAbility", player: "p0" }],
    ["unknown player", submit("zed", { room: "lobby", duffel: 1 })],
    ["missing move", { type: "submitMove", player: "p0" }],
    ["unknown room", submit("p0", { room: "kitchen", duffel: 1 })],
    ["room not in play for 3 players (closed)", submit("p0", { room: "depositBoxes", duffel: 1 })],
    ["the Teller line is gone (design §3.1)", submit("p0", { room: "tellerLine", duffel: 1 })],
    ["prototype key as room", submit("p0", { room: "constructor", duffel: 1 })],
    ["negative pocket", submit("p0", { room: "vault", duffel: 2, pocket: -1 })],
    ["negative duffel", submit("p0", { room: "vault", duffel: -1, pocket: 2 })],
    ["grab over the room's limit", submit("p0", { room: "vault", duffel: 2, pocket: 2 })],
    ["no coins in a coin room", submit("p0", { room: "vault" })],
    ["fractional pocket", submit("p0", { room: "vault", pocket: 1.5 })],
    ["NaN pocket", submit("p0", { room: "vault", pocket: Number.NaN })],
    ["infinite duffel", submit("p0", { room: "vault", duffel: Number.POSITIVE_INFINITY })],
    ["string pocket", submit("p0", { room: "vault", pocket: "2" })],
    ["missing duffel", { type: "submitMove", player: "p0", move: { room: "vault", pocket: 1 } }],
    ["Security without a watched room", submit("p0", { room: "security" })],
    ["Security watching a closed room", submit("p0", { room: "security", watch: "serverRoom" })],
    ["watching from outside Security", submit("p0", { room: "vault", duffel: 1, watch: "office" })],
    ["a Rookie using an ability", submit("p0", { room: "vault", duffel: 1, ability: { kind: "lookout", rooms: ["office"] } })],
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

  it("moves and round deadlines are refused outside planning (while a meeting is due)", () => {
    // Everyone in the Vault: 9 rings raid it, which calls a police briefing (design §9.2).
    const vault = (p: string) => submit(p, { room: "vault", duffel: 3 });
    const after = run(game(3), vault("p0"), vault("p1"), vault("p2"), ROUND);
    expect(after.phase).toEqual({ kind: "awaitingMeeting", meeting: "briefing", meetingId: "meeting-1" });
    expect(reason(after, submit("p0", { room: "lobby", duffel: 1 }))).toMatch(/planned/);
    expect(reason(after, ROUND(after))).toMatch(/no round deadline/);
  });
});

describe("resolution — design §3.2, §4.2 step 1", () => {
  it("duffel coins are split equally and pocket coins go to the stash; the round summary is public and the grabs private (design §7.2, §7.4)", () => {
    const before = run(game(3), submit("p0", { room: "vault", duffel: 1, pocket: 2 }), submit("p1", { room: "office", duffel: 2 }), submit("p2", { room: "lobby", pocket: 1 }));
    const s = run(before, ROUND);
    expect(s.reached).toBe(1 + 2 + 0);
    // The 3 handed in split 1 each; the pockets are their own.
    expect(s.players.p0).toMatchObject({ stash: 1 + 2 });
    expect(s.players.p1).toMatchObject({ stash: 1 });
    expect(s.players.p2).toMatchObject({ stash: 1 + 1 });
    const events = lastEvents(before, s);
    const grabs = events.filter((x) => x.type === "coinsGrabbed");
    expect(grabs.map((e) => e.type === "coinsGrabbed" && [e.player, e.room, e.duffel, e.pocket])).toEqual([
      ["p0", "vault", 1, 2],
      ["p1", "office", 2, 0],
      ["p2", "lobby", 0, 1],
    ]);
    for (const e of grabs) expect(e.visibility).toEqual({ kind: "private", player: e.player });
    expect(events.find((e) => e.type === "roundResolved")).toEqual({
      type: "roundResolved",
      visibility: { kind: "public" },
      round: 1,
      bank: 48 - 6, // design §6.1: every coin grabbed leaves the bank, handed in or pocketed
      taken: 6,
      missing: 3,
      honesty: { reached: 3, taken: 6 },
    });
  });

  it("events follow the resolution order: bells, grabs, the split, cooling, sightings and watches, the summary, then the next round (design §4.2)", () => {
    const before = run(game(3), submit("p0", { room: "security", watch: "vault" }));
    const types = lastEvents(before, run(before, ROUND)).map((e) => e.type);
    expect(types).toEqual([
      "defaultMoveAssigned",
      "defaultMoveAssigned",
      "bellsRung",
      "coinsGrabbed",
      "coinsGrabbed",
      "coinsGrabbed",
      "duffelSplit",
      "bellsCooled",
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

  it("visitors don't share a room's limit: everyone in the Vault grabs up to 3 (design §3.1)", () => {
    // Bells too big to raid: 15 rings would raid the Vault (bells.test.ts).
    const s = run(game(5, [], NO_RAIDS), ...["p0", "p1", "p2", "p3", "p4"].map((p) => submit(p, { room: "vault", duffel: 3 })), ROUND);
    expect(s.reached).toBe(15);
  });

  it("each player learns who else was in their room (design §3.4)", () => {
    const before = run(game(4), submit("p0", { room: "vault", duffel: 1 }), submit("p1", { room: "vault", duffel: 1 }), submit("p2", { room: "office", duffel: 1 }));
    const sightings = lastEvents(before, run(before, ROUND)).filter((e) => e.type === "roomSighting");
    expect(sightings.map((e) => [e.player, e.room, e.others])).toEqual([
      ["p0", "vault", ["p1"]],
      ["p1", "vault", ["p0"]],
      ["p2", "office", []],
      ["p3", "lobby", []],
    ]);
    for (const e of sightings) expect(e.visibility).toEqual({ kind: "private", player: e.player });
  });

  it("Security sees everyone in the watched room, privately (design §3.1)", () => {
    const before = run(game(4), submit("p0", { room: "security", watch: "vault" }), submit("p1", { room: "vault", duffel: 1 }), submit("p2", { room: "vault", duffel: 1 }));
    const watched = lastEvents(before, run(before, ROUND)).filter((e) => e.type === "roomWatched");
    expect(watched).toEqual([
      { type: "roomWatched", visibility: { kind: "private", player: "p0" }, player: "p0", round: 1, source: "security", room: "vault", seen: ["p1", "p2"], offline: false },
    ]);
  });
});

describe("the bank — design §6.1", () => {
  it("holds 16 coins per player, filled publicly at setup and shown in every view", () => {
    for (const n of [3, 7, 12]) {
      const s = game(n);
      expect(s.bank).toBe(16 * n);
      expect(s.log.find((e) => e.type === "bankFilled")).toEqual({ type: "bankFilled", visibility: { kind: "public" }, coins: 16 * n });
      expect(viewFor(s, "p1").bank).toBe(16 * n);
    }
  });

  it("every coin grabbed comes out of the bank; the count left is public", () => {
    const s = run(game(3), submit("p0", { room: "vault", pocket: 3 }), submit("p1", { room: "rooftop" }), ROUND);
    expect(s.bank).toBe(48 - 3 - 1);
    expect(viewFor(s, "p2").bank).toBe(44);
  });
});

describe("a short bank — design §3.2", () => {
  // Bells too big to raid, so the grabs stay in their bags (rings from a short bank: bells.test.ts).
  const tiny = (players: number, coinsPerPlayer: number) => game(players, [], { ...NO_RAIDS, bank: { coinsPerPlayer } });
  const grabsOf = (before: GameState, after: GameState) =>
    Object.fromEntries(lastEvents(before, after).flatMap((e) => (e.type === "coinsGrabbed" ? [[e.player, [e.duffel, e.pocket]]] : [])));

  it("when the bank covers every grab, nothing is cut and no randomness is drawn", () => {
    const before = run(tiny(3, 3), ...["p0", "p1", "p2"].map((p) => submit(p, { room: "vault", duffel: 3 })));
    const s = run(before, ROUND);
    expect(s.bank).toBe(0);
    expect(grabsOf(before, s)).toEqual({ p0: [3, 0], p1: [3, 0], p2: [3, 0] });
    expect(s.rng).toEqual(before.rng);
    expect(lastEvents(before, s).some((e) => e.type === "rngAdvanced")).toBe(false);
  });

  it("coins go out one at a time, round-robin in seat order from a seeded random seat, until the bank is empty", () => {
    // Bank 6, less 1 for p0's Lobby grab in round 1: 5 left for three grabs of 3.
    const r1 = run(tiny(3, 2), submit("p0", { room: "lobby", duffel: 1 }), submit("p1", { room: "rooftop" }), submit("p2", { room: "rooftop" }), ROUND);
    const before = run(r1, ...["p0", "p1", "p2"].map((p) => submit(p, { room: "vault", duffel: 3 })));
    expect(before.bank).toBe(5);
    const start = randomInt(before.rng, 3).value;
    const s = run(before, ROUND);
    expect(s.bank).toBe(0);
    // The drawn seat and the next get 2, the third 1.
    const got = grabsOf(before, s);
    for (const [i, coins] of [2, 2, 1].entries()) expect(got[before.playerOrder[(start + i) % 3] as string]).toEqual([coins, 0]);
    expect(lastEvents(before, s).some((e) => e.type === "rngAdvanced")).toBe(true);
  });

  it("the round-robin skips grabs that are full", () => {
    // Bank 8, less 2 in round 1: 6 left. p0 asks 1, p1 and p2 ask 3, p3 nothing (Rooftop):
    // p0 gets its 1, and p1 and p2 share 5, the extra coin to whichever comes first from the drawn seat.
    const r1 = run(tiny(4, 2), submit("p0", { room: "lobby", duffel: 1 }), submit("p1", { room: "lobby", duffel: 1 }), submit("p2", { room: "rooftop" }), submit("p3", { room: "rooftop" }), ROUND);
    const before = run(r1, submit("p0", { room: "lobby", duffel: 1 }), submit("p1", { room: "vault", duffel: 3 }), submit("p2", { room: "vault", duffel: 3 }), submit("p3", { room: "rooftop" }));
    expect(before.bank).toBe(6);
    const start = randomInt(before.rng, 4).value;
    const first = [0, 1, 2, 3].map((i) => before.playerOrder[(start + i) % 4]).find((id) => id === "p1" || id === "p2");
    const s = run(before, ROUND);
    expect(grabsOf(before, s)).toEqual({ p0: [1, 0], p1: [first === "p1" ? 3 : 2, 0], p2: [first === "p2" ? 3 : 2, 0], p3: [0, 0] });
    expect(s.bank).toBe(0);
  });

  it("a cut grab loses its pocket-bound coins first, then its duffel-bound ones", () => {
    const before = run(tiny(3, 1), submit("p0", { room: "vault", duffel: 1, pocket: 2 }), submit("p1", { room: "vault", duffel: 2, pocket: 1 }), submit("p2", { room: "vault", pocket: 3 }));
    const s = run(before, ROUND);
    // Bank 3, three grabs of 3: one coin each.
    expect(grabsOf(before, s)).toEqual({ p0: [1, 0], p1: [1, 0], p2: [0, 1] });
    expect(s.reached).toBe(2);
    expect(s.players.p2?.stash).toBe(1);
  });

  it("the round that empties the bank is the last: no grab is ever cut to nothing by an empty bank (design §6.2)", () => {
    const s = run(tiny(3, 1), ROUND); // three missed moves empty the bank of 3
    expect([s.bank, s.reached, s.phase.kind]).toEqual([0, 3, "ended"]);
  });

  it("is deterministic: the same seed and commands cut the same grabs", () => {
    const play = () => run(tiny(5, 1), ...["p0", "p1", "p2", "p3", "p4"].map((p) => submit(p, { room: "vault", duffel: 1, pocket: 2 })), ROUND);
    expect(JSON.stringify(play().log)).toBe(JSON.stringify(play().log));
    const s = play();
    expect(replay(s.config, JSON.parse(JSON.stringify(s.log)) as GameEvent[])).toEqual(s);
  });
});

describe("rounds and meetings — design §4.1, §9.1", () => {
  it("rounds run in planning until one takes the bank past two-thirds; then the game waits for the regular meeting", () => {
    // Everyone misses: 3 coins a round out of 48, so round 6 leaves 30, past 32.
    let s = game(3);
    for (const round of [1, 2, 3, 4, 5, 6]) {
      expect(s.phase).toEqual({ kind: "planning", round });
      s = run(s, ROUND);
    }
    expect(s.phase).toEqual({ kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" });
    expect(s.log.filter((e) => e.type === "roundStarted").map((e) => e.type === "roundStarted" && e.round)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("moves are cleared between rounds", () => {
    const s = run(game(3), submit("p0", { room: "vault", pocket: 3 }), ROUND);
    expect(s.moves).toEqual({});
  });
});

