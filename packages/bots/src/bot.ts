// A bot player: the same Agent interface a human client would use. It gets its
// own viewFor() output and returns ordinary player commands. design §17.3
//
// Bots are deterministic: all their randomness comes from their own seeded RNG
// (the engine's sfc32), never Math.random, so same seed + same views = same
// commands. Their seed is their own, not the game's (which is secret).
import { ROUNDS_PER_ACT, type RoomId } from "@skimjob/content";
import {
  actOfRound,
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
  const room = chooseAlibi(view, p, random);
  if (room !== null) out.push({ type: "postAlibi", player, room });
  if (phase.kind === "meeting") {
    if (view.me.vote === null) out.push({ type: "castVote", player, vote: chooseVote(view, p, random) });
    return out;
  }
  out.push(...scheduleMeeting(view));
  if (phase.kind === "planning") {
    if (wantsEmergency(view, p, random)) out.push({ type: "callEmergency", player });
    if (view.me.move === null) out.push({ type: "submitMove", player, move: chooseMove(view, p, random) });
  }
  return out;
}

// ---------------------------------------------------------------- moves (§5.1)

/** Room, split and role power for this round. design §5.1, §6, §7, §8 */
export function chooseMove(view: PlayerView, p: Personality, random: Random): Move {
  const job = jobOf(view);
  const lootRooms = roomsWhere(view, job, (d) => d.loot > 0);
  const byLoot = (rooms: readonly RoomId[]) => rooms.map((r) => [r, roomDef(job, r).loot] as const);
  const room = random() < p.noise ? pick(view.rooms, random) : chooseRoom(view, p, random);
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
    const used = ofType(view.caseFile, "abilityResolved").reduce(
      (sum, e) => sum + (e.ability.kind === "fenceSafe" && actOfRound(e.round) === view.act ? e.ability.amount : 0),
      0,
    );
    const left = power.perAct - used;
    const hideable = view.me.stash + pocket;
    if (left >= 1 && hideable >= 1) ability = { kind: "fenceSafe", amount: Math.min(left, hideable) };
  }
  return ability ? { ...move, ability } : move;
}

function chooseRoom(view: PlayerView, p: Personality, random: Random): RoomId {
  const job = jobOf(view);
  // design §7: Heat now plus the baseline still to come, against the raid level.
  const roundsLeft = totalRounds(job) - view.round + 1;
  const danger = (view.heat + job.heat.perRound * roundsLeft) / job.heat.max;
  const cooler = roomsWhere(view, job, (d) => d.heatPressure < 0)[0];
  if (cooler && danger > p.heatCaution && random() < Math.min(0.8, (danger - p.heatCaution) * 4)) return cooler;
  const watcher = roomsWhere(view, job, (d) => d.info === "watchRoom")[0];
  if (watcher && random() < p.watch) return watcher;
  // Richer rooms are likelier, more so for the greedy. Heat-raising rooms get
  // less likely once danger passes the bot's Heat caution (the same point and
  // slope as the Rooftop above): a greedy player doesn't avoid the Vault at Heat 10.
  const avoid = Math.max(0, danger - p.heatCaution) * 4;
  const options = roomsWhere(view, job, (d) => d.loot > 0).map((r) => {
    const d = roomDef(job, r);
    const heatFactor = d.heatPressure > 0 ? Math.max(0.05, 1 - avoid) : 1;
    return [r, d.loot ** (0.5 + p.greed) * heatFactor] as const;
  });
  return weighted(options, random) ?? job.defaultRoom;
}

/** How much to keep. design §5.1; §11.5 (team-minded bots keep the Haul on pace for the checkpoint) */
function choosePocket(view: PlayerView, p: Personality, random: Random, loot: number): number {
  if (loot === 0 || !roleOf(view).canPocket) return 0;
  if (random() < p.noise) return Math.floor(random() * (loot + 1));
  if (random() >= p.pocketChance) return 0;
  let pocket = Math.min(loot, Math.max(1, Math.round(loot * p.greed * (0.5 + random()))));
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
  if (random() < p.noise) {
    const target = pick([null, ...view.players.map((o) => o.id)], random);
    return target === null ? { kind: "skip" } : { kind: "shakedown", target };
  }
  const top = mostSuspicious(suspicion(view));
  return top !== null && top.score >= p.voteAt ? { kind: "shakedown", target: top.player } : { kind: "skip" };
}
