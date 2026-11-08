// QA (PR #132, R7 C2d): the five dropped event cards (Quiet night, Payday, Power cut,
// Raid rumour, Double-cross) and the Server room's pocket count are gone. Configs naming
// them are refused without a crash; seeded games only ever flip the four kept cards, one
// per round from round 2; the Server room is an ordinary room. design §10, §6.2, §17.2
import { describe, expect, it } from "vitest";
import { NO_RAIDS } from "./v01-numbers.testkit";
import { EVENTS, EVENT_DECK, EVENTS_FROM_ROUND, type RoomId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { createGame, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { closedRoom } from "./deck";
import { jobFor } from "./overrides";
import { handleThroughAlibis } from "./alibis.testkit";
import { fullGrab } from "./grab.testkit";

const DROPPED = ["quietNight", "payday", "powerCut", "raidRumour", "doubleCross"];
const KEPT = ["shiftChange", "lockdown", "audit", "insideTip"];
const DROPPED_EVENT_TYPES = ["doubleCrossOffered", "doubleCrossAnswered", "doubleCrossResolved", "raidRumourHit", "pocketCount"];

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "qa-c2d",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    eventsEnabled: true,
    voteVisibility: "hiddenThenRevealed",
    // Bells too big to raid: these scripts test other rules (bells and raids: bells.test.ts).
    contentOverrides: NO_RAIDS,
    ...extra,
  };
}

function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}

function resolve(state: GameState, moves: Record<PlayerId, Record<string, unknown>> = {}): GameState {
  let s = state;
  for (const id of s.playerOrder) {
    s = run(s, { type: "submitMove", player: id, move: moves[id] ?? fullGrab(closedRoom(s) === "office" ? "lobby" : "office") });
  }
  return run(s, { type: "advance", deadline: { kind: "round", round: s.round } });
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
  let guard = 0;
  while (s.phase.kind !== "ended") {
    s = step(s);
    if (++guard > 500) throw new Error("game did not end");
  }
  return s;
}

const flips = (s: GameState) => s.log.filter((e): e is Extract<GameEvent, { type: "eventFlipped" }> => e.type === "eventFlipped");

describe("QA: the content holds exactly the four kept cards", () => {
  it("EVENTS and EVENT_DECK are Shift change, Lockdown, Audit, Inside tip", () => {
    expect(Object.keys(EVENTS).sort()).toEqual([...KEPT].sort());
    expect([...EVENT_DECK].sort()).toEqual([...KEPT].sort());
  });
  it("the bank's Server room is still a room, with no info power", () => {
    const room = jobFor(config(6)).rooms.serverRoom;
    expect(room).toBeDefined();
    expect(room?.info).toBe("none");
  });
});

describe("QA: configs naming a dropped card or the old Server-room power are refused cleanly", () => {
  it.each(DROPPED)("contentOverrides.events.%s: refused as no such event card, never a throw", (card) => {
    for (const o of [{}, { amount: 2 }, { loss: 3 }, { lootMultiplier: 2 }]) {
      let errors: string[] = [];
      expect(() => (errors = validateConfig(config(6, { contentOverrides: { events: { [card]: o } } as never })))).not.toThrow();
      expect(errors).toContain(`contentOverrides.events.${card}: no such event card`);
    }
  });
  it.each(["amount", "loss"])("Shift change can no longer take the dropped cards' %s field", (field) => {
    const errors = validateConfig(config(6, { contentOverrides: { events: { shiftChange: { [field]: 1 } } } as never }));
    expect(errors).toContain(`contentOverrides.events.shiftChange.${field} is not an overridable field`);
  });
  it.each([{ info: "pocketCount" }, { pocketCount: 1 }, { info: "watchRoom" }])("a Server room override %j is refused, never a throw", (o) => {
    let errors: string[] = [];
    expect(() => (errors = validateConfig(config(6, { contentOverrides: { rooms: { serverRoom: o } } as never })))).not.toThrow();
    expect(errors.join("\n")).toMatch(/contentOverrides\.rooms\.serverRoom\.\w+ is not an overridable field/);
  });
  it("the Server room's own numbers are still overridable", () => {
    expect(validateConfig(config(6, { contentOverrides: { rooms: { serverRoom: { coins: 1, quietCoins: 0 } } } }))).toEqual([]);
  });
  it("answerDoubleCross is refused at any phase: no throw, state untouched", () => {
    let s = resolve(createGame(config(6)));
    for (const answer of [true, false, "accept", null]) {
      const before = s;
      let r: ReturnType<typeof handleCommand> | undefined;
      expect(() => (r = handleCommand(s, { type: "answerDoubleCross", player: "p0", accept: answer, answer }))).not.toThrow();
      expect(r?.ok).toBe(false);
      expect(s).toBe(before);
    }
    s = playThrough(s);
    expect(handleCommand(s, { type: "answerDoubleCross", player: "p0", accept: true }).ok).toBe(false);
  });
});

