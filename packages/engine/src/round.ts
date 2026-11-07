// The round loop: checking a submitted move, and resolving a round when its
// deadline passes. design §3 (rooms, coins and grabs), §4.2; R6 Heat and role powers until S3a.2/S3a.6
//
// Both are pure: they read state and return events (or a rejection reason).
// `handleCommand` (handle.ts) folds the events.
import type { RoomId } from "@skimjob/content";
import type { AbilityUse, GameEvent, GameState, Move, PlayerId, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import { clampHeat, roomDef, roomHeatParts, roundHeatDelta } from "./job";
import { eventsFor, jobFor, powerOf } from "./overrides";
import { isObject, show } from "./check";
import { actOfRound, isLastRoundOfAct } from "./acts";
import { gameEnded } from "./end";
import { applyEvent } from "./reduce";
import type { Draw } from "./handle";
import { cardEffects, closedRoom, isAudit, roundJob, startRound } from "./deck";
import { grantRewards, stopRaid } from "./crew";

export { actOfRound, isLastRoundOfAct };

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A role power used as part of a move, checked against the player's role. design §8 */
function checkAbility(state: GameState, player: PlayerState, raw: unknown): AbilityUse | string {
  if (!isObject(raw) || typeof raw.kind !== "string") return "ability must be an object with a kind";
  const power = powerOf(state.config, player.role);
  if (power.kind !== raw.kind) return `your role has no ${raw.kind} ability`;
  switch (power.kind) {
    case "lookout": {
      const rooms = raw.rooms;
      if (!Array.isArray(rooms) || rooms.length < 1 || rooms.length > power.extraRooms) {
        return `the Lookout watches 1 to ${power.extraRooms} room(s)`;
      }
      if (!rooms.every((r): r is RoomId => typeof r === "string" && state.rooms.includes(r))) {
        return "the Lookout can only watch rooms in play";
      }
      if (new Set(rooms).size !== rooms.length) return "the Lookout can't watch the same room twice";
      return { kind: "lookout", rooms: [...rooms] };
    }
    case "loopCameras": {
      if (player.roleState.usedThisAct >= power.perAct) return "you have already looped the cameras since the last meeting";
      if (typeof raw.room !== "string" || !state.rooms.includes(raw.room)) return "loop the cameras of a room in play";
      return { kind: "loopCameras", room: raw.room };
    }
    case "tipOff":
      return "the tip-off is used any time with useAbility, not in a move";
    case "voteWeight":
    case "audit":
    case "checkStash":
    case "bless":
    case "fixer":
      return "your role's power isn't used in a move";
    case "none":
      return "your role has no ability";
  }
}

/**
 * Check a submitted move and return it normalised (unknown fields dropped), or
 * the reason it's refused. Commands arrive as untrusted JSON, so the shape is
 * checked too. design §3.2, §11
 */
export function checkMove(state: GameState, player: PlayerState, raw: unknown): Move | string {
  if (!isObject(raw)) return "move must be an object";
  const { room, duffel, pocket, watch, ability } = raw;
  if (typeof room !== "string" || !state.rooms.includes(room)) return `room ${show(room)} is not open in this game`;
  // design §3.2 step 1, §13 Lockdown: the card names a room closed for this round.
  if (room === closedRoom(state)) return `the ${roomDef(jobFor(state.config), room).name} is closed this round (Lockdown)`;
  // design §13: Shift change raises a room's coins this round.
  const def = roomDef(roundJob(jobFor(state.config), state.card, eventsFor(state.config), state.playerOrder.length), room);
  if (!isCount(duffel) || !isCount(pocket)) return "duffel and pocket must be whole numbers, 0 or more";
  // design §3.2 step 2: grab 1 coin up to the room's limit (0 in Security and on the Rooftop).
  const grab = duffel + pocket;
  if (def.coins === 0 && grab > 0) return `there are no coins to grab in the ${def.name}`;
  if (def.coins > 0 && grab < 1) return `grab at least 1 coin in the ${def.name}`;
  if (grab > def.coins) return `you can grab at most ${def.coins} in the ${def.name}`;

  let move: Move = { room, duffel, pocket };
  if (def.info === "watchRoom") {
    if (typeof watch !== "string" || !state.rooms.includes(watch)) return `pick a room in play to watch from ${def.name}`;
    move = { ...move, watch };
  } else if (watch !== undefined) {
    return `you can only watch a room from a watcher room such as Security`;
  }
  if (ability !== undefined) {
    const checked = checkAbility(state, player, ability);
    if (typeof checked === "string") return checked;
    move = { ...move, ability: checked };
  }
  return move;
}

/**
 * design §3.2 short bank: the coins each player really grabs, given what each
 * asked for. When the bank covers every grab, everyone gets theirs; otherwise
 * the coins go out one at a time, round-robin in seat order from a seeded
 * random seat, until the bank is empty. Draws only when the bank runs short.
 */
function grabbed(order: readonly PlayerId[], asked: (id: PlayerId) => number, bank: number, draw: Draw): Map<PlayerId, number> {
  const total = order.reduce((sum, id) => sum + asked(id), 0);
  if (total <= bank) return new Map(order.map((id) => [id, asked(id)]));
  const got = new Map(order.map((id) => [id, 0]));
  const start = draw.int(order.length);
  let left = bank;
  // Each pass hands at least one coin out (some grab still wants more while total > handed out).
  while (left > 0) {
    for (let i = 0; i < order.length && left > 0; i++) {
      const id = order[(start + i) % order.length] as PlayerId;
      const have = got.get(id) as number;
      if (have < asked(id)) {
        got.set(id, have + 1);
        left--;
      }
    }
  }
  return got;
}

/**
 * Every event for resolving the current round: default moves (design §3.3),
 * grabs out of the bank split into the two bags (§3.2, §4.2 step 1), then R6's
 * order:
 * Heat (rounded, then clamped once), information, the public summary, and
 * finally the raid, or nothing more: the fold of `roundResolved` opens the
 * round's alibis (design §5.4) and `closeAlibis` goes on. Step 1 is the round's event card (§10): its
 * player effects (Inside tip) come first and are
 * folded before the rest is worked out; the others change yields, Heat and information below.
 */
export function resolveRound(before: GameState, round: number, draw: Draw): GameEvent[] {
  const job = roundJob(jobFor(before.config), before.card, eventsFor(before.config), before.playerOrder.length);
  const powerFor = (id: PlayerId) => powerOf(state.config, player(id).role);
  const order = before.playerOrder;
  const crewSize = order.length;
  const events: GameEvent[] = [];
  const player = (id: PlayerId): PlayerState => {
    const p = state.players[id];
    if (!p) throw new Error(`resolveRound: unknown player ${id}`);
    return p;
  };

  // design §3.3: anyone without a move gets the default.
  // Maps, not objects, because player ids are host-chosen strings (e.g. "__proto__").
  const moves = new Map<PlayerId, Move>();
  for (const id of order) {
    const submitted = Object.hasOwn(before.moves, id) ? before.moves[id] : undefined;
    if (submitted) {
      moves.set(id, submitted);
    } else {
      // design §3.3: a missed move is the Lobby, 1 coin, handed in.
      const move: Move = { room: job.defaultRoom, duffel: 1, pocket: 0 };
      moves.set(id, move);
      events.push({ type: "defaultMoveAssigned", visibility: privateTo(id), player: id, round, move });
    }
  }
  const moveOf = (id: PlayerId): Move => moves.get(id) as Move;

  // §5.2 step 1: the event card's player effects (design §10), folded so the rest of the round sees them.
  const cardEvents = cardEffects(before, round, draw);
  events.push(...cardEvents);
  const state = cardEvents.reduce(applyEvent, before);
  // A move's power only works if it still matches the player's role.
  const abilityOf = (id: PlayerId): AbilityUse | undefined => {
    const ability = moveOf(id).ability;
    return ability && ability.kind === powerFor(id).kind ? ability : undefined;
  };

  // Who is where. design §3.4
  const visitors: Record<RoomId, PlayerId[]> = {};
  for (const id of order) (visitors[moveOf(id).room] ??= []).push(id);
  const others = (room: RoomId, self: PlayerId): PlayerId[] => (visitors[room] ?? []).filter((p) => p !== self);

  // design §4.2 step 1: grabs come out of the bank, cut by a short bank (§3.2).
  const got = grabbed(order, (id) => moveOf(id).duffel + moveOf(id).pocket, state.bank, draw);
  let haulDelta = 0;
  let taken = 0;
  const pocketed = new Map<PlayerId, number>();
  for (const id of order) {
    const { room } = moveOf(id);
    const coins = got.get(id) ?? 0;
    // A cut grab loses its pocket-bound coins first, then its duffel-bound ones. design §3.2
    const duffel = Math.min(moveOf(id).duffel, coins);
    pocketed.set(id, coins - duffel);
    haulDelta += duffel;
    taken += coins;
    events.push({ type: "coinsGrabbed", visibility: privateTo(id), player: id, round, room, duffel, pocket: coins - duffel });
  }
  // §5.2 step 4, §7: baseline + room pressure, rounded, then clamped once.
  // The Mole's tip-off is no longer part of a round: it lands at a hidden police moment (police.ts).
  const counts = Object.fromEntries(Object.entries(visitors).map(([room, ids]) => [room, ids.length]));
  const roomsHeat = roundHeatDelta(job, crewSize, counts);
  const heat = clampHeat(job, state.heat + roomsHeat);
  // extension.md "Build notes" (Heat breakdown): the public parts of this round's Heat. The baseline is
  // its true value; any rounding sits on the rooms. `clamp` is what the 0–max limit took back (only when it did),
  // so the parts always add up to the real change ("Heat never drops below 0").
  const rooms = roomHeatParts(job, crewSize, counts, state.rooms);
  const base = roomsHeat - Object.values(rooms).reduce((a, b) => a + b, 0);
  const clamp = heat - (state.heat + roomsHeat);
  const heatParts = { base, rooms, ...(clamp !== 0 ? { clamp } : {}) };

  // §5.2 step 5: room-mates, then Hacker loops, Security / Lookout / Server-room results.
  for (const id of order) {
    const room = moveOf(id).room;
    events.push({ type: "roomSighting", visibility: privateTo(id), player: id, round, room, others: others(room, id) });
  }
  // Hacker (§8): a looped room's Security feed reads "camera offline" this round (not the Lookout's or room-mates').
  const looped = new Map<RoomId, PlayerId[]>();
  for (const id of order) {
    const ability = abilityOf(id);
    if (ability?.kind !== "loopCameras" || powerFor(id).kind !== "loopCameras") continue;
    looped.set(ability.room, [...(looped.get(ability.room) ?? []), id]);
    events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability });
  }
  // extension.md "Roles": Hackers whose loop hid, from a Security watcher of that room, a visitor who pocketed (their token).
  const hid = new Set<PlayerId>();
  for (const id of order) {
    const { room, watch } = moveOf(id);
    const ability = abilityOf(id);
    if (roomDef(job, room).info === "watchRoom" && watch !== undefined) {
      const loopers = looped.get(watch);
      if (loopers && others(watch, id).some((x) => (pocketed.get(x) ?? 0) > 0)) for (const h of loopers) hid.add(h);
      const seen = loopers ? [] : others(watch, id);
      events.push({ type: "roomWatched", visibility: privateTo(id), player: id, round, source: "security", room: watch, seen, offline: loopers !== undefined });
    }
    if (ability?.kind === "lookout") {
      events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability });
      for (const r of ability.rooms) {
        events.push({ type: "roomWatched", visibility: privateTo(id), player: id, round, source: "lookout", room: r, seen: others(r, id), offline: false });
      }
    }
    // design §8.3 Tail: one more watched room, like the Lookout's (not blinded by a camera loop).
    const tailed = player(id).roleState.tail;
    if (tailed !== null) {
      events.push({ type: "roomWatched", visibility: privateTo(id), player: id, round, source: "tail", room: tailed, seen: others(tailed, id), offline: false });
    }
  }
  // design §10 Audit: what each room came up short (its visitors' pockets), every room in play listed.
  if (isAudit(state)) {
    const shortfalls: Record<RoomId, number> = {};
    for (const r of state.rooms) shortfalls[r] = (visitors[r] ?? []).reduce((sum, id) => sum + (pocketed.get(id) ?? 0), 0);
    events.push({ type: "auditReport", visibility: PUBLIC, round, shortfalls });
  }
  events.push({
    type: "roundResolved",
    visibility: PUBLIC,
    round,
    bank: state.bank - taken,
    haulDelta,
    haul: state.haul + haulDelta,
    heatDelta: heat - state.heat,
    heat,
    heatParts,
  });

  // extension.md "Roles": this round's tokens (Hacker).
  events.push(...grantRewards(state, "loopHidPocketer", (p) => hid.has(p.id)));

  // §5.2 step 6: Heat at the max means the cops raid and the heist fails at once (§3, §7),
  // unless a Fixer stops it (v2 §2). Otherwise the round's alibis open (the fold of
  // `roundResolved`); `closeAlibis` moves on.
  if (heat >= job.heat.max) {
    const saved = stopRaid(events.reduce(applyEvent, before), round);
    if (saved.length > 0) return [...events, ...saved];
    events.push({ type: "copsRaided", visibility: PUBLIC, round, heat });
    events.push(gameEnded(before, events, "heat"));
  }
  return events;
}

/**
 * design §5.4: the alibi deadline for `round` has passed. The next round
 * starts (flipping its card); after an act's last round the game awaits the
 * act's meeting (the fold of `alibisClosed`).
 */
export function closeAlibis(state: GameState, round: number, draw: Draw): GameEvent[] {
  const events: GameEvent[] = [{ type: "alibisClosed", visibility: PUBLIC, round }];
  if (!isLastRoundOfAct(round)) return [...events, ...startRound(state, round + 1, draw)];
  return events;
}
