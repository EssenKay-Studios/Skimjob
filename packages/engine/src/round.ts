// The round loop: checking a submitted move, and resolving a round when its
// deadline passes. design §5, §6, §7, §8 (role powers used in a move)
//
// Both are pure: they read state and return events (or a rejection reason).
// `handleCommand` (handle.ts) folds the events.
import { MOLE_ROLE, type RoleId, type RoomId } from "@skimjob/content";
import type { AbilityUse, GameEvent, GameState, Move, PlayerId, PlayerState } from "./types";
import { PUBLIC, REVEAL, privateTo } from "./types";
import { clampHeat, roomDef, roomLoot, roundHeatDelta } from "./job";
import { eventsFor, jobFor, powerOf, roleDefIn, rolesFor } from "./overrides";
import { isObject, show } from "./check";
import { actOfRound, isLastRoundOfAct } from "./acts";
import { gameEnded } from "./end";
import { applyEvent } from "./reduce";
import type { Draw } from "./handle";
import { isDuel } from "./setup";
import { endOfDuelAct } from "./duel";
import { cardEffects, cardHeat, closedRoom, isAudit, isBlackout, roundJob, startRound } from "./deck";
import { grantRewards, roundRewards, stopRaid } from "./crew";
import { blackmailAllies, darkRoundEvents, playersOf } from "./accomplices";

export { actOfRound, isLastRoundOfAct };

