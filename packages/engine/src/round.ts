// The round loop: checking a submitted move, and resolving a round when its
// deadline passes. design §3 (rooms, coins and grabs), §4.2, §5 (bells, raids,
// Wanted, the bust, cooling), §6.2 (the end check), §7 (the split, missing and
// honesty); R6 role powers until S3a.6
//
// Both are pure: they read state and return events (or a rejection reason).
// `handleCommand` (handle.ts) folds the events.
import type { RoomId } from "@skimjob/content";
import type { AbilityUse, GameEvent, GameState, Move, PlayerId, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import { ringsOf, roomDef } from "./job";
import { eventsFor, jobFor, powerOf } from "./overrides";
import { isObject, show } from "./check";
import { endCheck, gameEnded } from "./end";
import { applyEvent } from "./reduce";
import type { Draw } from "./handle";
import { cardEffects, closedRoom, isAudit, roundJob, startRound } from "./deck";
import { grantRewards } from "./crew";
import { coolBells, factVisibility, isTaped, raidedRooms, ringBells } from "./bells";
import { honestyOf, splitDuffel } from "./shares";
import { afterResult } from "./meeting";

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
      if (player.roleState.usedThisStretch >= power.perStretch) return "you have already looped the cameras since the last meeting";
      if (typeof raw.room !== "string" || !state.rooms.includes(raw.room)) return "loop the cameras of a room in play";
      return { kind: "loopCameras", room: raw.room };
    }
    case "ring": {
      // design §5.2, §5.3, §11.1: any open room but the Rooftop; a taped-off room's bell is off.
      if (player.roleState.usedThisStretch >= power.perStretch) return "you have already rung a bell since the last meeting";
      if (typeof raw.room !== "string" || !state.rooms.includes(raw.room)) return "ring a room in play";
      if (isTaped(state, raw.room)) return "a taped-off room's bell is off";
      if (roomDef(jobFor(state.config), raw.room).lieLow) return "nothing can ring the Rooftop";
      return { kind: "ring", room: raw.room };
    }
    case "reopen": {
      // design §5.3, §11.1: once per game, a taped-off room.
      if (player.roleState.usedThisGame >= 1) return "you have already reopened a room this game";
      if (typeof raw.room !== "string" || !isTaped(state, raw.room)) return "reopen a taped-off room";
      return { kind: "reopen", room: raw.room };
    }
    case "voteWeight":
    case "audit":
    case "checkStash":
    case "bless":
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
  // design §3.2 step 1, §5.3: nobody can pick a taped-off room.
  if (isTaped(state, room)) return `the ${roomDef(jobFor(state.config), room).name} is taped off`;
  // design §13: Shift change raises a room's coins this round.
  const def = roomDef(roundJob(jobFor(state.config), state.card, eventsFor(state.config)), room);
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
 * Every event for resolving the current round, in the end-of-round order of
 * design §4.2: default moves (§3.3) and the event card's player effects (§13);
 * 1. grabs out of the bank (§3.2) and the powers that act this round (the
 *    Fixer's reopen, the Mole's ring);
 * 2. rings light bulbs (§5.2, `bellsRung`);
 * 3. raids: every room whose last bulb lit has its visitors' grabs seized, is
 *    taped off, and raises Wanted (§5.3, §5.4, `roomRaided`);
 * 4. the bust check (§5.5): at the bust line the game ends after this round's
 *    public summary, and steps 5–6 don't run;
 * 5. the split: the duffel shared equally, the change into the kitty (§7.2, `duffelSplit`);
 * 6. cooling (§5.6, `bellsCooled`); a reopened room comes back at 0 (`roomReopened`);
 * 7. information: sightings, Security and power results, the round summary
 *    (taken, missing and honesty, §7.4, §7.5);
 * 8. the end check (§6.2): the game ends once the bank is empty or this is the
 *    round cap (`endCheck`), and nothing below runs.
 * Otherwise the fold of `roundResolved` opens the round's alibis and notes the
 * meeting the round called (§4.2 step 9: a raid calls a briefing, a third of
 * the bank a regular meeting), and `closeAlibis` goes on.
 */
