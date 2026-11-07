// QA (PR #4): scripted full games, rejections, determinism and private
// information for the round loop. design §3 (rooms, coins, grabs), §6.1. The
// scripted games pin bells too big to raid; bells and raids: bells.test.ts.
import { STARTER_ROLES } from "@skimjob/content";
import { handleThroughAlibis } from "./alibis.testkit";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState, Move } from "./types";
import { PUBLIC, canSee } from "./types";
import { setupEvents } from "./setup";
import { applyEvent, replay } from "./reduce";
import { actOfRound } from "./round";
import { handleCommand } from "./handle";
import { fullGrab } from "./grab.testkit";
import { NO_RAIDS } from "./v01-numbers.testkit";

function config(players: number): GameConfig {
  return {
    seed: "qa-round",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [...STARTER_ROLES], // a shakedown window only if the shop holds a Shield
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    contentOverrides: NO_RAIDS,
  };
}

/** A new game with seat i dealt roles[i] (Rookie if missing). */
function game(players: number, roles: string[] = []): GameState {
  const cfg = config(players);
  let seat = 0;
  const log = setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "rookie" } : e));
  return replay(cfg, log);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** A function command is called with the current state (e.g. `ROUND`). */
function ok(state: GameState, command: unknown): GameState {
  const r = handleThroughAlibis(state, typeof command === "function" ? command(state) : command);
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.state;
}

const submit = (player: string, move: unknown) => ({ type: "submitMove", player, move });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
/** A full grab in `room`, `pocket` of it pocketed (design §3.2). */
const m = (room: string, pocket = 0, extra: Partial<Move> = {}): Move => ({ ...fullGrab(room, pocket), ...extra });

/** Stand-in for task 6: open the next act's first round after the meeting. */
function nextAct(s: GameState): GameState {
  if (s.phase.kind !== "awaitingMeeting") throw new Error(`expected awaitingMeeting, got ${s.phase.kind}`);
  const round = s.round + 1;
  return applyEvent(s, { type: "roundStarted", visibility: PUBLIC, round, act: actOfRound(round) });
}

/** Play scripted rounds: rounds[r][seat] is that seat's move, or null to miss the deadline. */
function play(start: GameState, rounds: (Move | null)[][]): GameState {
  let s = start;
  for (const moves of rounds) {
    if (s.phase.kind === "awaitingMeeting") s = nextAct(s);
    moves.forEach((mv, i) => {
      if (mv) s = ok(s, submit(`p${i}`, mv));
    });
    s = ok(s, ROUND);
  }
  return s;
}

const resolved = (s: GameState) => s.log.filter((e) => e.type === "roundResolved");
const stashes = (s: GameState) => s.playerOrder.map((id) => s.players[id]?.stash);
const ofType = <T extends GameEvent["type"]>(s: GameState, type: T) =>
  s.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** Bookkeeping that must hold for any game: coins grabbed = bank taken = kitty + stashes, per round and in total. design §3.2, §6.1, §7.7 */
function checkLedger(s: GameState): void {
  let bank = 16 * s.playerOrder.length;
  for (const r of resolved(s)) {
    if (r.type !== "roundResolved") continue;
    const grabs = ofType(s, "coinsGrabbed").filter((e) => e.round === r.round);
    expect(grabs).toHaveLength(s.playerOrder.length);
    expect(grabs.reduce((n, e) => n + e.duffel, 0), `round ${r.round}`).toBe(r.taken - r.missing);
    expect(grabs.reduce((n, e) => n + e.pocket, 0), `round ${r.round}`).toBe(r.missing);
    bank -= grabs.reduce((n, e) => n + e.duffel + e.pocket, 0);
    expect(r.bank, `round ${r.round}`).toBe(bank);
  }
  const grabbed = ofType(s, "coinsGrabbed").reduce((n, e) => n + e.duffel + e.pocket, 0);
  const kept = Object.values(s.players).reduce((n, p) => n + p.stash, 0);
  expect(s.kitty + kept).toBe(grabbed);
  expect(s.reached).toBe(ofType(s, "coinsGrabbed").reduce((n, e) => n + e.duffel, 0));
  expect(s.bank).toBe(16 * s.playerOrder.length - grabbed);
}

// ---------------------------------------------------------------- scripts
// Hand-calculated with content numbers: coins Lobby 1, Office, Deposit boxes, Manager's office, Server room 2,
// Vault 3 (design §3.1); a missed move hands in 1 (§3.3); the bank holds 16 a player (§6.1).

