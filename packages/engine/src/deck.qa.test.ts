// QA (PR #14): adversarial tests for the events deck — boundaries, card
// interactions, deck exhaustion, determinism and Double-cross leaks. design §10
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { V06_NUMBERS } from "./v01-numbers.testkit";
import type { RoomId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { PUBLIC, privateTo } from "./types";
import { createGame, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { closedRoom } from "./deck";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "deck-qa",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: ["rookie", "lookout", "fence", "insideMan"],
    mole: "off",
    eventsEnabled: true,
    voteVisibility: "open",
    starterMode: false,
    ...extra,
  };
}

/** A new game, seat i dealt roles[i] (Rookie if missing). */
function game(players: number, roles: string[] = [], extra: Partial<GameConfig> = {}): GameState {
  // Pin the 0.6.0 card numbers (balance pass 2 changed them); an extra override still wins.
  const cfg = config(players, { ...extra, contentOverrides: { ...V06_NUMBERS, ...extra.contentOverrides } });
  let seat = 0;
  const log = setupEvents(cfg)
    .filter((e) => e.type !== "snitchTargetAssigned" && e.type !== "moleAllies")
    .map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "rookie" } : e));
  return replay(cfg, log);
}

function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}

const move = (player: PlayerId, room: RoomId, pocket = 0, rest: Record<string, unknown> = {}) => ({ type: "submitMove", player, move: { room, pocket, ...rest } });
const answer = (player: PlayerId, accept: boolean) => ({ type: "answerDoubleCross", player, accept });
const refused = (s: GameState, c: unknown) => !handleThroughAlibis(s, c).ok;

/** Everyone not in `moves` goes to the Office (Lobby if the Office is closed); `skip` players submit nothing. */
function resolve(state: GameState, moves: Record<PlayerId, Record<string, unknown>> = {}, skip: PlayerId[] = []): GameState {
  let s = state;
  for (const id of s.playerOrder) {
    if (skip.includes(id)) continue;
    s = run(s, { type: "submitMove", player: id, move: moves[id] ?? { room: closedRoom(s) === "office" ? "lobby" : "office", pocket: 0 } });
  }
  return run(s, { type: "advance", deadline: { kind: "round", round: s.round } });
}

/** The events of the latest round's resolution. */
function lastResolution(s: GameState): GameEvent[] {
  let end = s.log.length - 1;
  while (s.log[end]?.type !== "roundResolved") end--;
  let start = end;
  while (start > 0 && s.log[start - 1]?.type !== "moveSubmitted" && s.log[start - 1]?.type !== "eventFlipped" && s.log[start - 1]?.type !== "doubleCrossAnswered") start--;
  return s.log.slice(start, end + 1);
}

/** Replace the current round's card (and offers) by rewriting the log and replaying it. */
function withCard(state: GameState, card: string, room: RoomId | null = null, pair?: [PlayerId, PlayerId]): GameState {
  const log = [...state.log];
  let i = log.length - 1;
  while (i >= 0 && log[i]?.type !== "eventFlipped") i--;
  if (i < 0) throw new Error("no card flipped");
  let j = i + 1;
  while (log[j]?.type === "doubleCrossOffered") j++;
  const round = state.round;
  const added: GameEvent[] = [{ type: "eventFlipped", visibility: PUBLIC, round, card, room }];
  if (pair) {
    const [a, b] = pair;
    added.push({ type: "doubleCrossOffered", visibility: privateTo(a), player: a, round, partner: b });
    added.push({ type: "doubleCrossOffered", visibility: privateTo(b), player: b, round, partner: a });
  }
  log.splice(i, j - i, ...added);
  return replay(state.config, log);
}

function step(s: GameState): GameState {
  if (s.phase.kind === "planning") return resolve(s);
  if (s.phase.kind !== "awaitingMeeting") throw new Error(`unexpected phase ${s.phase.kind}`);
  const { act } = s.phase;
  return run(
    s,
    { type: "scheduleMeeting", act, slot: `slot-${act}` },
    { type: "advance", deadline: { kind: "openMeeting", meetingId: `act-${act}` } },
    { type: "advance", deadline: { kind: "closeMeeting", meetingId: `act-${act}` } },
  );
}

