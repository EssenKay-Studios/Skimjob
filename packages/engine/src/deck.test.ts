// The events deck: from round 2, a 4-in-10 chance of one public card as the
// round starts, and each card's effect. design §13
import { describe, expect, it } from "vitest";
import { NO_RAIDS } from "./v01-numbers.testkit";
import { handleThroughAlibis } from "./alibis.testkit";
import { EVENTS, EVENT_CHANCE, EVENT_DECK, EVENTS_FROM_ROUND, type RoomId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { PUBLIC, privateTo } from "./types";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { viewFor } from "./view";
import { closedRoom, startRound } from "./deck";
import type { Draw } from "./handle";
import { fullGrab } from "./grab.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "deck-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: true,
    voteVisibility: "open",
    // Bells too big to raid: these scripts test other rules (bells and raids: bells.test.ts).
    contentOverrides: NO_RAIDS,
    ...extra,
  };
}

/** A new game, seat i dealt roles[i] (a Lookout if missing). */
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
    const r = handleThroughAlibis(s, c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}

const move = (player: PlayerId, room: RoomId, pocket = 0) => ({ type: "submitMove", player, move: fullGrab(room, pocket) });

/** Everyone not in `moves` goes to the Office (or the Lobby if the Office is closed); then the round resolves. */
function resolve(state: GameState, moves: Record<PlayerId, Record<string, unknown>> = {}): GameState {
  let s = state;
  for (const id of s.playerOrder) s = run(s, { type: "submitMove", player: id, move: moves[id] ?? fullGrab(closedRoom(s) === "office" ? "lobby" : "office") });
  return run(s, { type: "advance", deadline: { kind: "round", round: s.round } });
}

/** The events of the latest round, from its roundStarted to its roundResolved. */
function lastRound(s: GameState): GameEvent[] {
  let end = s.log.length - 1;
  while (s.log[end]?.type !== "roundResolved") end--;
  let start = end;
  while (start > 0 && s.log[start]?.type !== "roundStarted") start--;
  return s.log.slice(start, end + 1);
}

/** This round's card set to `card` (any card the round flipped removed), by rewriting the log and replaying it. */
function withCard(state: GameState, card: string, room: RoomId | null = null): GameState {
  const at = state.log.map((e) => e.type).lastIndexOf("roundStarted");
  const rest = state.log.slice(at + 1).filter((e) => e.type !== "eventFlipped" && e.type !== "insideTip");
  const flipped: GameEvent = { type: "eventFlipped", visibility: PUBLIC, round: state.round, card, room };
  return replay(state.config, [...state.log.slice(0, at + 1), flipped, ...rest]);
}

/** One round, or the meeting it called with no votes. */
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

function playThrough(state: GameState): GameState {
  let s = state;
  while (s.phase.kind !== "ended") s = step(s);
  return s;
}

const find = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** A draw that always flips (`int` 0) and picks `card` from the deck; any other pick takes `other(items)`, the first item by default. */
const forcing = (card: string, other = <T,>(items: readonly T[]): T => items[0] as T): Draw => ({
  int: () => 0,
  pick: <T,>(items: readonly T[]) => (items.includes(card as T) ? (card as T) : other(items)),
  shuffle: <T,>(items: readonly T[]) => [...items],
});

