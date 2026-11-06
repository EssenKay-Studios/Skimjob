// The events deck: one public card per round from round 2, its effects at
// §5.2 step 1 and through the round. design §10, §5.2
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { V06_NUMBERS } from "./v01-numbers.testkit";
import { EVENTS, EVENT_DECK, EVENTS_FROM_ROUND, type RoomId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { PUBLIC, privateTo } from "./types";
import { createGame, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { closedRoom, eventHeatScale, scaledCardHeat } from "./deck";
import { jobById } from "./job";

const BANK = jobById("bank");

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "deck-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: ["rookie", "lookout", "hacker", "priest"], // a window only if the shop holds a Shield
    eventsEnabled: true,
    voteVisibility: "open",
    ...extra,
  };
}

/** A new game with chosen roles (seat i gets roles[i], Rookie if missing), plus any extra setup events. */
function game(players: number, roles: string[] = [], extra: Partial<GameConfig> = {}, more: GameEvent[] = []): GameState {
  // Pin the 0.6.0 card numbers (balance pass 2 changed them); an extra override still wins.
  const cfg = config(players, { ...extra, contentOverrides: { ...V06_NUMBERS, ...extra.contentOverrides } });
  const log = setupEvents(cfg)
    .map((e, i, all): GameEvent => {
      if (e.type !== "roleDealt") return e;
      const seat = all.slice(0, i).filter((x) => x.type === "roleDealt").length;
      return { ...e, role: roles[seat] ?? "rookie" };
    });
  const at = log.findIndex((e) => e.type === "roundStarted");
  log.splice(at, 0, ...more);
  return replay(cfg, log);
}

function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}

const move = (player: PlayerId, room: RoomId, pocket = 0, rest: Record<string, unknown> = {}) => ({
  type: "submitMove",
  player,
  move: { room, pocket, ...rest },
});
const advance = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });

/** Everyone not in `moves` goes to the Office (or the Lobby if the Office is closed); then the round resolves. */
function resolve(state: GameState, moves: Record<PlayerId, Record<string, unknown>> = {}): GameState {
  let s = state;
  for (const id of s.playerOrder) {
    const m = moves[id] ?? { room: closedRoom(s) === "office" ? "lobby" : "office", pocket: 0 };
    s = run(s, { type: "submitMove", player: id, move: m });
  }
  return run(s, advance(s));
}

/** The command events of the latest round's resolution (from its first lootSplit / card effect to roundResolved). */
function lastResolution(s: GameState): GameEvent[] {
  let end = s.log.length - 1;
  while (s.log[end]?.type !== "roundResolved") end--;
  let start = end;
  while (start > 0 && s.log[start - 1]?.type !== "moveSubmitted") start--;
  return s.log.slice(start, end + 1);
}

/**
 * Replace the card flipped for the current round with `card`, by rewriting the
 * log and replaying it: still a fold over the log.
 */
function withCard(state: GameState, card: string, room: RoomId | null = null): GameState {
  const log = [...state.log];
  let i = log.length - 1;
  while (i >= 0 && log[i]?.type !== "eventFlipped") i--;
  if (i < 0) throw new Error("no card flipped");
  log.splice(i, 1, { type: "eventFlipped", visibility: PUBLIC, round: state.round, card, room });
  return replay(state.config, log);
}

/** One round (everyone in the Office, or the Lobby when the Office is closed), or the act's meeting with no votes. */
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

function playThrough(state: GameState): GameState {
  let s = state;
  while (s.phase.kind !== "ended") s = step(s);
  return s;
}

/** Play until `card` is flipped (the state is then planning that round), or to the end. */
function untilCard(state: GameState, card: string): GameState {
  let s = state;
  while (s.phase.kind !== "ended" && s.card?.id !== card) s = step(s);
  return s;
}

const flips = (s: GameState) => s.log.filter((e): e is Extract<GameEvent, { type: "eventFlipped" }> => e.type === "eventFlipped");

