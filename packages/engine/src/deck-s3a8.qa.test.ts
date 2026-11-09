// QA (PR #174, S3a.8): adversarial tests for the 4-card event deck at a
// 4-in-10 chance: the roll, events off, determinism, each card's effect and
// its "can't apply" redraw (owner, 8 Nov), the Audit's counts, the Inside tip at the flip and
// viewFor leaks. design §13, §4.1, §5.3, §16, §18
import { describe, expect, it } from "vitest";
import { NO_RAIDS } from "./v01-numbers.testkit";
import { handleThroughResult } from "./result.testkit";
import { EVENT_CHANCE, EVENT_DECK, EVENTS_FROM_ROUND, type RoomId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { PUBLIC, privateTo } from "./types";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { viewFor } from "./view";
import { closedRoom, startRound } from "./deck";
import { withRng, type Draw } from "./handle";
import { seedRng } from "./rng";
import { fullGrab } from "./grab.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "deck-s3a8-qa",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: true,
    voteVisibility: "open",
    contentOverrides: NO_RAIDS,
    ...extra,
  };
}

function game(players: number, roles: string[] = [], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  let seat = 0;
  return replay(
    cfg,
    setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "lookout" } : e)),
  );
}

function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughResult(s, c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}

/** Everyone not in `moves` goes to the Lobby (always open to Lockdown); `skip` players submit nothing. */
function resolve(state: GameState, moves: Record<PlayerId, Record<string, unknown>> = {}, skip: PlayerId[] = []): GameState {
  let s = state;
  for (const id of s.playerOrder) if (!skip.includes(id)) s = run(s, { type: "submitMove", player: id, move: moves[id] ?? fullGrab("lobby") });
  return run(s, { type: "advance", deadline: { kind: "round", round: s.round } });
}

function step(s: GameState): GameState {
  if (s.phase.kind === "planning") return resolve(s);
  if (s.phase.kind !== "awaitingMeeting") throw new Error(`unexpected phase ${s.phase.kind}`);
  const { meetingId } = s.phase;
  s = run(
    s,
    { type: "scheduleMeeting", meetingId, slot: `slot-${meetingId}` },
    { type: "advance", deadline: { kind: "openMeeting", meetingId } },
    { type: "advance", deadline: { kind: "closeMeeting", meetingId } },
  );
  return s.phase.kind === "result" ? run(s, { type: "advance", deadline: { kind: "result", round: s.resolvedRound } }) : s;
}

/** Every state the game passes through, to the end. */
function states(state: GameState): GameState[] {
  const out = [state];
  let s = state;
  while (s.phase.kind !== "ended") out.push((s = step(s)));
  return out;
}
/** Past any meeting the last round called, to the next planning. */
function toPlanning(state: GameState): GameState {
  let s = state;
  while (s.phase.kind === "awaitingMeeting") s = step(s);
  return s;
}
const playThrough = (state: GameState): GameState => states(state).at(-1) as GameState;

const find = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** The events from the latest roundStarted to its roundResolved. */
function lastRound(s: GameState): GameEvent[] {
  let end = s.log.length - 1;
  while (s.log[end]?.type !== "roundResolved") end--;
  let start = end;
  while (start > 0 && s.log[start]?.type !== "roundStarted") start--;
  return s.log.slice(start, end + 1);
}

/** This round's card set to `card`, by rewriting the log and replaying it. */
function withCard(state: GameState, card: string, room: RoomId | null = null): GameState {
  const at = state.log.map((e) => e.type).lastIndexOf("roundStarted");
  const rest = state.log.slice(at + 1).filter((e) => e.type !== "eventFlipped" && e.type !== "insideTip");
  const flipped: GameEvent = { type: "eventFlipped", visibility: PUBLIC, round: state.round, card, room };
  return replay(state.config, [...state.log.slice(0, at + 1), flipped, ...rest]);
}

/** A draw that always passes the roll, picks `card` from the deck and otherwise `other(items)`; it counts its calls. */
function forcing(card: string, other = <T,>(items: readonly T[]): T => items[0] as T) {
  const calls = { int: 0, pick: 0 };
  const draw: Draw = {
    int: () => (calls.int++, 0),
    pick: <T,>(items: readonly T[]) => (calls.pick++, items.includes(card as T) ? (card as T) : other(items)),
    shuffle: <T,>(items: readonly T[]) => [...items],
  };
  return { draw, calls };
}

