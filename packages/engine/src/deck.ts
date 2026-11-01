// The events deck: flipping a card as a round starts, the card's effects at
// §5.2 step 1, and the Double-cross answer. design §10, §5.2
//
// Cards are data in @skimjob/content; each kind of effect is one small
// function here. All draws go through the command's `Draw`.
import { EVENTS, EVENT_DECK, EVENT_HEAT_FULL_CREW, EVENTS_FROM_ROUND, ROUNDS_PER_ACT, type EventDef, type EventEffect, type EventId, type JobDef, type RoomId } from "@skimjob/content";
import type { ActiveCard, GameConfig, GameEvent, GameState, PlayerId, PlayerState, RoleState } from "./types";
import { PUBLIC, privateTo } from "./types";
import type { Draw } from "./handle";
import { eventsFor, factionIn, jobFor, powerOf, rolesFor, type EventTable } from "./overrides";
import { actOfRound } from "./acts";
import { playerFor } from "./check";

type Result = GameEvent[] | string;

/** Events are off in starter mode (validateConfig also refuses starter + events) and when the host turns them off. design §8.1, §15 */
export const eventsOn = (config: GameConfig): boolean => config.eventsEnabled && !config.starterMode;

/** Whether a card flips at the start of `round`: events on, from `EVENTS_FROM_ROUND`, not past the last round. design §10 */
export function cardRound(config: GameConfig, round: number): boolean {
  const last = jobFor(config).checkpoints.perPlayer.length * ROUNDS_PER_ACT;
  return eventsOn(config) && round >= EVENTS_FROM_ROUND && round <= last;
}

/** The card a Mastermind foresaw for `round` (it flips unless a Rig changes it), or undefined. design §8 (v2 §2) */
export function foreseenCard(state: GameState, round: number): EventId | undefined {
  for (let i = state.log.length - 1; i >= 0; i--) {
    const e = state.log[i] as GameEvent;
    if (e.type === "cardForeseen" && e.round === round) return e.card;
  }
  return undefined;
}

/**
 * Mastermind (v2 §2): as round `round` starts, the next round's card is drawn
 * now and each Mastermind is told it privately. Nothing is drawn when no
 * Mastermind is dealt, so the public game is the same either way.
 */
export function foresee(config: GameConfig, roles: ReadonlyMap<PlayerId, string>, round: number, pickCard: () => EventId): GameEvent[] {
  const next = round + 1;
  if (!cardRound(config, next)) return [];
  const minds = [...roles].filter(([, role]) => powerOf(config, role).kind === "foresee").map(([id]) => id);
  if (minds.length === 0) return [];
  const card = pickCard();
  return minds.map((player): GameEvent => ({ type: "cardForeseen", visibility: privateTo(player), player, round: next, card }));
}

/** The card's definition. Throws for ids the content doesn't have (the log only holds drawn ones). */
export function cardDef(id: string, events: EventTable = EVENTS): EventDef {
  const def = Object.hasOwn(events, id) ? events[id] : undefined;
  if (!def) throw new Error(`unknown event card ${id}`);
  return def;
}

/** This round's card effect, or null if no card was flipped. */
export const cardEffect = (state: GameState): EventEffect | null => (state.card ? cardDef(state.card.id, eventsFor(state.config)).effect : null);

const effectIs = <K extends EventEffect["kind"]>(state: GameState, kind: K): Extract<EventEffect, { kind: K }> | null => {
  const effect = cardEffect(state);
  return effect?.kind === kind ? (effect as Extract<EventEffect, { kind: K }>) : null;
};

/**
 * `roundStarted`, then from round 2 (events on) the flipped card: drawn at
 * random from the whole deck, so cards can repeat (owner answers, 1 Nov). Lockdown names its
 * closed room (any room in play but the default room) and Double-cross
 * privately offers two random players a swap, both as the card is flipped, so
 * players can plan around them. A Rig for this round flips its holder's pick
 * instead of a drawn card (the oldest, if several; design §8.3); else a card a
 * Mastermind foresaw flips. Then any Mastermind foresees the next one. design §10
 */
