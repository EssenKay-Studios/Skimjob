// A bot player: the same Agent interface a human client would use. It gets its
// own viewFor() output and returns ordinary player commands. design §17.3
//
// Bots are deterministic: all their randomness comes from their own seeded RNG
// (the engine's sfc32), never Math.random, so same seed + same views = same
// commands. Their seed is their own, not the game's (which is secret).
import { ROUNDS_PER_ACT, type RoomId } from "@skimjob/content";
import {
  checkpointTarget,
  nextUint32,
  roomDef,
  seedRng,
  type AbilityUse,
  type Move,
  type PlayerCommand,
  type PlayerId,
  type PlayerView,
  type RngState,
  type VoteChoice,
} from "@skimjob/engine";
import type { Personality } from "./personalities";
import { crewSize, isDuel, jobOf, lastResolvedRound, ofType, roleOf, roomsWhere } from "./read";
import { mostSuspicious, suspicion } from "./suspicion";
import { heatDanger, jobThisRound } from "./heat";

/**
 * Anything that plays a seat: a bot, or (later) a human client. It sees only
 * its own view and answers with the commands it wants to send now; it is
 * asked again whenever the view may have changed, and returns [] when it has
 * nothing to do. design §17.3
 */
export interface Agent {
  readonly player: PlayerId;
  act(view: PlayerView): PlayerCommand[];
}

/** A bot's random numbers in [0, 1). */
export type Random = () => number;

export interface BotOptions {
  readonly player: PlayerId;
  readonly personality: Personality;
  /** The bot's own seed. Never the game's seed: that is hidden from every player. */
  readonly seed: string;
}

/** A bot's own random numbers: the engine's seeded sfc32, kept apart from the game's RNG. */
export function botRandom(seed: string): Random {
  let rng: RngState = seedRng(`bot:${seed}`);
  return () => {
    const next = nextUint32(rng);
    rng = next.rng;
    return next.value / 0x1_0000_0000;
  };
}

export function createBot({ player, personality, seed }: BotOptions): Agent & { readonly personality: Personality } {
  const random = botRandom(seed);
  return {
    player,
    personality,
    act: (view) => {
      if (view.me.id !== player) throw new Error(`bot ${player} was given ${view.me.id}'s view`);
      return decide(view, personality, random);
    },
  };
}

/**
 * Chance a Mole bot tips off in a round when it still can this act (bot
 * setting, not a game rule): about one act in two, so Moles push Heat a bit
 * without dominating (sim, task 13). Smarter Moles: task 16.
 */
const MOLE_TIP_CHANCE = 0.15;

/**
 * A Muscle bot rescues a shakedown target whose suspicion (to it) is below this
 * (bot setting; no dice, since the bot may be asked again during the window). design §8
 */
const MUSCLE_CLEAN_BELOW = 1;

/** A Snitch bot votes for its own target at this share of its usual vote threshold (bot setting). design §8 */
const SNITCH_EAGERNESS = 0.5;

/** Chance a bot accepts a Double-cross offer (bot setting, not a game rule; minimal until task 16). design §10 */
const DOUBLE_CROSS_ACCEPT = 0.5;

/**
 * Getaway Driver bots (v2 §4 "Play", bot settings): with Heat danger from
 * `mid` up to `high` they go to the Rooftop (where their visit heats) with
 * chance `rooftop`; from `high` they loot and pocket without minding the checkpoint.
 */
const GETAWAY = { mid: 0.4, high: 0.75, rooftop: 0.6 } as const;

const pick = <T>(items: readonly T[], random: Random): T => items[Math.floor(random() * items.length)] as T;

function weighted<T>(items: readonly (readonly [T, number])[], random: Random): T | undefined {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let roll = random() * total;
  for (const [item, w] of items) if ((roll -= w) < 0) return item;
  return items[items.length - 1]?.[0];
}

