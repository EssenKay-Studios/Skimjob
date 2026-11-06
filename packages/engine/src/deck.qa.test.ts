// QA (PR #14): adversarial tests for the events deck — boundaries, card
// interactions, deck exhaustion, and determinism. design §10
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { V06_NUMBERS } from "./v01-numbers.testkit";
import type { RoomId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { PUBLIC } from "./types";
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
    rolePool: ["rookie", "lookout", "hacker", "priest"],
    eventsEnabled: true,
    voteVisibility: "open",
    ...extra,
  };
}

/** A new game, seat i dealt roles[i] (Rookie if missing). */
function game(players: number, roles: string[] = [], extra: Partial<GameConfig> = {}): GameState {
  // Pin the 0.6.0 card numbers (balance pass 2 changed them); an extra override still wins.
  const cfg = config(players, { ...extra, contentOverrides: { ...V06_NUMBERS, ...extra.contentOverrides } });
  let seat = 0;
  const log = setupEvents(cfg)
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
  while (start > 0 && s.log[start - 1]?.type !== "moveSubmitted" && s.log[start - 1]?.type !== "eventFlipped") start--;
  return s.log.slice(start, end + 1);
}

/** Replace the current round's card by rewriting the log and replaying it. */
function withCard(state: GameState, card: string, room: RoomId | null = null): GameState {
  const log = [...state.log];
  let i = log.length - 1;
  while (i >= 0 && log[i]?.type !== "eventFlipped") i--;
  if (i < 0) throw new Error("no card flipped");
  log.splice(i, 1, { type: "eventFlipped", visibility: PUBLIC, round: state.round, card, room });
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
    const s = resolve(base, { p0: { room: "depositBoxes", pocket: 5 }, p1: { room: "managersOffice", pocket: 3 } });
    // round(4 + (10 + 10)/12) = 6.
    expect(s.heat - h0).toBe(6);
    expect(refused(base, move("p0", "depositBoxes", 6))).toBe(true);
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

  it("the drawn closed room is never the Lobby at 3, 5 and 12 players", () => {
    for (const n of [3, 5, 12]) {
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
    const base = withCard(resolve(game(6, ["priest"])), "audit");
    const s = resolve(base, {
      p0: { room: "vault", pocket: 0 }, // hands in all 6
      p1: { room: "depositBoxes", pocket: 5 },
      p2: { room: "depositBoxes", pocket: 5 },
      p3: { room: "depositBoxes", pocket: 1 },
      p4: { room: "serverRoom", pocket: 0 },
    });
    const events = lastResolution(s);
    const audit = find(events, "auditReport")[0];
    const splits = find(events, "lootSplit");
    expect(Object.keys(audit?.shortfalls ?? {}).sort()).toEqual([...s.rooms].sort());
    // Three in the Deposit boxes (max 2) yield 4 each (R5; was 3): kept 4 + 4 + 1.
    expect(audit?.shortfalls).toMatchObject({ vault: 0, depositBoxes: 9, office: 0, serverRoom: 0 });
    const kept = splits.reduce((n, e) => n + e.toStash, 0);
    expect(Object.values(audit?.shortfalls ?? {}).reduce((a, b) => a + b, 0)).toBe(kept);
    expect(kept + roundResolved(s).haulDelta).toBe(splits.reduce((n, e) => n + e.loot, 0));
  });
});

describe("QA: Inside tip — design §10", () => {
  it("the tip is about another player and shows that player's real role", () => {
    const s = resolve(withCard(resolve(game(3, ["lookout", "hacker", "rookie"])), "insideTip"));
    const tip = find(lastResolution(s), "insideTip")[0];
    expect(tip?.subject).not.toBe(tip?.player);
    expect(tip?.role).toBe(s.players[tip?.subject as PlayerId]?.role);
  });
});

describe("QA: when the deck is on — design §10, §8.1", () => {
  it("round 1 never has a card; events off flips nothing over a whole game", () => {
    const g = createGame(config(4));
    expect(g.card).toBeNull();
    expect(viewFor(g, "p0").card).toBeNull();
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
  it("same seed + same commands → identical log; replaying the log rebuilds the same state (with a pocket and a tip)", () => {
    const play = () => {
      let s = createGame(config(4, { seed: "det-qa" }));
      s = resolve(s, { p0: { room: "office", pocket: 3 } });
      s = resolve(withCard(s, "insideTip"));
      return playThrough(s);
    };
    const a = play();
    const b = play();
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    expect(find(a.log, "insideTip").length).toBeGreaterThan(0);
    expect(JSON.stringify(replay(a.config, a.log))).toBe(JSON.stringify(a));
  });
});
