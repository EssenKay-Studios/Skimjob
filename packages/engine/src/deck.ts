// The events deck: from round 2, a 4-in-10 chance that a card flips as the
// round starts (a card that can't apply is redrawn), and the card's effects. design §13
//
// Cards are data in @skimjob/content; each kind of effect is one small
// function here. All draws go through the command's `Draw`.
import { EVENTS, EVENT_CHANCE, EVENT_DECK, EVENTS_FROM_ROUND, type EventDef, type EventEffect, type JobDef, type RoomId } from "@skimjob/content";
import type { ActiveCard, GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import type { Draw } from "./handle";
import { eventsFor, jobFor, type EventTable } from "./overrides";
import { applyEvent } from "./reduce";
import { isTaped } from "./bells";

/** Events are on unless the host turns them off. design §13, §16 */
const eventsOn = (config: GameConfig): boolean => config.eventsEnabled;

/** The card's definition. Throws for ids the content doesn't have (the log only holds drawn ones). */
function cardDef(id: string, events: EventTable = EVENTS): EventDef {
  const def = Object.hasOwn(events, id) ? events[id] : undefined;
  if (!def) throw new Error(`unknown event card ${id}`);
  return def;
}

/** This round's card effect, or null if no card was flipped. */
const cardEffect = (state: GameState): EventEffect | null => (state.card ? cardDef(state.card.id, eventsFor(state.config)).effect : null);

/** The rooms Lockdown may close in a round that has just started: open ones, never the Lobby or the Rooftop. design §13 */
function closable(started: GameState): RoomId[] {
  const job = jobFor(started.config);
  return started.rooms.filter((r) => !isTaped(started, r) && r !== job.defaultRoom && !job.rooms[r]?.lieLow);
}

/** Whether `card` can apply in a round that has just started: Lockdown needs a closable room, Shift change its room open. design §13 */
function applies(started: GameState, card: string): boolean {
  const effect = cardDef(card, eventsFor(started.config)).effect;
  if (effect.kind === "lockdown") return closable(started).length > 0;
  if (effect.kind === "roomSurge") return started.rooms.includes(effect.room) && !isTaped(started, effect.room);
  return true;
}

/**
 * The flip of `card` in a round that has just started (`started`). Lockdown
 * names one closable room; Inside tip tells a random player another player's
 * role, privately, as the card flips. design §13
 */
function flip(started: GameState, round: number, card: string, draw: Draw): GameEvent[] {
  const effect = cardDef(card, eventsFor(started.config)).effect;
  const flipped = (room: RoomId | null): GameEvent => ({ type: "eventFlipped", visibility: PUBLIC, round, card, room });
  if (effect.kind === "lockdown") return [flipped(draw.pick(closable(started)))];
  if (effect.kind !== "insideTip") return [flipped(null)];
  const player = draw.pick(started.playerOrder);
  const subject = draw.pick(started.playerOrder.filter((id) => id !== player));
  const { role } = started.players[subject] as PlayerState;
  return [flipped(null), { type: "insideTip", visibility: privateTo(player), player, round, subject, role }];
}

/**
 * `roundStarted`, then from round 2 (events on) a 4-in-10 chance of a card,
 * drawn at random from the whole deck, so cards can repeat (owner, 6 Nov). A
 * card that can't apply is redrawn from the cards that can, so a flip always
 * lands a card (owner, 8 Nov; Audit and Inside tip always apply). design §13
 * Then each blackout for this round (an Electrician's, or a Blackout perk) is announced, with no source (§11.1, §12).
 */
export function startRound(state: GameState, round: number, draw: Draw): GameEvent[] {
  const started: GameEvent = { type: "roundStarted", visibility: PUBLIC, round };
  const events: GameEvent[] = [started];
  if (eventsOn(state.config) && round >= EVENTS_FROM_ROUND) {
    const drawn = draw.int(EVENT_CHANCE.of) < EVENT_CHANCE.in ? draw.pick(EVENT_DECK) : null;
    if (drawn !== null) {
      const now = applyEvent(state, started);
      const card = applies(now, drawn) ? drawn : draw.pick(EVENT_DECK.filter((c) => applies(now, c)));
      events.push(...flip(now, round, card, draw));
    }
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