/** 3 players, all Rookies; p2 hands in the Lobby's 1 every round. */
const ROOKIES: (Move | null)[][] = [
  [m("vault", 1), m("office"), m("lobby")], //                          in +5
  [m("security", 0, { watch: "vault" }), m("vault", 3), m("lobby")], // in +1
  [m("rooftop"), m("rooftop"), m("lobby")], //                          in +1
  [m("lobby", 1), m("office", 2), m("lobby")], //                       in +1
  [null, m("office", 1), m("lobby")], //    p0 misses: Lobby, 1 in:     in +3
  [m("vault"), m("vault"), m("lobby")], //                              in +7
  [m("vault", 2), m("vault", 2), m("lobby")], //                        in +3
  [m("vault", 3), m("rooftop"), m("lobby")], //                         in +1
  [m("office", 1), m("vault"), m("lobby")], //                          in +5
];

/** 3 players: Priest, Lookout, Hacker. The last round empties the bank exactly. */
const L = (room: string) => ({ ability: { kind: "lookout" as const, rooms: [room] } });
const THREE: (Move | null)[][] = [
  [m("vault"), m("office", 1, L("vault")), m("lobby", 1)], //          in +4
  [m("vault"), m("vault", 3), m("vault", 3)], //                       in +3
  [m("rooftop"), m("rooftop"), m("security", 0, { watch: "rooftop" })], //  in 0
  [null, m("lobby", 1, L("lobby")), m("office", 2)], //                in +1
  [m("office"), m("office", 2), m("office", 2)], //                    in +2
  [m("vault"), m("vault"), m("vault")], //                             in +9
  [m("vault"), m("rooftop"), m("rooftop")], //                         in +3
  [m("vault"), m("vault", 3), m("office")], //                         in +5
  [m("lobby"), m("security", 0, { watch: "vault" }), m("office", 2)], // in +1
];

/** 12 players, all Rookies; every room is in play. */
const row = (...groups: [number, Move | null][]): (Move | null)[] => groups.flatMap(([n, mv]) => Array<Move | null>(n).fill(mv));
const TWELVE: (Move | null)[][] = [
  // 3 Vault; 3 Deposit boxes (two pocket 2, one pockets 1); 2 Manager's office pocket 1; Office pockets 1;
  // Server room; Security watching Deposit boxes; Rooftop.
  // in 9 + 1 + 2 + 1 + 2 = 15
  [
    ...row([3, m("vault")], [2, m("depositBoxes", 2)], [1, m("depositBoxes", 1)], [2, m("managersOffice", 1)]),
    m("office", 1),
    m("serverRoom"),
    m("security", 0, { watch: "depositBoxes" }),
    m("rooftop"),
  ],
  row([2, m("depositBoxes", 2)], [10, m("lobby")]), //               in +10
  row([12, m("rooftop")]), //                                        in 0
  row([6, m("vault")], [6, m("office")]), //                         in +30
  row([12, null]), //                                                all missed: in +12
  row([12, m("managersOffice", 2)]), //                              in 0
  [m("vault", 3), m("managersOffice"), ...row([10, m("office")])], // in +22
  row([3, m("depositBoxes")], [9, m("vault")]), //                   in 6 + 27 = 33
  [m("managersOffice"), ...row([5, m("rooftop")], [6, m("office")])], // in +14
];