export function resolveRound(before: GameState, round: number, draw: Draw): GameEvent[] {
  const job = roundJob(jobFor(before.config), before.card, eventsFor(before.config));
  const powerFor = (id: PlayerId) => powerOf(state.config, player(id).role);
  const order = before.playerOrder;
  const events: GameEvent[] = [];
  const player = (id: PlayerId): PlayerState => {
    const p = state.players[id];
    if (!p) throw new Error(`resolveRound: unknown player ${id}`);
    return p;
  };

  // design §3.3: anyone without a move gets the default.
  // Maps, not objects, because player ids are host-chosen strings (e.g. "__proto__").
  const moves = new Map<PlayerId, Move>();
  // design §3.3 (owner, 7 Nov): with the default room taped off (§5.3), a missed move sits the round out.
  const fallback: Move | null = isTaped(before, job.defaultRoom) ? null : { room: job.defaultRoom, duffel: 1, pocket: 0 };
  for (const id of order) {
    const submitted = Object.hasOwn(before.moves, id) ? before.moves[id] : undefined;
    if (submitted) {
      moves.set(id, submitted);
    } else {
      // design §3.3: a missed move is the Lobby, 1 coin, handed in.
      if (fallback) moves.set(id, fallback);
      events.push({ type: "defaultMoveAssigned", visibility: privateTo(id), player: id, round, move: fallback });
    }
  }
  const moveOf = (id: PlayerId): Move => moves.get(id) as Move;
  // Who plays the round: someone sitting it out is in no room, grabs and rings nothing, and doesn't escape a bust.
  const playing = order.filter((id) => moves.has(id));

  // The event card's player effects (design §13), folded so the rest of the round sees them.
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
  for (const id of playing) (visitors[moveOf(id).room] ??= []).push(id);
  const others = (room: RoomId, self: PlayerId): PlayerId[] => (visitors[room] ?? []).filter((p) => p !== self);

  // §4.2 step 1: grabs come out of the bank, cut by a short bank (§3.2); the Fixer's and the Mole's powers act.
  const got = grabbed(playing, (id) => moveOf(id).duffel + moveOf(id).pocket, state.bank, draw);
  const rings = new Map<RoomId, number>();
  const ring = (room: RoomId, n: number) => rings.set(room, (rings.get(room) ?? 0) + n);
  const reopened: RoomId[] = [];
  for (const id of playing) {
    const { room } = moveOf(id);
    // design §5.2: rings count the coins actually grabbed.
    ring(room, ringsOf(roomDef(job, room), got.get(id) ?? 0));
    const ability = abilityOf(id);
    if (ability?.kind === "ring") ring(ability.room, 1);
    if (ability?.kind === "reopen" && !reopened.includes(ability.room)) reopened.push(ability.room);
    if (ability?.kind === "ring" || ability?.kind === "reopen") {
      events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability });
    }
  }

  // §4.2 step 2: rings light bulbs.
  const { bulbs, tapedRounds, bustStars } = job.alarm;
  const lit = ringBells(state.rooms, state.bells, rings, bulbs);
  events.push({ type: "bellsRung", visibility: factVisibility("bells"), round, bells: lit });

  // §4.2 step 3: a raided room's visitors lose their grab before the split (§5.3).
  const raided = raidedRooms(state.rooms, lit, bulbs);
  let handedIn = 0;
  let grabbedCoins = 0;
  let taken = 0;
  const pocketed = new Map<PlayerId, number>();
  for (const id of playing) {
    const { room } = moveOf(id);
    const coins = got.get(id) ?? 0;
    grabbedCoins += coins;
    if (raided.includes(room)) {
      pocketed.set(id, 0);
      events.push({ type: "coinsGrabbed", visibility: privateTo(id), player: id, round, room, duffel: 0, pocket: 0, seized: coins });
      continue;
    }
    // A cut grab loses its pocket-bound coins first, then its duffel-bound ones. design §3.2
    const duffel = Math.min(moveOf(id).duffel, coins);
    pocketed.set(id, coins - duffel);
    // design §7.4: seized coins count as neither taken nor missing.
    taken += coins;
    handedIn += duffel;
    events.push({ type: "coinsGrabbed", visibility: privateTo(id), player: id, round, room, duffel, pocket: coins - duffel, seized: 0 });
  }
  let wanted = state.wanted;
  const raidEvents: GameEvent[] = raided.map((room) => ({
    type: "roomRaided",
    visibility: PUBLIC,
    round,
    room,
    seized: (visitors[room] ?? []).reduce((sum, id) => sum + (got.get(id) ?? 0), 0),
    closedThrough: round + tapedRounds,
    wanted: ++wanted,
  }));
  events.push(...raidEvents);

  // §4.2 step 4: Wanted at the bust line ends the game at once (§5.5); only the Rooftop escapes.
  const lyingLow = playing.filter((id) => roomDef(job, moveOf(id).room).lieLow);
  const busted = wanted >= bustStars;
  if (!busted) {
    // §4.2 step 5: the split.
    events.push(splitDuffel(state, round, handedIn));
    // §4.2 step 6: cooling; a room the Fixer reopened comes back from the next round, its bell at 0.
    const afterRaids = raidEvents.reduce(applyEvent, { ...state, bells: lit }).bells;
    events.push({ type: "bellsCooled", visibility: factVisibility("bells"), round, bells: coolBells(state.rooms, afterRaids, lyingLow.length, draw) });
  }
  for (const room of reopened) events.push({ type: "roomReopened", visibility: PUBLIC, round, room });

  // §4.2 step 7: room-mates, then Hacker loops, Security / Lookout results.
  for (const id of playing) {
    const room = moveOf(id).room;
    events.push({ type: "roomSighting", visibility: privateTo(id), player: id, round, room, others: others(room, id) });
  }
  // Hacker (§8): a looped room's Security feed reads "camera offline" this round (not the Lookout's or room-mates').
  const looped = new Map<RoomId, PlayerId[]>();
  for (const id of playing) {
    const ability = abilityOf(id);
    if (ability?.kind !== "loopCameras" || powerFor(id).kind !== "loopCameras") continue;
    looped.set(ability.room, [...(looped.get(ability.room) ?? []), id]);
    events.push({ type: "abilityResolved", visibility: privateTo(id), player: id, round, ability });
  }
  // extension.md "Roles": Hackers whose loop hid, from a Security watcher of that room, a visitor who pocketed (their token).
  const hid = new Set<PlayerId>();
  for (const id of playing) {
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
  // design §13 Audit: what each room came up short (its visitors' pockets), every room in play listed.
  if (isAudit(state)) {
    const shortfalls: Record<RoomId, number> = {};
    for (const r of state.rooms) shortfalls[r] = (visitors[r] ?? []).reduce((sum, id) => sum + (pocketed.get(id) ?? 0), 0);
    events.push({ type: "auditReport", visibility: PUBLIC, round, shortfalls });
  }
  // design §7.4, §7.5: the summary says how many went missing, never who; honesty after the split.
  const bank = state.bank - grabbedCoins;
  const after = events.reduce(applyEvent, before);
  events.push({ type: "roundResolved", visibility: factVisibility("bank", "missing", "honesty"), round, bank, taken, missing: taken - handedIn, honesty: honestyOf({ ...after, bank }) });

  // extension.md "Roles": this round's tokens (Hacker).
  events.push(...grantRewards(state, "loopHidPocketer", (p) => hid.has(p.id)));

  // §4.2 step 8: the end check (a bust has already ended the game).
  const ended = busted ? gameEnded(before, events, "bust", lyingLow) : endCheck(before, events, round);
  if (ended) events.push(ended);
  return events;
}

/**
 * design §5.4: the alibi deadline for `round` has passed. The meeting the
 * round called is awaited (the fold of `alibisClosed`, §4.2 step 9); else the
 * result window opens, or with the pool empty the next round starts (§9.3).
 */
export function closeAlibis(state: GameState, round: number, draw: Draw): GameEvent[] {
  const closed: GameEvent = { type: "alibisClosed", visibility: PUBLIC, round };
  return [closed, ...(state.meetingDue ? [] : afterResult(applyEvent(state, closed), draw))];
}
