// QA (PR #156, S3a.1): adversarial tests for rooms, coins and grabs, the bank
// and the short bank. design §3.1, §3.2, §3.3, §6.1
//
// Rings (design §3.2 "rings count the coins actually grabbed") arrive with the
// bells in S3a.2; here the coins actually grabbed are pinned in `coinsGrabbed`,
// which is what the rings will read.
import { BANK_JOB, MAX_PLAYERS, MIN_PLAYERS, type RoomId } from "@skimjob/content";
import { NO_RAIDS } from "./v01-numbers.testkit";
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import type { Command, GameConfig, GameEvent, GameState, PlayerId, PlayerView } from "./types";
import { PUBLIC } from "./types";
import { setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { randomInt } from "./rng";
import { viewFor } from "./view";
import { roomsInPlay } from "./job";
import { closedRoom } from "./deck";

type Overrides = GameConfig["contentOverrides"];
type Grabbed = Extract<GameEvent, { type: "coinsGrabbed" }>;
type Resolved = Extract<GameEvent, { type: "roundResolved" }>;

function config(players: number, contentOverrides: Overrides = null, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "coins-qa",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: ["rookie"],
    eventsEnabled: false,
    voteVisibility: "open",
    // Bells too big to raid: these scripts test coins and the bank (rings and raids: bells.test.ts).
    contentOverrides: { ...NO_RAIDS, ...contentOverrides },
    ...extra,
  };
}

/** A new game with every seat a Rookie (no role powers in the way). */
function game(players: number, contentOverrides: Overrides = null, extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, contentOverrides, extra);
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "rookie" } : e)));
}

function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, typeof c === "function" ? (c as (s: GameState) => unknown)(s) : c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}

const submit = (player: PlayerId, move: Record<string, unknown>): Command => ({ type: "submitMove", player, move }) as unknown as Command;
const ROUND = (s: GameState): Command => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const refusal = (s: GameState, c: unknown): string => {
  const r = handleCommand(s, c);
  if (r.ok) throw new Error(`expected a refusal of ${JSON.stringify(c)}`);
  return r.reason;
};
const after = (before: GameState, s: GameState): GameEvent[] => s.log.slice(before.log.length);
const grabsIn = (events: readonly GameEvent[]): Grabbed[] => events.filter((e): e is Grabbed => e.type === "coinsGrabbed");
const resolvedIn = (events: readonly GameEvent[]): Resolved => events.find((e): e is Resolved => e.type === "roundResolved") as Resolved;

/** Replace the current round's card (as deck.qa does) by rewriting the log and replaying it. */
function withCard(state: GameState, card: string, room: RoomId | null = null): GameState {
  const log = [...state.log];
  let i = log.length - 1;
  while (i >= 0 && log[i]?.type !== "eventFlipped" && log[i]?.type !== "roundStarted") i--;
  if (i < 0) throw new Error("no round started");
  const flipped: GameEvent = { type: "eventFlipped", visibility: PUBLIC, round: state.round, card, room };
  if (log[i]?.type === "eventFlipped") log.splice(i, 1, flipped);
  else log.splice(i + 1, 0, flipped); // no card flipped this round: add one
  return replay(state.config, log);
}