/** A draw that fails the test if anything is drawn. */
const noDraw: Draw = {
  int: () => {
    throw new Error("drew int");
  },
  pick: () => {
    throw new Error("drew pick");
  },
  shuffle: () => {
    throw new Error("drew shuffle");
  },
};

/** startRound's events with the seeded RNG for `seed`. */
function seeded(s: GameState, round: number, seed: string): GameEvent[] {
  const out = withRng(seedRng(seed), (d) => startRound(s, round, d));
  if (typeof out === "string") throw new Error(out);
  return out;
}

const tipOf = (events: readonly GameEvent[]) => find(events, "insideTip")[0];
/** Whether `viewer` sees an Inside tip (`tip`, or any if omitted) anywhere in their view. */
const seesTip = (s: GameState, viewer: PlayerId, tip?: Extract<GameEvent, { type: "insideTip" }>) => {
  const v = viewFor(s, viewer);
  return [...v.ledger, ...v.caseFile].some((e) => e.event.type === "insideTip" && (!tip || JSON.stringify(e.event) === JSON.stringify(tip)));
};

describe("QA §13: the 4-in-10 chance from round 2", () => {
  it("over 4000 seeded rolls with every card able to apply, about 4 in 10 flip and each card about a quarter of those", () => {
    const s = resolve(game(5));
    const counts: Record<string, number> = {};
    let flips = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const cards = find(seeded(s, 2, `roll-${i}`), "eventFlipped");
      expect(cards.length).toBeLessThanOrEqual(1);
      for (const c of cards) {
        flips++;
        counts[c.card] = (counts[c.card] ?? 0) + 1;
      }
    }
    expect(flips / n).toBeGreaterThan(0.37);
    expect(flips / n).toBeLessThan(0.43);
    expect(Object.keys(counts).sort()).toEqual([...EVENT_DECK].sort());
    for (const id of EVENT_DECK) {
      expect((counts[id] ?? 0) / flips).toBeGreaterThan(0.21);
      expect((counts[id] ?? 0) / flips).toBeLessThan(0.29);
    }
  });

  it("the roll's boundary: int below `in` flips, int at `in` or above doesn't, and the roll is out of `of`", () => {
    const s = resolve(game(3));
    for (let v = 0; v < EVENT_CHANCE.of; v++) {
      let askedOf = 0;
      const d: Draw = { ...forcing("audit").draw, int: (k) => ((askedOf = k), v) };
      expect(find(startRound(s, 3, d), "eventFlipped")).toHaveLength(v < EVENT_CHANCE.in ? 1 : 0);
      expect(askedOf).toBe(EVENT_CHANCE.of);
    }
  });

  it("a miss draws no card (one int, no pick)", () => {
    const s = resolve(game(3));
    const { draw, calls } = forcing("audit");
    expect(startRound(s, 3, { ...draw, int: (k) => (calls.int++, k - 1) })).toEqual([{ type: "roundStarted", visibility: PUBLIC, round: 3 }]);
    expect(calls).toEqual({ int: 1, pick: 0 });
  });

  it("never in round 1, even with a draw that always flips; round 2 is the first that can", () => {
    expect(EVENTS_FROM_ROUND).toBe(2);
    const s = game(3);
    expect(startRound(s, 1, noDraw)).toEqual([{ type: "roundStarted", visibility: PUBLIC, round: 1 }]);
    expect(find(startRound(s, 2, forcing("audit").draw), "eventFlipped")).toHaveLength(1);
    for (let i = 0; i < 30; i++) {
      const g = createGame(config(3, { seed: `r1-${i}` }));
      expect(g.card).toBeNull();
      expect(find(g.log, "eventFlipped")).toEqual([]);
    }
  });

  it("over whole games at 3, 8 and 12 players: at most one card per round, never round 1, each right after its roundStarted, rate near 4 in 10", () => {
    let rounds = 0;
    let flips = 0;
    for (const n of [3, 8, 12]) {
      for (let i = 0; i < 12; i++) {
        const end = playThrough(createGame(config(n, { seed: `whole-${n}-${i}` })));
        const flipped = find(end.log, "eventFlipped");
        const started = find(end.log, "roundStarted").map((e) => e.round);
        expect(new Set(started).size).toBe(started.length);
        expect(new Set(flipped.map((f) => f.round)).size).toBe(flipped.length);
        for (const f of flipped) {
          expect(f.round).toBeGreaterThanOrEqual(2);
          expect(end.log[end.log.indexOf(f) - 1]).toMatchObject({ type: "roundStarted", round: f.round });
        }
        rounds += end.round - 1;
        flips += flipped.length;
      }
    }
    expect(flips / rounds).toBeGreaterThan(0.3);
    expect(flips / rounds).toBeLessThan(0.5);
  });
});