/** Everything the bot wants to do given this view. */
export function decide(view: PlayerView, p: Personality, random: Random): PlayerCommand[] {
  const phase = view.phase;
  if (phase.kind === "ended" || phase.kind === "setup") return [];
  const player = view.me.id;
  const out: PlayerCommand[] = [];
  // design §5.4: alibis only while the round's alibi window is open.
  const room = view.alibiRound !== null ? chooseAlibi(view, p, random) : null;
  if (room !== null) out.push({ type: "postAlibi", player, room });
  if (phase.kind === "meeting") {
    if (view.me.vote === null) out.push({ type: "castVote", player, vote: chooseVote(view, p, random) });
    return out;
  }
  if (phase.kind === "shakedownPending") {
    // design §8, §11.3: a Muscle with its cancel left keeps itself out of trouble, and
    // stops a shakedown of someone it thinks is clean (the Haul would pay them compensation).
    const { power } = roleOf(view);
    const cancelled = ofType(view.caseFile, "abilityResolved").some((e) => e.ability.kind === "cancelShakedown" && e.ability.meetingId === phase.meetingId);
    if (power.kind === "cancelShakedown" && view.me.roleState.usedThisGame < power.perGame && !cancelled) {
      const looksClean = phase.target !== player && (suspicion(view).get(phase.target) ?? 0) < MUSCLE_CLEAN_BELOW;
      if (phase.target === player || looksClean) {
        out.push({ type: "useAbility", player, ability: { kind: "cancelShakedown" } });
      }
    }
    return out;
  }
  const duel = isDuel(view);
  if (!duel) out.push(...scheduleMeeting(view));
  out.push(...crewPowers(view));
  if (phase.kind === "planning") {
    if (duel) {
      if (wantsCallOut(view, p, random)) out.push({ type: "callOut", player });
    } else if (wantsEmergency(view, p, random)) out.push({ type: "callEmergency", player });
    if (view.me.move === null) out.push({ type: "submitMove", player, move: chooseMove(view, p, random) });
    // design §10: answer a Double-cross offer once (minimal: a coin flip; a Mole keeps its card).
    const round = phase.round;
    const offered = ofType(view.caseFile, "doubleCrossOffered").some((e) => e.round === round);
    const answered = ofType(view.caseFile, "doubleCrossAnswered").some((e) => e.round === round);
    if (offered && !answered) {
      // The dark side (saboteurs, accomplices) keeps its card.
      const accept = roleOf(view).faction === "crew" && random() < DOUBLE_CROSS_ACCEPT;
      out.push({ type: "answerDoubleCross", player, accept });
    }
  }
  return out;
}

// ---------------------------------------------------------------- crew powers (v2 §2)

/**
 * The Auditor's, Detective's and Priest's powers (role deck v2 §4 "Play",
 * minimal; R4 adds claims and perk use). Once per act, while planning: the
 * Auditor audits the room its top suspect claimed for the latest round; the
 * Detective checks its top suspect in the act's last round, closest to the
 * meeting; the Priest blesses its most-trusted player (lowest suspicion).
 */
function crewPowers(view: PlayerView): PlayerCommand[] {
  const { power } = roleOf(view);
  if (view.phase.kind !== "planning" || (power.kind !== "audit" && power.kind !== "checkStash" && power.kind !== "bless")) return [];
  if (view.me.roleState.usedThisAct >= power.perAct) return [];
  const scores = suspicion(view);
  if (power.kind === "bless") {
    // v2 §2: no blessing in an act after a blessed player was caught dirty (its own blessings, public shakedowns).
    const acts = new Map(ofType(view.ledger, "meetingOpened").map((e) => [e.meetingId, e.act]));
    const dirty = ofType(view.ledger, "shakedownResolved").filter((x) => !x.clean && acts.get(x.meetingId) === view.act - 1);
    const barred = ofType(view.caseFile, "abilityResolved").some((e) => {
      const a = e.ability;
      return a.kind === "bless" && a.act === view.act - 1 && dirty.some((x) => x.target === a.target);
    });
    if (barred) return [];
    const trusted = [...view.players].map((o) => o.id).sort((a, b) => (scores.get(a) ?? 0) - (scores.get(b) ?? 0))[0];
    return trusted === undefined ? [] : [{ type: "useAbility", player: view.me.id, ability: { kind: "bless", target: trusted } }];
  }
  const top = mostSuspicious(scores);
  if (top === null || top.score <= 0) return [];
  const player = view.me.id;
  if (power.kind === "checkStash") {
    return view.round % ROUNDS_PER_ACT === 0 ? [{ type: "useAbility", player, ability: { kind: "checkStash", target: top.player } }] : [];
  }
  const round = lastResolvedRound(view);
  const claim = ofType(view.ledger, "alibiPosted").find((a) => a.player === top.player && a.round === round);
  return claim ? [{ type: "useAbility", player, ability: { kind: "audit", room: claim.room } }] : [];
}

// ---------------------------------------------------------------- moves (§5.1)