describe("QA: seeded games flip only kept cards, once per round from round 2 (3 / 6 / 12 players)", () => {
  for (const n of [3, 6, 12]) {
    it(`${n} players: 70 seeds`, { timeout: 120_000 }, () => {
      const counts = new Map<string, number>();
      let total = 0;
      for (let k = 0; k < 70; k++) {
        const cfg = config(n, { seed: `c2d-${n}-${k}` });
        expect(validateConfig(cfg)).toEqual([]);
        const end = playThrough(createGame(cfg));
        const rounds = end.log.filter((e): e is Extract<GameEvent, { type: "roundStarted" }> => e.type === "roundStarted").map((e) => e.round);
        const f = flips(end);
        // One card each round from round 2, none in round 1.
        expect(f.map((e) => e.round)).toEqual(rounds.filter((r) => r >= EVENTS_FROM_ROUND));
        for (const e of f) {
          expect(KEPT).toContain(e.card);
          counts.set(e.card, (counts.get(e.card) ?? 0) + 1);
          total++;
        }
        for (const e of end.log) expect(DROPPED_EVENT_TYPES).not.toContain(e.type);
      }
      // Uniform draw over 4 cards: each about a quarter (generous bounds).
      expect(total).toBeGreaterThan(300);
      for (const card of KEPT) {
        const share = (counts.get(card) ?? 0) / total;
        expect(share, card).toBeGreaterThan(0.17);
        expect(share, card).toBeLessThan(0.33);
      }
    });
  }
  it("events off: no card ever flips", () => {
    expect(flips(playThrough(createGame(config(6, { eventsEnabled: false, seed: "off" }))))).toEqual([]);
  });
});

describe("QA: the Server room is an ordinary room", () => {
  it("in play from 5 players; a 2-coin room like the Office (design §3.1): 2 accepted, 3 refused, and it tells the visitor nothing", () => {
    for (const n of [5, 6, 12]) {
      let s = resolve(createGame(config(n, { eventsEnabled: false, seed: `srv-${n}` })));
      expect(s.rooms).toContain("serverRoom" as RoomId);
      expect(handleThroughAlibis(s, { type: "submitMove", player: "p0", move: fullGrab("serverRoom", 1) }).ok).toBe(true);
      expect(handleThroughAlibis(s, { type: "submitMove", player: "p0", move: { room: "serverRoom", duffel: 2, pocket: 1 } }).ok).toBe(false);
      const base = resolve(s, { p0: fullGrab("office"), p1: fullGrab("vault", 3) });
      const before = s.log.length;
      s = resolve(s, { p0: fullGrab("serverRoom"), p1: fullGrab("vault", 3) });
      const added = s.log.slice(before);
      expect(added.map((e) => e.type)).not.toContain("pocketCount");
      // p0 learns no more in the Server room than in the Office: same event types reach them privately.
      const privTypes = (st: GameState) =>
        st.log
          .slice(before)
          .filter((e) => e.visibility.kind !== "public" && JSON.stringify(e.visibility).includes('"p0"'))
          .map((e) => e.type)
          .sort();
      expect(privTypes(s)).toEqual(privTypes(base));
      expect(JSON.stringify(viewFor(s, "p0"))).not.toMatch(/pocketCount/);
    }
  });
  it("not in play below 5 players", () => {
    for (const n of [3, 4]) expect(createGame(config(n)).rooms).not.toContain("serverRoom" as RoomId);
  });
});

describe("QA: determinism", () => {
  it("same seed and same commands: identical logs at 3 / 6 / 12", () => {
    for (const n of [3, 6, 12]) {
      const cfg = config(n, { seed: `det-${n}` });
      const a = playThrough(createGame(cfg));
      const b = playThrough(createGame(cfg));
      expect(b.log).toEqual(a.log);
      expect(replay(cfg, a.log).log).toEqual(a.log);
      expect(setupEvents(cfg)).toEqual(setupEvents(cfg));
    }
  });
});