describe("QA §13, §16: events off", () => {
  it("draws nothing at any round when the host turns events off", () => {
    const s = resolve(game(4, [], { eventsEnabled: false }));
    for (const r of [1, 2, 3, 12]) expect(startRound(s, r, noDraw)).toEqual([{ type: "roundStarted", visibility: PUBLIC, round: r }]);
  });

  it("whole games with events off never flip, tip or audit, and no view ever shows a card", () => {
    for (const n of [3, 12]) {
      for (let i = 0; i < 5; i++) {
        const all = states(createGame(config(n, { seed: `off-${n}-${i}`, eventsEnabled: false })));
        const end = all.at(-1) as GameState;
        for (const t of ["eventFlipped", "insideTip", "auditReport"] as const) expect(find(end.log, t)).toEqual([]);
        for (const s of all) expect(viewFor(s, "p0").card).toBeNull();
      }
    }
  });
});

describe("QA §19.1: seeded determinism", () => {
  it("same seed and commands: identical logs; the log replays to the same state; different seeds give different flips", () => {
    for (const n of [3, 8]) {
      const a = playThrough(createGame(config(n, { seed: `det-${n}` })));
      const b = playThrough(createGame(config(n, { seed: `det-${n}` })));
      expect(b.log).toEqual(a.log);
      expect(replay(a.config, a.log)).toEqual(a);
    }
    const flips = (seed: string) =>
      find(playThrough(createGame(config(3, { seed }))).log, "eventFlipped")
        .map((e) => `${e.round}:${e.card}:${e.room}`)
        .join();
    expect(new Set(Array.from({ length: 8 }, (_, i) => flips(`det-x-${i}`))).size).toBeGreaterThan(1);
  });

  it("every random choice of a flip comes from the seed: the same seed gives the same card, room and tip", () => {
    const s = resolve(game(8));
    for (let i = 0; i < 50; i++) expect(seeded(s, 2, `same-${i}`)).toEqual(seeded(s, 2, `same-${i}`));
  });
});

describe("QA §13: Lockdown", () => {
  it("can't apply with only the Lobby and the Rooftop open: redrawn once from the cards that can (owner, 8 Nov)", () => {
    const s = resolve(game(3));
    const { draw, calls } = forcing("lockdown", (items) => {
      // The redraw offers only cards that can apply: not Lockdown, not Shift change (the Vault is taped).
      expect(items).toEqual(["audit", "insideTip"]);
      return items[0] as never;
    });
    const events = startRound({ ...s, taped: { office: 4, vault: 4, security: 4 } }, 3, draw);
    expect(events).toEqual([
      { type: "roundStarted", visibility: PUBLIC, round: 3 },
      { type: "eventFlipped", visibility: PUBLIC, round: 3, card: "audit", room: null },
    ]);
    expect(calls).toEqual({ int: 1, pick: 2 });
  });

  it("with only the Lobby open (the Rooftop is never closable) it can't apply either, at 12 players: another card flips", () => {
    const s = resolve(game(12));
    const taped = Object.fromEntries(s.rooms.filter((r) => r !== "lobby" && r !== "rooftop").map((r) => [r, 5]));
    const flips = find(startRound({ ...s, taped }, 3, forcing("lockdown").draw), "eventFlipped");
    expect(flips).toHaveLength(1);
    expect(["audit", "insideTip"]).toContain(flips[0]?.card);
  });

  it("with Security the only closable room left, it closes Security", () => {
    const s = resolve(game(3));
    const events = startRound({ ...s, taped: { office: 4, vault: 4 } }, 3, forcing("lockdown").draw);
    expect(find(events, "eventFlipped")).toEqual([{ type: "eventFlipped", visibility: PUBLIC, round: 3, card: "lockdown", room: "security" }]);
  });

  it("never names the Lobby or the Rooftop, nor a taped room, over many seeds at every crew size", () => {
    for (const n of [3, 5, 9, 12]) {
      const s = { ...resolve(game(n)), taped: { vault: 5 } };
      const named = new Set<RoomId>();
      for (let i = 0; i < 300; i++) for (const f of find(seeded(s, 3, `lock-${n}-${i}`), "eventFlipped")) if (f.card === "lockdown") named.add(f.room as RoomId);
      expect([...named].sort()).toEqual(s.rooms.filter((r) => !["lobby", "rooftop", "vault"].includes(r)).sort());
    }
  });

  it("the closed room refuses moves only that round; missed moves still go to the Lobby", () => {
    const s = withCard(resolve(game(3)), "lockdown", "office");
    expect(closedRoom(s)).toBe("office");
    expect(handleThroughResult(s, { type: "submitMove", player: "p0", move: fullGrab("office") }).ok).toBe(false);
    const after = resolve(s, {}, ["p0"]);
    expect(find(lastRound(after), "coinsGrabbed").find((e) => e.player === "p0")).toMatchObject({ room: "lobby", duffel: 1 });
    expect(closedRoom(after)).toBeNull();
    expect(handleThroughResult(after, { type: "submitMove", player: "p0", move: fullGrab("office") }).ok).toBe(true);
  });
});