describe("the deck — design §13", () => {
  it("has the four cards of §13 as data, and a 4-in-10 chance from round 2", () => {
    expect(EVENT_DECK.map((id) => EVENTS[id]?.name)).toEqual(["Shift change", "Lockdown", "Audit", "Inside tip"]);
    expect(EVENT_CHANCE).toEqual({ in: 4, of: 10 });
    expect(EVENTS_FROM_ROUND).toBe(2);
  });

  it("flips at most one public card per round, from round 2, right after roundStarted, about 4 rounds in 10, repeats allowed (owner, 6 Nov)", () => {
    let rounds = 0;
    let flipped = 0;
    let repeats = 0;
    for (const n of [3, 5, 8, 12]) {
      for (let i = 0; i < 10; i++) {
        const end = playThrough(createGame(config(n, { seed: `flip-${n}-${i}` })));
        const flips = find(end.log, "eventFlipped");
        rounds += end.round - 1;
        flipped += flips.length;
        if (new Set(flips.map((f) => f.card)).size < flips.length) repeats++;
        expect(new Set(flips.map((f) => f.round)).size).toBe(flips.length);
        for (const f of flips) {
          expect(f.round).toBeGreaterThanOrEqual(2);
          expect(f.visibility).toEqual(PUBLIC);
          expect(EVENT_DECK).toContain(f.card);
          expect(end.log[end.log.indexOf(f) - 1]).toMatchObject({ type: "roundStarted", round: f.round });
        }
      }
    }
    // 4 in 10 of the rounds from 2 on (a card that can't apply flips nothing, so slightly fewer).
    expect(flipped / rounds).toBeGreaterThan(0.3);
    expect(flipped / rounds).toBeLessThan(0.5);
    expect(repeats).toBeGreaterThan(0);
  });

  it("is drawn with the seeded RNG: same seed, same cards; other seeds, other cards (design §19.1)", () => {
    const cards = (seed: string) => find(playThrough(createGame(config(4, { seed }))).log, "eventFlipped").map((e) => `${e.round}:${e.card}`);
    expect(cards("same")).toEqual(cards("same"));
    expect(new Set(["a", "b", "c", "d", "e"].map((s) => cards(s).join())).size).toBeGreaterThan(1);
  });

  it("flips nothing when the host turns events off, and never in round 1 (design §13, §16)", () => {
    expect(createGame(config(4)).card).toBeNull();
    expect(find(playThrough(createGame(config(4, { eventsEnabled: false }))).log, "eventFlipped")).toEqual([]);
  });

  it("6 in 10: nothing happens (the roll misses, no card is drawn)", () => {
    const s = resolve(game(3));
    const miss: Draw = { ...forcing("audit"), int: () => EVENT_CHANCE.in };
    expect(startRound(s, 3, miss)).toEqual([{ type: "roundStarted", visibility: PUBLIC, round: 3 }]);
    expect(startRound(s, 3, forcing("audit"))).toContainEqual({ type: "eventFlipped", visibility: PUBLIC, round: 3, card: "audit", room: null });
  });

  it("shows the card in every view while its round is planned, and clears it when the round resolves", () => {
    const s = withCard(resolve(game(3)), "lockdown", "vault");
    for (const id of s.playerOrder) expect(viewFor(s, id).card).toEqual({ round: 2, id: "lockdown", room: "vault" });
    expect(resolve(s).card).toBeNull();
  });
});

