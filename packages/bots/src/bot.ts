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
import { crewSize, jobOf, lastResolvedRound, ofType, roleOf, roomsWhere, totalRounds } from "./read";
import { mostSuspicious, suspicion } from "./suspicion";
import { claimCommands, meetingTime } from "./claims";
import { alibiPerk, buyPerks, hasPerk, meetingPerks, perkSpender, planningPerks } from "./perks";
import { heatDanger, jobThisRound } from "./heat";
import { leaning } from "./forecast";

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
  /**
   * The crew's shared hunch seed (`crewHunch`): the same for every bot in a
   * game, different between games, and hidden from the players (the harness
   * derives it from the game's secret seed), so nobody can work the hunch out
   * from public data (PR #37 review). Required: there is no public-data fallback.
   */
  readonly crewSeed: string;
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

export function createBot({ player, personality, seed, crewSeed }: BotOptions): Agent & { readonly personality: Personality } {
  const random = botRandom(seed);
  return {
    player,
    personality,
    act: (view) => {
      if (view.me.id !== player) throw new Error(`bot ${player} was given ${view.me.id}'s view`);
      return decide(view, personality, random, crewSeed);
    },
  };
}

/**
 * A Mole bot tips off when Heat two rounds on (this round, then about one
 * round's wait for the next police moment) would reach this share of the raid
 * level [70 of 100], or when it leans toward a raid. extension.md Build notes "Bots"
 */
export const MOLE_TIP_AT = 0.7;

const pick = <T>(items: readonly T[], random: Random): T => items[Math.floor(random() * items.length)] as T;

function weighted<T>(items: readonly (readonly [T, number])[], random: Random): T | undefined {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let roll = random() * total;
  for (const [item, w] of items) if ((roll -= w) < 0) return item;
  return items[items.length - 1]?.[0];
}

/** Everything the bot wants to do given this view. */
export function decide(view: PlayerView, p: Personality, random: Random, crewSeed: string): PlayerCommand[] {
  const phase = view.phase;
  if (phase.kind === "ended" || phase.kind === "setup") return [];
  const player = view.me.id;
  const out: PlayerCommand[] = [];
  // extension.md "Tokens and the perk shop": one perk use per round.
  const spend = perkSpender(view);
  // design §5.4: alibis only while the round's alibi window is open.
  const room = view.alibiRound !== null ? chooseAlibi(view, p, random) : null;
  if (room !== null) out.push({ type: "postAlibi", player, room }, ...spend(alibiPerk(view, room)));
  if (phase.kind === "meeting") {
    // v2 §4: vote (with a +Vote on a shakedown), then maybe claim a role (the Priest only after its vote).
    const vote = view.me.vote === null ? chooseVote(view, p, random, crewSeed) : null;
    if (vote !== null) out.push({ type: "castVote", player, vote }, ...spend(meetingPerks(view, vote)));
    out.push(...claimCommands(view, p, random, true));
    return out;
  }
  if (phase.kind === "shakedownPending") {
    // v2 §4: a target can still claim.
    out.push(...claimCommands(view, p, random, true));
    return out;
  }
  out.push(...scheduleMeeting(view));
  // v2 §4: claims are made around meetings (the act's meeting is next, or an emergency is called).
  if (meetingTime(view)) out.push(...claimCommands(view, p, random, false));
  out.push(...crewPowers(view), ...moleTipOff(view), ...buyPerks(view));
  if (phase.kind === "planning") {
    if (wantsEmergency(view, p, random)) out.push({ type: "callEmergency", player });
    const move = view.me.move ?? chooseMove(view, p, random);
    if (view.me.move === null) out.push({ type: "submitMove", player, move });
    out.push(...spend(planningPerks(view, move.room)));
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
  // A Recharge perk can free the power again before a new round resolves; the engine allows one audit per round.
  if (ofType(view.caseFile, "abilityResolved").some((e) => e.ability.kind === "audit" && e.ability.round === round)) return [];
  const claim = ofType(view.ledger, "alibiPosted").find((a) => a.player === top.player && a.round === round);
  return claim ? [{ type: "useAbility", player, ability: { kind: "audit", room: claim.room } }] : [];
}

/**
 * The Mole's tip-off: any time outside meetings, once between meetings. It
 * lands at the next police moment, so the bot tips off when Heat after this
 * round and about one more would pass `MOLE_TIP_AT` of the raid level, or when
 * it leans toward a raid. extension.md "Police activity", Build notes "Bots"
 */
function moleTipOff(view: PlayerView): PlayerCommand[] {
  const { power } = roleOf(view);
  if (power.kind !== "tipOff" || view.me.roleState.usedThisAct >= power.perAct || view.me.tipOffs >= power.perGame) return [];
  const job = jobOf(view);
  const soon = view.heat + 2 * job.heat.perRound;
  if (soon < MOLE_TIP_AT * job.heat.max && leaning(view) !== "heat") return [];
  return [{ type: "useAbility", player: view.me.id, ability: { kind: "tipOff" } }];
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
  } else if (power.kind === "loopCameras" && view.me.roleState.usedThisAct < power.perAct) {
    // v2 §4: hide its own skim (no allies to cover since the Extension).
    if (pocket > 0) ability = { kind: "loopCameras", room };
  }
  return ability ? { ...move, ability } : move;
}

