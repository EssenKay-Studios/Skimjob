// The events deck: from round 2, a 4-in-10 chance that a card flips as the
// round starts, and the card's effects. design §13
//
// Cards are data in @skimjob/content; each kind of effect is one small
// function here. All draws go through the command's `Draw`.
import { EVENTS, EVENT_CHANCE, EVENT_DECK, EVENTS_FROM_ROUND, type EventDef, type EventEffect, type JobDef, type RoomId } from "@skimjob/content";
import type { ActiveCard, GameConfig, GameEvent, GameState } from "./types";
import { PUBLIC, privateTo } from "./types";
import type { Draw } from "./handle";
import { eventsFor, jobFor, type EventTable } from "./overrides";
import { applyEvent } from "./reduce";
import { isTaped } from "./bells";

/** Events are on unless the host turns them off. design §13, §16 */
export const eventsOn = (config: GameConfig): boolean => config.eventsEnabled;

/** Whether a card may flip at the start of `round`: events on, from `EVENTS_FROM_ROUND`, not past the round cap. design §6.2, §13 */
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

/**
 * The flip for a round that has just started (`started`), or `[]` when the card
 * can't apply (design §13: no event that round). Lockdown names one open room,
 * never the Lobby or the Rooftop; Shift change needs its room open; Inside tip
 * tells a random player another player's role, privately, as the card flips.
 */
function flip(started: GameState, round: number, card: string, draw: Draw): GameEvent[] {
  const effect = cardDef(card, eventsFor(started.config)).effect;
  const job = jobFor(started.config);
  const open = started.rooms.filter((r) => !isTaped(started, r));
  const flipped = (room: RoomId | null): GameEvent => ({ type: "eventFlipped", visibility: PUBLIC, round, card, room });
  switch (effect.kind) {
    case "lockdown": {
      const closable = open.filter((r) => r !== job.defaultRoom && !job.rooms[r]?.lieLow);
      return closable.length === 0 ? [] : [flipped(draw.pick(closable))];
    }
    case "roomSurge":
      return open.includes(effect.room) ? [flipped(null)] : [];
    case "insideTip": {
      const player = draw.pick(started.playerOrder);
      const subject = draw.pick(started.playerOrder.filter((id) => id !== player));
      const role = started.players[subject]?.role as string;
      return [flipped(null), { type: "insideTip", visibility: privateTo(player), player, round, subject, role }];
    }
    case "audit":
      return [flipped(null)];
  }
}

/**
 * `roundStarted`, then from round 2 (events on) a 4-in-10 chance of a card,
 * drawn at random from the whole deck, so cards can repeat (owner, 6 Nov).
 * A Rig for this round flips its holder's pick instead, with no chance roll
 * (the oldest, if several). design §13
 * Then each Electrician's blackout for this round is announced, with no source (§11.1).
 */
export function startRound(state: GameState, round: number, draw: Draw): GameEvent[] {
  const started: GameEvent = { type: "roundStarted", visibility: PUBLIC, round };
  const events: GameEvent[] = [started];
  if (eventsOn(state.config) && round >= EVENTS_FROM_ROUND) {
    // The oldest Rig of this round wins; later ones were spent without effect (they never learn more than the flip shows).
    const rigged = state.rigs.find((r) => r.round === round)?.pick;
    const card = rigged ?? (draw.int(EVENT_CHANCE.of) < EVENT_CHANCE.in ? draw.pick(EVENT_DECK) : null);
    if (card !== null) events.push(...flip(applyEvent(state, started), round, card, draw));
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

/** The room Lockdown closes this round, or null. design §13 */
export const closedRoom = (state: GameState): RoomId | null => (cardEffect(state)?.kind === "lockdown" ? (state.card?.room ?? null) : null);

/** Audit: every room shows how many coins reached the duffel from it this round. design §13 */
export const isAudit = (state: GameState): boolean => cardEffect(state)?.kind === "audit";
