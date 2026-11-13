// The round loop: checking a submitted move, resolving a round when its
// deadline passes, and closing its alibi window. design §3 (rooms, coins and grabs), §4.2, §5 (bells, raids,
// Wanted, the bust, cooling), §6.2 (the end check), §7 (the split, missing and
// honesty), §11 (role powers as the round resolves), §12 (perks that act then)
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
import { closedRoom, isAudit, roundJob } from "./deck";
import { aboveShare } from "./crew";
import { roleHandler } from "./roles";
import { boughtIn, roundSales } from "./perks";
import { coolBells, factVisibility, isTaped, raidedRooms, ringBells } from "./bells";
import { honestyOf, splitDuffel } from "./shares";
import { afterResult } from "./meeting";

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A role power used as part of a move, checked by the player's role handler. design §11.1 */
function checkAbility(state: GameState, player: PlayerState, raw: unknown): AbilityUse | string {
  if (!isObject(raw) || typeof raw.kind !== "string") return "ability must be an object with a kind";
  const handler = roleHandler(player.role);
  if (powerOf(state.config, player.role)?.kind !== raw.kind) return `your role has no ${raw.kind} ability`;
  return handler.move ? handler.move(state, player, raw) : "your role's power isn't used in a move";
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
 * design §4.2: the round's purchases announced, without names (§12); default moves (§3.3);
 * 1. grabs out of the bank (§3.2) and the powers and perks that act this round: the
 *    Locksmith's quieter coins, Soft shoes bought last round (§12), the Mole's ring,
 *    the Fixer's reopen, the Electrician's blackout for next round (§11.1);
 * 2. rings light bulbs (§5.2, `bellsRung`), with any bell a Hacker hid left out (§5.1);
 * 3. raids: every room whose last bulb lit has its visitors' grabs seized, is
 *    taped off, and raises Wanted (§5.3, §5.4, `roomRaided`);
 * 4. the bust check (§5.5): at the bust line the game ends after this round's
 *    public summary, and steps 5–6 don't run (a Priest's absolve is spent, never resolved);
 * 5. the split: first the Priests' absolves (set aside for the next split), then
 *    the duffel shared equally, the change into the kitty (§7.2, `duffelSplit`);
 * 6. cooling (§5.6, `bellsCooled`); a reopened room comes back at 0 (`roomReopened`);
 *    each Hacker learns its hidden bell;
 * 7. information: sightings, Security and power results (none from a blacked-out
 *    room, §11.1), Tails bought last round and this round's planted evidence (§12),
 *    the round summary (taken, missing and honesty, §7.4, §7.5);
 * 8. the end check (§6.2): the game ends once the bank is empty or this is the
 *    round cap (`endCheck`), and nothing below runs.
 * Two copies of a role on one target resolve in seat order from a seeded seat;
 * a use the other already did is "already done" and not spent (§11.4).
 * Otherwise the fold of `roundResolved` notes the meeting the round called
 * (§4.2 step 9: a raid calls a briefing, a third of the bank a regular
 * meeting) and opens the alibi window (§10); what follows waits for it (`closeAlibi`).
 */