/** Small seeded PRNG for the test's own choices (mulberry32). */
function prng(seed: number): (n: number) => number {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

/**
 * design §3.2 short bank, written independently of the engine's loop: after L
 * full round-robin passes everyone holds min(ask, L); the r coins left go one
 * each to the first r seats (from the drawn seat, in seat order) still wanting
 * more. L is the highest level the bank covers.
 */
function waterFill(order: readonly PlayerId[], ask: ReadonlyMap<PlayerId, number>, bank: number, start: number): Map<PlayerId, number> {
  const total = [...ask.values()].reduce((a, b) => a + b, 0);
  if (total <= bank) return new Map(ask);
  const at = (level: number) => order.reduce((sum, id) => sum + Math.min(ask.get(id) ?? 0, level), 0);
  let level = 0;
  while (at(level + 1) <= bank) level++;
  let r = bank - at(level);
  const got = new Map(order.map((id) => [id, Math.min(ask.get(id) ?? 0, level)]));
  for (let i = 0; i < order.length && r > 0; i++) {
    const id = order[(start + i) % order.length] as PlayerId;
    if ((ask.get(id) ?? 0) > level) {
      got.set(id, level + 1);
      r--;
    }
  }
  return got;
}

/** A random legal move for `id` in `s` (some seats skip, to get the §3.3 default). */
function randomMove(s: GameState, rand: (n: number) => number): Record<string, unknown> {
  const closed = closedRoom(s);
  const open = s.rooms.filter((r) => r !== closed);
  const room = open[rand(open.length)] as RoomId;
  const limit = BANK_JOB.rooms[room]?.coins ?? 0;
  const grab = limit === 0 ? 0 : 1 + rand(limit);
  const pocket = rand(grab + 1);
  return { room, duffel: grab - pocket, pocket, ...(room === "security" ? { watch: open[rand(open.length)] } : {}) };
}

describe("QA: R7 coin values come from content — design §3.1", () => {
  it("each room's limit is its content value: Lobby 1; Office, Deposit boxes, Manager's office, Server room 2; Vault 3; Security, Rooftop 0", () => {
    const coins = Object.fromEntries(Object.values(BANK_JOB.rooms).map((r) => [r.id, r.coins]));
    expect(coins).toEqual({ lobby: 1, office: 2, depositBoxes: 2, managersOffice: 2, serverRoom: 2, vault: 3, security: 0, rooftop: 0 });
  });

  it("rooms in play: 5 at 3–4 players, 7 at 5–8, 8 at 9–12 (the Teller line is gone)", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const rooms = game(n).rooms;
      expect(rooms).toEqual(roomsInPlay(BANK_JOB, n));
      expect(rooms.length).toBe(n <= 4 ? 5 : n <= 8 ? 7 : 8);
      expect(rooms).not.toContain("tellerLine");
    }
  });

  it("every room in play at 12 players: every split of 1..limit is accepted, limit + 1 and 0 are refused (0 rooms take only 0)", () => {
    const s = game(12);
    for (const room of s.rooms) {
      const limit = BANK_JOB.rooms[room]?.coins ?? 0;
      const watch = room === "security" ? { watch: "vault" } : {};
      if (limit === 0) {
        expect(handleCommand(s, submit("p0", { room, duffel: 0, pocket: 0, ...watch })).ok).toBe(true);
        expect(refusal(s, submit("p0", { room, duffel: 1, pocket: 0, ...watch }))).toMatch(/no coins/);
        expect(refusal(s, submit("p0", { room, duffel: 0, pocket: 1, ...watch }))).toMatch(/no coins/);
        continue;
      }
      for (let grab = 1; grab <= limit; grab++) {
        for (let pocket = 0; pocket <= grab; pocket++) {
          const r = handleCommand(s, submit("p0", { room, duffel: grab - pocket, pocket }));
          expect(r.ok, `${room} ${grab - pocket}+${pocket}`).toBe(true);
        }
      }
      expect(refusal(s, submit("p0", { room, duffel: limit + 1, pocket: 0 }))).toMatch(/at most/);
      expect(refusal(s, submit("p0", { room, duffel: 0, pocket: limit + 1 }))).toMatch(/at most/);
      expect(refusal(s, submit("p0", { room, duffel: limit, pocket: 1 }))).toMatch(/at most/);
      expect(refusal(s, submit("p0", { room, duffel: 0, pocket: 0 }))).toMatch(/at least 1/);
    }
  });

  it("the limit follows a content override, not a hard-coded number", () => {
    const s = game(3, { rooms: { vault: { coins: 5 }, lobby: { coins: 2 } } });
    expect(handleCommand(s, submit("p0", { room: "vault", duffel: 2, pocket: 3 })).ok).toBe(true);
    expect(refusal(s, submit("p0", { room: "vault", duffel: 3, pocket: 3 }))).toMatch(/at most 5/);
    expect(handleCommand(s, submit("p0", { room: "lobby", duffel: 0, pocket: 2 })).ok).toBe(true);
  });

  it("overrides can't give Security or the Rooftop coins, nor take a coin room to 0, nor empty the bank at setup", () => {
    for (const o of [{ rooms: { security: { coins: 1 } } }, { rooms: { rooftop: { coins: 2 } } }, { rooms: { vault: { coins: 0 } } }, { rooms: { lobby: { coins: -1 } } }, { rooms: { office: { coins: 1.5 } } }, { bank: { coinsPerPlayer: 0 } }, { bank: { coinsPerPlayer: -16 } }, { bank: { coinsPerPlayer: "16" } }, { bank: { coinsPerPlayer: 16, extra: 1 } }]) {
      expect(validateConfig(config(3, o as Overrides)), JSON.stringify(o)).not.toEqual([]);
    }
  });

  it("Shift change: the Vault takes 1 extra coin this round only; other rooms keep their limits (design §13)", () => {
    const s = withCard(game(3, null, { eventsEnabled: true }), "shiftChange", null);
    expect(handleCommand(s, submit("p0", { room: "vault", duffel: 1, pocket: 3 })).ok).toBe(true);
    expect(refusal(s, submit("p0", { room: "vault", duffel: 2, pocket: 3 }))).toMatch(/at most 4/);
    expect(refusal(s, submit("p0", { room: "office", duffel: 3, pocket: 0 }))).toMatch(/at most 2/);
    expect(refusal(s, submit("p0", { room: "rooftop", duffel: 1, pocket: 0 }))).toMatch(/no coins/);
    const before = run(s, submit("p0", { room: "vault", duffel: 0, pocket: 4 }));
    const s2 = run(before, ROUND);
    expect(grabsIn(after(before, s2)).find((e) => e.player === "p0")).toMatchObject({ duffel: 0, pocket: 4 });
    const next = s2.card?.id === "shiftChange" ? withCard(s2, "audit") : s2;
    expect(refusal(next, submit("p0", { room: "vault", duffel: 4, pocket: 0 }))).toMatch(/at most 3/);
  });
});