describe("QA §13: Shift change", () => {
  it("can't apply with the Vault taped off: redrawn from the cards that can (owner, 8 Nov)", () => {
    const s = resolve(game(3));
    const { draw, calls } = forcing("shiftChange");
    // The redraw takes the first card that can apply (Lockdown), which then closes the first closable room.
    expect(startRound({ ...s, taped: { vault: 4 } }, 3, draw)).toEqual([
      { type: "roundStarted", visibility: PUBLIC, round: 3 },
      { type: "eventFlipped", visibility: PUBLIC, round: 3, card: "lockdown", room: "office" },
    ]);
    expect(calls).toEqual({ int: 1, pick: 3 });
  });

  it("applies when another room is taped and the Vault is open", () => {
    const s = resolve(game(3));
    expect(find(startRound({ ...s, taped: { office: 4 } }, 3, forcing("shiftChange").draw), "eventFlipped")).toEqual([
      { type: "eventFlipped", visibility: PUBLIC, round: 3, card: "shiftChange", room: null },
    ]);
  });

  it("the Vault takes 4 coins this round (5 refused), back to 3 the next; other rooms unchanged", () => {
    const s = withCard(resolve(game(3)), "shiftChange");
    const sub = (st: GameState, room: RoomId, coins: number) => handleThroughResult(st, { type: "submitMove", player: "p0", move: { room, duffel: coins, pocket: 0 } }).ok;
    expect(sub(s, "vault", 4)).toBe(true);
    expect(sub(s, "vault", 5)).toBe(false);
    expect(sub(s, "office", 3)).toBe(false);
    const after = resolve(s, { p0: { room: "vault", duffel: 2, pocket: 2 } });
    expect(find(lastRound(after), "coinsGrabbed").find((e) => e.player === "p0")).toMatchObject({ duffel: 2, pocket: 2 });
    expect(sub(after, "vault", 4)).toBe(false);
    expect(sub(after, "vault", 3)).toBe(true);
  });
});