describe("QA scripted full games — design §3, §6.1", () => {
  it("3 Rookies: 9 rounds, hand-ins, shares, stashes and bank by hand (design §7.2, §7.3)", () => {
    let s = game(3);
    s = ok(s, submit("p0", m("office", 2))); // resubmitted below; the last one counts (§3.2)
    s = play(s, ROOKIES);
    expect(resolved(s).map((e) => e.type === "roundResolved" && e.honesty.reached)).toEqual([5, 6, 7, 8, 11, 18, 21, 22, 27]);
    expect([s.reached, s.bank]).toEqual([27, 5]);
    // Each split shares the hand-ins and the kitty 3 ways: 5 → 1 (kitty 2), 1+2 → 1, 1 → 0 (1), 1+1 → 0 (2), 3+2 → 1 (2), 7+2 → 3, 3 → 1, 1 → 0 (1), 5+1 → 2.
    expect(ofType(s, "duffelSplit").map((e) => [e.cut, e.kitty])).toEqual([[1, 2], [1, 0], [0, 1], [0, 2], [1, 2], [3, 0], [1, 0], [0, 1], [2, 0]]);
    expect([s.share, s.kitty]).toEqual([9, 0]);
    expect(stashes(s)).toEqual([8 + 9, 8 + 9, 0 + 9]);
    expect(s.phase).toEqual({ kind: "awaitingMeeting", act: 3 });
    expect(ofType(s, "defaultMoveAssigned").map((e) => [e.player, e.round])).toEqual([["p0", 5]]);
    expect(s.players.p0?.consecutiveMissedMoves).toBe(0); // reset by submitting in round 6
    expect(ofType(s, "roomWatched")).toMatchObject([{ player: "p0", round: 2, source: "security", room: "vault", seen: ["p1"] }]);
    checkLedger(s);
  });

  it("3 with powers: the last round takes exactly what the bank has left", () => {
    const s = play(game(3, ["priest", "lookout", "hacker"]), THREE);
    expect(resolved(s).map((e) => e.type === "roundResolved" && e.honesty.reached)).toEqual([4, 7, 7, 8, 10, 19, 22, 27, 28]);
    // Shares 1, 2, 2, 2, 3, 6, 7, 9, 9; the last split's change (1) is the kitty, and it pays for the getaway car (design §6.3).
    expect(ofType(s, "duffelSplit").map((e) => e.share)).toEqual([1, 2, 2, 2, 3, 6, 7, 9, 9]);
    expect([s.bank, s.kitty, stashes(s)]).toEqual([0, 1, [0 + 9, 10 + 9, 10 + 9]]);
    expect(s.phase.kind === "ended" && s.phase.outcome).toMatchObject({ result: "failed", reason: "theft", getaway: 1 });
    checkLedger(s);
  });

  it("12 players: 9 rounds over every room, visitors not sharing a room's limit", () => {
    const s = play(game(12), TWELVE);
    expect(resolved(s).map((e) => e.type === "roundResolved" && e.taken - e.missing)).toEqual([15, 10, 0, 30, 12, 0, 22, 33, 14]);
    expect([s.reached, s.bank]).toEqual([136, 192 - 175]);
    // 12 ways: 15 → 1 (kitty 3), 10+3 → 1 (1), 0+1 → 0 (1), 30+1 → 2 (7), 12+7 → 1 (7), 0+7 → 0 (7), 22+7 → 2 (5), 33+5 → 3 (2), 14+2 → 1 (4).
    expect(ofType(s, "duffelSplit").map((e) => e.share)).toEqual([1, 2, 2, 4, 5, 5, 7, 10, 11]);
    expect([s.share, s.kitty]).toEqual([11, 4]);
    expect(stashes(s)).toEqual([7, 4, 2, 4, 4, 3, 3, 3, 3, 2, 2, 2].map((pocket) => pocket + 11));
    // Deposit boxes: everyone there grabs the full 2, however many go. design §3.1
    const boxes = ofType(s, "coinsGrabbed").filter((e) => e.room === "depositBoxes").map((e) => [e.round, e.duffel, e.pocket]);
    expect(boxes).toEqual([[1, 0, 2], [1, 0, 2], [1, 1, 1], [2, 0, 2], [2, 0, 2], [8, 2, 0], [8, 2, 0], [8, 2, 0]]);
    expect(ofType(s, "roomWatched")).toMatchObject([{ player: "p10", room: "depositBoxes", seen: ["p3", "p4", "p5"] }]);
    expect(ofType(s, "defaultMoveAssigned")).toHaveLength(12);
    expect(Object.values(s.players).every((p) => p.consecutiveMissedMoves === 0)).toBe(true);
    checkLedger(s);
  });
});

describe("QA resubmitting a move — design §3.2", () => {
  it("a rejected resubmission keeps the earlier move", () => {
    let s = ok(game(3), submit("p0", m("office", 2)));
    expect(handleThroughAlibis(s, submit("p0", m("office", 3))).ok).toBe(false);
    s = ok(s, ROUND);
    expect(ofType(s, "coinsGrabbed").find((e) => e.player === "p0")).toMatchObject({ room: "office", duffel: 0, pocket: 2 });
  });
});