export function startRound(state: GameState, round: number, draw: Draw): GameEvent[] {
  const events: GameEvent[] = [{ type: "roundStarted", visibility: PUBLIC, round, act: actOfRound(round) }];
  const roles = new Map(state.playerOrder.map((id) => [id, playerIn(state, id).role]));
  const ahead = (): GameEvent[] => foresee(state.config, roles, round, () => draw.pick(EVENT_DECK));
  if (!eventsOn(state.config) || round < EVENTS_FROM_ROUND) return [...events, ...ahead()];
  // The oldest Rig of this round wins; later ones were spent without effect (they never learn more than the flip shows).
  const card = state.rigs.find((r) => r.round === round)?.pick ?? foreseenCard(state, round) ?? draw.pick(EVENT_DECK);
  const effect = cardDef(card, eventsFor(state.config)).effect;
  let room: RoomId | null = null;
  if (effect.kind === "lockdown") {
    const job = jobFor(state.config);
    room = draw.pick(state.rooms.filter((r) => r !== job.defaultRoom));
  }
  events.push({ type: "eventFlipped", visibility: PUBLIC, round, card, room });
  if (effect.kind === "doubleCross") {
    const a = draw.pick(state.playerOrder);
    const b = draw.pick(state.playerOrder.filter((id) => id !== a));
    events.push({ type: "doubleCrossOffered", visibility: privateTo(a), player: a, round, partner: b });
    events.push({ type: "doubleCrossOffered", visibility: privateTo(b), player: b, round, partner: a });
  }
  return [...events, ...ahead()];
}

/**
 * design §10: event-card Heat is scaled by min(1, crew ÷ EVENT_HEAT_FULL_CREW),
 * so it weighs on a crew of 2–4 about as much as on a crew of 5+ (owner answers, 1 Nov).
 */
export const eventHeatScale = (crewSize: number): number => Math.min(1, crewSize / EVENT_HEAT_FULL_CREW);

/** A Heat card's amount for this crew, scaled and rounded (halves up). design §10 */
export const scaledCardHeat = (amount: number, crewSize: number): number => Math.round(amount * eventHeatScale(crewSize));

/**
 * The job as this round's card changes it: Shift change and Payday multiply
 * one room's loot and Heat pressure; the extra Heat pressure is scaled for
 * small crews (`eventHeatScale`). design §10
 */
export function roundJob(job: JobDef, card: ActiveCard | null, events: EventTable, crewSize: number): JobDef {
  const effect = card ? cardDef(card.id, events).effect : null;
  if (effect?.kind !== "roomSurge" || !Object.hasOwn(job.rooms, effect.room)) return job;
  const def = job.rooms[effect.room] as JobDef["rooms"][string];
  const heatMultiplier = 1 + (effect.heatMultiplier - 1) * eventHeatScale(crewSize);
  const surged = { ...def, loot: Math.round(def.loot * effect.lootMultiplier), heatPressure: def.heatPressure * heatMultiplier };
  return { ...job, rooms: { ...job.rooms, [effect.room]: surged } };
}

/** The room Lockdown closes this round, or null. design §10 */
export const closedRoom = (state: GameState): RoomId | null => (effectIs(state, "lockdown") ? (state.card?.room ?? null) : null);

/** Police patrol / Quiet night: Heat added to the round's change (scaled for small crews), before the clamp. design §10, §7 */
export const cardHeat = (state: GameState): number => scaledCardHeat(effectIs(state, "heat")?.amount ?? 0, state.playerOrder.length);

/** Power cut: nobody sees anybody (no sightings, Security or Lookout results). design §10 */
export const isBlackout = (state: GameState): boolean => effectIs(state, "blackout") !== null;

/** Audit: the round's shortfall is posted per room. design §10 */
export const isAudit = (state: GameState): boolean => effectIs(state, "audit") !== null;

const playerIn = (state: GameState, id: PlayerId): PlayerState => state.players[id] as PlayerState;

/** Raid rumour: the biggest stash (not the safe) loses up to `loss`; a tie is drawn at random; nothing if every stash is empty. */
function raidRumour(state: GameState, round: number, loss: number, draw: Draw): GameEvent[] {
  const top = Math.max(...state.playerOrder.map((id) => playerIn(state, id).stash));
  if (top <= 0) return [];
  const tied = state.playerOrder.filter((id) => playerIn(state, id).stash === top);
  const player = tied.length === 1 ? (tied[0] as PlayerId) : draw.pick(tied);
  return [{ type: "raidRumourHit", visibility: privateTo(player), player, round, lost: Math.min(loss, top) }];
}

