// QA (PR #14): adversarial tests for the events deck — boundaries, card
// interactions, repeats, and determinism. design §13
import { describe, expect, it } from "vitest";
import { NO_RAIDS } from "./v01-numbers.testkit";
import { handleThroughResult } from "./result.testkit";
import type { RoomId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { PUBLIC } from "./types";
import { createGame, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { closedRoom } from "./deck";
import { fullGrab } from "./grab.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "deck-qa",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: true,
    voteVisibility: "open",
    // Bells too big to raid: these scripts test other rules (bells and raids: bells.test.ts).
    contentOverrides: NO_RAIDS,
    ...extra,
  };
}

/** A new game, seat i dealt roles[i] (a Lookout if missing: its power acts only when used). */
function game(players: number, roles: string[] = [], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  let seat = 0;
  const log = setupEvents(cfg)
    .map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "lookout" } : e));
  return replay(cfg, log);
}

function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughResult(s, c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}

const move = (player: PlayerId, room: RoomId, pocket = 0, rest: Record<string, unknown> = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, pocket), ...rest } });
const refused = (s: GameState, c: unknown) => !handleThroughResult(s, c).ok;

/** Everyone not in `moves` goes to the Office (Lobby if the Office is closed); `skip` players submit nothing. */
function resolve(state: GameState, moves: Record<PlayerId, Record<string, unknown>> = {}, skip: PlayerId[] = []): GameState {
  let s = state;
  for (const id of s.playerOrder) {
    if (skip.includes(id)) continue;
    s = run(s, { type: "submitMove", player: id, move: moves[id] ?? fullGrab(closedRoom(s) === "office" ? "lobby" : "office") });
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

/** This round's card set to `card` (any card the round flipped removed), by rewriting the log and replaying it. */
function withCard(state: GameState, card: string, room: RoomId | null = null): GameState {
  const at = state.log.map((e) => e.type).lastIndexOf("roundStarted");
  const rest = state.log.slice(at + 1).filter((e) => e.type !== "eventFlipped" && e.type !== "insideTip");
  const flipped: GameEvent = { type: "eventFlipped", visibility: PUBLIC, round: state.round, card, room };
  return replay(state.config, [...state.log.slice(0, at + 1), flipped, ...rest]);
}

function step(s: GameState): GameState {
  if (s.phase.kind === "planning") return resolve(s);
  if (s.phase.kind !== "awaitingMeeting") throw new Error(`unexpected phase ${s.phase.kind}`);
  // design §9.1, §9.2: the meeting the round called, nobody voting; then its result window closes (§9.3).
  const { meetingId } = s.phase;
  s = run(
    s,
    { type: "scheduleMeeting", meetingId, slot: `slot-${meetingId}` },
    { type: "advance", deadline: { kind: "openMeeting", meetingId } },
    { type: "advance", deadline: { kind: "closeMeeting", meetingId } },
  );
  return s.phase.kind === "result" ? run(s, { type: "advance", deadline: { kind: "result", round: s.resolvedRound } }) : s;
}

function playThrough(s: GameState): GameState {
  while (s.phase.kind !== "ended") s = step(s);
  return s;
}

const find = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const roundResolved = (s: GameState) => find(lastResolution(s), "roundResolved")[0] as Extract<GameEvent, { type: "roundResolved" }>;

describe("QA: room surges — design §13", () => {
  // design §13, §5.2, §5.3: Shift change's extra Vault coin rings like the rest.
  it("Shift change: two of three grab 4 in the Vault → 8 rings, a raid seizing all 8; one coin lights one bulb; 4 coins accepted, 5 refused; next round back to 3", () => {
    const grab = (n: number) => ({ room: "vault", duffel: 0, pocket: n });
    const base = withCard(resolve(game(3, [], { contentOverrides: null }), { p0: fullGrab("lobby"), p1: fullGrab("lobby"), p2: fullGrab("lobby") }), "shiftChange");
    expect(refused(base, { type: "submitMove", player: "p0", move: grab(5) })).toBe(true);
    const two = resolve(base, { p0: grab(4), p1: { room: "vault", duffel: 4, pocket: 0 } });
    expect(find(lastResolution(two), "coinsGrabbed").filter((e) => e.room === "vault").map((e) => e.seized)).toEqual([4, 4]);
    expect(find(lastResolution(two), "roomRaided")).toMatchObject([{ room: "vault", seized: 8, wanted: 1 }]);
    const one = resolve(base, { p0: { room: "vault", duffel: 1, pocket: 0 } });
    expect(find(lastResolution(one), "bellsRung")[0]?.bells.vault).toBe(1);
    // The card is gone next round: with another card the Vault is back to 3.
    expect(refused(withCard(two, "audit"), { type: "submitMove", player: "p0", move: grab(4) })).toBe(true);
  });

  it("Shift change leaves the Deposit boxes and Manager's office alone (12 players)", () => {
    const base = withCard(resolve(game(12)), "shiftChange");
    expect(refused(base, move("p0", "depositBoxes", 3))).toBe(true);
    expect(refused(base, move("p0", "managersOffice", 3))).toBe(true);
  });
});

describe("QA: Lockdown vs moves — design §13", () => {
  it("at 12 players every room but the Lobby and the Rooftop can be closed: the move is refused, watching/looking at it is allowed, it reopens next round", () => {
    const at2 = resolve(game(12, ["lookout"]));
    for (const room of at2.rooms.filter((r) => r !== "lobby" && r !== "rooftop")) {
      const s = withCard(at2, "lockdown", room);
      expect(refused(s, move("p1", room)), room).toBe(true);
      if (room !== "security") expect(refused(s, move("p1", "security", 0, { watch: room })), room).toBe(false);
      if (room !== "office") expect(refused(s, move("p0", "office", 0, { ability: { kind: "lookout", rooms: [room] } })), room).toBe(false);
    }
    const after = resolve(withCard(at2, "lockdown", "vault"));
    expect(refused(after, move("p1", "vault"))).toBe(false);
  });

  it("a refused move to the closed room doesn't replace an earlier valid move", () => {
    const s = run(withCard(resolve(game(3)), "lockdown", "vault"), move("p0", "office", 2));
    expect(refused(s, move("p0", "vault", 3))).toBe(true);
    const done = resolve(s, {}, ["p0"]);
    expect(find(lastResolution(done), "coinsGrabbed").find((e) => e.player === "p0")).toMatchObject({ room: "office", duffel: 0, pocket: 2 });
  });

  it("the drawn closed room is never the Lobby or the Rooftop at 3, 5 and 12 players", () => {
    let seen = 0;
    for (const n of [3, 5, 12]) {
      for (let i = 0; i < 25; i++) {
        let g = createGame(config(n, { seed: `lock-qa-${n}-${i}` }));
        while (g.phase.kind !== "ended" && g.card?.id !== "lockdown") g = step(g);
        if (g.card?.id !== "lockdown") continue;
        seen++;
        expect(["lobby", "rooftop"]).not.toContain(g.card.room);
        expect(g.rooms).toContain(g.card.room);
      }
    }
    expect(seen).toBeGreaterThan(10);
  });
});

describe("QA: Audit numbers — design §13", () => {
  it("each room's count is what its visitors handed in; they sum to the coins handed in, and with the pockets to the coins taken", () => {
    const base = withCard(resolve(game(6, ["priest"])), "audit");
    const s = resolve(base, {
      p0: fullGrab("vault"), // hands in all 3
      p1: fullGrab("depositBoxes", 2),
      p2: fullGrab("depositBoxes", 2),
      p3: fullGrab("depositBoxes", 1),
      p4: fullGrab("serverRoom"),
    });
    const events = lastResolution(s);
    const audit = find(events, "auditReport")[0];
    const splits = find(events, "coinsGrabbed");
    expect(Object.keys(audit?.duffel ?? {}).sort()).toEqual([...s.rooms].sort());
    // Three in the Deposit boxes each grab 2 (no room is shared, design §3.1): handed in 0 + 0 + 1.
    expect(audit?.duffel).toMatchObject({ vault: 3, depositBoxes: 1, office: 2, serverRoom: 2, lobby: 0, security: 0, rooftop: 0 });
    const handedIn = splits.reduce((n, e) => n + e.duffel, 0);
    expect(Object.values(audit?.duffel ?? {}).reduce((a, b) => a + b, 0)).toBe(handedIn);
    expect(roundResolved(s).missing).toBe(roundResolved(s).taken - handedIn);
  });
});

describe("QA: Inside tip — design §13", () => {
  it("every tip over whole 3-player games is about another player and shows that player's real role", () => {
    let tips = 0;
    for (let i = 0; i < 20; i++) {
      const end = playThrough(createGame(config(3, { seed: `tip-qa-${i}` })));
      for (const tip of find(end.log, "insideTip")) {
        tips++;
        expect(tip.subject).not.toBe(tip.player);
        expect(tip.role).toBe(end.players[tip.subject]?.role);
      }
    }
    expect(tips).toBeGreaterThan(0);
  });
});

describe("QA: when the deck is on — design §13", () => {
  it("round 1 never has a card; events off flips nothing over a whole game", () => {
    const g = createGame(config(4));
    expect(g.card).toBeNull();
    expect(viewFor(g, "p0").card).toBeNull();
    const off = playThrough(createGame(config(4, { eventsEnabled: false })));
    expect(find(off.log, "eventFlipped")).toEqual([]);
  });

  it("over whole games: rounds with a card and rounds without, never two in a round, each right after its roundStarted (3 and 12 players)", () => {
    let repeats = 0;
    let quiet = 0;
    for (const n of [3, 12]) {
      for (let i = 0; i < 8; i++) {
        const end = playThrough(createGame(config(n, { seed: `exhaust-${n}-${i}` })));
        const flips = find(end.log, "eventFlipped");
        const rounds = flips.map((f) => f.round);
        expect(new Set(rounds).size).toBe(rounds.length);
        quiet += end.round - 1 - flips.length;
        if (new Set(flips.map((f) => f.card)).size < flips.length) repeats++;
        for (const f of flips) {
          const at = end.log.indexOf(f);
          expect(end.log[at - 1]).toMatchObject({ type: "roundStarted", round: f.round });
        }
      }
    }
    expect(repeats).toBeGreaterThan(0);
    expect(quiet).toBeGreaterThan(0);
  });
});

describe("QA: determinism and event sourcing — design §17.2", () => {
  it("same seed + same commands → identical log; replaying the log rebuilds the same state (with a pocket and a tip)", () => {
    const play = () => {
      let s = createGame(config(4, { seed: "det-qa" }));
      s = resolve(s, { p0: fullGrab("office", 2) });
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
