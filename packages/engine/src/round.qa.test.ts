// QA (PR #4): scripted full games, rejections, capacity, raids, determinism
// and private information for the round loop. design §5, §6, §7, §8
import { STARTER_ROLES } from "@skimjob/content";
import { handleThroughAlibis } from "./alibis.testkit";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState, Move } from "./types";
import { PUBLIC, canSee } from "./types";
import { setupEvents } from "./setup";
import { applyEvent, replay } from "./reduce";
import { actOfRound, isLastRoundOfAct } from "./round";
import { handleCommand } from "./handle";
import { V01_NUMBERS } from "./v01-numbers.testkit";

function config(players: number): GameConfig {
  return {
    seed: "qa-round",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [...STARTER_ROLES], // no Muscle, so no shakedown window (task 12)
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    contentOverrides: V01_NUMBERS, // scripted against content 0.1.0 numbers (balance pass 1)
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
const m = (room: string, pocket = 0, extra: Partial<Move> = {}): Move => ({ room, pocket, ...extra });

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

/** Bookkeeping that must hold for any game: loot = Haul + stashes, per round and in total. */
function checkLedger(s: GameState): void {
  for (const r of resolved(s)) {
    if (r.type !== "roundResolved") continue;
    const splits = ofType(s, "lootSplit").filter((e) => e.round === r.round);
    expect(splits).toHaveLength(s.playerOrder.length);
    expect(splits.reduce((n, e) => n + e.toHaul, 0), `round ${r.round}`).toBe(r.haulDelta);
    for (const e of splits) expect(e.toHaul + e.toStash).toBe(e.loot);
  }
  const loot = ofType(s, "lootSplit").reduce((n, e) => n + e.loot, 0);
  const kept = Object.values(s.players).reduce((n, p) => n + p.stash + p.safe, 0);
  expect(s.haul + kept).toBe(loot);
}

// ---------------------------------------------------------------- scripts
// Hand-calculated. Heat per round = round(4 + (20·Vault + 10·Manager − 20·Rooftop) ÷ crew), clamped 0–100. design §7

/** 3 players, all Rookies; p2 hands in the Lobby's 2 every round. Heat Δ = round(4 + 20·(V − R)/3). */
const ROOKIES: (Move | null)[][] = [
  [m("vault", 2), m("office"), m("lobby")], //                          haul +10, heat round(10.67) = 11 → 11
  [m("security", 0, { watch: "vault" }), m("vault", 6), m("lobby")], // haul +2,  +11 → 22
  [m("rooftop"), m("rooftop"), m("lobby")], //                          haul +2,  round(−9.33) = −9 → 13
  [m("lobby", 1), m("lobby", 2), m("lobby")], //                        haul +3,  +4 → 17
  [null, m("office", 4), m("lobby")], //     p0 defaults to Lobby:      haul +4,  +4 → 21
  [m("vault"), m("vault"), m("lobby")], //                              haul +14, round(17.33) = 17 → 38
  [m("vault", 3), m("vault", 3), m("lobby")], //                        haul +8,  +17 → 55
  [m("vault", 6), m("rooftop"), m("lobby")], //                         haul +2,  +4 → 59
  [m("office", 1), m("vault"), m("lobby")], //                          haul +11, +11 → 70
];

/** 3 players: Inside Man, Lookout, Fence. Heat Δ = round(4 + 20·(V − R)/3). */
const L = (room: string) => ({ ability: { kind: "lookout" as const, rooms: [room] } });
const F = (amount: number) => ({ ability: { kind: "fenceSafe" as const, amount } });
const THREE: (Move | null)[][] = [
  [m("vault"), m("office", 1, L("vault")), m("lobby", 2, F(5))], //          haul +9, +11 → 11; safe +2 (stash-capped)
  [m("vault"), m("vault", 6), m("vault", 6, F(3))], //                       haul +6, +24 → 35; safe +3 (act cap)
  [m("rooftop"), m("rooftop"), m("security", 0, { watch: "rooftop" })], //  haul 0,  −9 → 26
  [null, m("lobby", 2, L("lobby")), m("office", 4, F(5))], //                haul +2, +4 → 30; safe +5 (new act)
  [m("office"), m("office", 4), m("office", 4)], //                          haul +4, +4 → 34
  [m("vault"), m("vault"), m("vault")], //                                   haul +18, +24 → 58
  [m("vault"), m("rooftop"), m("rooftop")], //                               haul +6, −3 → 55
  [m("vault"), m("vault", 6), m("office", 0, F(5))], //                      haul +10, +17 → 72; safe +5
  [m("office"), m("security", 0, { watch: "vault" }), m("vault", 6)], //     haul +4, +11 → 83
];

/** 12 players, all Rookies; every room is in play. */
const row = (...groups: [number, Move | null][]): (Move | null)[] => groups.flatMap(([n, mv]) => Array<Move | null>(n).fill(mv));
const TWELVE: (Move | null)[][] = [
  // 3 Vault; 3 Deposit boxes (crowded → 3 each: two pocket 5→3, one pockets 2); 2 Manager's office pocket 1;
  // Teller pockets 3; Server room; Security watching Deposit boxes; Rooftop.
  // haul 18 + 1 + 8 = 27; heat round(4 + (60 + 20 − 20)/12) = 9 → 9
  [
    ...row([3, m("vault")], [2, m("depositBoxes", 5)], [1, m("depositBoxes", 2)], [2, m("managersOffice", 1)]),
    m("tellerLine", 3),
    m("serverRoom"),
    m("security", 0, { watch: "depositBoxes" }),
    m("rooftop"),
  ],
  row([2, m("depositBoxes", 5)], [10, m("lobby")]), //               exactly 2 → 5 each pocketed; haul +20, +4 → 13
  row([12, m("rooftop")]), //                                        −16, clamped → 0
  row([6, m("vault")], [6, m("office")]), //                         haul +60, +14 → 14
  row([12, null]), //                                                all default: haul +24, +4 → 18
  row([12, m("managersOffice", 5)]), //                              haul 0, +14 → 32
  [m("vault", 6), m("managersOffice"), ...row([10, m("tellerLine")])], // haul +35, 4 + 30/12 = 6.5 → 7 → 39
  row([3, m("depositBoxes")], [9, m("vault")]), //                   haul 9 + 54 = 63, +19 → 58
  [m("managersOffice"), ...row([5, m("rooftop")], [6, m("office")])], // haul +29, 4 − 90/12 = −3.5 → −3 → 55
];

describe("QA scripted full games — design §5, §6, §7", () => {
  it("3 Rookies: 9 rounds, Haul/Stash/Heat by hand", () => {
    let s = game(3);
    s = ok(s, submit("p0", m("office", 4))); // resubmitted below; the last one counts (§5.1)
    s = play(s, ROOKIES);
    expect(resolved(s).map((e) => e.type === "roundResolved" && e.haul)).toEqual([10, 12, 14, 17, 21, 35, 43, 45, 56]);
    expect(resolved(s).map((e) => e.type === "roundResolved" && e.heat)).toEqual([11, 22, 13, 17, 21, 38, 55, 59, 70]);
    expect([s.haul, s.heat]).toEqual([56, 70]);
    expect(stashes(s)).toEqual([13, 15, 0]);
    expect(s.phase).toEqual({ kind: "awaitingMeeting", act: 3 });
    expect(ofType(s, "defaultMoveAssigned").map((e) => [e.player, e.round])).toEqual([["p0", 5]]);
    expect(s.players.p0?.consecutiveMissedMoves).toBe(0); // reset by submitting in round 6
    expect(ofType(s, "roomWatched")).toMatchObject([{ player: "p0", round: 2, source: "security", room: "vault", seen: ["p1"] }]);
    checkLedger(s);
  });

  it("3 players (Inside Man, Lookout, Fence): 9 rounds, safe caps per act", () => {
    let s = play(game(3, ["insideMan", "lookout", "fence"]), THREE.slice(0, 1));
    // Round 2: 2 of the Fence's 5 already moved this act, so 5 is refused and 3 is fine.
    expect(handleThroughAlibis(s, submit("p2", m("vault", 6, F(5)))).ok).toBe(false);
    expect(handleThroughAlibis(s, submit("p0", m("vault", 1))).ok).toBe(false); // Inside Man can't pocket
    s = play(s, THREE.slice(1));
    expect(resolved(s).map((e) => e.type === "roundResolved" && e.haulDelta)).toEqual([9, 6, 0, 2, 4, 18, 6, 10, 4]);
    expect(resolved(s).map((e) => e.type === "roundResolved" && e.heat)).toEqual([11, 35, 26, 30, 34, 58, 55, 72, 83]);
    expect([s.haul, s.heat]).toEqual([59, 83]);
    expect(stashes(s)).toEqual([0, 19, 7]);
    expect(s.players.p2?.safe).toBe(15);
    expect(ofType(s, "abilityResolved").filter((e) => e.ability.kind === "fenceSafe").map((e) => e.ability.kind === "fenceSafe" && e.ability.amount)).toEqual([2, 3, 5, 5]);
    expect(ofType(s, "roomWatched").map((e) => [e.player, e.round, e.source, e.room, e.seen])).toEqual([
      ["p1", 1, "lookout", "vault", ["p0"]],
      ["p2", 3, "security", "rooftop", ["p0", "p1"]],
      ["p1", 4, "lookout", "lobby", ["p0"]],
      ["p1", 9, "security", "vault", ["p2"]],
    ]);
    checkLedger(s);
  });

  it("12 players: 9 rounds over every room, Deposit-box capacity, Heat halves and the 0 floor", () => {
    const s = play(game(12), TWELVE);
    expect(resolved(s).map((e) => e.type === "roundResolved" && e.haulDelta)).toEqual([27, 20, 0, 60, 24, 0, 35, 63, 29]);
    expect(resolved(s).map((e) => e.type === "roundResolved" && [e.heatDelta, e.heat])).toEqual([
      [9, 9], [4, 13], [-13, 0], [14, 14], [4, 18], [14, 32], [7, 39], [19, 58], [-3, 55],
    ]);
    expect(s.haul).toBe(258);
    expect(stashes(s)).toEqual([16, 10, 5, 8, 8, 7, 6, 6, 8, 5, 5, 5]);
    // Deposit boxes: 3 people → 3 each (pocket capped); exactly 2 → 5 each; 3 handing in → 3 each. design §6.2
    const boxes = ofType(s, "lootSplit").filter((e) => e.room === "depositBoxes").map((e) => [e.round, e.loot, e.toStash]);
    expect(boxes).toEqual([[1, 3, 3], [1, 3, 3], [1, 3, 2], [2, 5, 5], [2, 5, 5], [8, 3, 0], [8, 3, 0], [8, 3, 0]]);
    expect(ofType(s, "pocketCount")).toMatchObject([{ player: "p9", round: 1, pocketed: 6 }]);
    expect(ofType(s, "roomWatched")).toMatchObject([{ player: "p10", room: "depositBoxes", seen: ["p3", "p4", "p5"] }]);
    expect(ofType(s, "defaultMoveAssigned")).toHaveLength(12);
    expect(Object.values(s.players).every((p) => p.consecutiveMissedMoves === 0)).toBe(true);
    checkLedger(s);
  });
});

describe("QA resubmitting a move — design §5.1", () => {
  it("a new move replaces the old one entirely: Security watch and Fence safe don't linger", () => {
    let s = game(3, ["rookie", "fence"]);
    s = ok(s, submit("p0", m("security", 0, { watch: "vault" })));
    s = ok(s, submit("p1", m("vault", 6, F(5))));
    s = ok(s, submit("p0", m("vault", 6)));
    s = ok(s, submit("p1", m("vault", 6)));
    expect(s.moves).toEqual({ p0: { room: "vault", pocket: 6 }, p1: { room: "vault", pocket: 6 } });
    s = ok(s, ROUND);
    expect(ofType(s, "roomWatched")).toEqual([]);
    expect(ofType(s, "abilityResolved")).toEqual([]);
    expect(s.players.p1).toMatchObject({ stash: 6, safe: 0 });
  });

  it("a rejected resubmission keeps the earlier move", () => {
    let s = ok(game(3), submit("p0", m("office", 3)));
    expect(handleThroughAlibis(s, submit("p0", m("office", 5))).ok).toBe(false);
    s = ok(s, ROUND);
    expect(ofType(s, "lootSplit").find((e) => e.player === "p0")).toMatchObject({ room: "office", toStash: 3 });
  });
});

describe("QA rejected commands leave state unchanged", () => {
  // Mid-round, with a move already in, on a frozen state: any mutation would throw.
  const base = deepFreeze(ok(game(3, ["insideMan", "lookout", "fence"]), submit("p1", m("office", 2))));
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
    ["pocket in a 0-loot room", submit("p1", m("security", 1, { watch: "vault" }))],
    ["pocket in the Rooftop", submit("p1", m("rooftop", 1))],
    ["missing pocket", submit("p1", { room: "lobby" })],
    ["null pocket", submit("p1", { room: "lobby", pocket: null })],
    ["NaN pocket", submit("p1", m("lobby", Number.NaN))],
    ["negative fractional pocket", submit("p1", m("lobby", -0.5))],
    ["Security watching an unknown room", submit("p1", m("security", 0, { watch: "kitchen" }))],
    ["Inside Man pockets 1", submit("p0", m("vault", 1))],
    ["Inside Man uses the Lookout's power", submit("p0", m("vault", 0, L("office")))],
    ["Lookout watches no rooms", submit("p1", m("lobby", 0, { ability: { kind: "lookout", rooms: [] } }))],
    ["Lookout watches 2 rooms", submit("p1", m("lobby", 0, { ability: { kind: "lookout", rooms: ["vault", "office"] } }))],
    ["Lookout watches a closed room", submit("p1", m("lobby", 0, L("depositBoxes")))],
    ["Lookout rooms not an array", submit("p1", m("lobby", 0, { ability: { kind: "lookout", rooms: "vault" } as never }))],
    ["Fence safe 0", submit("p2", m("lobby", 0, F(0)))],
    ["Fence safe 6", submit("p2", m("lobby", 0, F(6)))],
    ["Fence safe 2.5", submit("p2", m("lobby", 0, F(2.5)))],
    ["Fence safe NaN", submit("p2", m("lobby", 0, F(Number.NaN)))],
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

describe("QA Heat raid — design §5.2 step 6, §7", () => {
  it("3 players reach exactly 100 in round 5 by play: raid, game over, Haul still banked", () => {
    const vault = [m("vault"), m("vault"), m("vault")]; // all three in the Vault: 4 + 20 = +24
    const s = play(game(3), [vault, vault, vault, vault, [m("lobby"), m("lobby"), m("lobby")]]);
    expect(resolved(s).map((e) => e.type === "roundResolved" && e.heat)).toEqual([24, 48, 72, 96, 100]);
    expect(s.log.slice(-3).map((e) => e.type)).toEqual(["roundResolved", "copsRaided", "gameEnded"]);
    expect(s.log.at(-2)).toMatchObject({ type: "copsRaided", round: 5, heat: 100 });
    expect(s.phase).toMatchObject({ kind: "ended", outcome: { result: "failed", reason: "heat" } });
    expect(s.haul).toBe(78); // 4 × 18 from the Vault + 3 × 2 from the Lobby
    expect(replay(s.config, s.log)).toEqual(s);
    for (const c of [submit("p0", m("lobby")), ROUND(s)]) expect(handleThroughAlibis(s, c).ok).toBe(false);
  });

  it("a raid on an act's last round ends the game instead of waiting for the meeting", () => {
    const vault = [m("vault"), m("vault"), m("vault")];
    const s = play({ ...game(3), heat: 28 }, [vault, vault, vault]); // 52, 76, 100
    expect(isLastRoundOfAct(3)).toBe(true);
    expect(s.heat).toBe(100);
    expect(s.phase.kind).toBe("ended");
    expect(ofType(s, "roundStarted").map((e) => e.round)).toEqual([1, 2, 3]);
  });

  it("12 players at 99 with a Rooftop crowd don't raid; with Vault pressure they do", () => {
    const cool = play({ ...game(12), heat: 99 }, [row([3, m("rooftop")], [9, null])]); // 4 − 5 = −1 → 98
    expect(cool.heat).toBe(98);
    expect(cool.phase.kind).toBe("planning");
    const hot = play({ ...game(12), heat: 99 }, [row([12, null])]); // +4 → clamped 100
    expect(hot.heat).toBe(100);
    expect(hot.phase.kind).toBe("ended");
  });
});

describe("QA determinism — design §17.2", () => {
  for (const [n, script, roles] of [
    [3, ROOKIES, []],
    [3, THREE, ["insideMan", "lookout", "fence"]],
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

describe("QA private information — design §5.2 step 5, §17.2", () => {
  const PRIVATE = new Set(["moveSubmitted", "defaultMoveAssigned", "lootSplit", "abilityResolved", "roomSighting", "roomWatched", "pocketCount", "roleDealt"]);
  const games = [
    play(game(3), ROOKIES),
    play(game(3, ["insideMan", "lookout", "fence"]), THREE),
    play(game(12), TWELVE),
  ];
  for (const s of games) {
    it(`${s.playerOrder.length} players: splits, sightings and watch results are visible only to their own player`, () => {
      for (const e of s.log) {
        if (PRIVATE.has(e.type)) {
          const owner = (e as { player: string }).player;
          expect(e.visibility, e.type).toEqual({ kind: "private", player: owner });
          for (const viewer of s.playerOrder) expect(canSee(e.visibility, viewer, false)).toBe(viewer === owner);
        } else if (e.type === "moveLocked") {
          // Owner decision (2 Nov), design §5.1: who locked in is public, never the room or split.
          expect(Object.keys(e).sort(), e.type).toEqual(["player", "round", "type", "visibility"]);
        } else if (e.visibility.kind === "public") {
          // Public events carry no per-player data.
          expect(JSON.stringify(e), e.type).not.toMatch(/"(player|pocket|toStash|stash|seen|others|move)"/);
        }
      }
      const summary = resolved(s)[0];
      expect(Object.keys(summary ?? {}).sort()).toEqual(["haul", "haulDelta", "heat", "heatDelta", "heatParts", "round", "type", "visibility"]);
    });
  }
});