/** Room, split and role power for this round. design §5.1, §6, §7, §8 */
export function chooseMove(view: PlayerView, p: Personality, random: Random): Move {
  const job = jobThisRound(view);
  const lootRooms = roomsWhere(view, job, (d) => d.loot > 0);
  const byLoot = (rooms: readonly RoomId[]) => rooms.map((r) => [r, roomDef(job, r).loot] as const);
  const chosen = random() < p.noise ? pick(view.rooms, random) : chooseRoom(view, p, random);
  // design §10 Lockdown: the closed room is refused, so go to the default room (never closed) instead.
  const room = view.card?.room === chosen ? job.defaultRoom : chosen;
  const def = roomDef(job, room);
  const pocket = choosePocket(view, p, random, def.loot);
  let move: Move = { room, pocket };
  // design §6.1: Security watches one room; a looting room, more often the richer ones.
  if (def.info === "watchRoom") move = { ...move, watch: weighted(byLoot(lootRooms), random) ?? room };

  const { power } = roleOf(view);
  let ability: AbilityUse | null = null;
  if (power.kind === "lookout") {
    // design §8: one extra room's visitors; a looting room other than mine.
    const target = weighted(byLoot(lootRooms.filter((r) => r !== room)), random);
    if (target !== undefined) ability = { kind: "lookout", rooms: [target] };
  } else if (power.kind === "fenceSafe") {
    // design §8: hide what the act's allowance and the stash allow.
    // The role's uses this act (they travel with the card in a Double-cross, design §10).
    const left = power.perAct - view.me.roleState.usedThisAct;
    const hideable = view.me.stash + pocket;
    if (left >= 1 && hideable >= 1) ability = { kind: "fenceSafe", amount: Math.min(left, hideable) };
  } else if (power.kind === "loopCameras" && view.me.roleState.usedThisAct < power.perAct) {
    // v2 §4: loop the room its known saboteur claimed last (it may go back there); otherwise hide its own skim.
    const ally = view.me.roleState.allies[0];
    const claim = ofType(view.ledger, "alibiPosted").filter((a) => a.player === ally).at(-1)?.room;
    if (claim !== undefined && view.rooms.includes(claim)) ability = { kind: "loopCameras", room: claim };
    else if (pocket > 0) ability = { kind: "loopCameras", room };
  } else if (power.kind === "blackmail" && view.me.roleState.usedThisAct < power.perAct && view.players.length > 0) {
    // v2 §4: guess only with a role it learned (an Inside tip or a Peek; the latest per
    // player, which can be stale after a Double-cross); otherwise skip. Claims come in R4.
    const learned: [string, string][] = [
      ...ofType(view.caseFile, "insideTip").map((t): [string, string] => [t.subject, t.role]),
      ...ofType(view.caseFile, "perkUsed").flatMap((e): [string, string][] => (e.perk.kind === "peek" ? [[e.perk.target, e.perk.role]] : [])),
    ];
    const known = [...new Map(learned)].filter(([id]) => view.players.some((o) => o.id === id));
    if (known.length > 0) {
      const [target, role] = pick(known, random);
      ability = { kind: "blackmail", target, role };
    }
  } else if (power.kind === "forge" && view.me.roleState.usedThisAct < power.perAct) {
    // v2 §4: plant its most-trusted rival (lowest suspicion, not a known ally) in the room
    // likely to come up short: where it skims itself, else the richest room, in the act's last round.
    const scores = suspicion(view);
    const rival = view.players.map((o) => o.id).filter((id) => !view.me.roleState.allies.includes(id)).sort((a, b) => (scores.get(a) ?? 0) - (scores.get(b) ?? 0))[0];
    const richest = [...byLoot(lootRooms)].sort((a, b) => b[1] - a[1])[0]?.[0];
    const short = pocket > 0 ? room : view.round % ROUNDS_PER_ACT === 0 ? richest : undefined;
    if (rival !== undefined && short !== undefined) ability = { kind: "forge", target: rival, room: short };
  } else if (power.kind === "embezzle" && view.me.roleState.usedThisAct < power.perAct) {
    // v2 §4: take when it is in the richest room (a crowd there to blame), or in the act's last round.
    const richest = [...byLoot(lootRooms)].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (room === richest || view.round % ROUNDS_PER_ACT === 0) ability = { kind: "embezzle" };
  } else if (power.kind === "tipOff" && view.me.roleState.usedThisAct < power.perAct) {
    // design §8: the Mole sometimes tips off (at most once per act); otherwise it plays its personality.
    if (random() < MOLE_TIP_CHANCE) ability = { kind: "tipOff" };
  }
  return ability ? { ...move, ability } : move;
}