describe("QA: the duffel/pocket split is checked — design §3.2", () => {
  const s = game(3);
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["negative pocket", { room: "vault", duffel: 3, pocket: -1 }, /whole numbers/],
    ["negative duffel", { room: "vault", duffel: -1, pocket: 3 }, /whole numbers/],
    ["both negative", { room: "office", duffel: -1, pocket: -1 }, /whole numbers/],
    ["a fraction", { room: "office", duffel: 0.5, pocket: 0.5 }, /whole numbers/],
    ["a string", { room: "office", duffel: "1", pocket: 0 }, /whole numbers/],
    ["NaN", { room: "office", duffel: Number.NaN, pocket: 1 }, /whole numbers/],
    ["Infinity", { room: "vault", duffel: Number.POSITIVE_INFINITY, pocket: 0 }, /whole numbers/],
    ["a missing duffel", { room: "vault", pocket: 1 }, /whole numbers/],
    ["a missing pocket", { room: "vault", duffel: 1 }, /whole numbers/],
    ["null bags", { room: "vault", duffel: null, pocket: null }, /whole numbers/],
    ["more than the grab limit", { room: "office", duffel: 2, pocket: 1 }, /at most 2/],
    ["huge numbers", { room: "vault", duffel: Number.MAX_SAFE_INTEGER, pocket: Number.MAX_SAFE_INTEGER }, /at most 3/],
    ["zero in a coin room", { room: "lobby", duffel: 0, pocket: 0 }, /at least 1/],
    ["Rooftop with a coin", { room: "rooftop", duffel: 0, pocket: 1 }, /no coins/],
    ["Security with a coin", { room: "security", duffel: 1, pocket: 0, watch: "vault" }, /no coins/],
    ["a room not in play at 3 players", { room: "serverRoom", duffel: 1, pocket: 0 }, /not open/],
    ["the Teller line", { room: "tellerLine", duffel: 1, pocket: 0 }, /not open/],
  ];
  for (const [name, move, why] of cases) {
    it(`refuses ${name}, leaving the state as it was`, () => {
      expect(refusal(s, submit("p0", move))).toMatch(why);
    });
  }

  it("all-pocket and all-duffel grabs land in the right bag", () => {
    const before = run(s, submit("p0", { room: "vault", duffel: 0, pocket: 3 }), submit("p1", { room: "vault", duffel: 3, pocket: 0 }), submit("p2", { room: "rooftop", duffel: 0, pocket: 0 }));
    const s2 = run(before, ROUND);
    const g = grabsIn(after(before, s2));
    expect(g.map((e) => [e.player, e.room, e.duffel, e.pocket])).toEqual([
      ["p0", "vault", 0, 3],
      ["p1", "vault", 3, 0],
      ["p2", "rooftop", 0, 0],
    ]);
    expect([s2.players.p0?.stash, s2.players.p1?.stash, s2.players.p2?.stash, s2.haul, s2.bank]).toEqual([3, 0, 0, 3, 48 - 6]);
  });

  it("a Lockdown-closed room refuses every split, even 0 coins in a 0-coin room (design §3.2 step 1, §13)", () => {
    const base = game(5, null, { eventsEnabled: true });
    for (const room of ["vault", "office", "rooftop", "depositBoxes"] as const) {
      const s2 = withCard(base, "lockdown", room);
      const limit = BANK_JOB.rooms[room]?.coins ?? 0;
      expect(refusal(s2, submit("p0", { room, duffel: limit, pocket: 0 }))).toMatch(/closed/);
      expect(refusal(s2, submit("p0", { room, duffel: 0, pocket: Math.min(1, limit) }))).toMatch(/closed/);
    }
  });

  it("out of phase: refused in the alibi window, while awaiting a meeting and after the game ends", () => {
    const resolved = handleCommand(run(s, submit("p0", { room: "lobby", duffel: 1, pocket: 0 })), ROUND(s));
    if (!resolved.ok) throw new Error(resolved.reason);
    expect(resolved.state.phase.kind).toBe("alibis");
    expect(refusal(resolved.state, submit("p0", { room: "lobby", duffel: 1, pocket: 0 }))).toMatch(/only be submitted while a round is being planned/);
    const r3 = run(s, ROUND, ROUND, ROUND);
    expect(r3.phase.kind).toBe("awaitingMeeting");
    expect(refusal(r3, submit("p0", { room: "lobby", duffel: 1, pocket: 0 }))).toMatch(/planned/);
    const ended = { ...r3, phase: { kind: "ended" } } as unknown as GameState;
    expect(refusal(ended, submit("p0", { room: "lobby", duffel: 1, pocket: 0 }))).toMatch(/over/);
  });

  it("wrong player: an unknown, missing, non-string or prototype id is refused", () => {
    for (const player of ["p9", "", undefined, 0, null, "__proto__", "toString", ["p0"]]) {
      expect(refusal(s, { type: "submitMove", player, move: { room: "lobby", duffel: 1, pocket: 0 } })).toMatch(/unknown player/);
    }
  });

  it("a duplicate submit replaces the move, locks in once (public) and only the last move resolves", () => {
    const a = run(s, submit("p0", { room: "vault", duffel: 0, pocket: 3 }));
    const b = run(a, submit("p0", { room: "vault", duffel: 0, pocket: 3 }), submit("p0", { room: "office", duffel: 2, pocket: 0 }));
    expect(a.log.filter((e) => e.type === "moveLocked").length).toBe(1);
    expect(b.log.filter((e) => e.type === "moveLocked").length).toBe(1);
    expect(b.log.filter((e) => e.type === "moveSubmitted").length).toBe(3);
    const s2 = run(b, ROUND);
    expect(grabsIn(after(b, s2)).find((e) => e.player === "p0")).toMatchObject({ room: "office", duffel: 2, pocket: 0 });
    expect(s2.players.p0?.stash).toBe(0);
  });

  it("a refused resubmit keeps the earlier valid move", () => {
    const a = run(s, submit("p0", { room: "vault", duffel: 3, pocket: 0 }));
    expect(handleCommand(a, submit("p0", { room: "vault", duffel: 0, pocket: 4 })).ok).toBe(false);
    expect(a.moves.p0).toEqual({ room: "vault", duffel: 3, pocket: 0 });
  });

  it("unknown move fields are dropped, and a prototype-polluted pocket is ignored", () => {
    const a = run(s, submit("p0", { room: "vault", duffel: 3, pocket: 0, coins: 99, grab: 99 }));
    expect(a.moves.p0).toEqual({ room: "vault", duffel: 3, pocket: 0 });
    const polluted = JSON.parse('{"type":"submitMove","player":"p1","move":{"room":"lobby","duffel":1},"__proto__":{"pocket":1}}') as unknown;
    expect(handleCommand(s, polluted).ok).toBe(false);
  });
});

