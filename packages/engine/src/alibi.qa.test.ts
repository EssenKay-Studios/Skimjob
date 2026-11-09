// QA (PR #5): alibis and the round-named deadline. design §11.3, §5
import { NO_RAIDS } from "./v01-numbers.testkit";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameState } from "./types";
import { PUBLIC, canSee } from "./types";
import { createGame } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { fullGrab } from "./grab.testkit";

function config(players: number, seed = "qa-alibi"): GameConfig {
  return {
    seed,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    // Bells too big to raid: these scripts test alibis (bells and raids: bells.test.ts).
    contentOverrides: NO_RAIDS,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** A function command is called with the current state. */
type Cmd = unknown | ((s: GameState) => unknown);
function ok(state: GameState, command: Cmd): GameState {
  const r = handleCommand(state, typeof command === "function" ? command(state) : command);
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.state;
}
const run = (s: GameState, ...cs: Cmd[]) => cs.reduce<GameState>(ok, s);

const alibi = (player: string, room: unknown, extra: object = {}) => ({ type: "postAlibi", player, round: 1, room, ...extra });
const deadline = (round: unknown) => ({ type: "advance", deadline: { kind: "round", round } });
const ROUND = (s: GameState) => deadline(s.round);
/** design §9.3: the result window closes with no emergency called; the next round's planning starts. */
const RESULT = (s: GameState) => ({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } });
/** A bank of 9 for 3 players: round 1's missed moves (3 coins) leave 6, a third gone (design §9.1). */
const SMALL_BANK = { ...NO_RAIDS, bank: { coinsPerPlayer: 3 } };

/** Refused, with the (frozen) state untouched. */
function refused(s: GameState, command: unknown): string {
  const before = JSON.stringify(s);
  const r = handleCommand(deepFreeze(s), command);
  expect(r.ok).toBe(false);
  expect(JSON.stringify(s)).toBe(before);
  return r.ok ? "" : r.reason;
}

describe("QA alibis — design §11.3", () => {
  it("one per player per round at 3 and 12 players; every player can post once", () => {
    for (const n of [3, 12]) {
      let s = run(createGame(config(n)), ROUND);
      const ids = s.playerOrder;
      for (const id of ids) s = ok(s, alibi(id, "lobby"));
      for (const id of ids) expect(refused(s, alibi(id, "vault"))).toMatch(/already posted/);
      expect(s.log.filter((e) => e.type === "said")).toHaveLength(n);
    }
  });

  it("no window: round N's alibi is taken in every later phase, during round N+1's planning and around a meeting (owner, 6 Nov)", () => {
    let s = run(createGame(config(3)), ROUND); // round 1 resolved: the result window
    s = run(s, alibi("p0", "vault"), RESULT); // planning 2
    s = run(s, alibi("p1", "lobby"), { type: "submitMove", player: "p0", move: fullGrab("office") }, ROUND);
    const r = handleCommand(s, alibi("p2", "lobby", { round: 2 }));
    expect(r.ok && r.events).toEqual([{ type: "said", visibility: PUBLIC, statement: { kind: "alibi", player: "p2", round: 2, room: "lobby" } }]);
    let m = run(createGame({ ...config(3), contentOverrides: SMALL_BANK }), ROUND);
    expect(m.phase.kind).toBe("awaitingMeeting");
    m = run(m, alibi("p0", "rooftop"), { type: "scheduleMeeting", meetingId: "meeting-1", slot: "now" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "meeting-1" } });
    m = run(m, alibi("p1", "lobby"), { type: "advance", deadline: { kind: "closeMeeting", meetingId: "meeting-1" } }, alibi("p2", "lobby"));
    expect(m.log.filter((e) => e.type === "said")).toHaveLength(3);
  });

  it("lies are allowed: an alibi naming a room nobody visited is accepted", () => {
    const s = run(createGame(config(3)), { type: "submitMove", player: "p0", move: fullGrab("vault") }, ROUND);
    expect(handleCommand(s, alibi("p0", "security")).ok).toBe(true);
  });

  it("rooms: extra rooms only when in play (3 vs 12 players); bad room values refused", () => {
    const small = run(createGame(config(3)), ROUND);
    const big = run(createGame(config(12)), ROUND);
    for (const room of ["managersOffice", "depositBoxes", "serverRoom"]) {
      refused(small, alibi("p0", room));
      expect(handleCommand(big, alibi("p0", room)).ok).toBe(true);
    }
    for (const room of [undefined, null, "", "Lobby", " lobby", "toString", "__proto__", "tellerLine", ["lobby"], { id: "lobby" }, 0]) {
      refused(small, alibi("p0", room));
    }
  });

  it("refused before round 1 resolves, from bad players, and after the game ends", () => {
    refused(createGame(config(3)), alibi("p0", "lobby"));
    const s = run(createGame(config(3)), ROUND);
    for (const p of [undefined, 0, "", "P0", "hasOwnProperty"]) refused(s, { type: "postAlibi", player: p, round: 1, room: "lobby" });

    // A bust (design §5.5): a one-bulb bell and one star, everyone in the Vault.
    let g = createGame({ ...config(3), contentOverrides: { alarm: { bulbs: 1, bustStars: 1 } } });
    for (let i = 0; i < 12 && g.phase.kind !== "ended"; i++) {
      if (g.phase.kind === "result") g = run(g, RESULT);
      g = run(g, ...g.playerOrder.map((p) => ({ type: "submitMove", player: p, move: fullGrab("vault") })), ROUND);
    }
    expect(g.phase.kind).toBe("ended");
    expect(refused(g, alibi("p0", "lobby"))).toMatch(/over/);
  });

  it("is public and carries nothing but player, round and room (extra fields dropped, no RNG draw)", () => {
    const s = run(createGame(config(3)), ROUND);
    const r = handleCommand(s, alibi("p1", "office", { secret: "mole", pocket: 9, visibility: { kind: "private", player: "p1" }, statement: { kind: "plan" } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toEqual([{ type: "said", visibility: PUBLIC, statement: { kind: "alibi", player: "p1", round: 1, room: "office" } }]);
    for (const viewer of s.playerOrder) expect(canSee(r.events[0]!.visibility, viewer, false)).toBe(true);
    expect(r.state.rng).toEqual(s.rng);
    // Nothing else in the state changes besides the log.
    expect({ ...r.state, log: s.log }).toEqual(s);
  });
});

describe("QA round-named deadline — design §5", () => {
  it("duplicate, stale, future and malformed rounds are refused with no state change", () => {
    let s = run(createGame(config(3)), ROUND, RESULT);
    s = run(s, ROUND, RESULT); // planning 3
    for (const round of [2, 1, 0, 4, 99, -3, "3", 3.5, NaN, Infinity, null, [3], { valueOf: () => 3 }]) refused(s, deadline(round));
    expect(ok(s, deadline(3)).resolvedRound).toBe(3);
  });

  it("a round's deadline can't be repeated while the meeting it called is awaited", () => {
    const s = run(createGame({ ...config(3), contentOverrides: SMALL_BANK }), ROUND);
    expect(s.phase.kind).toBe("awaitingMeeting");
    for (const round of [1, 2]) refused(s, deadline(round));
  });

  it("determinism: same seed + same commands give an identical log, and replay matches", () => {
    const play = () => {
      let s = run(createGame(config(5, "det")), ROUND, alibi("p3", "depositBoxes"), alibi("p0", "vault"));
      s = run(s, RESULT, { type: "submitMove", player: "p1", move: fullGrab("office", s.players.p1?.role === "priest" ? 0 : 1) }, ROUND, alibi("p1", "lobby", { round: 2 }));
      return s;
    };
    const a = play();
    const b = play();
    expect(a.log).toEqual(b.log);
    expect(replay(a.config, a.log)).toEqual(a);
  });
});