function chooseRoom(view: PlayerView, p: Personality, random: Random): RoomId {
  const base = jobOf(view);
  // design §10: this round's card can surge a room's loot and Heat (Shift change, Payday).
  const job = jobThisRound(view, base);
  // design §7: Heat now plus this round's card, the baseline still to come and,
  // when a Mole may be in play, the tip-offs still to come (heat.ts), against the raid level.
  const danger = heatDanger(view, base);
  // The most any room pushes Heat on a normal round: a surged room is avoided harder.
  const usual = Math.max(1, ...roomsWhere(view, base, (d) => d.heatPressure > 0).map((r) => roomDef(base, r).heatPressure));
  const cooler = roomsWhere(view, job, (d) => d.heatPressure < 0)[0];
  // v2 §4: a Getaway Driver heats the Rooftop when Heat is mid, and loots once it's high.
  const { power } = roleOf(view);
  if (power.kind === "getaway") {
    if (danger >= GETAWAY.high) return weighted(roomsWhere(view, job, (d) => d.loot > 0).map((r) => [r, roomDef(job, r).loot] as const), random) ?? job.defaultRoom;
    if (danger >= GETAWAY.mid && view.rooms.includes(power.room) && random() < GETAWAY.rooftop) return power.room;
  }
  if (cooler && danger > p.heatCaution && random() < Math.min(0.8, (danger - p.heatCaution) * 4)) return cooler;
  const watcher = roomsWhere(view, job, (d) => d.info === "watchRoom")[0];
  if (watcher && random() < p.watch) return watcher;
  // Richer rooms are likelier, more so for the greedy. Heat-raising rooms get
  // less likely once danger passes the bot's Heat caution (the same point and
  // slope as the Rooftop above): a greedy player doesn't avoid the Vault at Heat 10.
  const avoid = Math.max(0, danger - p.heatCaution) * 4;
  const options = roomsWhere(view, job, (d) => d.loot > 0).map((r) => {
    const d = roomDef(job, r);
    const heatFactor = d.heatPressure > 0 ? Math.max(0.05, 1 - avoid * Math.max(1, d.heatPressure / usual)) : 1;
    return [r, d.loot ** (0.5 + p.greed) * heatFactor] as const;
  });
  return weighted(options, random) ?? job.defaultRoom;
}

/** How much to keep. design §5.1; §11.5 (team-minded bots keep the Haul on pace for the checkpoint) */
function choosePocket(view: PlayerView, p: Personality, random: Random, loot: number): number {
  // v2 §4: the Bagman leans honest and goes all-in (its bonus and Alibi need it).
  if (loot === 0 || !roleOf(view).canPocket || roleOf(view).power.kind === "bagman") return 0;
  if (random() < p.noise) return Math.floor(random() * (loot + 1));
  if (random() >= p.pocketChance) return 0;
  let pocket = Math.min(loot, Math.max(1, Math.round(loot * p.greed * (0.5 + random()))));
  // v2 §4: a Getaway Driver pockets freely once Heat is high (the job is sinking anyway).
  const reckless = roleOf(view).power.kind === "getaway" && heatDanger(view, jobOf(view)) >= GETAWAY.high;
  if (!reckless && random() < p.teamSpirit) {
    const job = jobOf(view);
    const crew = crewSize(view);
    const roundsLeftInAct = view.act * ROUNDS_PER_ACT - view.round + 1;
    const needEach = Math.max(0, checkpointTarget(job, view.act, crew) - view.haul) / (roundsLeftInAct * crew);
    pocket = Math.min(pocket, Math.max(0, Math.floor(loot - needEach * 1.2)));
  }
  return pocket;
}

// ---------------------------------------------------------------- alibis (§5.4)

/**
 * The room to claim for the latest resolved round, or null if already posted.
 * The truth, unless the bot pocketed and decides to cover it: then the richest
 * room whose loot is no more than what it really handed in (so the claim adds up).
 */