export function resolveRound(state: GameState, round: number, draw: Draw): GameEvent[] {
  const job = roundJob(jobFor(state.config), state.card, eventsFor(state.config));
  const powerFor = (id: PlayerId) => powerOf(state.config, player(id).role);
  const order = state.playerOrder;
  // design §12, §18: planning has closed, so the round's "someone bought" notices come out together.
  const events: GameEvent[] = roundSales(state, round);
  const player = (id: PlayerId): PlayerState => {
    const p = state.players[id];
    if (!p) throw new Error(`resolveRound: unknown player ${id}`);
    return p;
  };

  // design §3.3: anyone without a move gets the default.
  // Maps, not objects, because player ids are host-chosen strings (e.g. "__proto__").
  const moves = new Map<PlayerId, Move>();
  // design §3.3 (owner, 7 Nov): with the default room taped off (§5.3), a missed move sits the round out.
  const fallback: Move | null = isTaped(state, job.defaultRoom) ? null : { room: job.defaultRoom, duffel: 1, pocket: 0 };
  for (const id of order) {
    const submitted = Object.hasOwn(state.moves, id) ? state.moves[id] : undefined;
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

  // A move's power only works if it still matches the player's role.
  const abilityOf = (id: PlayerId): AbilityUse | undefined => {
    const ability = moveOf(id).ability;
    return ability && ability.kind === powerFor(id)?.kind ? ability : undefined;
  };
  /** The players using move power `kind` this round, with their uses. */
  const usesOf = <K extends AbilityUse["kind"]>(kind: K): [PlayerId, Extract<AbilityUse, { kind: K }>][] =>
    playing.flatMap((id) => {
      const ability = abilityOf(id);
      return ability?.kind === kind ? [[id, ability as Extract<AbilityUse, { kind: K }>]] : [];
    });
  // design §11.4: copies on the same target resolve in seat order from a seeded random seat, drawn once and only then.
  let seated: readonly PlayerId[] | null = null;
  const inTurn = <A>(uses: [PlayerId, A][], target: (use: A) => string): [PlayerId, A][] => {
    if (new Set(uses.map(([, a]) => target(a))).size === uses.length) return uses;
    if (!seated) {
      const start = draw.int(order.length);
      seated = [...order.slice(start), ...order.slice(0, start)];
    }
    const turn = seated;
    return [...uses].sort(([a], [b]) => turn.indexOf(a) - turn.indexOf(b));
  };
  const resolved = (id: PlayerId, ability: Extract<GameEvent, { type: "abilityResolved" }>["ability"]): GameEvent => ({
    type: "abilityResolved",
    visibility: privateTo(id),
    player: id,
    round,
    ability,
  });
  const alreadyDone = (id: PlayerId, ability: AbilityUse): GameEvent => ({ type: "abilityAlreadyDone", visibility: privateTo(id), player: id, round, ability });
  /** The first use on each target acts; a later copy's use on it is already done (§11.4). */
  const firstOnTarget = <A extends AbilityUse>(uses: [PlayerId, A][], target: (use: A) => string): [PlayerId, A][] => {
    const done = new Set<string>();
    const first: [PlayerId, A][] = [];
    for (const [id, use] of inTurn(uses, target)) {
      if (done.has(target(use))) events.push(alreadyDone(id, use));
      else {
        done.add(target(use));
        first.push([id, use]);
      }
    }
    return first;
  };

  // Who is where. design §3.4
  const visitors: Record<RoomId, PlayerId[]> = {};
  for (const id of playing) (visitors[moveOf(id).room] ??= []).push(id);
  const others = (room: RoomId, self: PlayerId): PlayerId[] => (visitors[room] ?? []).filter((p) => p !== self);

  // §4.2 step 1: grabs come out of the bank, cut by a short bank (§3.2); the powers that act this round.
  const got = grabbed(playing, (id) => moveOf(id).duffel + moveOf(id).pocket, state.bank, draw);
  const rings = new Map<RoomId, number>();
  const ring = (room: RoomId, n: number) => rings.set(room, (rings.get(room) ?? 0) + n);
  // design §12 Soft shoes: bought last round, this round your coins don't ring at all.
  const softShoes = new Set(boughtIn(state, round - 1, "softShoes").map(([id]) => id));
  for (const id of playing) {
    const { room } = moveOf(id);
    const power = powerFor(id);
    // design §5.2: rings count the coins actually grabbed; the Locksmith's each ring one time fewer.
    if (!softShoes.has(id)) ring(room, ringsOf(roomDef(job, room), got.get(id) ?? 0, power?.kind === "muffle" ? power.fewerRings : 0));
  }
  // design §11.4: Mole rings stack.
  for (const [id, use] of usesOf("ring")) {
    ring(use.room, 1);
    events.push(resolved(id, use));
  }
  const reopened = firstOnTarget(usesOf("reopen"), (u) => u.room);
  for (const [id, use] of reopened) events.push(resolved(id, use));
  for (const [id, use] of firstOnTarget(usesOf("blackout"), (u) => u.room)) events.push(resolved(id, use));

  // §4.2 step 2: rings light bulbs; a bell a Hacker hid shows "?" to everyone else (§5.1).
  const { bulbs, tapedRounds, bustStars } = job.alarm;
  const lit = ringBells(state.rooms, state.bells, rings, bulbs);
  const hiders = firstOnTarget(usesOf("hide"), (u) => u.room);
  const shown = (bells: Readonly<Record<RoomId, number>>, hidden: readonly RoomId[]) =>
    Object.fromEntries(Object.entries(bells).filter(([room]) => !hidden.includes(room)));
  const hidden = hiders.map(([, use]) => use.room);
  events.push({ type: "bellsRung", visibility: factVisibility("bells"), round, bells: shown(lit, hidden), hidden });

  // §4.2 step 3: a raided room's visitors lose their grab before the split (§5.3).
  const raided = raidedRooms(state.rooms, lit, bulbs);
  let handedIn = 0;
  let grabbedCoins = 0;
  let taken = 0;
  for (const id of playing) {
    const { room } = moveOf(id);
    const coins = got.get(id) ?? 0;
    grabbedCoins += coins;
    if (raided.includes(room)) {
      events.push({ type: "coinsGrabbed", visibility: privateTo(id), player: id, round, room, duffel: 0, pocket: 0, seized: coins });
      continue;
    }
    // A cut grab loses its pocket-bound coins first, then its duffel-bound ones. design §3.2
    const duffel = Math.min(moveOf(id).duffel, coins);
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
  const absolves = usesOf("absolve");
  let realBells: Readonly<Record<RoomId, number>> = lit;
  if (busted) {
    // design §11.1: on a bust the absolve never resolves, and the Priest's use is still spent.
    for (const [id, use] of absolves) events.push(resolved(id, { ...use, taken: null }));
  } else {
    // §4.2 step 5: the Priests' absolves, against the share before this split, after this round's pocketing; then the split.
    let now = events.reduce(applyEvent, state);
    const absolvedBy = new Map<PlayerId, number>();
    for (const [id, use] of inTurn(absolves, (u) => u.target)) {
      const took = aboveShare(now, use.target);
      const earlier = absolvedBy.get(use.target);
      // design §11.4: a second absolve finding nothing left because the first took it is already done (it learns 0).
      if (earlier !== undefined && earlier > 0) {
        events.push(alreadyDone(id, use));
        continue;
      }
      const absolved: GameEvent[] = [resolved(id, { ...use, taken: took })];
      if (earlier === undefined) absolved.push({ type: "sinsAbsolved", visibility: privateTo(use.target), player: use.target, round, taken: took });
      absolvedBy.set(use.target, took);
      events.push(...absolved);
      now = absolved.reduce(applyEvent, now);
    }
    events.push(splitDuffel(state, round, handedIn));
    // §4.2 step 6: cooling; a room the Fixer reopened comes back from the next round, its bell at 0.
    const afterRaids = raidEvents.reduce(applyEvent, { ...state, bells: lit }).bells;
    realBells = coolBells(state.rooms, afterRaids, lyingLow.length, draw);
    events.push({ type: "bellsCooled", visibility: factVisibility("bells"), round, bells: shown(realBells, hidden) });
  }
  for (const [, use] of reopened) events.push({ type: "roomReopened", visibility: PUBLIC, round, room: use.room });
  // design §11.1: the Hacker sees the real bell (none once the room is raided: its bell is off).
  for (const [id, use] of hiders) events.push(resolved(id, { ...use, bulbs: raided.includes(use.room) ? null : (realBells[use.room] ?? null) }));

  // §4.2 step 7: room-mates, then Security, Lookout and Tail feeds; nobody is seen in a blacked-out room, and a
  // blacked-out Security's own cameras are offline too (§11.1, owner 8 Nov). A player put on a room's feeds by
  // Plant evidence this round shows in them (in seat order, so nothing marks the plant), and in their real room too (§12).
  const dark = (room: RoomId) => state.dark.includes(room);
  const planted = boughtIn(state, round, "plantEvidence");
  const onFeed = (room: RoomId, self: PlayerId): PlayerId[] =>
    order.filter((p) => p !== self && ((visitors[room] ?? []).includes(p) || planted.some(([, use]) => use.room === room && use.target === p)));
  for (const id of playing) {
    const room = moveOf(id).room;
    events.push({ type: "roomSighting", visibility: privateTo(id), player: id, round, room, others: dark(room) ? [] : others(room, id) });
  }
  const watched = (id: PlayerId, source: "security" | "lookout" | "tail", room: RoomId, offline = dark(room)): GameEvent => ({
    type: "roomWatched",
    visibility: privateTo(id),
    player: id,
    round,
    source,
    room,
    seen: offline ? [] : onFeed(room, id),
    offline,
  });
  for (const id of playing) {
    const { room, watch } = moveOf(id);
    const ability = abilityOf(id);
    if (roomDef(job, room).info === "watchRoom" && watch !== undefined) events.push(watched(id, "security", watch, dark(room) || dark(watch)));
    if (ability?.kind === "lookout") {
      events.push(resolved(id, ability));
      for (const r of ability.rooms) events.push(watched(id, "lookout", r));
    }
  }
  // design §12 Tail: bought last round, one more watched room this round, like the Lookout's.
  for (const [id, use] of boughtIn(state, round - 1, "tail")) events.push(watched(id, "tail", use.room));
  // design §13 Audit: how many coins reached the duffel from each room in play (0 from a raided room).
  if (isAudit(state)) {
    const duffel: Record<RoomId, number> = Object.fromEntries(state.rooms.map((r) => [r, 0]));
    for (const e of events) if (e.type === "coinsGrabbed") duffel[e.room] = (duffel[e.room] ?? 0) + e.duffel;
    events.push({ type: "auditReport", visibility: PUBLIC, round, duffel });
  }
  // design §7.4, §7.5: the summary says how many went missing, never who; honesty after the split.
  const bank = state.bank - grabbedCoins;
  const after = events.reduce(applyEvent, state);
  events.push({ type: "roundResolved", visibility: factVisibility("bank", "missing", "honesty"), round, bank, taken, missing: taken - handedIn, honesty: honestyOf({ ...after, bank }) });

  // §4.2 step 8: the end check (a bust has already ended the game).
  const ended = busted ? gameEnded(state, events, "bust", lyingLow) : endCheck(state, events, round);
  if (ended) return [...events, ended];
  // §4.1, §10: the alibi window opens; the meeting the round called, the result window or the next round wait for it to close.
  return events;
}

/**
 * design §4.1, §10: `round`'s alibi window closes. Everyone who played it and posted no alibi is
 * shown in their real room, as a fact; then the meeting the round called is awaited, else the
 * result window opens, or with the crew's pool empty the next round starts (§4.2 steps 9–10, §9.3).
 */
export function closeAlibi(state: GameState, round: unknown, draw: Draw): GameEvent[] | string {
  if (state.phase.kind !== "alibi" || round !== state.phase.round) return `the round ${show(round)} alibi window is not open`;
  const posted = new Set(state.log.flatMap((e) => (e.type === "said" && e.statement.kind === "alibi" && e.statement.round === round ? [e.statement.player] : [])));
  const real = new Map(state.log.flatMap((e) => (e.type === "coinsGrabbed" && e.round === round ? [[e.player, e.room] as const] : [])));
  // Seat order; a player who sat the round out (§3.3) was in no room, so has no fact.
  const noAlibi = state.playerOrder.flatMap((p) => (!posted.has(p) && real.has(p) ? [{ player: p, room: real.get(p) as string }] : []));
  const closed: GameEvent = { type: "alibiWindowClosed", visibility: PUBLIC, round, noAlibi };
  const settled = applyEvent(state, closed);
  return settled.meetingDue ? [closed] : [closed, ...afterResult(settled, draw)];
}