describe("QA rejected commands leave state unchanged", () => {
  // Mid-round, with a move already in, on a frozen state: any mutation would throw.
  const base = deepFreeze(ok(game(3, ["priest", "lookout", "hacker"]), submit("p1", m("office", 2))));
  const snapshot = JSON.stringify(base);
  const cases: [string, unknown][] = [
    ["null command", null],
    ["array command", [{ type: "advance", deadline: { kind: "round", round: 1 } }]],
    ["player not in the game", submit("p3", m("lobby"))],
    ["prototype key as player", submit("__proto__", m("lobby"))],
    ["inherited key as player", submit("hasOwnProperty", m("lobby"))],
    ["numeric player", submit(0 as unknown as string, m("lobby"))],
    ["move is null", submit("p1", null)],
    ["move is an array", submit("p1", [m("lobby")])],
    ["prototype key as room", submit("p1", m("__proto__"))],
    ["Manager's office closed at 3 players", submit("p1", m("managersOffice"))],
    ["pocket in a 0-coin room", submit("p1", m("security", 1, { watch: "vault" }))],
    ["pocket on the Rooftop", submit("p1", m("rooftop", 1))],
    ["missing pocket", submit("p1", { room: "lobby", duffel: 1 })],
    ["missing duffel", submit("p1", { room: "lobby", pocket: 1 })],
    ["null pocket", submit("p1", { room: "lobby", duffel: 1, pocket: null })],
    ["NaN pocket", submit("p1", { room: "lobby", duffel: 0, pocket: Number.NaN })],
    ["negative fractional pocket", submit("p1", { room: "lobby", duffel: 1, pocket: -0.5 })],
    ["empty bags in a coin room", submit("p1", { room: "office", duffel: 0, pocket: 0 })],
    ["more than the room's limit", submit("p1", { room: "office", duffel: 2, pocket: 1 })],
    ["Security watching an unknown room", submit("p1", m("security", 0, { watch: "kitchen" }))],
    ["the Priest uses the Lookout's power", submit("p0", m("vault", 0, L("office")))],
    ["Lookout watches no rooms", submit("p1", m("lobby", 0, { ability: { kind: "lookout", rooms: [] } }))],
    ["Lookout watches 2 rooms", submit("p1", m("lobby", 0, { ability: { kind: "lookout", rooms: ["vault", "office"] } }))],
    ["Lookout watches a closed room", submit("p1", m("lobby", 0, L("depositBoxes")))],
    ["Lookout rooms not an array", submit("p1", m("lobby", 0, { ability: { kind: "lookout", rooms: "vault" } as never }))],
    ["ability kind none", submit("p2", m("lobby", 0, { ability: { kind: "none" } as never }))],
    ["ability is null", submit("p2", m("lobby", 0, { ability: null as never }))],
    ["deadline is a string", { type: "advance", deadline: "round" }],
    ["closeMeeting deadline", { type: "advance", deadline: { kind: "closeMeeting", meetingId: "m1" } }],
  ];
  for (const [name, command] of cases) {
    it(name, () => {
      const r = handleThroughAlibis(base, command);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(base)).toBe(snapshot);
    });
  }

  it("every command is refused after the game ends, and in awaitingMeeting moves/rounds are refused", () => {
    const waiting = play(game(3), [[null, null, null], [null, null, null], [null, null, null]]);
    expect(waiting.phase.kind).toBe("awaitingMeeting");
    for (const c of [submit("p0", m("lobby")), ROUND(waiting)]) expect(handleThroughAlibis(waiting, c).ok).toBe(false);
  });
});

describe("QA determinism — design §17.2", () => {
  for (const [n, script, roles] of [
    [3, ROOKIES, []],
    [3, THREE, ["priest", "lookout", "hacker"]],
    [12, TWELVE, []],
  ] as const) {
    it(`${n} players: same seed + same commands → identical log; replay (also via JSON) rebuilds the state`, () => {
      const a = play(game(n, [...roles]), script.map((r) => [...r]));
      const b = play(game(n, [...roles]), script.map((r) => [...r]));
      expect(b.log).toEqual(a.log);
      expect(b).toEqual(a);
      expect(replay(a.config, JSON.parse(JSON.stringify(a.log)) as GameEvent[])).toEqual(a);
    });
  }
});

describe("QA private information — design §3.4, §18", () => {
  const PRIVATE = new Set(["moveSubmitted", "defaultMoveAssigned", "coinsGrabbed", "abilityResolved", "roomSighting", "roomWatched", "roleDealt"]);
  const games = [
    play(game(3), ROOKIES),
    play(game(3, ["priest", "lookout", "hacker"]), THREE),
    play(game(12), TWELVE),
  ];
  for (const s of games) {
    it(`${s.playerOrder.length} players: grabs, sightings and watch results are visible only to their own player`, () => {
      for (const e of s.log) {
        if (PRIVATE.has(e.type)) {
          const owner = (e as { player: string }).player;
          expect(e.visibility, e.type).toEqual({ kind: "private", player: owner });
          for (const viewer of s.playerOrder) expect(canSee(e.visibility, viewer, false)).toBe(viewer === owner);
        } else if (e.type === "moveLocked") {
          // Owner decision (2 Nov), design §5.1: who locked in is public, never the room or split.
          expect(Object.keys(e).sort(), e.type).toEqual(["player", "round", "type", "visibility"]);
        } else if (e.visibility.kind === "public" && e.type !== "gameEnded") {
          // Public events carry no per-player data (but the final ranking, design §8.6).
          expect(JSON.stringify(e), e.type).not.toMatch(/"(player|pocket|duffel|stash|seen|others|move)"/);
        }
      }
      const summary = resolved(s)[0];
      expect(Object.keys(summary ?? {}).sort()).toEqual(["bank", "honesty", "missing", "round", "taken", "type", "visibility"]);
    });
  }
});