describe("QA: the bank — design §6.1", () => {
  it("is filled with 16 × players at 3 and 12 players, and by an override, publicly", () => {
    for (const [n, o, coins] of [[3, null, 48], [12, null, 192], [12, { bank: { coinsPerPlayer: 1 } }, 12]] as const) {
      const s = game(n, o);
      const filled = s.log.filter((e) => e.type === "bankFilled");
      expect(filled).toEqual([{ type: "bankFilled", visibility: PUBLIC, coins }]);
      expect(s.bank).toBe(coins);
    }
  });

  it("a 2-player game is refused at setup (3–12 players)", () => {
    expect(validateConfig(config(2)).join(" ")).toMatch(/3–12 players/);
    expect(validateConfig(config(13)).join(" ")).toMatch(/3–12 players/);
  });
});

describe("QA: a short bank — design §3.2", () => {
  /** Resolve `s` with `moves` (missing seats get the default) and return the cut. */
  function resolveWith(s: GameState, moves: Record<PlayerId, Record<string, unknown>>) {
    const before = run(s, ...Object.entries(moves).map(([id, m]) => submit(id, m)));
    const asked = new Map<PlayerId, number>(before.playerOrder.map((id) => {
      const m = before.moves[id];
      return [id, m ? m.duffel + m.pocket : 1];
    }));
    const start = randomInt(before.rng, before.playerOrder.length).value;
    const s2 = run(before, ROUND);
    return { before, s2, asked, start, events: after(before, s2) };
  }

  it("exactly at the boundary (grabs = bank): nothing is cut, no seat is drawn, the bank ends at 0", () => {
    // 3 players, bank 6: grabs 3 + 2 + 1 = 6.
    const { before, s2, events } = resolveWith(game(3, { bank: { coinsPerPlayer: 2 } }), {
      p0: { room: "vault", duffel: 0, pocket: 3 },
      p1: { room: "office", duffel: 1, pocket: 1 },
      p2: { room: "lobby", duffel: 0, pocket: 1 },
    });
    expect(grabsIn(events).map((e) => [e.duffel, e.pocket])).toEqual([[0, 3], [1, 1], [0, 1]]);
    expect(s2.bank).toBe(0);
    expect(resolvedIn(events).bank).toBe(0);
    expect(s2.rng).toEqual(before.rng);
  });

  it("one over the boundary (grabs = bank + 1): exactly one coin is cut, from a pocket first, and a seat is drawn", () => {
    // 3 players, bank 6, grabs 3 + 3 + 1 = 7.
    const { s2, asked, start, events, before } = resolveWith(game(3, { bank: { coinsPerPlayer: 2 } }), {
      p0: { room: "vault", duffel: 2, pocket: 1 },
      p1: { room: "vault", duffel: 2, pocket: 1 },
      p2: { room: "lobby", duffel: 0, pocket: 1 },
    });
    const want = waterFill(before.playerOrder, asked, 6, start);
    const got = grabsIn(events);
    expect(got.reduce((n, e) => n + e.duffel + e.pocket, 0)).toBe(6);
    for (const e of got) expect(e.duffel + e.pocket).toBe(want.get(e.player));
    // The one cut grab lost its pocket coin, not a duffel coin.
    const cut = got.filter((e) => e.duffel + e.pocket < (asked.get(e.player) ?? 0));
    expect(cut).toHaveLength(1);
    expect(cut[0]).toMatchObject({ duffel: 2, pocket: 0 });
    expect(s2.bank).toBe(0);
    expect(s2.rng).not.toEqual(before.rng);
  });

  it("pocket first, then duffel: a cut can take every pocket coin and then duffel coins", () => {
    // 4 players, bank 4, all in the Vault with 1 duffel + 2 pocket: each gets 1, which is duffel-bound.
    const all = { room: "vault", duffel: 1, pocket: 2 };
    const r = resolveWith(game(4, { bank: { coinsPerPlayer: 1 } }), { p0: all, p1: all, p2: all, p3: all });
    expect(grabsIn(r.events).map((e) => [e.duffel, e.pocket])).toEqual([[1, 0], [1, 0], [1, 0], [1, 0]]);
    const r2 = resolveWith(game(3, { bank: { coinsPerPlayer: 1 } }), { p0: { room: "vault", duffel: 2, pocket: 1 }, p1: { room: "vault", duffel: 0, pocket: 3 }, p2: { room: "rooftop", duffel: 0, pocket: 0 } });
    // Bank 3, asks 3 + 3 + 0: the drawn seat of p0/p1 gets 2, the other 1 (p2 asks nothing).
    const g = Object.fromEntries(grabsIn(r2.events).map((e) => [e.player, [e.duffel, e.pocket]]));
    const want = waterFill(r2.before.playerOrder, r2.asked, 3, r2.start);
    expect(g.p0).toEqual([want.get("p0"), 0]); // p0's coins are duffel-bound up to 2
    expect(g.p1).toEqual([0, want.get("p1")]); // p1 asked only pocket coins
    expect(g.p2).toEqual([0, 0]);
  });

  it("a missed move (Lobby, 1 coin, handed in) is cut like any grab", () => {
    // 3 players, bank 3: p0 and p1 take the Vault, p2 misses.
    const r = resolveWith(game(3, { bank: { coinsPerPlayer: 1 } }), { p0: { room: "vault", duffel: 0, pocket: 3 }, p1: { room: "vault", duffel: 0, pocket: 3 } });
    const want = waterFill(r.before.playerOrder, r.asked, 3, r.start);
    const g = grabsIn(r.events);
    expect(g.map((e) => e.duffel + e.pocket)).toEqual(r.before.playerOrder.map((id) => want.get(id)));
    expect(g.find((e) => e.player === "p2")).toMatchObject({ room: "lobby", duffel: want.get("p2"), pocket: 0 });
  });

  it("matches the round-robin from the drawn seat for random moves at 3, 4, 5, 8, 9 and 12 players, round after round until the bank is empty", () => {
    let cut = 0;
    let checked = 0;
    for (const n of [3, 4, 5, 8, 9, 12]) {
      for (let trial = 0; trial < 25; trial++) {
        const rand = prng(n * 1000 + trial);
        let s = game(n, { bank: { coinsPerPlayer: 1 + rand(3) } }, { seed: `short-${n}-${trial}` });
        const filled = s.bank;
        let taken = 0;
        while (s.phase.kind === "planning") {
          const moves: Record<PlayerId, Record<string, unknown>> = {};
          for (const id of s.playerOrder) if (rand(6) > 0) moves[id] = randomMove(s, rand);
          const bankBefore = s.bank;
          const r = resolveWith(s, moves);
          const want = waterFill(r.before.playerOrder, r.asked, bankBefore, r.start);
          const g = grabsIn(r.events);
          expect(g.map((e) => e.player)).toEqual(r.before.playerOrder);
          for (const e of g) {
            const m = r.before.moves[e.player];
            const askedDuffel = m ? m.duffel : 1;
            const coins = want.get(e.player) ?? -1;
            expect(e.duffel + e.pocket, `n=${n} t=${trial} ${e.player}`).toBe(coins);
            // design §3.2: pocket-bound coins are cut first.
            expect(e.duffel).toBe(Math.min(askedDuffel, coins));
            expect(e.room).toBe(m ? m.room : "lobby");
          }
          const sum = g.reduce((a, e) => a + e.duffel + e.pocket, 0);
          if (sum < [...r.asked.values()].reduce((a, b) => a + b, 0)) cut++;
          taken += sum;
          expect(sum).toBe(Math.min(bankBefore, [...r.asked.values()].reduce((a, b) => a + b, 0)));
          expect(resolvedIn(r.events).bank).toBe(bankBefore - sum);
          expect(r.s2.bank).toBe(bankBefore - sum);
          expect(r.s2.bank).toBeGreaterThanOrEqual(0);
          checked++;
          s = r.s2;
          if (s.bank === 0 || s.round > 3) break; // the bank doesn't end the game until S3a.3
        }
        expect(s.bank).toBe(filled - taken);
      }
    }
    expect(cut).toBeGreaterThan(50);
    expect(checked).toBeGreaterThan(150);
  });

  it("the drawn seat is uniform-ish across seeds at 12 players: every seat starts the round-robin sometimes", () => {
    const starts = new Set<number>();
    for (let i = 0; i < 200 && starts.size < 12; i++) {
      const s = game(12, { bank: { coinsPerPlayer: 1 } }, { seed: `seat-${i}` });
      const before = run(s, ...s.playerOrder.map((id) => submit(id, { room: "vault", duffel: 3, pocket: 0 })));
      const start = randomInt(before.rng, 12).value;
      const s2 = run(before, ROUND);
      // Bank 12, 12 grabs of 3: everyone gets exactly 1, whoever starts.
      expect(grabsIn(after(before, s2)).every((e) => e.duffel === 1 && e.pocket === 0)).toBe(true);
      starts.add(start);
    }
    expect(starts.size).toBe(12);
  });

  it("12 players, bank 13, Vault grabs of 3: the drawn seat alone gets 2 (round-robin starts there)", () => {
    // Bank 24: round 1, 11 Lobby grabs (11) → 13 left; round 2, all in the Vault.
    const s = game(12, { bank: { coinsPerPlayer: 2 } }, { seed: "seat-13" });
    const r1 = run(s, ...s.playerOrder.map((id, i) => submit(id, i < 11 ? { room: "lobby", duffel: 1, pocket: 0 } : { room: "rooftop", duffel: 0, pocket: 0 })), ROUND);
    expect(r1.bank).toBe(13);
    const before = run(r1, ...r1.playerOrder.map((id) => submit(id, { room: "vault", duffel: 0, pocket: 3 })));
    const start = randomInt(before.rng, 12).value;
    const s2 = run(before, ROUND);
    const g = grabsIn(after(before, s2));
    const two = g.filter((e) => e.pocket === 2).map((e) => e.player);
    expect(two).toEqual([before.playerOrder[start]]);
    expect(g.filter((e) => e.pocket === 1)).toHaveLength(11);
    expect(s2.bank).toBe(0);
  });

  it("once the bank is empty every grab is 0 and nothing is drawn beyond the seat", () => {
    let s = run(game(3, { bank: { coinsPerPlayer: 1 } }), ROUND); // three missed moves take the 3 coins
    expect(s.bank).toBe(0);
    for (let k = 0; k < 2; k++) {
      const before = run(s, submit("p0", { room: "vault", duffel: 0, pocket: 3 }), submit("p1", { room: "office", duffel: 1, pocket: 1 }));
      s = run(before, ROUND);
      expect(grabsIn(after(before, s)).map((e) => e.duffel + e.pocket)).toEqual([0, 0, 0]);
      expect(resolvedIn(after(before, s))).toMatchObject({ bank: 0, haulDelta: 0 });
      expect(s.players.p0?.stash).toBe(0);
    }
  });
});