function playThrough(s: GameState): GameState {
  while (s.phase.kind !== "ended") s = step(s);
  return s;
}

const find = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const roundResolved = (s: GameState) => find(lastResolution(s), "roundResolved")[0] as Extract<GameEvent, { type: "roundResolved" }>;

describe("QA: Heat cards at the boundary — design §10, §7", () => {
  // perRound 45: Heat 45 after round 1, 90 after a plain round 2. 5 players, so card Heat is unscaled (design §10).
  const hot = (seed = "hot") => resolve(game(5, [], { seed, contentOverrides: { heat: { perRound: 45 } } }));

  it("Police patrol taking Heat to exactly 100 raids the crew; without it the round ends at 90", () => {
    const s = resolve(withCard(hot(), "policePatrol"));
    expect(s.heat).toBe(100);
    expect(s.phase).toMatchObject({ kind: "ended" });
    expect(find(s.log, "copsRaided")).toEqual([{ type: "copsRaided", visibility: PUBLIC, round: 2, heat: 100 }]);
    const plain = resolve(withCard(hot(), "audit"));
    expect(plain.heat).toBe(90);
    expect(plain.phase.kind).not.toBe("ended");
  });

  it("Quiet night is part of the same round's Heat (90 − 10 = 80), not a separate step", () => {
    const s = resolve(withCard(hot(), "quietNight"));
    expect(s.heat).toBe(80);
    expect(roundResolved(s)).toMatchObject({ heatDelta: 35, heat: 80 });
  });
});

describe("QA: room surges — design §10", () => {
  // design §10: at 3 players the surge's extra Heat is scaled by 3/5, so the Vault's ×2 pressure is ×1.6 (32 per visitor).
  it("Shift change: two of three in the Vault → Heat round(4 + 2·32/3) = 25 (15 for one); 12 accepted, 13 refused; next round back to 6", () => {
    const base = withCard(resolve(game(3)), "shiftChange");
    expect(refused(base, move("p0", "vault", 13))).toBe(true);
    const h0 = base.heat;
    const two = resolve(base, { p0: { room: "vault", pocket: 12 }, p1: { room: "vault", pocket: 0 } });
    expect(two.heat - h0).toBe(25);
    expect(find(lastResolution(two), "lootSplit").filter((e) => e.room === "vault").map((e) => e.loot)).toEqual([12, 12]);
    const one = resolve(base, { p0: { room: "vault", pocket: 0 } });
    expect(one.heat - h0).toBe(15);
    // The card is gone next round: with another card the Vault is back to 6.
    expect(refused(withCard(two, "audit"), move("p0", "vault", 7))).toBe(true);
  });

  it("Shift change leaves the Deposit boxes and Manager's office alone (12 players)", () => {
    const base = withCard(resolve(game(12)), "shiftChange");
    const h0 = base.heat;
    const s = resolve(base, { p0: { room: "depositBoxes", pocket: 5 }, p1: { room: "managersOffice", pocket: 4 } });
    // round(4 + (10 + 10)/12) = 6.
    expect(s.heat - h0).toBe(6);
    expect(refused(base, move("p0", "depositBoxes", 6))).toBe(true);
  });

  it("Payday: pocket 4 in the Lobby accepted, 5 refused; Heat unchanged; a missed move lands in the Lobby and hands in 4", () => {
    const base = withCard(resolve(game(3)), "payday");
    expect(refused(base, move("p0", "lobby", 5))).toBe(true);
    const h0 = base.heat;
    const s = resolve(base, { p0: { room: "lobby", pocket: 4 } }, ["p2"]);
    expect(s.heat - h0).toBe(4);
    expect(find(lastResolution(s), "lootSplit").find((e) => e.player === "p2")).toMatchObject({ room: "lobby", loot: 4, toHaul: 4 });
  });
});

