// The round loop: checking a submitted move, and resolving a round when its
// deadline passes. design §5, §6, §7, §8 (starter role powers used in a move)
//
// Both are pure: they read state and return events (or a rejection reason).
// `handleCommand` (handle.ts) folds the events.
import { ROLES, ROUNDS_PER_ACT, type RoleDef, type RoleId, type RoomId } from "@skimjob/content";
import type { AbilityUse, ActNumber, GameEvent, GameState, Move, PlayerId, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import { clampHeat, jobById, roomDef, roomLoot, roundHeatDelta } from "./job";

/** The act a round belongs to: rounds 1–3 are Act 1, and so on. design §4 */
export function actOfRound(round: number): ActNumber {
  return Math.ceil(round / ROUNDS_PER_ACT) as ActNumber;
}

/** True for rounds 3, 6 and 9: the act's meeting and checkpoint come next. design §4 */
export function isLastRoundOfAct(round: number): boolean {
  return round % ROUNDS_PER_ACT === 0;
}

/** A role with no definition yet (the Mole, until its powers land) has no power and may pocket. */
const NO_POWER: Pick<RoleDef, "power" | "canPocket"> = { power: { kind: "none" }, canPocket: true };

function roleOf(role: RoleId): Pick<RoleDef, "power" | "canPocket"> {
  return (Object.hasOwn(ROLES, role) ? ROLES[role] : undefined) ?? NO_POWER;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A role power used as part of a move, checked against the player's role. design §8 */
function checkAbility(state: GameState, player: PlayerState, raw: unknown): AbilityUse | string {
  if (!isObject(raw) || typeof raw.kind !== "string") return "ability must be an object with a kind";
  const { power } = roleOf(player.role);
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
    case "fenceSafe": {
      const left = power.perAct - player.safeDepositedThisAct;
      if (!isCount(raw.amount) || raw.amount < 1 || raw.amount > left) {
        return `the safe takes a whole number from 1 to ${left} this act`;
      }
      return { kind: "fenceSafe", amount: raw.amount };
    }
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
  if (typeof room !== "string" || !state.rooms.includes(room)) return `room ${String(room)} is not open in this game`;
  const def = roomDef(jobById(state.config.job), room);
  if (!isCount(pocket)) return "pocket must be a whole number, 0 or more";
  // The real yield can only drop below the room's loot (crowded Deposit boxes), so this is the upper bound.
  if (pocket > def.loot) return `you can pocket at most ${def.loot} in the ${def.name}`;
  if (pocket > 0 && !roleOf(player.role).canPocket) return "your role can't pocket loot";

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
 * default moves (§5.1), yields and capacity, splits (then the Fence safe),
 * Heat (rounded, then clamped once), information, the public summary, and
 * finally either the raid, the next round, or (after an act's last round)
 * nothing more: the fold of `roundResolved` leaves the game awaiting the
 * act's meeting (task 6). Step 1, event cards, arrives with the events deck.
 */
export function resolveRound(state: GameState, round: number): GameEvent[] {
  const job = jobById(state.config.job);
  const order = state.playerOrder;
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
    const submitted = Object.hasOwn(state.moves, id) ? state.moves[id] : undefined;
    if (submitted) {
      moves.set(id, submitted);
    } else {
      const move: Move = { room: job.defaultRoom, pocket: 0 };
      moves.set(id, move);
      events.push({ type: "defaultMoveAssigned", visibility: privateTo(id), player: id, round, move });
    }
  }
  const moveOf = (id: PlayerId): Move => moves.get(id) as Move;

  // §5.2 step 2: who is where, and what each room pays (Deposit-box capacity, §6.2).
  const visitors: Record<RoomId, PlayerId[]> = {};
  for (const id of order) (visitors[moveOf(id).room] ??= []).push(id);
  const others = (room: RoomId, self: PlayerId): PlayerId[] => (visitors[room] ?? []).filter((p) => p !== self);

  // §5.2 step 3: splits. Pocket is capped at the real yield; the Insider never pockets (§8).
  let haulDelta = 0;
  let pocketed = 0;
  const toStash = new Map<PlayerId, number>();
  for (const id of order) {
    const { room, pocket } = moveOf(id);
    const loot = roomLoot(roomDef(job, room), visitors[room]?.length ?? 0);
    const kept = roleOf(player(id).role).canPocket ? Math.min(pocket, loot) : 0;
    toStash.set(id, kept);
    haulDelta += loot - kept;
    if (kept > 0) pocketed++;
    events.push({ type: "lootSplit", visibility: privateTo(id), player: id, round, room, loot, toHaul: loot - kept, toStash: kept });
  }
  // Fence (§8): move loot from the stash, including this round's pocket, into the safe.
  for (const id of order) {
    const ability = moveOf(id).ability;
    if (ability?.kind !== "fenceSafe") continue;
    const p = player(id);
    const power = roleOf(p.role).power;
    const left = power.kind === "fenceSafe" ? power.perAct - p.safeDepositedThisAct : 0;
    const amount = Math.max(0, Math.min(ability.amount, left, p.stash + (toStash.get(id) ?? 0)));
    events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability: { kind: "fenceSafe", amount } });
  }

  // §5.2 step 4, §7: baseline + room pressure, rounded, then clamped once after every Heat source.
  const counts = Object.fromEntries(Object.entries(visitors).map(([room, ids]) => [room, ids.length]));
  const heat = clampHeat(job, state.heat + roundHeatDelta(job, crewSize, counts));

  // §5.2 step 5: room-mates, then Security / Lookout / Server-room results.
  for (const id of order) {
    const room = moveOf(id).room;
    events.push({ type: "roomSighting", visibility: privateTo(id), player: id, round, room, others: others(room, id) });
  }
  for (const id of order) {
    const { room, watch, ability } = moveOf(id);
    if (roomDef(job, room).info === "watchRoom" && watch !== undefined) {
      events.push({ type: "roomWatched", visibility: privateTo(id), player: id, round, source: "security", room: watch, seen: others(watch, id) });
    }
    if (ability?.kind === "lookout") {
      events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability });
      for (const r of ability.rooms) {
        events.push({ type: "roomWatched", visibility: privateTo(id), player: id, round, source: "lookout", room: r, seen: others(r, id) });
      }
    }
    if (roomDef(job, room).info === "pocketCount") {
      events.push({ type: "pocketCount", visibility: privateTo(id), player: id, round, pocketed });
    }
  }
  events.push({
    type: "roundResolved",
    visibility: PUBLIC,
    round,
    haulDelta,
    haul: state.haul + haulDelta,
    heatDelta: heat - state.heat,
    heat,
  });

  // §5.2 step 6: Heat at the max means the cops raid and the heist fails at once (§3, §7).
  if (heat >= job.heat.max) {
    events.push({ type: "copsRaided", visibility: PUBLIC, round, heat });
    // Ranking and role scoring are task 7 (design §3, §13); until then the outcome carries none.
    events.push({ type: "gameEnded", visibility: PUBLIC, outcome: { result: "failed", reason: "heat", ranking: [], winners: [] } });
  } else if (!isLastRoundOfAct(round)) {
    events.push({ type: "roundStarted", visibility: PUBLIC, round: round + 1, act: actOfRound(round + 1) });
  }
  return events;
}