describe("QA: the bank may run short — the preview's inputs are public (design §3.2)", () => {
  /** design §3.2: every player's highest grab, from public information only (the view and content). */
  function mayRunShort(view: PlayerView): boolean {
    const open = view.rooms.filter((r) => r !== view.card?.room || view.card?.id !== "lockdown");
    const extra = view.card?.id === "shiftChange" ? 1 : 0;
    const highest = Math.max(...open.map((r) => (BANK_JOB.rooms[r]?.coins ?? 0) + (r === "vault" ? extra : 0)));
    return highest * (view.players.length + 1) > view.bank;
  }

  it("a viewer's planning view is the same whatever the others have picked, so a preview from it uses public maximums only", () => {
    const s = game(4, { bank: { coinsPerPlayer: 3 } });
    const greedy = run(s, ...["p1", "p2", "p3"].map((id) => submit(id, { room: "vault", duffel: 0, pocket: 3 })));
    const meek = run(s, ...["p1", "p2", "p3"].map((id) => submit(id, { room: "lobby", duffel: 1, pocket: 0 })));
    const strip = (v: PlayerView) => JSON.parse(JSON.stringify({ ...v, ledger: v.ledger.map((l) => l.event) })) as unknown;
    expect(strip(viewFor(greedy, "p0"))).toEqual(strip(viewFor(meek, "p0")));
    // Bank 12, 4 players × the Vault's 3 = 12: not short; one coin fewer and it may run short.
    expect(mayRunShort(viewFor(greedy, "p0"))).toBe(false);
    const after1 = run(s, submit("p0", { room: "lobby", duffel: 1, pocket: 0 }), ...["p1", "p2", "p3"].map((id) => submit(id, { room: "rooftop", duffel: 0, pocket: 0 })), ROUND);
    expect(viewFor(after1, "p2").bank).toBe(11);
    expect(mayRunShort(viewFor(after1, "p2"))).toBe(true);
  });
});

