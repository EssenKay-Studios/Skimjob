// QA round 3 (S3a.7, #94): attacks on the order of a round's power cuts. All
// of a round's cuts (Blackout perks and Electricians) come out together as the
// next round starts, in an order that must carry no information: not which
// cut was a perk and which an Electrician's, not the order the perks were
// bought, not the buyers' lock-in order. design §11.1, §12, §18
import { describe, expect, it } from "vitest";
import { PERK_IDS } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { privateTo } from "./types";
import { setupEvents } from "./setup";
import { applyEvent, replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { fullGrab } from "./grab.testkit";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "qa-power-cut-order",
    players: ids(players).map((id, i) => ({ id, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}

/** Every seat a Lookout but those in `electricians`; all seven perks on sale; every stash at 9. */
function game(players: number, electricians: readonly string[] = [], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  const s = replay(
    cfg,
    setupEvents(cfg).map((e): GameEvent =>
      e.type === "roleDealt" ? { ...e, role: electricians.includes(e.player) ? "electrician" : "lookout" } : e.type === "shopDealt" ? { ...e, perks: PERK_IDS } : e,
    ),
  );
  return { ...s, players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...(p as PlayerState), stash: 9 }])) };
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    if (Array.isArray(command)) return run(s, ...(command as Cmd[]));
    const r = handleCommand(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    return r.state;
  }, state);
}