export function chooseAlibi(view: PlayerView, p: Personality, random: Random): RoomId | null {
  const round = lastResolvedRound(view);
  if (round === 0) return null;
  if (ofType(view.ledger, "alibiPosted").some((a) => a.player === view.me.id && a.round === round)) return null;
  const split = ofType(view.caseFile, "lootSplit").find((e) => e.round === round);
  if (!split) return null;
  // A bot that never lies (Honest) doesn't post a random alibi either.
  if (p.lie > 0 && random() < p.noise) return random() < 0.3 ? null : pick(view.rooms, random);
  if (split.toStash === 0 || p.lie === 0) return split.room;
  const alone = ofType(view.caseFile, "roomSighting").find((e) => e.round === round)?.others.length === 0;
  if ((p.lieOnlyWhenAlone && !alone) || random() >= p.lie) return split.room;
  const job = jobOf(view);
  const covers = view.rooms
    .filter((r) => r !== split.room && roomDef(job, r).loot <= split.toHaul)
    .sort((a, b) => roomDef(job, b).loot - roomDef(job, a).loot);
  return covers[0] ?? split.room;
}

// ---------------------------------------------------------------- Duel call-outs (§16.1)

/**
 * Duel (minimal; task 16 refines): in the act's last round, call out the
 * opponent if a round this act handed in less than the room they claimed or
 * were seen in pays (Haul change minus my own hand-in, so exact at 2
 * players); otherwise only by noise. Once per act.
 */
export function wantsCallOut(view: PlayerView, p: Personality, random: Random): boolean {
  if (view.round % ROUNDS_PER_ACT !== 0) return false;
  if (ofType(view.caseFile, "callOutMade").some((e) => e.act === view.act)) return false;
  const opponent = view.players[0]?.id;
  if (opponent === undefined) return false;
  const job = jobOf(view);
  const firstRound = (view.act - 1) * ROUNDS_PER_ACT + 1;
  const short = ofType(view.ledger, "roundResolved").some((r) => {
    if (r.round < firstRound) return false;
    const mine = ofType(view.caseFile, "lootSplit").find((e) => e.round === r.round);
    if (!mine) return false;
    const seenWithMe = ofType(view.caseFile, "roomSighting").some((e) => e.round === r.round && e.others.includes(opponent));
    const claimed = ofType(view.ledger, "alibiPosted").find((a) => a.player === opponent && a.round === r.round)?.room;
    const room = seenWithMe ? mine.room : claimed;
    return room !== undefined && r.haulDelta - mine.toHaul < roomDef(job, room).loot;
  });
  return short || random() < p.noise;
}

// ---------------------------------------------------------------- meetings (§11)

/** Help lock in the act's meeting: accept an open proposal, or propose one if there is none. design §11.1 */
function scheduleMeeting(view: PlayerView): PlayerCommand[] {
  const player = view.me.id;
  if (view.scheduledMeeting) return [];
  const open = view.proposals.find((p) => !p.acceptedBy.includes(player));
  if (open) return [{ type: "acceptMeeting", player, proposalId: open.id }];
  if (view.proposals.length === 0) return [{ type: "proposeMeeting", player, slot: `act-${view.act}` }];
  return [];
}

function wantsEmergency(view: PlayerView, p: Personality, random: Random): boolean {
  if (view.me.emergencyMeetingUsed || view.pendingEmergency) return false;
  if (random() < p.noise * 0.05) return true;
  if (p.emergencyAt === null) return false;
  const top = mostSuspicious(suspicion(view));
  return top !== null && top.score >= p.emergencyAt;
}

/** Shake down the most suspicious player once they pass the bot's threshold; otherwise skip. design §11.2 */
export function chooseVote(view: PlayerView, p: Personality, random: Random): VoteChoice {
  // design §8.1: a Mole never votes to shake down its fellow Mole.
  const allies = view.me.roleState.allies;
  if (random() < p.noise) {
    const target = pick([null, ...view.players.map((o) => o.id).filter((id) => !allies.includes(id))], random);
    return target === null ? { kind: "skip" } : { kind: "shakedown", target };
  }
  const scores = suspicion(view);
  // design §8: a Snitch is paid when its target is caught holding loot, so it moves on less evidence.
  const { power } = roleOf(view);
  const mark = power.kind === "snitch" ? view.me.roleState.target : null;
  if (mark !== null && mark !== undefined && !allies.includes(mark) && (scores.get(mark) ?? 0) >= p.voteAt * SNITCH_EAGERNESS) {
    return { kind: "shakedown", target: mark };
  }
  const top = mostSuspicious(scores);
  if (top !== null && allies.includes(top.player)) return { kind: "skip" };
  return top !== null && top.score >= p.voteAt ? { kind: "shakedown", target: top.player } : { kind: "skip" };
}