describe("the deck — design §10", () => {
  it("has the cards of §10 as data, without Police patrol (extension.md \"Police activity\")", () => {
    expect(EVENT_DECK.map((id) => EVENTS[id]?.name)).toEqual([
      "Shift change",
      "Lockdown",
      "Audit",
      "Inside tip",
    ]);
  });

  it("flips one public card at the start of every round from round 2, drawn from the full deck (owner answers, 1 Nov)", () => {
    for (const n of [3, 4, 7]) {
      const end = playThrough(createGame(config(n, { seed: `flip-${n}` })));
      const flipped = flips(end);
      expect(flipped.map((e) => e.round)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
      expect(EVENTS_FROM_ROUND).toBe(2);
      expect(flipped.every((e) => e.visibility.kind === "public" && EVENT_DECK.includes(e.card))).toBe(true);
      // Repeats allowed: each flip draws from all four cards (the game's seeds give a repeat here).
      expect(new Set(flipped.map((e) => e.card)).size).toBeLessThan(8);
      // Flipped straight after its round starts, so players can plan around it.
      for (const e of flipped) {
        const at = end.log.indexOf(e);
        expect(end.log[at - 1]).toMatchObject({ type: "roundStarted", round: e.round });
      }
    }
  });

  it("is drawn with the seeded RNG: same seed, same cards; another seed, other cards (design §17.2)", () => {
    const cards = (seed: string) => flips(playThrough(createGame(config(4, { seed })))).map((e) => e.card);
    expect(cards("same")).toEqual(cards("same"));
    const seeds = ["a", "b", "c", "d", "e"].map(cards).map((c) => c.join());
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it("flips nothing when events are off (design §8.1)", () => {
    const end = playThrough(createGame(config(4, { eventsEnabled: false })));
    expect(flips(end)).toEqual([]);
    expect(end.cardsFlipped).toEqual([]);
  });

  it("shows the card in every view while its round is planned, and clears it when the round resolves", () => {
    let s = resolve(createGame(config(3)));
    const card = s.card;
    expect(card?.round).toBe(2);
    for (const id of s.playerOrder) expect(viewFor(s, id).card).toEqual({ round: 2, id: card?.id, room: card?.room });
    s = resolve(s);
    expect(viewFor(s, "p0").card?.round).toBe(3);
  });
});

describe("card effects — design §10, §5.2", () => {
  const atRound2 = (n: number, roles: string[] = [], extra: Partial<GameConfig> = {}) => resolve(game(n, roles, extra));

  it("event-card Heat is scaled by min(1, crew ÷ 5) for small crews, rounded (owner answers, 1 Nov)", () => {
    expect(eventHeatScale(3)).toBeCloseTo(0.6);
    expect(scaledCardHeat(-10, 3)).toBe(-6);
    expect(scaledCardHeat(5, 3)).toBe(3);
    expect(scaledCardHeat(5, 12)).toBe(5);
  });

  it("Shift change: the Vault yields double and its Heat pressure doubles (×1.8 at 4 players, design §10 scaling); a pocket up to the doubled loot is accepted", () => {
    const base = withCard(atRound2(4, ["rookie"]), "shiftChange");
    const heat0 = base.heat;
    const s = resolve(base, { p0: { room: "vault", pocket: 12 } });
    const split = lastResolution(s).find((e) => e.type === "lootSplit" && e.player === "p0");
    expect(split).toMatchObject({ loot: 12, toStash: 12, toHaul: 0 });
    // One of 4 in the Vault: the surge's extra ×1 is scaled by 4/5, so 4 + 1.8 × 20 × 1/4 = 13.
    expect(s.heat - heat0).toBe(BANK.heat.perRound + Math.round((1.8 * 20) / 4));
    // Without the card the same pocket is refused.
    const plain = withCard(atRound2(4, ["rookie"]), "audit");
    expect(handleThroughAlibis(plain, move("p0", "vault", 12)).ok).toBe(false);
  });

  it("Lockdown: the named room is refused for the round; it is never the default room and always in play", () => {
    const base = atRound2(4);
    const s = withCard(base, "lockdown", "vault");
    const r = handleThroughAlibis(s, move("p0", "vault"));
    expect(r.ok).toBe(false);
    expect(handleThroughAlibis(s, move("p0", "office")).ok).toBe(true);
    // Drawn rooms over many seeds.
    for (let i = 0; i < 40; i++) {
      const g = untilCard(createGame(config(6, { seed: `lock-${i}` })), "lockdown");
      if (g.card?.id !== "lockdown") continue;
      expect(g.card.room).not.toBe(BANK.defaultRoom);
      expect(g.rooms).toContain(g.card.room);
    }
  });

  it("Audit: the round's shortfall is posted per room, publicly, every room in play listed", () => {
    const base = withCard(atRound2(4, ["rookie", "rookie", "hacker", "lookout"]), "audit");
    const s = resolve(base, {
      p0: { room: "vault", pocket: 4 },
      p1: { room: "vault", pocket: 1 },
      p2: { room: "office", pocket: 0 },
      p3: { room: "lobby", pocket: 2 },
    });
    const audit = lastResolution(s).find((e) => e.type === "auditReport");
    expect(audit).toEqual({
      type: "auditReport",
      visibility: PUBLIC,
      round: 2,
      shortfalls: { vault: 5, office: 0, lobby: 2, security: 0, rooftop: 0 },
    });
  });

  it("Inside tip: one player privately learns another player's real role", () => {
    const s = resolve(withCard(atRound2(4, ["rookie", "lookout", "hacker", "priest"]), "insideTip"));
    const tips = lastResolution(s).filter((e): e is Extract<GameEvent, { type: "insideTip" }> => e.type === "insideTip");
    expect(tips).toHaveLength(1);
    const tip = tips[0] as Extract<GameEvent, { type: "insideTip" }>;
    expect(tip.visibility).toEqual(privateTo(tip.player));
    expect(tip.subject).not.toBe(tip.player);
    expect(tip.role).toBe(s.players[tip.subject]?.role);
  });
});

describe("event-card visibility (leak tests) — design §10, §13, §17.2", () => {
  const sees = (s: GameState, viewer: PlayerId, type: GameEvent["type"]) =>
    [...viewFor(s, viewer).ledger, ...viewFor(s, viewer).caseFile].some((e) => e.event.type === type);

  it("the flipped card and the Audit are public; nothing else about the card is", () => {
    const s = resolve(withCard(resolve(game(3)), "audit"), { p0: { room: "office", pocket: 2 } });
    for (const id of s.playerOrder) {
      expect(sees(s, id, "eventFlipped")).toBe(true);
      expect(sees(s, id, "auditReport")).toBe(true);
    }
  });

  it("Inside tip reaches only its player", () => {
    const tipped = resolve(withCard(resolve(game(4, ["rookie", "lookout", "hacker", "priest"])), "insideTip"));
    const tip = tipped.log.find((e) => e.type === "insideTip");
    for (const id of tipped.playerOrder) expect(sees(tipped, id, "insideTip")).toBe(tip?.type === "insideTip" && tip.player === id);
  });
});