describe("QA: determinism — same seed + same commands → identical log", () => {
  function play(seed: string, n: number): GameState {
    const rand = prng(42);
    let s = game(n, { bank: { coinsPerPlayer: 2 } }, { seed, eventsEnabled: true, rolePool: ["rookie", "lookout", "hacker"] });
    for (let k = 0; k < 3 && s.phase.kind === "planning"; k++) {
      for (const id of s.playerOrder) if (rand(5) > 0) s = run(s, submit(id, randomMove(s, rand)));
      s = run(s, ROUND);
    }
    return s;
  }

  it("at 3 and 12 players, short-bank rounds with events on replay byte for byte, and from the JSON log", () => {
    for (const n of [3, 12]) {
      const a = play("det", n);
      const b = play("det", n);
      expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
      expect(replay(a.config, JSON.parse(JSON.stringify(a.log)) as GameEvent[])).toEqual(a);
    }
  });

  it("the seed decides who is cut: different seeds give different cuts somewhere", () => {
    const cuts = new Set<string>();
    for (let i = 0; i < 20; i++) {
      // Bank 6, asks 3 + 3 + 1: one of p0/p1 gets the 6th coin, whichever the drawn seat reaches first.
      const s = game(3, { bank: { coinsPerPlayer: 2 } }, { seed: `cut-${i}` });
      const before = run(s, submit("p0", { room: "vault", duffel: 1, pocket: 2 }), submit("p1", { room: "vault", duffel: 1, pocket: 2 }), submit("p2", { room: "lobby", duffel: 1, pocket: 0 }));
      cuts.add(JSON.stringify(grabsIn(after(before, run(before, ROUND))).map((e) => e.duffel + e.pocket)));
    }
    expect(cuts.size).toBeGreaterThan(1);
  });
});