describe("card effects — design §13", () => {
  it("Shift change: Vault visitors can grab 1 extra coin, and every one rings (§5.2)", () => {
    const base = withCard(resolve(game(4)), "shiftChange");
    const s = resolve(base, { p0: { room: "vault", duffel: 1, pocket: 3 } });
    expect(find(lastRound(s), "coinsGrabbed").find((e) => e.player === "p0")).toMatchObject({ duffel: 1, pocket: 3, seized: 0 });
    expect(find(lastRound(s), "bellsRung")[0]).toMatchObject({ bells: { vault: 4 } });
    expect(handleThroughAlibis(base, { type: "submitMove", player: "p0", move: { room: "vault", duffel: 1, pocket: 4 } }).ok).toBe(false);
    const plain = withCard(resolve(game(4)), "audit");
    expect(handleThroughAlibis(plain, { type: "submitMove", player: "p0", move: { room: "vault", duffel: 1, pocket: 3 } }).ok).toBe(false);
  });

  it("Shift change can't apply with the Vault taped off: no event that round", () => {
    const s = resolve(game(3));
    expect(find(startRound({ ...s, taped: { vault: 3 } }, 3, forcing("shiftChange")), "eventFlipped")).toEqual([]);
    // Tape that runs out as the round starts doesn't stop it (§5.3: the room reopens).
    expect(find(startRound({ ...s, taped: { vault: 2 } }, 3, forcing("shiftChange")), "eventFlipped")).toHaveLength(1);
  });

  it("Lockdown: the named room is refused for the round and reopens the next", () => {
    const s = withCard(resolve(game(4)), "lockdown", "vault");
    expect(handleThroughAlibis(s, move("p0", "vault")).ok).toBe(false);
    expect(handleThroughAlibis(s, move("p0", "office")).ok).toBe(true);
    expect(handleThroughAlibis(withCard(resolve(s), "audit"), move("p0", "vault")).ok).toBe(true);
  });

  it("Lockdown closes an open room, never the Lobby or the Rooftop; with none left, no event that round", () => {
    const s = { ...resolve(game(12)), taped: { office: 3 } };
    // Every room it may pick, each tried in turn.
    const pool = (n: number) => find(startRound(s, 3, forcing("lockdown", (items) => items[n % items.length] as never)), "eventFlipped")[0]?.room;
    const closable = new Set(Array.from({ length: 20 }, (_, n) => pool(n)));
    expect([...closable].sort()).toEqual(s.rooms.filter((r) => !["lobby", "rooftop", "office"].includes(r)).sort());
    const three = resolve(game(3));
    expect(find(startRound({ ...three, taped: { vault: 3, office: 3, security: 3 } }, 3, forcing("lockdown")), "eventFlipped")).toEqual([]);
  });

  it("Audit: every room in play shows the coins that reached the duffel from it; a raided room shows 0 (§5.3)", () => {
    const base = withCard(resolve(game(4)), "audit");
    const s = resolve(base, { p0: fullGrab("vault", 2), p1: fullGrab("vault"), p2: fullGrab("office", 2), p3: fullGrab("lobby") });
    expect(find(lastRound(s), "auditReport")).toEqual([{ type: "auditReport", visibility: PUBLIC, round: 2, duffel: { vault: 4, office: 0, lobby: 1, security: 0, rooftop: 0 } }]);
    // With real bells, two full Vault grabs ring 6 and raid it: its coins were seized, none reached the duffel.
    const raided = resolve(withCard(resolve(game(3, [], { contentOverrides: null })), "audit"), { p0: fullGrab("vault"), p1: fullGrab("vault") });
    expect(find(lastRound(raided), "roomRaided")).toHaveLength(1);
    expect(find(lastRound(raided), "auditReport")[0]?.duffel).toMatchObject({ vault: 0, office: 2 });
  });

  it("Inside tip: as the card flips, one random player privately learns another player's real role", () => {
    const s = resolve(game(4, ["lookout", "mole", "hacker", "priest"]));
    const events = startRound(s, 3, forcing("insideTip"));
    const tip = find(events, "insideTip")[0] as Extract<GameEvent, { type: "insideTip" }>;
    expect(events.indexOf(tip)).toBe(events.findIndex((e) => e.type === "eventFlipped") + 1);
    expect(tip.visibility).toEqual(privateTo(tip.player));
    expect(tip.subject).not.toBe(tip.player);
    expect(tip.role).toBe(s.players[tip.subject]?.role);
  });
});

describe("event-card visibility (leak tests) — design §13, §18", () => {
  const sees = (s: GameState, viewer: PlayerId, type: GameEvent["type"]) =>
    [...viewFor(s, viewer).ledger, ...viewFor(s, viewer).caseFile].some((e) => e.event.type === type);

  it("the flipped card and the Audit are public", () => {
    const s = resolve(withCard(resolve(game(3)), "audit"), { p0: fullGrab("office", 2) });
    for (const id of s.playerOrder) {
      expect(sees(s, id, "eventFlipped")).toBe(true);
      expect(sees(s, id, "auditReport")).toBe(true);
    }
  });

  it("Inside tip reaches only its player", () => {
    // The first seeded game with a tip in it.
    const games = Array.from({ length: 20 }, (_, i) => playThrough(createGame(config(4, { seed: `tip-${i}` }))));
    const s = games.find((g) => g.log.some((e) => e.type === "insideTip")) as GameState;
    const tip = find(s.log, "insideTip")[0];
    expect(tip).toBeDefined();
    for (const id of s.playerOrder) expect(sees(s, id, "insideTip")).toBe(tip?.player === id);
  });
});