/** Whether `role` may pocket loot (Inside Man can't, design §8). A role id with no definition may. */
const canPocket = (state: GameState, role: RoleId): boolean => roleDefIn(rolesFor(state.config), role)?.canPocket ?? true;

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
    case "fenceSafe": {
      const left = power.perAct - player.roleState.usedThisAct;
      if (!isCount(raw.amount) || raw.amount < 1 || raw.amount > left) {
        return `the safe takes a whole number from 1 to ${left} this act`;
      }
      return { kind: "fenceSafe", amount: raw.amount };
    }
    case "loopCameras": {
      if (player.roleState.usedThisAct >= power.perAct) return "you have already looped the cameras this act";
      if (typeof raw.room !== "string" || !state.rooms.includes(raw.room)) return "loop the cameras of a room in play";
      return { kind: "loopCameras", room: raw.room };
    }
    case "blackmail": {
      if (player.roleState.usedThisAct >= power.perAct) return "you have already blackmailed someone this act";
      const { target, role } = raw;
      if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${show(target)}`;
      if (target === player.id) return "you can't blackmail yourself";
      if (typeof role !== "string" || !(Object.hasOwn(rolesFor(state.config), role) || role === MOLE_ROLE)) return `unknown role ${show(role)}`;
      return { kind: "blackmail", target, role };
    }
    case "forge": {
      if (player.roleState.usedThisAct >= power.perAct) return "you have already forged a sighting this act";
      const { target, room } = raw;
      if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${show(target)}`;
      if (typeof room !== "string" || !state.rooms.includes(room)) return "forge a sighting in a room in play";
      return { kind: "forge", target, room };
    }
    case "embezzle": {
      if (player.roleState.usedThisAct >= power.perAct) return "you have already embezzled this act";
      return { kind: "embezzle" };
    }
    case "tipOff": {
      if (player.roleState.usedThisAct >= power.perAct) return "you have already tipped off the cops this act";
      return { kind: "tipOff" };
    }
    case "voteWeight":
    case "cancelShakedown":
    case "snitch":
    case "audit":
    case "checkStash":
    case "bless":
    case "bagman":
    case "cleaner":
    case "fixer":
    case "foresee":
    case "getaway":
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
  // design §10: Shift change / Payday raise a room's loot this round.
  const def = roomDef(roundJob(jobFor(state.config), state.card, eventsFor(state.config), state.playerOrder.length), room);
  if (!isCount(pocket)) return "pocket must be a whole number, 0 or more";
  // The real yield can only drop below the room's loot (crowded Deposit boxes), so this is the upper bound.
  if (pocket > def.loot) return `you can pocket at most ${def.loot} in the ${def.name}`;
  if (pocket > 0 && !canPocket(state, player.role)) return "your role can't pocket loot";

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
 * finally the raid, or nothing more: the fold of `roundResolved` opens the
 * round's alibis (design §5.4) and `closeAlibis` goes on. Step 1 is the round's event card (§10): its
 * player effects (Raid rumour, Inside tip, Double-cross) come first and are
 * folded before the rest is worked out, so a swapped role plays this round;
 * the others change yields, Heat and information below.
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
  // A move's power only works if it still matches the player's role (a Double-cross may have swapped it).
  const abilityOf = (id: PlayerId): AbilityUse | undefined => {
    const ability = moveOf(id).ability;
    return ability && ability.kind === powerFor(id).kind ? ability : undefined;
  };

  // §5.2 step 2: who is where, and what each room pays (Deposit-box capacity, §6.2).
  const visitors: Record<RoomId, PlayerId[]> = {};
  for (const id of order) (visitors[moveOf(id).room] ??= []).push(id);
  const others = (room: RoomId, self: PlayerId): PlayerId[] => (visitors[room] ?? []).filter((p) => p !== self);

  // §5.2 step 3: splits. Pocket is capped at the real yield; the Inside Man never pockets (§8).
  let haulDelta = 0;
  let pocketed = 0;
  const toStash = new Map<PlayerId, number>();
  for (const id of order) {
    const { room, pocket } = moveOf(id);
    const loot = roomLoot(roomDef(job, room), visitors[room]?.length ?? 0);
    const kept = canPocket(state, player(id).role) ? Math.min(pocket, loot) : 0;
    toStash.set(id, kept);
    haulDelta += loot - kept;
    if (kept > 0) pocketed++;
    events.push({ type: "lootSplit", visibility: privateTo(id), player: id, round, room, loot, toHaul: loot - kept, toStash: kept });
    // Bagman (v2 §2): handed in everything (and something) → the bank adds its bonus, hidden in the round's Haul change.
    const power = powerFor(id);
    if (power.kind === "bagman" && kept === 0 && loot > 0 && power.bonus > 0) {
      haulDelta += power.bonus;
      events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability: { kind: "bagman", bonus: power.bonus } });
    }
  }
  // Each stash as the round's splits, safe moves and takes change it.
  const stash = new Map<PlayerId, number>(order.map((id) => [id, player(id).stash + (toStash.get(id) ?? 0)]));
  const stashOf = (id: PlayerId): number => stash.get(id) as number;
  // Fence (§8): move loot from the stash, including this round's pocket, into the safe.
  for (const id of order) {
    const ability = abilityOf(id);
    if (ability?.kind !== "fenceSafe") continue;
    const power = powerFor(id);
    const left = power.kind === "fenceSafe" ? power.perAct - player(id).roleState.usedThisAct : 0;
    const amount = Math.max(0, Math.min(ability.amount, left, stashOf(id)));
    stash.set(id, stashOf(id) - amount);
    events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability: { kind: "fenceSafe", amount } });
  }
  // Embezzler (v2 §2): after the splits, its take moves from the Haul (as it stands) to its stash, inside the Haul change.
  for (const id of order) {
    const power = powerFor(id);
    if (abilityOf(id)?.kind !== "embezzle" || power.kind !== "embezzle") continue;
    const amount = Math.max(0, Math.min(power.take, state.haul + haulDelta));
    haulDelta -= amount;
    stash.set(id, stashOf(id) + amount);
    events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability: { kind: "embezzle", amount } });
  }
  // Blackmailer (v2 §2): a right guess steals the target's vote at the next meeting (meeting.ts); the
  // victim is told its vote is compromised. A saboteur guessed right and the Blackmailer learn each other.
  for (const id of order) {
    const ability = abilityOf(id);
    if (ability?.kind !== "blackmail") continue;
    const correct = player(ability.target).role === ability.role;
    events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability: { ...ability, correct } });
    if (!correct) continue;
    events.push({ type: "voteCompromised", visibility: privateTo(ability.target), player: ability.target, round });
    events.push(...blackmailAllies(state, id, ability.target));
  }

  // §5.2 step 4, §7: baseline + room pressure, rounded, plus any Mole tip-off (§8, hidden in
  // the round's total), then clamped once after every Heat source.
  const counts = Object.fromEntries(Object.entries(visitors).map(([room, ids]) => [room, ids.length]));
  // Cleaner (v2 §2): its visit to its cooling room counts as `visitors` visitors for that room's Heat pressure.
  for (const id of order) {
    const power = powerFor(id);
    if (power.kind === "cleaner" && moveOf(id).room === power.room) counts[power.room] = (counts[power.room] ?? 0) + power.visitors - 1;
    // Getaway Driver (v2 §2): its visit there adds the Heat a visitor would remove (× `reverse`), hidden in the total.
    // It counts as negative visitors, so it follows the room's pressure (and its sign) if a card or override changes it.
    if (power.kind === "getaway" && moveOf(id).room === power.room) counts[power.room] = (counts[power.room] ?? 0) - power.reverse - 1;
  }
  let tipOffs = 0;
  for (const id of order) {
    const power = powerFor(id);
    if (abilityOf(id)?.kind !== "tipOff" || power.kind !== "tipOff") continue;
    tipOffs += power.heat;
    events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability: { kind: "tipOff", heat: power.heat } });
  }
  // design §10: Police patrol / Quiet night join the same single clamp.
  const heat = clampHeat(job, state.heat + roundHeatDelta(job, crewSize, counts) + tipOffs + cardHeat(state));

  // §5.2 step 5: room-mates, then Hacker loops, Security / Lookout / Server-room results.
  // design §10 Power cut: nobody sees anybody (sightings, Security and Lookout); the Server room still counts.
  const blackout = isBlackout(state);
  for (const id of order) {
    const room = moveOf(id).room;
    if (!blackout) events.push({ type: "roomSighting", visibility: privateTo(id), player: id, round, room, others: others(room, id) });
  }
  // Hacker (§8): a looped room shows as empty on Security this round (not to the Lookout or room-mates).
  const looped = new Map<RoomId, PlayerId[]>();
  for (const id of order) {
    const ability = abilityOf(id);
    if (ability?.kind !== "loopCameras" || powerFor(id).kind !== "loopCameras") continue;
    looped.set(ability.room, [...(looped.get(ability.room) ?? []), id]);
    events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability });
  }
  // v2 §2: Hackers whose loop hid a saboteur from a crew Security watcher (their reward). Fooling the
  // dark side, the Hacker itself included, earns nothing (PR #32 QA).
  const saboteurs = playersOf(state, "saboteur");
  const crew = playersOf(state, "crew");
  const hid = new Set<PlayerId>();
  // Forger (v2 §2): planted players show on every watch feed of the room this round (not to room-mates),
  // in seat order like real ones, unless really there or watching it themselves.
  const forged = new Map<RoomId, Set<PlayerId>>();
  const forgers: { readonly forger: PlayerId; readonly target: PlayerId; readonly room: RoomId }[] = [];
  for (const id of order) {
    const ability = abilityOf(id);
    if (ability?.kind !== "forge") continue;
    events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability });
    forgers.push({ forger: id, target: ability.target, room: ability.room });
    if (!(visitors[ability.room] ?? []).includes(ability.target)) forged.set(ability.room, (forged.get(ability.room) ?? new Set()).add(ability.target));
  }
  const fooled = new Map<string, PlayerId[]>();
  const feed = (watcher: PlayerId, r: RoomId): PlayerId[] => {
    const fakes = [...(forged.get(r) ?? [])].filter((x) => x !== watcher);
    for (const x of fakes) fooled.set(`${x}\u0000${r}`, [...(fooled.get(`${x}\u0000${r}`) ?? []), watcher]);
    const seen = new Set([...others(r, watcher), ...fakes]);
    return order.filter((x) => seen.has(x));
  };
  for (const id of order) {
    const { room, watch } = moveOf(id);
    const ability = abilityOf(id);
    if (!blackout && roomDef(job, room).info === "watchRoom" && watch !== undefined) {
      const loopers = looped.get(watch);
      if (loopers && crew.includes(id) && others(watch, id).some((x) => saboteurs.includes(x))) for (const h of loopers) hid.add(h);
      const seen = loopers ? [] : feed(id, watch);
      events.push({ type: "roomWatched", visibility: privateTo(id), player: id, round, source: "security", room: watch, seen });
    }
    if (ability?.kind === "lookout") {
      events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability });
      for (const r of blackout ? [] : ability.rooms) {
        events.push({ type: "roomWatched", visibility: privateTo(id), player: id, round, source: "lookout", room: r, seen: feed(id, r) });
      }
    }
    // design §8.3 Tail: one more watched room, like the Lookout's (blinded by a Power cut, not by a camera loop).
    const tailed = player(id).roleState.tail;
    if (tailed !== null && !blackout) {
      events.push({ type: "roomWatched", visibility: privateTo(id), player: id, round, source: "tail", room: tailed, seen: feed(id, tailed) });
    }
    if (roomDef(job, room).info === "pocketCount") {
      events.push({ type: "pocketCount", visibility: privateTo(id), player: id, round, pocketed });
    }
  }
  // v2 §2: which feeds a forged sighting fooled, for the end-of-game reveal only.
  for (const f of forgers) {
    const shownTo = fooled.get(`${f.target}\u0000${f.room}`) ?? [];
    events.push({ type: "sightingForged", visibility: REVEAL, forger: f.forger, round, target: f.target, room: f.room, shownTo: order.filter((x) => shownTo.includes(x)) });
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
  });

  // design §8.3 (v2 §2): the Bagman's, Cleaner's and Hacker's rewards for this round, then what the dark side learns.
  events.push(...roundRewards(state, events, round), ...grantRewards(state, "loopHidSaboteur", (p) => hid.has(p.id)));
  events.push(...darkRoundEvents(events.reduce(applyEvent, before), round, draw));

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
 * act's meeting (the fold of `alibisClosed`), or in Duel mode the act's
 * call-outs and checkpoint follow at once (design §16.1).
 */
export function closeAlibis(state: GameState, round: number, draw: Draw): GameEvent[] {
  const events: GameEvent[] = [{ type: "alibisClosed", visibility: PUBLIC, round }];
  if (!isLastRoundOfAct(round)) return [...events, ...startRound(state, round + 1, draw)];
  if (isDuel(state.config)) return [...events, ...endOfDuelAct(state, events, actOfRound(round), draw)];
  return events;
}