/** Inside tip: a random player learns another random player's current role. */
function insideTip(state: GameState, round: number, draw: Draw): GameEvent[] {
  const player = draw.pick(state.playerOrder);
  const subject = draw.pick(state.playerOrder.filter((id) => id !== player));
  return [{ type: "insideTip", visibility: privateTo(player), player, round, subject, role: playerIn(state, subject).role }];
}

/**
 * Double-cross: the swap happens only if both accepted. Each role card takes
 * its uses so far with it; perk tokens and a spent Tail stay with the player
 * (they were earned, not dealt; provisional, design §8.3); a Snitch's target
 * that would become its new holder becomes the other swapper; saboteur allies
 * are recomputed and any other saboteur whose ally changed is told privately
 * (`moleAllies`). (provisional)
 */
function doubleCross(state: GameState, round: number): GameEvent[] {
  const offer = state.card?.offer;
  if (!offer) return [];
  const [a, b] = offer.players;
  const swapped = offer.accepted.includes(a) && offer.accepted.includes(b);
  const pa = playerIn(state, a);
  const pb = playerIn(state, b);
  if (!swapped) {
    return [
      { type: "doubleCrossResolved", visibility: privateTo(a), player: a, round, partner: b, swap: null },
      { type: "doubleCrossResolved", visibility: privateTo(b), player: b, round, partner: a, swap: null },
    ];
  }
  const roleAfter = (id: PlayerId) => (id === a ? pb.role : id === b ? pa.role : playerIn(state, id).role);
  const roles = rolesFor(state.config);
  const saboteurAfter = (id: PlayerId): boolean => factionIn(roles, roleAfter(id)) === "saboteur";
  const moles = state.playerOrder.filter(saboteurAfter);
  const alliesOf = (id: PlayerId): PlayerId[] => (saboteurAfter(id) ? moles.filter((m) => m !== id) : []);
  // Same role on both sides: nothing changes hands, so each keeps its own uses.
  const same = pa.role === pb.role;
  const taken = (self: PlayerId, partner: PlayerId, from: PlayerState): RoleState => ({
    ...from.roleState,
    target: from.roleState.target === self ? partner : from.roleState.target,
    allies: alliesOf(self),
    perks: playerIn(state, self).roleState.perks,
    tail: playerIn(state, self).roleState.tail,
  });
  const events: GameEvent[] = [
    { type: "doubleCrossResolved", visibility: privateTo(a), player: a, round, partner: b, swap: { role: pb.role, roleState: taken(a, b, same ? pa : pb) } },
    { type: "doubleCrossResolved", visibility: privateTo(b), player: b, round, partner: a, swap: { role: pa.role, roleState: taken(b, a, same ? pb : pa) } },
  ];
  for (const m of moles) {
    if (m === a || m === b) continue;
    const allies = alliesOf(m);
    const before = playerIn(state, m).roleState.allies;
    if (allies.length !== before.length || allies.some((x, i) => x !== before[i])) {
      events.push({ type: "moleAllies", visibility: privateTo(m), player: m, allies });
    }
  }
  return events;
}

/** §5.2 step 1: the card's effects that change players before the round's yields. Other kinds act later in the round. design §10 */
export function cardEffects(state: GameState, round: number, draw: Draw): GameEvent[] {
  const effect = cardEffect(state);
  switch (effect?.kind) {
    case "raidRumour":
      return raidRumour(state, round, effect.loss, draw);
    case "insideTip":
      return insideTip(state, round, draw);
    case "doubleCross":
      return doubleCross(state, round);
    default:
      return [];
  }
}

/** Accept or decline this round's Double-cross offer; changeable until the round deadline. design §10 */
export function answerDoubleCross(state: GameState, command: Record<string, unknown>): Result {
  if (state.phase.kind !== "planning") return "a double-cross can only be answered while a round is being planned";
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  if (!state.card?.offer?.players.includes(player.id)) return "you have no double-cross offer this round";
  if (typeof command.accept !== "boolean") return "accept must be true or false";
  return [{ type: "doubleCrossAnswered", visibility: privateTo(player.id), player: player.id, round: state.phase.round, accept: command.accept }];
}
