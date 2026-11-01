// The events deck: flipping a card as a round starts, the card's effects at
// §5.2 step 1, and the Double-cross answer. design §10, §5.2
//
// Cards are data in @skimjob/content; each kind of effect is one small
// function here. All draws go through the command's `Draw`.
import { EVENTS, EVENT_DECK, EVENTS_FROM_ROUND, MOLE_ROLE, type EventDef, type EventEffect, type JobDef, type RoomId } from "@skimjob/content";
import type { ActiveCard, GameConfig, GameEvent, GameState, PlayerId, PlayerState, RoleState } from "./types";
import { PUBLIC, privateTo } from "./types";
import type { Draw } from "./handle";
import { eventsFor, jobFor, type EventTable } from "./overrides";
import { actOfRound } from "./acts";
import { playerFor } from "./check";

type Result = GameEvent[] | string;

/** Events are off in starter mode (validateConfig also refuses starter + events) and when the host turns them off. design §8.1, §15 */
export const eventsOn = (config: GameConfig): boolean => config.eventsEnabled && !config.starterMode;

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
 * random from the cards not yet flipped, so none repeats. Lockdown names its
 * closed room (any room in play but the default room) and Double-cross
 * privately offers two random players a swap, both as the card is flipped, so
 * players can plan around them. design §10
 */
export function startRound(state: GameState, round: number, draw: Draw): GameEvent[] {
  const events: GameEvent[] = [{ type: "roundStarted", visibility: PUBLIC, round, act: actOfRound(round) }];
  if (!eventsOn(state.config) || round < EVENTS_FROM_ROUND) return events;
  const left = EVENT_DECK.filter((id) => !state.cardsFlipped.includes(id));
  if (left.length === 0) return events;
  const card = draw.pick(left);
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
  return events;
}

/** The job as this round's card changes it: Shift change and Payday multiply one room's loot and Heat pressure. design §10 */
export function roundJob(job: JobDef, card: ActiveCard | null, events: EventTable = EVENTS): JobDef {
  const effect = card ? cardDef(card.id, events).effect : null;
  if (effect?.kind !== "roomSurge" || !Object.hasOwn(job.rooms, effect.room)) return job;
  const def = job.rooms[effect.room] as JobDef["rooms"][string];
  const surged = { ...def, loot: Math.round(def.loot * effect.lootMultiplier), heatPressure: def.heatPressure * effect.heatMultiplier };
  return { ...job, rooms: { ...job.rooms, [effect.room]: surged } };
}

/** The room Lockdown closes this round, or null. design §10 */
export const closedRoom = (state: GameState): RoomId | null => (effectIs(state, "lockdown") ? (state.card?.room ?? null) : null);

/** Police patrol / Quiet night: Heat added to the round's change, before the clamp. design §10, §7 */
export const cardHeat = (state: GameState): number => effectIs(state, "heat")?.amount ?? 0;

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
 * its uses so far with it; a Snitch's target that would become its new holder
 * becomes the other swapper; Mole allies are recomputed and any other Mole
 * whose ally changed is told privately (`moleAllies`). (provisional)
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
  const moles = state.playerOrder.filter((id) => roleAfter(id) === MOLE_ROLE);
  const alliesOf = (id: PlayerId): PlayerId[] => (roleAfter(id) === MOLE_ROLE ? moles.filter((m) => m !== id) : []);
  // Same role on both sides: nothing changes hands, so each keeps its own uses.
  const same = pa.role === pb.role;
  const taken = (self: PlayerId, partner: PlayerId, from: PlayerState): RoleState => ({
    ...from.roleState,
    target: from.roleState.target === self ? partner : from.roleState.target,
    allies: alliesOf(self),
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