describe("QA §13: no card that can't apply ever flips in a real game", () => {
  it("with real bells (raids taping rooms), every flipped Shift change has the Vault open and every Lockdown names an open closable room", () => {
    let checked = 0;
    for (let i = 0; i < 20; i++) {
      const all = states(createGame(config(3, { seed: `real-${i}`, contentOverrides: null })));
      for (const s of all) {
        if (s.phase.kind !== "planning" || !s.card || s.card.round !== s.round) continue;
        checked++;
        const taped = (r: RoomId) => (s.taped[r] ?? 0) >= s.round;
        if (s.card.id === "shiftChange") expect(taped("vault")).toBe(false);
        if (s.card.id === "lockdown") {
          expect(s.card.room).not.toBeNull();
          expect(["lobby", "rooftop"]).not.toContain(s.card.room);
          expect(taped(s.card.room as RoomId)).toBe(false);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("QA §13: the Audit's duffel counts", () => {
  it("counts duffel coins only (pockets excluded), sums visitors, counts a missed move's Lobby coin, lists every room in play at 8 players", () => {
    const base = withCard(resolve(game(8)), "audit");
    const s = resolve(
      base,
      { p0: fullGrab("vault", 3), p1: fullGrab("vault", 1), p2: fullGrab("office", 1), p3: fullGrab("depositBoxes", 0), p4: fullGrab("rooftop"), p5: { ...fullGrab("security"), watch: "vault" } },
      ["p6", "p7"],
    );
    const report = find(lastRound(s), "auditReport");
    expect(report).toHaveLength(1);
    expect(Object.keys(report[0]?.duffel ?? {}).sort()).toEqual([...s.rooms].sort());
    expect(report[0]?.duffel).toMatchObject({ vault: 2, office: 1, depositBoxes: 2, lobby: 2, rooftop: 0, security: 0 });
    const grabbed = find(lastRound(s), "coinsGrabbed");
    const total = Object.values(report[0]?.duffel ?? {}).reduce((a, b) => a + b, 0);
    expect(total).toBe(grabbed.reduce((a, e) => a + e.duffel, 0));
  });

  it("a raided room shows 0 even when its visitors meant to hand everything in; seized coins aren't counted anywhere", () => {
    const base = withCard(resolve(game(3, [], { contentOverrides: null })), "audit");
    const s = resolve(base, { p0: fullGrab("vault"), p1: fullGrab("vault"), p2: fullGrab("office", 1) });
    const round = lastRound(s);
    expect(find(round, "roomRaided").map((e) => e.room)).toEqual(["vault"]);
    expect(find(round, "auditReport")[0]?.duffel).toEqual({ lobby: 0, office: 1, vault: 0, security: 0, rooftop: 0 });
  });

  it("a taped-off room is listed at 0", () => {
    const raided = toPlanning(resolve(resolve(game(3, [], { contentOverrides: null })), { p0: fullGrab("vault"), p1: fullGrab("vault") }));
    expect(raided.taped.vault).toBeGreaterThan(raided.round);
    const s = resolve(withCard(raided, "audit"), { p0: fullGrab("office") });
    expect(find(lastRound(s), "auditReport")[0]?.duffel).toMatchObject({ vault: 0, office: 2, lobby: 2 });
  });

  it("with a short bank, counts only the coins actually grabbed into the duffel", () => {
    const base = withCard(toPlanning(resolve(game(3, [], { contentOverrides: { ...NO_RAIDS, bank: { coinsPerPlayer: 2 } } }))), "audit");
    expect(base.bank).toBe(3);
    const s = resolve(base, { p0: fullGrab("vault"), p1: fullGrab("vault"), p2: fullGrab("office") });
    const report = find(lastRound(s), "auditReport")[0]?.duffel ?? {};
    expect(Object.values(report).reduce((a, b) => a + b, 0)).toBe(3);
    expect(report).toEqual(
      Object.fromEntries(s.rooms.map((r) => [r, find(lastRound(s), "coinsGrabbed").filter((e) => e.room === r).reduce((a, e) => a + e.duffel, 0)])),
    );
  });

  it("is public, carries no pocket or per-player field, and appears in every view the same", () => {
    const s = resolve(withCard(resolve(game(4)), "audit"), { p0: fullGrab("vault", 3) });
    const report = find(lastRound(s), "auditReport")[0];
    expect(Object.keys(report ?? {}).sort()).toEqual(["duffel", "round", "type", "visibility"]);
    expect(report?.visibility).toEqual(PUBLIC);
    const seen = s.playerOrder.map((id) => JSON.stringify(viewFor(s, id).ledger.filter((e) => e.event.type === "auditReport")));
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).not.toMatch(/pocket|p0/);
  });

  it("no other card makes an Audit", () => {
    for (const card of ["lockdown", "shiftChange", "insideTip"]) {
      const s = resolve(withCard(resolve(game(4)), card, card === "lockdown" ? "office" : null));
      expect(find(lastRound(s), "auditReport")).toEqual([]);
    }
  });
});

describe("QA §13, §4.1, §18: the Inside tip at the flip", () => {
  it("over many seeds: the learner is any player, the subject another, the role the subject's real role, private to the learner", () => {
    const roles = ["lookout", "mole", "hacker", "priest"];
    const s = resolve(game(4, roles));
    const learners = new Set<PlayerId>();
    const subjects = new Set<PlayerId>();
    for (let i = 0; i < 400; i++) {
      const events = seeded(s, 3, `tip-${i}`);
      const tip = tipOf(events);
      if (!tip) continue;
      expect(events[events.indexOf(tip) - 1]).toMatchObject({ type: "eventFlipped", card: "insideTip", room: null });
      expect(tip.visibility).toEqual(privateTo(tip.player));
      expect(tip.subject).not.toBe(tip.player);
      expect(tip.role).toBe(s.players[tip.subject]?.role);
      expect(tip.round).toBe(3);
      learners.add(tip.player);
      subjects.add(tip.subject);
    }
    expect([...learners].sort()).toEqual(s.playerOrder.slice().sort());
    expect([...subjects].sort()).toEqual(s.playerOrder.slice().sort());
  });

  it("at 3 players, the subject is one of the two others", () => {
    const s = resolve(game(3, ["lookout", "mole", "hacker"]));
    for (const learner of s.playerOrder) {
      for (const k of [0, 1]) {
        const others = s.playerOrder.filter((p) => p !== learner);
        let picks = 0;
        const d = forcing("insideTip", <T,>(items: readonly T[]) => (picks++ === 0 ? (learner as T) : (items[k] as T))).draw;
        const tip = tipOf(startRound(s, 3, d));
        expect(tip).toMatchObject({ player: learner, subject: others[k] });
      }
    }
  });

  it("in a real game the learner sees the tip during planning, before any move; nobody else sees it before the reveal", () => {
    let found = 0;
    for (let i = 0; i < 40 && found < 3; i++) {
      const all = states(createGame(config(5, { seed: `tipgame-${i}` })));
      const end = all.at(-1) as GameState;
      for (const tip of find(end.log, "insideTip")) {
        found++;
        const planning = all.find((s) => s.phase.kind === "planning" && s.round === tip.round) as GameState;
        expect(planning).toBeDefined();
        expect(find(planning.log, "insideTip")).toContainEqual(tip);
        // drawn before any move of its round
        const at = end.log.indexOf(tip);
        expect(end.log.slice(at).findIndex((e) => e.type === "moveSubmitted" && e.round === tip.round)).toBeGreaterThan(0);
        expect(end.log.slice(end.log.findIndex((e) => e.type === "roundStarted" && e.round === tip.round), at).some((e) => e.type === "moveSubmitted")).toBe(false);
        for (const s of all.filter((x) => x.round >= tip.round && x.phase.kind !== "ended")) {
          for (const id of s.playerOrder) expect(seesTip(s, id, tip)).toBe(id === tip.player);
        }
        // §18: private until the reveal, then open to everyone
        for (const id of end.playerOrder) expect(JSON.stringify(viewFor(end, id).reveal)).toContain('"type":"insideTip"');
        // exactly one tip for that round: nothing re-sent at resolution
        expect(find(end.log, "insideTip").filter((t) => t.round === tip.round)).toHaveLength(1);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("the tip's learner view names the subject and the role; a non-learner's view has neither the event nor the pairing", () => {
    const s = withCard(resolve(game(4, ["lookout", "mole", "hacker", "priest"])), "audit");
    const tip: GameEvent = { type: "insideTip", visibility: privateTo("p0"), player: "p0", round: s.round, subject: "p1", role: "mole" };
    const t = replay(s.config, [...s.log, tip]);
    expect([...viewFor(t, "p0").caseFile, ...viewFor(t, "p0").ledger].some((e) => e.event.type === "insideTip")).toBe(true);
    for (const id of ["p1", "p2", "p3"]) expect(seesTip(t, id)).toBe(false);
  });
});

describe("QA §18: viewFor leaks around the deck", () => {
  it("across seeded games with events on, no viewer's view holds another's tip, the RNG state or a pocket-carrying grab of someone else", () => {
    for (const n of [3, 12]) {
      for (let i = 0; i < 4; i++) {
        const all = states(createGame(config(n, { seed: `leak-${n}-${i}` })));
        for (const s of all.filter((x) => x.phase.kind !== "ended")) {
          for (const id of s.playerOrder) {
            const v = viewFor(s, id);
            const events = [...v.ledger, ...v.caseFile].map((e) => e.event);
            for (const e of events) {
              if (e.type === "insideTip") expect(e.player).toBe(id);
              if (e.type === "coinsGrabbed") expect(e.player).toBe(id);
              expect(e.type).not.toBe("rngAdvanced");
            }
          }
        }
      }
    }
  });
});

describe("QA §13: a card that can't apply is redrawn (owner, 8 Nov)", () => {
  const three = () => resolve(game(3));
  /** No closable room and the Vault taped: only Audit and Inside tip can apply. */
  const onlyTwo = (s: GameState): GameState => ({ ...s, taped: { office: 4, vault: 4, security: 4 } });
  const vaultTaped = (s: GameState): GameState => ({ ...s, taped: { vault: 4 } });
  const cardOf = (events: readonly GameEvent[]) => find(events, "eventFlipped")[0]?.card ?? null;

  it("the roll is unchanged: over 3000 seeds a round flips exactly when it would with every card able to apply, about 4 in 10", () => {
    const open = three();
    let flips = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) {
      const hit = cardOf(seeded(open, 3, `redraw-${i}`)) !== null;
      for (const s of [onlyTwo(open), vaultTaped(open)]) {
        const flipped = find(seeded(s, 3, `redraw-${i}`), "eventFlipped");
        expect(flipped).toHaveLength(hit ? 1 : 0);
      }
      if (hit) flips++;
    }
    expect(flips / n).toBeGreaterThan(0.37);
    expect(flips / n).toBeLessThan(0.43);
  });

  it("every flip lands a card that applies, spread over the cards that can (Vault taped: a third each; nothing closable: a half each)", () => {
    const tally = (s: GameState) => {
      const counts: Record<string, number> = {};
      let flips = 0;
      for (let i = 0; i < 4000; i++) {
        const events = seeded(s, 3, `spread-${i}`);
        const card = cardOf(events);
        if (card === null) continue;
        flips++;
        counts[card] = (counts[card] ?? 0) + 1;
        const lock = find(events, "eventFlipped")[0]?.room;
        if (card === "lockdown") expect(["office", "security"]).toContain(lock);
        if (card === "insideTip") expect(find(events, "insideTip")).toHaveLength(1);
      }
      return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / flips]));
    };
    const taped = tally(vaultTaped(three()));
    expect(Object.keys(taped).sort()).toEqual(["audit", "insideTip", "lockdown"]);
    for (const share of Object.values(taped)) expect(Math.abs(share - 1 / 3)).toBeLessThan(0.05);
    const two = tally(onlyTwo(three()));
    expect(Object.keys(two).sort()).toEqual(["audit", "insideTip"]);
    for (const share of Object.values(two)) expect(Math.abs(share - 1 / 2)).toBeLessThan(0.05);
  });

  it("the redraw is seeded: the same seed gives the same redrawn card, room and tip; different seeds reach each card", () => {
    const eight = resolve(game(8));
    const s = { ...eight, taped: Object.fromEntries(eight.rooms.filter((r) => r !== "lobby" && r !== "rooftop").map((r) => [r, 4])) };
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const a = seeded(s, 4, `redet-${i}`);
      expect(seeded(s, 4, `redet-${i}`)).toEqual(a);
      const c = cardOf(a);
      if (c) seen.add(c);
    }
    expect([...seen].sort()).toEqual(["audit", "insideTip"]);
  });

  it("a card that applies is never redrawn: one pick for the card, nothing more for Audit or Shift change", () => {
    for (const card of ["audit", "shiftChange"]) {
      const { draw, calls } = forcing(card);
      expect(cardOf(startRound(three(), 3, draw))).toBe(card);
      expect(calls).toEqual({ int: 1, pick: 1 });
    }
  });

  it("tape that runs out as the round starts makes Lockdown apply again: no redraw", () => {
    const s = { ...three(), taped: { office: 2, vault: 2, security: 2 } };
    const { draw, calls } = forcing("lockdown");
    expect(cardOf(startRound(s, 3, draw))).toBe("lockdown");
    expect(calls).toEqual({ int: 1, pick: 2 }); // the card, then its room
  });

  it("whole games with raids on (tape, so redraws happen) are deterministic: same seed, same log, and the log replays", () => {
    for (const n of [3, 12]) {
      for (let i = 0; i < 4; i++) {
        const cfg = config(n, { seed: `bells-redraw-${n}-${i}`, contentOverrides: null });
        const end = playThrough(createGame(cfg));
        expect(playThrough(createGame(cfg)).log).toEqual(end.log);
        expect(replay(end.config, end.log)).toEqual(end);
      }
    }
  });
});