describe("QA: Lockdown vs moves — design §10", () => {
  it("at 12 players every non-Lobby room can be closed: the move is refused, watching/looking at it is allowed, it reopens next round", () => {
    const at2 = resolve(game(12, ["lookout"]));
    for (const room of at2.rooms.filter((r) => r !== "lobby")) {
      const s = withCard(at2, "lockdown", room);
      expect(refused(s, move("p1", room)), room).toBe(true);
      if (room !== "security") expect(refused(s, move("p1", "security", 0, { watch: room })), room).toBe(false);
      if (room !== "office") expect(refused(s, move("p0", "office", 0, { ability: { kind: "lookout", rooms: [room] } })), room).toBe(false);
    }
    const after = resolve(withCard(at2, "lockdown", "vault"));
    expect(refused(after, move("p1", "vault"))).toBe(false);
  });

  it("a refused move to the closed room doesn't replace an earlier valid move", () => {
    const s = run(withCard(resolve(game(3)), "lockdown", "vault"), move("p0", "office", 3));
    expect(refused(s, move("p0", "vault", 6))).toBe(true);
    const done = resolve(s, {}, ["p0"]);
    expect(find(lastResolution(done), "lootSplit").find((e) => e.player === "p0")).toMatchObject({ room: "office", toStash: 3 });
  });

  it("the drawn closed room is never the Lobby at 2, 5 and 12 players", () => {
    for (const n of [2, 5, 12]) {
      for (let i = 0; i < 25; i++) {
        let g = createGame(config(n, { seed: `lock-qa-${n}-${i}` }));
        while (g.phase.kind !== "ended" && g.card?.id !== "lockdown") g = step(g);
        if (g.card?.id === "lockdown") expect(g.card.room).not.toBe("lobby");
      }
    }
  });
});

describe("QA: Audit numbers — design §10", () => {
  it("crowded Deposit boxes: shortfalls are what was actually kept; they sum to the pockets, and pockets + Haul = loot", () => {
    const base = withCard(resolve(game(6, ["insideMan"])), "audit");
    const s = resolve(base, {
      p0: { room: "vault", pocket: 0 }, // Inside Man: hands in all 6
      p1: { room: "depositBoxes", pocket: 5 },
      p2: { room: "depositBoxes", pocket: 5 },
      p3: { room: "depositBoxes", pocket: 1 },
      p4: { room: "serverRoom", pocket: 0 },
    });
    const events = lastResolution(s);
    const audit = find(events, "auditReport")[0];
    const splits = find(events, "lootSplit");
    expect(Object.keys(audit?.shortfalls ?? {}).sort()).toEqual([...s.rooms].sort());
    // Three in the Deposit boxes (max 2) yield 3 each: kept 3 + 3 + 1.
    expect(audit?.shortfalls).toMatchObject({ vault: 0, depositBoxes: 7, office: 0, serverRoom: 0 });
    const kept = splits.reduce((n, e) => n + e.toStash, 0);
    expect(Object.values(audit?.shortfalls ?? {}).reduce((a, b) => a + b, 0)).toBe(kept);
    expect(kept + roundResolved(s).haulDelta).toBe(splits.reduce((n, e) => n + e.loot, 0));
  });
});