function chooseRoom(view: PlayerView, p: Personality, random: Random): RoomId {
  const base = jobOf(view);
  // design §10: this round's card can surge a room's loot and Heat (Shift change).
  const job = jobThisRound(view, base);
  // design §7: Heat now, the baseline still to come and,
  // when a Mole could be in play, the police activity still to come (heat.ts), against the raid level.
  const danger = heatDanger(view, base);
  // The most any room pushes Heat on a normal round: a surged room is avoided harder.
  const usual = Math.max(1, ...roomsWhere(view, base, (d) => d.heatPressure > 0).map((r) => roomDef(base, r).heatPressure));
  const cooler = roomsWhere(view, job, (d) => d.heatPressure < 0)[0];
  // extension.md Build notes "Bots": a ★ role leaning toward a raid heats the job,
  // toward a missed target it skims the richest room.
  const lean = leaning(view);
  if (lean === "heat") {
    const hottest = roomsWhere(view, job, (d) => d.heatPressure > 0).sort((a, b) => roomDef(job, b).heatPressure - roomDef(job, a).heatPressure)[0];
    if (hottest !== undefined) return hottest;
  }
  if (lean === "target") return roomsWhere(view, job, (d) => d.loot > 0).sort((a, b) => roomDef(job, b).loot - roomDef(job, a).loot)[0] ?? job.defaultRoom;
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
  if (loot === 0) return 0;
  if (random() < p.noise) return Math.floor(random() * (loot + 1));
  if (random() >= p.pocketChance) return 0;
  let pocket = Math.min(loot, Math.max(1, Math.round(loot * p.greed * (0.5 + random()))));
  // extension.md Build notes "Bots": a ★ role leaning toward its failure skims all it can.
  if (leaning(view) !== null) return loot;
  if (random() < p.teamSpirit) {
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

// ---------------------------------------------------------------- meetings (§11)

/**
 * Let people pick the meeting time (design §11.1): back an open proposal, a
 * person's first (then the best backed), at once. Bots never propose a slot
 * (STATUS "Bot scheduling", #35 review), and their backing doesn't count
 * toward the lock while the crew has people (owner decision, 2 Nov); if
 * nobody locks one, the server picks it.
 */
function scheduleMeeting(view: PlayerView): PlayerCommand[] {
  const player = view.me.id;
  if (view.scheduledMeeting) return [];
  const bots = new Set(view.players.filter((o) => o.isBot).map((o) => o.id));
  const open = view.proposals
    .filter((p) => !p.acceptedBy.includes(player))
    .sort((a, b) => Number(bots.has(a.by) || a.by === player) - Number(bots.has(b.by) || b.by === player) || b.acceptedBy.length - a.acceptedBy.length)[0];
  return open ? [{ type: "acceptMeeting", player, proposalId: open.id }] : [];
}

function wantsEmergency(view: PlayerView, p: Personality, random: Random): boolean {
  if ((view.me.emergencyMeetingUsed && !hasPerk(view, "emergency")) || view.pendingEmergency) return false;
  if (random() < p.noise * 0.05) return true;
  if (p.emergencyAt === null) return false;
  const top = mostSuspicious(suspicion(view));
  return top !== null && top.score >= p.emergencyAt;
}

/**
 * The crew's shared hunch about each player at a meeting, in [−1, 1]: the same
 * for every bot, so it can carry a majority to a wrong target, as a crew
 * talking itself into a theory does. Scaled by each bot's `hunch` (personalities.ts).
 *
 * Seeded by the meeting, the player and the harness's hidden `crewSeed`
 * (BotOptions), so every bot at the table shares it but it changes from game
 * to game: seat and meeting ids are the same in every game, and alone they
 * gave each seat a fixed bias (PR #37 review). Nothing in it comes from
 * public view data beyond the meeting id, so nobody can compute it.
 */
export function crewHunch(view: PlayerView, player: PlayerId, crewSeed: string): number {
  const meeting = view.phase.kind === "meeting" || view.phase.kind === "shakedownPending" ? view.phase.meetingId : `act-${view.act}`;
  return botRandom(`hunch/${meeting}/${player}/crew:${crewSeed}`)() * 2 - 1;
}

/** Suspicion as the bot reads it at a vote: the evidence, the crew's hunch (`hunch`), and its own misreading (`misread`). */
export function misjudged(view: PlayerView, scores: ReadonlyMap<PlayerId, number>, p: Personality, random: Random, crewSeed: string): Map<PlayerId, number> {
  const out = new Map<PlayerId, number>();
  for (const [id, score] of scores) out.set(id, score + p.hunch * crewHunch(view, id, crewSeed) + p.misread * (random() * 2 - 1));
  return out;
}

/** Shake down the most suspicious player once they pass the bot's threshold; otherwise skip. Suspicion only, no ally logic (extension.md Build notes "Bots"). design §11.2 */
export function chooseVote(view: PlayerView, p: Personality, random: Random, crewSeed: string): VoteChoice {
  if (random() < p.noise) {
    const target = pick([null, ...view.players.map((o) => o.id)], random);
    return target === null ? { kind: "skip" } : { kind: "shakedown", target };
  }
  const scores = misjudged(view, suspicion(view), p, random, crewSeed);
  const top = mostSuspicious(scores);
  return top !== null && top.score >= p.voteAt ? { kind: "shakedown", target: top.player } : { kind: "skip" };
}
