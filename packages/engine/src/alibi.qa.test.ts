// QA (PR #5): alibis and the round-named deadline. design §5.4, §5
import { describe, expect, it } from "vitest";
import type { GameConfig, GameState } from "./types";
import { PUBLIC, canSee } from "./types";
import { createGame } from "./setup";
import { applyEvent, replay } from "./reduce";
import { actOfRound } from "./round";
import { handleCommand } from "./handle";

function config(players: number, seed = "qa-alibi"): GameConfig {
  return {
    seed,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
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

const alibi = (player: string, room: unknown, extra: object = {}) => ({ type: "postAlibi", player, room, ...extra });
const deadline = (round: unknown) => ({ type: "advance", deadline: { kind: "round", round } });
const ROUND = (s: GameState) => deadline(s.round);

/** Stand-in for task 6: open the next act's first round after the meeting. */
function nextAct(s: GameState): GameState {
  const round = s.round + 1;
  return applyEvent(s, { type: "roundStarted", visibility: PUBLIC, round, act: actOfRound(round) });
}

/** Refused, with the (frozen) state untouched. */
function refused(s: GameState, command: unknown): string {
  const before = JSON.stringify(s);
  const r = handleCommand(deepFreeze(s), command);
  expect(r.ok).toBe(false);
  expect(JSON.stringify(s)).toBe(before);
  return r.ok ? "" : r.reason;
}

describe("QA alibis — design §5.4", () => {
  it("one per player per round at 2, 3 and 12 players; every player can post once", () => {
    for (const n of [2, 3, 12]) {
      let s = run(createGame(config(n)), ROUND);
      const ids = s.playerOrder;
      for (const id of ids) s = ok(s, alibi(id, "lobby"));
      expect(s.alibisPosted).toEqual(ids);
      for (const id of ids) expect(refused(s, alibi(id, "vault"))).toMatch(/already posted/);
      expect(s.log.filter((e) => e.type === "alibiPosted")).toHaveLength(n);
    }
  });

  it("window: round N's alibi can be posted during round N+1 planning, and closes when N+1 resolves", () => {
    let s = run(createGame(config(3)), ROUND); // round 1 resolved, planning 2
    s = run(s, { type: "submitMove", player: "p0", move: { room: "office", pocket: 0 } }, alibi("p0", "vault"));
    expect(s.log.at(-1)).toMatchObject({ type: "alibiPosted", round: 1 });
    // p1 never posted for round 1; once round 2 resolves its alibi is for round 2.
    s = run(s, ROUND);
    expect(s.resolvedRound).toBe(2);
    const r = handleCommand(s, alibi("p1", "lobby"));
    expect(r.ok && r.events).toEqual([{ type: "alibiPosted", visibility: PUBLIC, player: "p1", round: 2, room: "lobby" }]);
    // p0 posted for round 1 only, so may post for round 2.
    expect(handleCommand(s, alibi("p0", "office")).ok).toBe(true);
  });

  it("window spans the act boundary: round 3's alibi in awaitingMeeting and in round 4's planning", () => {
    let s = run(createGame(config(2)), ROUND, ROUND, ROUND);
    expect(s.phase.kind).toBe("awaitingMeeting");
    s = ok(s, alibi("p0", "rooftop"));
    s = nextAct(s);
    expect(s.phase).toEqual({ kind: "planning", round: 4 });
    expect(refused(s, alibi("p0", "lobby"))).toMatch(/round 3/);
    expect(handleCommand(s, alibi("p1", "lobby"))).toMatchObject({ ok: true, events: [{ round: 3 }] });
  });

  it("lies are allowed: an alibi naming a room nobody visited is accepted", () => {
    const s = run(createGame(config(2)), { type: "submitMove", player: "p0", move: { room: "vault", pocket: 0 } }, ROUND);
    expect(handleCommand(s, alibi("p0", "security")).ok).toBe(true);
  });

  it("rooms: extra rooms only when in play (3 vs 12 players); bad room values refused", () => {
    const small = run(createGame(config(3)), ROUND);
    const big = run(createGame(config(12)), ROUND);
    for (const room of ["tellerLine", "managersOffice", "depositBoxes", "serverRoom"]) {
      refused(small, alibi("p0", room));
      expect(handleCommand(big, alibi("p0", room)).ok).toBe(true);
    }
    for (const room of [undefined, null, "", "Lobby", " lobby", "toString", "__proto__", ["lobby"], { id: "lobby" }, 0]) {
      refused(small, alibi("p0", room));
    }
  });

  it("refused before round 1 resolves, from bad players, and after the game ends", () => {
    refused(createGame(config(3)), alibi("p0", "lobby"));
    const s = run(createGame(config(3)), ROUND);
    for (const p of [undefined, 0, "", "P0", "hasOwnProperty"]) refused(s, { type: "postAlibi", player: p, room: "lobby" });

    // Raid: everyone in the Vault every round until Heat hits 100.
    let g = createGame(config(2));
    for (let i = 0; i < 12 && g.phase.kind !== "ended"; i++) {
      if (g.phase.kind === "awaitingMeeting") g = nextAct(g);
      g = run(g, ...g.playerOrder.map((p) => ({ type: "submitMove", player: p, move: { room: "vault", pocket: 0 } })), ROUND);
    }
    expect(g.phase.kind).toBe("ended");
    expect(refused(g, alibi("p0", "lobby"))).toMatch(/over/);
  });

  it("is public and carries nothing but player, round and room (extra fields dropped, no RNG draw)", () => {
    const s = run(createGame(config(3)), ROUND);
    const r = handleCommand(s, alibi("p1", "office", { secret: "mole", pocket: 9, visibility: { kind: "private", player: "p1" }, round: 7 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toEqual([{ type: "alibiPosted", visibility: PUBLIC, player: "p1", round: 1, room: "office" }]);
    for (const viewer of s.playerOrder) expect(canSee(r.events[0]!.visibility, viewer, false)).toBe(true);
    expect(r.state.rng).toEqual(s.rng);
    // Nothing else in the state changes besides the log and the posted list.
    const { log: _l, alibisPosted: _a, ...rest } = r.state;
    const { log: _l2, alibisPosted: _a2, ...restBefore } = s;
    expect(rest).toEqual(restBefore);
  });
});

describe("QA round-named deadline — design §5", () => {
  it("duplicate, stale, future and malformed rounds are refused with no state change", () => {
    let s = run(createGame(config(3)), ROUND);
    s = run(s, ROUND); // planning 3
    for (const round of [2, 1, 0, 4, 99, -3, "3", 3.5, NaN, Infinity, null, [3], { valueOf: () => 3 }]) refused(s, deadline(round));
    expect(ok(s, deadline(3)).resolvedRound).toBe(3);
  });

  it("the act's last-round deadline can't be repeated while the meeting is awaited", () => {
    const s = run(createGame(config(2)), ROUND, ROUND, ROUND);
    for (const round of [3, 4]) refused(s, deadline(round));
  });

  it("determinism: same seed + same commands give an identical log, and replay matches", () => {
    const play = () => {
      let s = run(createGame(config(5, "det")), ROUND, alibi("p3", "depositBoxes"), alibi("p0", "vault"));
      s = run(s, { type: "submitMove", player: "p1", move: { room: "office", pocket: 1 } }, ROUND, alibi("p1", "lobby"));
      return s;
    };
    const a = play();
    const b = play();
    expect(a.log).toEqual(b.log);
    expect(replay(a.config, a.log)).toEqual(a);
  });
});