describe("QA: Raid rumour edges — design §10", () => {
  it("a top stash of 1 loses 1 (to 0) before this round's pocket; the loss is not in the Haul; a bigger safe doesn't count", () => {
    const r1 = resolve(game(3, ["fence"]), { p0: { room: "office", pocket: 4, ability: { kind: "fenceSafe", amount: 4 } }, p1: { room: "lobby", pocket: 1 } });
    const moves = { p1: { room: "office", pocket: 2 } };
    const hit = resolve(withCard(r1, "raidRumour"), moves);
    const control = resolve(withCard(r1, "audit"), moves);
    expect(find(lastResolution(hit), "raidRumourHit")).toEqual([{ type: "raidRumourHit", visibility: privateTo("p1"), player: "p1", round: 2, lost: 1 }]);
    expect(hit.players.p1?.stash).toBe(2);
    expect(control.players.p1?.stash).toBe(3);
    expect(hit.haul).toBe(control.haul);
    expect(hit.players.p0?.safe).toBe(4);
  });

  it("a tie is broken at random, not by seat: over seeds both tied players get hit", () => {
    const hitPlayers = new Set<PlayerId>();
    for (let i = 0; i < 20; i++) {
      const r1 = resolve(game(3, [], { seed: `tie-${i}` }), { p1: { room: "office", pocket: 2 }, p2: { room: "office", pocket: 2 } });
      const hits = find(lastResolution(resolve(withCard(r1, "raidRumour"))), "raidRumourHit");
      expect(hits).toHaveLength(1);
      expect(hits[0]?.lost).toBe(2);
      hitPlayers.add(hits[0]?.player as PlayerId);
    }
    expect([...hitPlayers].sort()).toEqual(["p1", "p2"]);
  });
});

describe("QA: Inside tip — design §10", () => {
  it("at 2 players the tip is about the other player, and shows a role swapped by an earlier Double-cross", () => {
    const r2 = run(withCard(resolve(game(2, ["lookout", "fence"])), "doubleCross", null, ["p0", "p1"]), answer("p0", true), answer("p1", true));
    const s = resolve(withCard(resolve(r2), "insideTip"));
    const tip = find(lastResolution(s), "insideTip")[0];
    expect(tip?.subject).not.toBe(tip?.player);
    expect(tip?.role).toBe(tip?.subject === "p0" ? "fence" : "lookout");
  });
});

describe("QA: Double-cross answers — design §10", () => {
  const offered = () => withCard(resolve(game(4, ["lookout", "fence", "rookie", "rookie"])), "doubleCross", null, ["p0", "p1"]);
  const roles = (s: GameState) => [s.players.p0?.role, s.players.p1?.role];

  it("one-sided either way, or accept-then-decline, swaps nothing; decline-then-accept by both swaps", () => {
    for (const answers of [[answer("p0", true), answer("p1", false)], [answer("p1", true)], [answer("p0", true), answer("p1", true), answer("p0", false)]]) {
      expect(roles(resolve(run(offered(), ...answers)))).toEqual(["lookout", "fence"]);
    }
    expect(roles(resolve(run(offered(), answer("p0", false), answer("p1", false), answer("p0", true), answer("p1", true))))).toEqual(["fence", "lookout"]);
  });

  it("an answer is refused in round 1, during a meeting, and from an unknown player", () => {
    expect(refused(game(4), answer("p0", true))).toBe(true);
    expect(refused(offered(), answer("nobody", true))).toBe(true);
    let s = createGame(config(3));
    while (s.phase.kind === "planning") s = resolve(s);
    expect(s.phase.kind).toBe("awaitingMeeting");
    expect(refused(s, answer("p0", true))).toBe(true);
  });
});

describe("QA: Power cut vs info rooms and powers — design §10", () => {
  it("6 players: no Security / Lookout / room-mate results; the Hacker's and Lookout's uses are recorded; the Server room still counts pockets", () => {
    const base = withCard(resolve(game(6, ["lookout", "hacker"], { rolePool: ["lookout", "hacker", "rookie"] })), "powerCut");
    const s = resolve(base, {
      p0: { room: "office", pocket: 1, ability: { kind: "lookout", rooms: ["vault"] } },
      p1: { room: "office", pocket: 0, ability: { kind: "loopCameras", room: "vault" } },
      p2: { room: "security", pocket: 0, watch: "office" },
      p3: { room: "serverRoom", pocket: 0 },
      p4: { room: "vault", pocket: 2 },
    });
    const events = lastResolution(s);
    expect(events.filter((e) => e.type === "roomSighting" || e.type === "roomWatched")).toEqual([]);
    expect(find(events, "abilityResolved").map((e) => e.player).sort()).toEqual(["p0", "p1"]);
    // Pocketed: p0 (1), p4 (2), p5 (Office, 0) → 2 players.
    expect(find(events, "pocketCount")).toEqual([{ type: "pocketCount", visibility: privateTo("p3"), player: "p3", round: 2, pocketed: 2 }]);
  });
});