describe("QA: viewFor never leaks the new events", () => {
  /** Play `s` through every round (meetings with no votes) to the end. */
  function playOut(s: GameState, moves: (s: GameState, id: PlayerId) => Record<string, unknown>): GameState {
    while (s.phase.kind !== "ended") {
      if (s.phase.kind === "planning") {
        const now = s;
        s = run(s, ...s.playerOrder.map((id) => submit(id, moves(now, id))), ROUND);
      } else if (s.phase.kind === "awaitingMeeting") {
        const { act } = s.phase;
        s = run(s, { type: "scheduleMeeting", act, slot: `slot-${act}` }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `act-${act}` } }, { type: "advance", deadline: { kind: "closeMeeting", meetingId: `act-${act}` } });
      } else throw new Error(`unexpected phase ${s.phase.kind}`);
    }
    return s;
  }

  it("bankFilled is in every player's ledger, identical, with only its coin count", () => {
    const s = game(12);
    const seen = s.playerOrder.map((id) => viewFor(s, id).ledger.filter((l) => l.event.type === "bankFilled").map((l) => l.event));
    for (const v of seen) expect(v).toEqual([{ type: "bankFilled", visibility: PUBLIC, coins: 192 }]);
    for (const id of s.playerOrder) expect(viewFor(s, id).caseFile.some((l) => (l.event as GameEvent).type === "bankFilled")).toBe(false);
  });

  it("during the game each player sees only their own coinsGrabbed and moves; after the end the reveal shows everyone's", () => {
    const s0 = game(3);
    const mid = run(s0, submit("p0", { room: "vault", duffel: 0, pocket: 3 }), submit("p1", { room: "office", duffel: 1, pocket: 1 }), submit("p2", { room: "lobby", duffel: 1, pocket: 0 }), ROUND);
    for (const id of mid.playerOrder) {
      const v = viewFor(mid, id);
      expect(v.ledger.some((l) => (l.event as GameEvent).type === "coinsGrabbed")).toBe(false);
      const own = v.caseFile.filter((l) => l.event.type === "coinsGrabbed").map((l) => l.event as Grabbed);
      expect(own.map((e) => e.player)).toEqual([id]);
      expect(v.caseFile.every((l) => !("player" in l.event) || l.event.player === id)).toBe(true);
      expect(v.reveal).toBeNull();
    }
    const end = playOut(mid, (_s, id) => (id === "p0" ? { room: "vault", duffel: 0, pocket: 3 } : { room: "office", duffel: 2, pocket: 0 }));
    const v = viewFor(end, "p2");
    const shown = (v.reveal?.log ?? []).filter((l) => l.event.type === "coinsGrabbed").map((l) => l.event as Grabbed);
    expect(new Set(shown.map((e) => e.player))).toEqual(new Set(["p0", "p1", "p2"]));
    expect(shown.find((e) => e.player === "p1" && e.round === 1)).toMatchObject({ room: "office", duffel: 1, pocket: 1 });
    const r1 = v.reveal?.summary.rounds.find((r) => r.round === 1);
    expect(r1?.moves.map((m) => [m.player, m.room, m.duffel, m.pocket])).toEqual([
      ["p0", "vault", 0, 3],
      ["p1", "office", 1, 1],
      ["p2", "lobby", 1, 0],
    ]);
  });

  it("swapping two players' splits (same rooms) changes nothing in a third player's view, short bank or not", () => {
    for (const coinsPerPlayer of [16, 1]) {
      const s = game(3, { bank: { coinsPerPlayer } }, { seed: "swap" });
      const a = run(s, submit("p0", { room: "vault", duffel: 0, pocket: 3 }), submit("p1", { room: "vault", duffel: 3, pocket: 0 }), submit("p2", { room: "office", duffel: 2, pocket: 0 }), ROUND);
      const b = run(s, submit("p0", { room: "vault", duffel: 3, pocket: 0 }), submit("p1", { room: "vault", duffel: 0, pocket: 3 }), submit("p2", { room: "office", duffel: 2, pocket: 0 }), ROUND);
      expect(viewFor(a, "p2")).toEqual(viewFor(b, "p2"));
      expect(viewFor(a, "p0")).not.toEqual(viewFor(b, "p0"));
    }
  });

  it("who was cut by a short bank is not public: the drawn seat is in no visible event", () => {
    const play = (coinsPerPlayer: number) => {
      const s = game(4, { bank: { coinsPerPlayer } }, { seed: "hidden-seat" });
      return run(s, ...s.playerOrder.map((id) => submit(id, { room: "vault", duffel: 3, pocket: 0 })), ROUND);
    };
    const short = play(1);
    const full = play(16);
    for (const id of short.playerOrder) {
      const v = viewFor(short, id);
      expect(v.caseFile.filter((l) => l.event.type === "coinsGrabbed").every((l) => (l.event as Grabbed).player === id)).toBe(true);
      // The same public events, in the same order, as a round the bank covered: no event names the drawn seat.
      expect(v.ledger.map((l) => l.event.type)).toEqual(viewFor(full, id).ledger.map((l) => l.event.type));
      expect(v.caseFile.map((l) => l.event.type)).toEqual(viewFor(full, id).caseFile.map((l) => l.event.type));
    }
  });
});

