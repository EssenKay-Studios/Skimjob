// The round loop: checking a submitted move, and resolving a round when its
// deadline passes. design §5, §6, §7, §8 (role powers used in a move)
//
// Both are pure: they read state and return events (or a rejection reason).
// `handleCommand` (handle.ts) folds the events.
import type { RoomId } from "@skimjob/content";
import type { AbilityUse, GameEvent, GameState, Move, PlayerId, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import { clampHeat, roomDef, roomHeatParts, roomLoot, roundHeatDelta } from "./job";
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
 * checked too. design §5.1, §6.1, §8
 */
export function checkMove(state: GameState, player: PlayerState, raw: unknown): Move | string {
  if (!isObject(raw)) return "move must be an object";
  const { room, pocket, watch, ability } = raw;
  if (typeof room !== "string" || !state.rooms.includes(room)) return `room ${show(room)} is not open in this game`;
  // design §10 Lockdown: the card names a room closed for this round.
  if (room === closedRoom(state)) return `the ${roomDef(jobFor(state.config), room).name} is closed this round (Lockdown)`;
  // design §10: Shift change raises a room's loot this round.
  const def = roomDef(roundJob(jobFor(state.config), state.card, eventsFor(state.config), state.playerOrder.length), room);
  if (!isCount(pocket)) return "pocket must be a whole number, 0 or more";
  // The real yield can only drop below the room's loot (crowded Deposit boxes), so this is the upper bound.
  if (pocket > def.loot) return `you can pocket at most ${def.loot} in the ${def.name}`;

  let move: Move = { room, pocket };
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
 * Every event for resolving the current round, in the order of design §5.2:
 * default moves (§5.1), yields and capacity, splits,
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

  // §5.1: anyone without a move gets the default — Lobby, hand everything in.
  // Maps, not objects, because player ids are host-chosen strings (e.g. "__proto__").
  const moves = new Map<PlayerId, Move>();
  for (const id of order) {
    const submitted = Object.hasOwn(before.moves, id) ? before.moves[id] : undefined;
    if (submitted) {
      moves.set(id, submitted);
    } else {
      const move: Move = { room: job.defaultRoom, pocket: 0 };
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

  // §5.2 step 2: who is where, and what each room pays (Deposit-box capacity, §6.2).
  const visitors: Record<RoomId, PlayerId[]> = {};
  for (const id of order) (visitors[moveOf(id).room] ??= []).push(id);
  const others = (room: RoomId, self: PlayerId): PlayerId[] => (visitors[room] ?? []).filter((p) => p !== self);

  // §5.2 step 3: splits. Pocket is capped at the real yield.
  let haulDelta = 0;
  const toStash = new Map<PlayerId, number>();
  for (const id of order) {
    const { room, pocket } = moveOf(id);
    const loot = roomLoot(roomDef(job, room), visitors[room]?.length ?? 0);
    const kept = Math.min(pocket, loot);
    toStash.set(id, kept);
    haulDelta += loot - kept;
    events.push({ type: "lootSplit", visibility: privateTo(id), player: id, round, room, loot, toHaul: loot - kept, toStash: kept });
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
      if (loopers && others(watch, id).some((x) => (toStash.get(x) ?? 0) > 0)) for (const h of loopers) hid.add(h);
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
    for (const r of state.rooms) shortfalls[r] = (visitors[r] ?? []).reduce((sum, id) => sum + (toStash.get(id) ?? 0), 0);
    events.push({ type: "auditReport", visibility: PUBLIC, round, shortfalls });
  }
  events.push({
    type: "roundResolved",
    visibility: PUBLIC,
    round,
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
