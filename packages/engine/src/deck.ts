// The events deck: flipping a card as a round starts, the card's effects at
// §5.2 step 1. design §10, §5.2
//
// Cards are data in @skimjob/content; each kind of effect is one small
// function here. All draws go through the command's `Draw`.
import { EVENTS, EVENT_DECK, EVENTS_FROM_ROUND, type EventDef, type EventEffect, type EventId, type JobDef, type RoomId } from "@skimjob/content";
import type { ActiveCard, GameConfig, GameEvent, GameState, PlayerId, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import type { Draw } from "./handle";
import { eventsFor, jobFor, type EventTable } from "./overrides";

/** Events are on unless the host turns them off. design §8.1, §15 */
export const eventsOn = (config: GameConfig): boolean => config.eventsEnabled;

/** Whether a card flips at the start of `round`: events on, from `EVENTS_FROM_ROUND`, not past the round cap. design §6.2, §13 */
export function cardRound(config: GameConfig, round: number): boolean {
  return eventsOn(config) && round >= EVENTS_FROM_ROUND && round <= jobFor(config).roundCap;
}

/** The card's definition. Throws for ids the content doesn't have (the log only holds drawn ones). */
function cardDef(id: string, events: EventTable = EVENTS): EventDef {
  const def = Object.hasOwn(events, id) ? events[id] : undefined;
  if (!def) throw new Error(`unknown event card ${id}`);
  return def;
}

/** This round's card effect, or null if no card was flipped. */
const cardEffect = (state: GameState): EventEffect | null => (state.card ? cardDef(state.card.id, eventsFor(state.config)).effect : null);

const effectIs = <K extends EventEffect["kind"]>(state: GameState, kind: K): Extract<EventEffect, { kind: K }> | null => {
  const effect = cardEffect(state);
  return effect?.kind === kind ? (effect as Extract<EventEffect, { kind: K }>) : null;
};

/**
 * `roundStarted`, then from round 2 (events on) the flipped card: drawn at
 * random from the whole deck, so cards can repeat (owner answers, 1 Nov). Lockdown names its
 * closed room (any room in play but the default room) as the card is flipped,
 * so players can plan around it. A Rig for this round flips its holder's pick
 * instead of a drawn card (the oldest, if several; design §8.3). design §10
 * Then each Electrician's blackout for this round is announced, with no source (§11.1).
 */
export function startRound(state: GameState, round: number, draw: Draw): GameEvent[] {
  const events: GameEvent[] = [{ type: "roundStarted", visibility: PUBLIC, round }];
  if (eventsOn(state.config) && round >= EVENTS_FROM_ROUND) {
    // The oldest Rig of this round wins; later ones were spent without effect (they never learn more than the flip shows).
    const card = state.rigs.find((r) => r.round === round)?.pick ?? draw.pick(EVENT_DECK);
    const effect = cardDef(card, eventsFor(state.config)).effect;
    let room: RoomId | null = null;
    if (effect.kind === "lockdown") {
      const job = jobFor(state.config);
      room = draw.pick(state.rooms.filter((r) => r !== job.defaultRoom));
    }
    events.push({ type: "eventFlipped", visibility: PUBLIC, round, card, room });
  }
  for (const room of state.cutsPending) events.push({ type: "powerCut", visibility: PUBLIC, round, room });
  return events;
}

/** The job as this round's card changes it: Shift change lets one room's visitors grab extra coins. design §13 */
export function roundJob(job: JobDef, card: ActiveCard | null, events: EventTable): JobDef {
  const effect = card ? cardDef(card.id, events).effect : null;
  if (effect?.kind !== "roomSurge" || !Object.hasOwn(job.rooms, effect.room)) return job;
  const def = job.rooms[effect.room] as JobDef["rooms"][string];
  return { ...job, rooms: { ...job.rooms, [effect.room]: { ...def, coins: def.coins + effect.extraCoins } } };
}

/** The room Lockdown closes this round, or null. design §10 */
export const closedRoom = (state: GameState): RoomId | null => (effectIs(state, "lockdown") ? (state.card?.room ?? null) : null);

/** Audit: the round's shortfall is posted per room. design §10 */
export const isAudit = (state: GameState): boolean => effectIs(state, "audit") !== null;

const playerIn = (state: GameState, id: PlayerId): PlayerState => state.players[id] as PlayerState;

/** Inside tip: a random player learns another random player's current role. */
function insideTip(state: GameState, round: number, draw: Draw): GameEvent[] {
  const player = draw.pick(state.playerOrder);
  const subject = draw.pick(state.playerOrder.filter((id) => id !== player));
  return [{ type: "insideTip", visibility: privateTo(player), player, round, subject, role: playerIn(state, subject).role }];
}

/** §5.2 step 1: the card's effects that change players before the round's yields. Other kinds act later in the round. design §10 */
export function cardEffects(state: GameState, round: number, draw: Draw): GameEvent[] {
  const effect = cardEffect(state);
  switch (effect?.kind) {
    case "insideTip":
      return insideTip(state, round, draw);
    default:
      return [];
  }
}