describe("QA: conservation — every coin grabbed leaves the bank and lands in one bag (design §6.1, §7.7)", () => {
  it("over random games at 3, 8 and 12 players with events on: per round, bank drop = Σ grabbed, haul growth = Σ duffel; pockets reach stashes", () => {
    for (const n of [3, 8, 12]) {
      for (let trial = 0; trial < 6; trial++) {
        const rand = prng(7 * n + trial);
        let s = game(n, { bank: { coinsPerPlayer: [16, 3, 1][trial % 3] as number } }, { seed: `cons-${n}-${trial}`, eventsEnabled: true });
        const filled = s.bank;
        let total = 0;
        for (let k = 0; k < 3 && s.phase.kind === "planning"; k++) {
          for (const id of s.playerOrder) if (rand(5) > 0) s = run(s, submit(id, randomMove(s, rand)));
          const before = s;
          const stashBefore = new Map(s.playerOrder.map((id) => [id, s.players[id]?.stash ?? 0]));
          s = run(s, ROUND);
          const ev = after(before, s);
          const g = grabsIn(ev);
          const res = resolvedIn(ev);
          const sum = g.reduce((a, e) => a + e.duffel + e.pocket, 0);
          expect(before.bank - res.bank).toBe(sum);
          expect(res.haulDelta).toBe(g.reduce((a, e) => a + e.duffel, 0));
          for (const e of g) {
            expect(e.duffel).toBeGreaterThanOrEqual(0);
            expect(e.pocket).toBeGreaterThanOrEqual(0);
            expect((s.players[e.player]?.stash ?? 0) - (stashBefore.get(e.player) ?? 0)).toBe(e.pocket);
          }
          total += sum;
          expect(s.bank).toBe(filled - total);
          expect(s.bank).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
