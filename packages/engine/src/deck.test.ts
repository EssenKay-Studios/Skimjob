// The events deck: one public card per round from round 2, its effects at
// §5.2 step 1 and through the round, and the Double-cross answer. design §10, §5.2
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
 * Replace the card flipped for the current round (and any Double-cross offers)
 * with `card`, by rewriting the log and replaying it: still a fold over the log.
 */
function withCard(state: GameState, card: string, room: RoomId | null = null, pair?: [PlayerId, PlayerId]): GameState {
  const log = [...state.log];
  let i = log.length - 1;
  while (i >= 0 && log[i]?.type !== "eventFlipped") i--;
  if (i < 0) throw new Error("no card flipped");
  let j = i + 1;
  while (log[j]?.type === "doubleCrossOffered") j++;
  const round = state.round;
  const added: GameEvent[] = [{ type: "eventFlipped", visibility: PUBLIC, round, card, room }];
  if (pair) {
    const [a, b] = pair;
    added.push({ type: "doubleCrossOffered", visibility: privateTo(a), player: a, round, partner: b });
    added.push({ type: "doubleCrossOffered", visibility: privateTo(b), player: b, round, partner: a });
  }
  log.splice(i, j - i, ...added);
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
      "Quiet night",
      "Shift change",
      "Power cut",
      "Payday",
      "Lockdown",
      "Audit",
      "Raid rumour",
      "Inside tip",
      "Double-cross",
    ]);
  });

  it("flips one public card at the start of every round from round 2, drawn from the full deck (owner answers, 1 Nov)", () => {
    for (const n of [3, 4, 7]) {
      const end = playThrough(createGame(config(n, { seed: `flip-${n}` })));
      const flipped = flips(end);
      expect(flipped.map((e) => e.round)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
      expect(EVENTS_FROM_ROUND).toBe(2);
      expect(flipped.every((e) => e.visibility.kind === "public" && EVENT_DECK.includes(e.card))).toBe(true);
      // Repeats allowed: each flip draws from all ten cards (the game's seeds give a repeat here).
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

  it("Quiet night removes 10 (clamped at 0), in the round's one Heat change", () => {
    const base = atRound2(5);
    const heat0 = base.heat;
    const quiet = resolve(withCard(base, "quietNight"));
    expect(quiet.heat).toBe(Math.max(0, heat0 + BANK.heat.perRound - 10));
    expect(lastResolution(quiet).find((e) => e.type === "roundResolved")).toMatchObject({ heatDelta: quiet.heat - heat0 });
  });

  it("event-card Heat is scaled by min(1, crew ÷ 5) for small crews, rounded (owner answers, 1 Nov)", () => {
    // design §10: Quiet night −10 gives −6 / −8 / −10 at 3 / 4 / 5+ players.
    for (const [n, quiet] of [[3, 6], [4, 8], [5, 10], [9, 10]] as const) {
      const base = atRound2(n, [], { contentOverrides: { heat: { perRound: 30 } } });
      expect(resolve(withCard(base, "quietNight")).heat - base.heat).toBe(30 - quiet);
    }
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

  it("Payday: the Lobby yields 4", () => {
    const s = resolve(withCard(atRound2(3), "payday"), { p1: { room: "lobby", pocket: 0 } });
    expect(lastResolution(s).find((e) => e.type === "lootSplit" && e.player === "p1")).toMatchObject({ room: "lobby", loot: 4, toHaul: 4 });
  });

  it("Power cut: no sightings, Security reads \"camera offline\", no Lookout results; loot, splits and the Lookout's use still happen", () => {
    const base = withCard(atRound2(3, ["lookout", "rookie", "rookie"]), "powerCut");
    const s = resolve(base, {
      p0: { room: "office", pocket: 0, ability: { kind: "lookout", rooms: ["vault"] } },
      p1: { room: "security", pocket: 0, watch: "vault" },
      p2: { room: "vault", pocket: 1 },
    });
    const events = lastResolution(s);
    expect(events.filter((e) => e.type === "roomSighting")).toEqual([]);
    // extension.md "Camera offline": the feed reads offline, the same as a Hacker loop.
    expect(events.filter((e) => e.type === "roomWatched").every((e) => e.type === "roomWatched" && e.offline && e.seen.length === 0)).toBe(true);
    expect(events.filter((e) => e.type === "lootSplit")).toHaveLength(3);
    expect(events.some((e) => e.type === "abilityResolved" && e.player === "p0")).toBe(true);
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

  it("Raid rumour: a tie for the biggest stash is drawn at random; nobody is hit when every stash is empty", () => {
    const tied = resolve(game(3), { p0: { room: "office", pocket: 4 }, p1: { room: "office", pocket: 4 }, p2: { room: "office", pocket: 1 } });
    const s = resolve(withCard(tied, "raidRumour"));
    const hits = lastResolution(s).filter((e) => e.type === "raidRumourHit");
    expect(hits).toHaveLength(1);
    expect(["p0", "p1"]).toContain(hits[0]?.type === "raidRumourHit" ? hits[0].player : null);
    expect(hits[0]).toMatchObject({ lost: EVENTS.raidRumour?.effect.kind === "raidRumour" ? EVENTS.raidRumour.effect.loss : -1 });
    const empty = resolve(withCard(atRound2(3), "raidRumour"));
    expect(lastResolution(empty).filter((e) => e.type === "raidRumourHit")).toEqual([]);
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

describe("Double-cross — design §10", () => {
  const offerFor = (n: number, roles: string[], pair: [PlayerId, PlayerId], extra: Partial<GameConfig> = {}, more: GameEvent[] = []) =>
    withCard(resolve(game(n, roles, extra, more)), "doubleCross", null, pair);
  const answer = (player: PlayerId, accept: boolean) => ({ type: "answerDoubleCross", player, accept });

  it("offers two different random players a swap, privately, as the card is flipped", () => {
    for (let i = 0; i < 30; i++) {
      const g = untilCard(createGame(config(5, { seed: `dc-${i}` })), "doubleCross");
      if (g.card?.id !== "doubleCross") continue;
      const offers = g.log.filter((e): e is Extract<GameEvent, { type: "doubleCrossOffered" }> => e.type === "doubleCrossOffered");
      expect(offers).toHaveLength(2);
      const [a, b] = offers as [Extract<GameEvent, { type: "doubleCrossOffered" }>, Extract<GameEvent, { type: "doubleCrossOffered" }>];
      expect(a.player).not.toBe(b.player);
      expect([a.partner, b.partner]).toEqual([b.player, a.player]);
      expect(a.visibility).toEqual(privateTo(a.player));
      return;
    }
    throw new Error("no Double-cross drawn");
  });

  it("swaps the two roles at the round's resolution only if both accept; the last answer counts", () => {
    const base = offerFor(3, ["lookout", "hacker", "rookie"], ["p0", "p1"]);
    const both = resolve(run(base, answer("p0", true), answer("p1", true)));
    expect([both.players.p0?.role, both.players.p1?.role]).toEqual(["hacker", "lookout"]);
    const resolved = lastResolution(both).filter((e) => e.type === "doubleCrossResolved");
    expect(resolved.map((e) => e.visibility)).toEqual([privateTo("p0"), privateTo("p1")]);
    expect(resolved[0]).toMatchObject({ player: "p0", partner: "p1", swap: { role: "hacker" } });
    // The view shows the new role.
    expect(viewFor(both, "p0").me.role).toBe("hacker");

    for (const answers of [[answer("p0", true)], [answer("p0", true), answer("p1", true), answer("p1", false)], []]) {
      const s = resolve(run(base, ...answers));
      expect([s.players.p0?.role, s.players.p1?.role]).toEqual(["lookout", "hacker"]);
      expect(lastResolution(s).filter((e) => e.type === "doubleCrossResolved").every((e) => e.type === "doubleCrossResolved" && e.swap === null)).toBe(true);
    }
  });

  it("only the offered players may answer, only while the round is planned, with a boolean", () => {
    const base = offerFor(3, [], ["p0", "p1"]);
    expect(handleThroughAlibis(base, answer("p2", true)).ok).toBe(false);
    expect(handleThroughAlibis(base, { type: "answerDoubleCross", player: "p0", accept: "yes" }).ok).toBe(false);
    const answered = handleThroughAlibis(base, answer("p0", true));
    expect(answered.ok && answered.events[0]).toMatchObject({ type: "doubleCrossAnswered", visibility: privateTo("p0"), accept: true });
    // No offer in a round without the card.
    expect(handleThroughAlibis(withCard(resolve(game(3)), "audit"), answer("p0", true)).ok).toBe(false);
    // Not after the round has resolved.
    expect(handleThroughAlibis(resolve(base), answer("p0", true)).ok).toBe(false);
  });
});

describe("event-card visibility (leak tests) — design §10, §13, §17.2", () => {
  const sees = (s: GameState, viewer: PlayerId, type: GameEvent["type"]) =>
    [...viewFor(s, viewer).ledger, ...viewFor(s, viewer).caseFile].some((e) => e.event.type === type);
  const answer = (player: PlayerId, accept: boolean) => ({ type: "answerDoubleCross", player, accept });

  it("the flipped card and the Audit are public; nothing else about the card is", () => {
    const s = resolve(withCard(resolve(game(3)), "audit"), { p0: { room: "office", pocket: 2 } });
    for (const id of s.playerOrder) {
      expect(sees(s, id, "eventFlipped")).toBe(true);
      expect(sees(s, id, "auditReport")).toBe(true);
    }
  });

  it("Double-cross: only the two see the offer; nobody sees the other's answer; views can't tell answers apart", () => {
    const base = withCard(resolve(game(3)), "doubleCross", null, ["p0", "p1"]);
    expect(sees(base, "p2", "doubleCrossOffered")).toBe(false);
    expect(viewFor(base, "p2").card).toEqual({ round: 2, id: "doubleCross", room: null });
    const accepted = run(base, answer("p1", true));
    const declined = run(base, answer("p1", false));
    // p0 (the partner) and p2 (outside) see exactly the same whatever p1 answered.
    for (const viewer of ["p0", "p2"]) expect(JSON.stringify(viewFor(accepted, viewer))).toBe(JSON.stringify(viewFor(declined, viewer)));
    expect(sees(accepted, "p1", "doubleCrossAnswered")).toBe(true);
    // The outcome goes to the two only.
    const done = resolve(run(accepted, answer("p0", true)));
    expect(sees(done, "p2", "doubleCrossResolved")).toBe(false);
    expect(sees(done, "p0", "doubleCrossResolved") && sees(done, "p1", "doubleCrossResolved")).toBe(true);
  });

  it("Raid rumour and Inside tip reach only their player; an outsider's view is the same with or without them", () => {
    const r1 = resolve(game(3), { p1: { room: "office", pocket: 3 } });
    const hit = resolve(withCard(r1, "raidRumour"));
    const miss = resolve(withCard(r1, "audit"));
    expect(sees(hit, "p1", "raidRumourHit")).toBe(true);
    expect(sees(hit, "p0", "raidRumourHit") || sees(hit, "p2", "raidRumourHit")).toBe(false);
    // The Haul and Heat don't show the loss: p0's view differs only by the public card (and Audit report).
    const strip = (s: GameState) =>
      JSON.stringify(viewFor(s, "p0").caseFile) + JSON.stringify([viewFor(s, "p0").haul, viewFor(s, "p0").heat]);
    expect(strip(hit)).toBe(strip(miss));

    const tipped = resolve(withCard(resolve(game(4, ["rookie", "lookout", "hacker", "priest"])), "insideTip"));
    const tip = tipped.log.find((e) => e.type === "insideTip");
    for (const id of tipped.playerOrder) expect(sees(tipped, id, "insideTip")).toBe(tip?.type === "insideTip" && tip.player === id);
  });

  it("Power cut leaves no private sighting events to compare (everyone's case file has only their own split)", () => {
    const s = resolve(withCard(resolve(game(3)), "powerCut"), { p0: { room: "security", pocket: 0, watch: "office" } });
    for (const id of s.playerOrder) {
      const round2 = viewFor(s, id).caseFile.filter((e) => "round" in e.event && e.event.round === 2).map((e) => e.event.type);
      expect(round2.sort()).toEqual(id === "p0" ? ["lootSplit", "moveSubmitted", "roomWatched"] : ["lootSplit", "moveSubmitted"]);
    }
  });

  it("after the game, the reveal shows the offers, answers and private card results (design §13)", () => {
    const base = run(withCard(resolve(game(3)), "doubleCross", null, ["p0", "p1"]), answer("p0", true));
    const end = playThrough(base);
    const reveal = viewFor(end, "p2").reveal?.log.map((e) => e.event.type) ?? [];
    for (const t of ["doubleCrossOffered", "doubleCrossAnswered", "doubleCrossResolved"]) expect(reveal).toContain(t);
  });
});