describe("QA: when the deck is on — design §10, §8.1", () => {
  it("round 1 never has a card; starter + events is refused; events off flips nothing over a whole game", () => {
    const g = createGame(config(4));
    expect(g.card).toBeNull();
    expect(viewFor(g, "p0").card).toBeNull();
    expect(validateConfig({ ...config(4), starterMode: true, rolePool: [] }).some((e) => /event/i.test(e))).toBe(true);
    const off = playThrough(createGame(config(4, { eventsEnabled: false })));
    expect(find(off.log, "eventFlipped")).toEqual([]);
    expect(off.cardsFlipped).toEqual([]);
  });

  it("over 9 rounds: one card per round 2..9 from the full deck (repeats allowed, owner answers 1 Nov), right after each roundStarted (3 and 12 players)", () => {
    let repeats = 0;
    for (const n of [3, 12]) {
      for (let i = 0; i < 8; i++) {
        const end = playThrough(createGame(config(n, { seed: `exhaust-${n}-${i}` })));
        const flips = find(end.log, "eventFlipped");
        expect(flips.map((f) => f.round)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
        if (new Set(flips.map((f) => f.card)).size < 8) repeats++;
        for (const f of flips) {
          const at = end.log.indexOf(f);
          expect(end.log[at - 1]).toMatchObject({ type: "roundStarted", round: f.round });
        }
      }
    }
    expect(repeats).toBeGreaterThan(0);
  });
});

describe("QA: determinism and event sourcing — design §17.2", () => {
  it("same seed + same commands → identical log; replaying the log rebuilds the same state (with a swap and a raid)", () => {
    const play = () => {
      let s = createGame(config(4, { seed: "det-qa" }));
      s = resolve(s, { p0: { room: "office", pocket: 3 } });
      s = resolve(run(withCard(s, "doubleCross", null, ["p0", "p1"]), answer("p0", true), answer("p1", true)));
      s = resolve(withCard(s, "raidRumour"));
      return playThrough(s);
    };
    const a = play();
    const b = play();
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    expect(find(a.log, "raidRumourHit")).toHaveLength(1);
    expect(JSON.stringify(replay(a.config, a.log))).toBe(JSON.stringify(a));
  });
});

describe("QA: Double-cross view-diff leaks — design §10, §13", () => {
  const base = () => withCard(resolve(game(4, ["lookout", "fence", "rookie", "rookie"])), "doubleCross", null, ["p0", "p1"]);
  const combos: [boolean, boolean][] = [[true, true], [true, false], [false, true], [false, false]];
  const v = (s: GameState, id: PlayerId) => JSON.stringify(viewFor(s, id));

  it("outsiders' views are identical for all four answer combinations, before and after the round resolves", () => {
    const planned = combos.map(([a, b]) => run(base(), answer("p0", a), answer("p1", b)));
    const done = planned.map((s) => resolve(s));
    for (const id of ["p2", "p3"]) {
      for (const s of [planned, done]) expect(new Set(s.map((x) => v(x, id))).size, id).toBe(1);
    }
    expect(viewFor(planned[0] as GameState, "p2").card).toEqual({ round: 2, id: "doubleCross", room: null });
  });

  it("a player who declined can't tell, even after the round, whether the partner accepted", () => {
    const declinedP1 = (p0: boolean) => resolve(run(base(), answer("p0", p0), answer("p1", false)));
    expect(v(declinedP1(true), "p1")).toBe(v(declinedP1(false), "p1"));
    // Same for p0. (The end-of-game reveal shows answers: decided in docs/decisions.md.)
    const declinedP0 = (p1: boolean) => resolve(run(base(), answer("p0", false), answer("p1", p1)));
    expect(v(declinedP0(true), "p0")).toBe(v(declinedP0(false), "p0"));
  });
});