const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const blackout = (p: string, room: string) => ({ type: "buyPerk", player: p, perk: { kind: "blackout", room } });
const mv = (p: string, room = "lobby", pocket = 0, extra: object = {}) => ({ type: "submitMove", player: p, move: { ...fullGrab(room, pocket), ...extra } });
const cut = (p: string, room: string) => mv(p, "lobby", 0, { ability: { kind: "blackout", room } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const ALIBI = (s: GameState) => ({ type: "advance", deadline: { kind: "alibi", round: s.resolvedRound } });
const RESULT = (s: GameState) => ({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } });
// design §4.1, §10: the alibi window closes before the result window.
const NEXT = [ROUND, ALIBI, RESULT];
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
const vote = (p: string, target: string) => ({ type: "castVote", player: p, vote: { kind: "shakedown", target } });

const ledger = (s: GameState, id: string) => viewFor(s, id).ledger.map(({ event }) => event);
const cutsOf = (s: GameState, round: number) =>
  ofType(s.log, "powerCut")
    .filter((e) => e.round === round)
    .map((e) => e.room);
/** The rooms in `set`, in the game's room order. */
const inRoomOrder = (s: GameState, set: Iterable<string>) => s.rooms.filter((r) => new Set(set).has(r));

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/** A small seeded PRNG for the sweep (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled<T>(xs: readonly T[], r: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe("QA: power cuts come out together, in an order that tells nothing — design §11.1, §12, §18", () => {
  // 12 players: p0, p1 and p2 can buy, p3 is the Electrician, p4 the bystander; everyone else misses the move.
  const ROOMS = ["vault", "security", "serverRoom"] as const;

  /**
   * Round 1 with three cuts: `rooms[0..2]` go to buyer p0, buyer p1 and the
   * Electrician p3. `buyOrder` is the order p0 and p1 buy; `buyFirst` says
   * whether each buys before (true) or after its own lock-in. The lock-ins are
   * always p0, p1, p3, p4. Returns the state once round 2 has started.
   */
  function threeCuts(rooms: readonly string[], buyOrder: readonly ("p0" | "p1")[], buyFirst: boolean, electricianCuts = true): GameState {
    const room = { p0: rooms[0] as string, p1: rooms[1] as string };
    const buys = buyOrder.map((p) => blackout(p, room[p]));
    const locks = [mv("p0"), mv("p1"), electricianCuts ? cut("p3", rooms[2] as string) : blackout("p3", rooms[2] as string), mv("p4")];
    const planning = buyFirst ? [...buys, ...locks] : [...locks, ...buys];
    return run(game(12, ["p3"]), ...planning, ...NEXT);
  }

  it("three cuts (two Blackouts and an Electrician's): every assignment of rooms to sources, buy order and buy timing gives the bystander one ledger", () => {
    const reference = threeCuts(ROOMS, ["p0", "p1"], true);
    const expected = inRoomOrder(reference, ROOMS);
    expect(cutsOf(reference, 2)).toEqual(expected);
    expect(reference.dark).toEqual(expected);
    const view = ledger(reference, "p4");
    for (const rooms of permutations(ROOMS))
      for (const order of [["p0", "p1"], ["p1", "p0"]] as const)
        for (const buyFirst of [true, false]) {
          const s = threeCuts(rooms, order, buyFirst);
          expect(cutsOf(s, 2)).toEqual(expected);
          expect(ledger(s, "p4")).toEqual(view);
          expect(viewFor(s, "p4")).toEqual(viewFor(reference, "p4"));
        }
  });

  it("three Blackout perks (no Electrician's cut): every assignment of rooms and buy order gives one ledger, also against three bought in reverse room order", () => {
    // p3 is still dealt the Electrician but buys a Blackout instead of cutting.
    const reference = threeCuts(ROOMS, ["p0", "p1"], true, false);
    expect(cutsOf(reference, 2)).toEqual(inRoomOrder(reference, ROOMS));
    for (const rooms of permutations(ROOMS))
      for (const order of [["p0", "p1"], ["p1", "p0"]] as const) expect(ledger(threeCuts(rooms, order, false, false), "p4")).toEqual(ledger(reference, "p4"));
  });

  it("the same room cut twice (two Blackouts, or a Blackout and an Electrician, or all three): one powerCut, the same ledger whichever came first", () => {
    for (const twice of [
      // two perks on the Office, either buy order
      [[blackout("p0", "office"), blackout("p1", "office")], [blackout("p1", "office"), blackout("p0", "office")]],
      // a perk and the Electrician on the Office, the perk bought before or after the cut is locked in
      [[blackout("p0", "office"), cut("p3", "office")], [cut("p3", "office"), blackout("p0", "office")]],
      // all three on the Office, two orders
      [
        [blackout("p0", "office"), blackout("p1", "office"), cut("p3", "office")],
        [cut("p3", "office"), blackout("p1", "office"), blackout("p0", "office")],
      ],
    ]) {
      const [a, b] = twice.map((cmds) => run(game(12, ["p3"]), ...(cmds as Cmd[]), ...NEXT));
      for (const s of [a, b] as GameState[]) {
        expect(cutsOf(s, 2)).toEqual(["office"]);
        expect(s.dark).toEqual(["office"]);
        expect(s.cutsPending).toEqual([]);
      }
      expect(ledger(b as GameState, "p4")).toEqual(ledger(a as GameState, "p4"));
    }
    // A doubled room next to a single one still comes out in room order, the doubled one once.
    const mixed = run(game(12, ["p3"]), blackout("p0", "serverRoom"), cut("p3", "vault"), blackout("p1", "serverRoom"), ...NEXT);
    expect(cutsOf(mixed, 2)).toEqual(inRoomOrder(mixed, ["vault", "serverRoom"]));
    const swapped = run(game(12, ["p3"]), blackout("p1", "vault"), blackout("p0", "serverRoom"), cut("p3", "serverRoom"), ...NEXT);
    expect(cutsOf(swapped, 2)).toEqual(cutsOf(mixed, 2));
  });

  it("a cut next to a held Bail: the round's cuts survive the emergency and the Bail window, in room order, whatever the Bail choice", () => {
    // 4 players: p0 the Electrician, p1 holds a Bail, buys a Blackout and pockets the Vault's 3; p0, p2, p3 vote p1 down.
    const play = (perkRoom: string, elecRoom: string, choice: boolean | null) => {
      // A Bail bought before this round (round 0), so round 1's purchase is still free.
      let s = applyEvent(game(4, ["p0"]), { type: "perkBought", visibility: privateTo("p1"), player: "p1", round: 0, perk: { kind: "bail" }, cost: 0 });
      expect((s.players.p1 as PlayerState).roleState.bail).toBe(true);
      s = run(
        s,
        blackout("p1", perkRoom),
        mv("p1", "vault", 3),
        cut("p0", elecRoom),
        ROUND,
        ALIBI,
        { type: "callEmergency", player: "p2" },
        (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.pendingEmergency?.meetingId } }),
        vote("p0", "p1"),
        vote("p2", "p1"),
        vote("p3", "p1"),
        CLOSE,
      );
      expect(s.pendingShakedown).not.toBeNull();
      // The cuts wait through the Bail window, unannounced.
      expect(cutsOf(s, 2)).toEqual([]);
      expect([...s.cutsPending].sort()).toEqual([perkRoom, elecRoom].sort());
      if (choice !== null) s = run(s, { type: "chooseBail", player: "p1", use: choice });
      s = run(s, RESOLVE);
      while (s.round < 2) s = run(s, s.phase.kind === "alibi" ? ALIBI : s.phase.kind === "result" ? RESULT : ROUND);
      return s;
    };
    const runs = [play("office", "vault", true), play("vault", "office", true), play("office", "vault", false), play("vault", "office", null)];
    for (const s of runs) {
      expect(s.round).toBe(2);
      expect(cutsOf(s, 2)).toEqual(inRoomOrder(s, ["office", "vault"]));
      expect(s.dark).toEqual(inRoomOrder(s, ["office", "vault"]));
    }
    // Same Bail choice, rooms swapped between the perk and the Electrician: the bystander's whole ledger matches.
    expect(ledger(runs[1] as GameState, "p3")).toEqual(ledger(runs[0] as GameState, "p3"));
    // The Bail was used in the first two and kept in the others.
    expect(runs.map((s) => (s.players.p1 as PlayerState).roleState.bail)).toEqual([false, false, true, true]);
  });

  it("seeded sweep at 3, 8 and 12 players with events on: random rooms, sources, buy orders and timings; the cuts are always the set in room order and the bystander's ledger never changes with the buy order", () => {
    let checked = 0;
    for (const n of [3, 8, 12])
      for (let i = 0; i < 25; i++) {
        const r = prng(n * 1000 + i);
        const extra = { seed: `qa-cut-sweep-${n}-${i}`, eventsEnabled: true };
        const elec = n >= 4 && r() < 0.6 ? `p${n - 1}` : null;
        const buyers = ids(Math.min(3, n - 1)).filter(() => r() < 0.8);
        const pool = game(n, elec ? [elec] : [], extra).rooms;
        const pickRoom = () => pool[Math.floor(r() * pool.length)] as string;
        const target = Object.fromEntries(buyers.map((p) => [p, pickRoom()]));
        const elecRoom = elec ? pickRoom() : null;
        // Two rounds: the cuts bought in round 1 land in round 2, and again round 2's in round 3.
        const plan = (order: readonly string[], buyFirst: boolean): Cmd[] => {
          const buys = order.map((p) => blackout(p, target[p] as string));
          const locks = ids(n).map((p) => (p === elec && elecRoom ? cut(p, elecRoom) : mv(p)));
          return buyFirst ? [...buys, ...locks] : [...locks, ...buys];
        };
        const play = (order: readonly string[], buyFirst: boolean) => run(game(n, elec ? [elec] : [], extra), ...plan(order, buyFirst), ...NEXT);
        const reference = play(buyers, true);
        const set = [...Object.values(target), ...(elecRoom ? [elecRoom] : [])];
        expect(cutsOf(reference, 2)).toEqual(inRoomOrder(reference, set));
        expect(new Set(reference.dark)).toEqual(new Set(set));
        const bystander = n === 3 ? "p2" : "p3";
        for (let k = 0; k < 3; k++) {
          const other = play(shuffled(buyers, r), r() < 0.5);
          expect(cutsOf(other, 2)).toEqual(cutsOf(reference, 2));
          // Purchases are private: whatever their order or timing against the lock-ins, the bystander's whole ledger is the same.
          expect(ledger(other, bystander)).toEqual(ledger(reference, bystander));
          checked++;
        }
      }
    expect(checked).toBe(225);
  });

  it("determinism: the same seed and commands give the same cuts and the same log", () => {
    const cmds = [blackout("p1", "serverRoom"), cut("p3", "vault"), blackout("p0", "security"), mv("p0"), mv("p1"), ...NEXT];
    const a = run(game(12, ["p3"], { eventsEnabled: true }), ...cmds);
    const b = run(game(12, ["p3"], { eventsEnabled: true }), ...cmds);
    expect(b.log).toEqual(a.log);
    expect(cutsOf(a, 2)).toEqual(inRoomOrder(a, ["vault", "security", "serverRoom"]));
  });
});
