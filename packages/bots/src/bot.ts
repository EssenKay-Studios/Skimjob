// A bot player: the same Agent interface a human client would use. It gets its
// own viewFor() output and returns ordinary player commands. design §17.3
//
// Bots are deterministic: all their randomness comes from their own seeded RNG
// (the engine's sfc32), never Math.random, so same seed + same views = same
// commands. Their seed is their own, not the game's (which is secret).
import type { JobDef, RoomId } from "@skimjob/content";
import {
  nextUint32,
  ringsOf,
  roomDef,
  seedRng,
  type AbilityUse,
  type Move,
  type PlayerCommand,
  type PlayerId,
  type PlayerView,
  type PowerClaim,
  type RngState,
  type VoteChoice,
} from "@skimjob/engine";
import type { Personality } from "./personalities";
import { jobOf, lastResolvedRound, myPower, ofType, roomsWhere, saidOf, saidRooms } from "./read";
import { mostSuspicious, suspicion } from "./suspicion";
import { bluffs, claimCommands, meetingTime } from "./claims";
import { bailChoice, buyPerk } from "./perks";
import { bustDanger, jobThisRound, openRooms, quietGrab, raidRisk } from "./alarm";
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
  /** design §10: its own claims on this round's plan board (a room claim and a pledge), or null; an agent without it never uses the board. */
  spot?(view: PlayerView): PlanSpot | null;
}

/** A seat's own claims on the plan board: its room claim (✋) and an optional power claim. design §10 */
export interface PlanSpot {
  readonly room: RoomId;
  readonly power: PowerClaim | null;
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

export function createBot({ player, personality, seed, crewSeed }: BotOptions): Required<Agent> & { readonly personality: Personality } {
  const random = botRandom(seed);
  // design §10: the spot it took on each round's board, chosen with its move.
  const spots = new Map<number, PlanSpot>();
  const mine = (view: PlayerView) => {
    if (view.me.id !== player) throw new Error(`bot ${player} was given ${view.me.id}'s view`);
  };
  return {
    player,
    personality,
    act: (view) => {
      mine(view);
      const out = decide(view, personality, random, crewSeed);
      const move = out.find((c) => c.type === "submitMove")?.move;
      if (move) spots.set(view.round, chooseSpot(view, personality, random, move));
      return out;
    },
    spot: (view) => {
      mine(view);
      return view.phase.kind === "planning" ? (spots.get(view.round) ?? null) : null;
    },
  };
}

const pick = <T>(items: readonly T[], random: Random): T => items[Math.floor(random() * items.length)] as T;

/** Team-minded bots keep honesty at least this many times the line (bot setting). design §7.5 */
const HONESTY_MARGIN = 1.1;

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
  // design §11.3: an alibi for the latest round as it resolves (alibis have no window).
  const room = chooseAlibi(view, p, random);
  if (room !== null) out.push({ type: "postAlibi", player, round: lastResolvedRound(view), room });
  if (phase.kind === "meeting") {
    // v2 §4: vote, then maybe claim a role (the Priest only after its vote).
    const vote = view.me.vote === null ? chooseVote(view, p, random, crewSeed) : null;
    if (vote !== null) out.push({ type: "castVote", player, vote });
    out.push(...claimCommands(view, p, random, true));
    return out;
  }
  if (phase.kind === "shakedownPending") {
    // design §9.6: a target holding Bail chooses; v2 §4: a target can still claim.
    out.push(...bailChoice(view, p, random), ...claimCommands(view, p, random, true));
    return out;
  }
  out.push(...scheduleMeeting(view));
  // v2 §4: claims are made around meetings (a meeting is due, or an emergency is called).
  if (meetingTime(view)) out.push(...claimCommands(view, p, random, false));
  out.push(...crewPowers(view));
  // design §9.3: an emergency only in the result window, while the crew's pool lasts.
  if (phase.kind === "result" && wantsEmergency(view, p, random)) out.push({ type: "callEmergency", player });
  if (phase.kind === "planning" && view.me.move === null) {
    // design §12: a perk, if any, is bought with the round's move. Safe only because the engine holds its notices until planning closes.
    const move = chooseMove(view, p, random);
    out.push({ type: "submitMove", player, move }, ...buyPerk(view, p, random, move));
  }
  return out;
}

// ---------------------------------------------------------------- powers used now (§11.1)

/**
 * The Auditor's and the Detective's powers, while planning: the Detective
 * (every round) looks into its top suspect's grab in the latest round; the
 * Auditor (once between meetings) audits the room its top suspect claimed for it.
 */
function crewPowers(view: PlayerView): PlayerCommand[] {
  const power = myPower(view);
  if (view.phase.kind !== "planning" || (power?.kind !== "audit" && power?.kind !== "detect")) return [];
  if (power.kind === "audit" && view.me.roleState.usedThisStretch >= power.perStretch) return [];
  const top = mostSuspicious(suspicion(view));
  if (top === null || top.score <= 0) return [];
  const player = view.me.id;
  const round = lastResolvedRound(view);
  // The engine allows one use per resolved round (a regular meeting can free the Auditor's again before a new round resolves).
  if (round === 0 || ofType(view.caseFile, "abilityResolved").some((e) => e.ability.kind === power.kind && "round" in e.ability && e.ability.round === round)) return [];
  if (power.kind === "detect") return [{ type: "useAbility", player, ability: { kind: "detect", target: top.player } }];
  const claim = saidRooms(view).get(round)?.get(top.player);
  return claim ? [{ type: "useAbility", player, ability: { kind: "audit", room: claim } }] : [];
}

// ---------------------------------------------------------------- moves (§5.1)

/** Room, grab, split and role power for this round. design §3.2, §11 */
export function chooseMove(view: PlayerView, p: Personality, random: Random): Move {
  const job = jobThisRound(view);
  const coinRooms = roomsWhere(view, job, (d) => d.coins > 0);
  const byCoins = (rooms: readonly RoomId[]) => rooms.map((r) => [r, roomDef(job, r).coins] as const);
  // design §5.3, §13: a taped-off or locked-down room is refused, so the bot only picks open rooms.
  const room = random() < p.noise ? pick(openRooms(view), random) : chooseRoom(view, p, random);
  const def = roomDef(job, room);
  // design §3.2, §5.2: the bot grabs the room's limit, or (cautiously) only what keeps the bell below a raid,
  // and splits it between the two bags.
  const coins = def.coins > 0 && random() < p.caution ? quietGrab(view, job, room, def.coins) : def.coins;
  const pocket = choosePocket(view, p, random, coins);
  let move: Move = { room, duffel: coins - pocket, pocket };
  // design §3.1: Security watches one room; a coin room, more often the richer ones.
  if (def.info === "watchRoom") move = { ...move, watch: weighted(byCoins(coinRooms), random) ?? room };

  const power = myPower(view);
  const charged = power !== undefined && "perStretch" in power && view.me.roleState.usedThisStretch < power.perStretch;
  let ability: AbilityUse | null = null;
  if (power?.kind === "lookout") {
    // design §11.1: one extra room's visitors; a coin room other than mine.
    const target = weighted(byCoins(coinRooms.filter((r) => r !== room)), random);
    if (target !== undefined) ability = { kind: "lookout", rooms: [target] };
  } else if (power?.kind === "hide" && charged) {
    // design §11.1: the Hacker hides its own room's bell when it skims there and its coins ring.
    if (pocket > 0 && ringsOf(def, coins) > 0) ability = { kind: "hide", room };
  } else if (power?.kind === "blackout" && charged) {
    // design §11.1: the Electrician cuts the power in the richest room next round, when it skims.
    const richest = byCoins(coinRooms).sort((a, b) => b[1] - a[1])[0];
    if (pocket > 0 && richest !== undefined) ability = { kind: "blackout", room: richest[0] };
  } else if (power?.kind === "absolve" && charged) {
    // design §11.1: the Priest absolves its top suspect, never the same player twice in a row.
    const last = ofType(view.caseFile, "abilityResolved")
      .map((e) => e.ability)
      .filter((a) => a.kind === "absolve")
      .at(-1);
    const top = mostSuspicious(new Map([...suspicion(view)].filter(([id]) => last?.kind !== "absolve" || id !== last.target)));
    if (top !== null && top.score > 0) ability = { kind: "absolve", target: top.player };
  } else if (power?.kind === "ring" && charged && ringServesWin(view, job, room)) {
    // design §5.2, §11.1: the Mole tips the police off on the loudest open bell elsewhere, if any is lit.
    const loudest = openRooms(view)
      .filter((r) => r !== room && !roomDef(job, r).lieLow && (view.bells[r] ?? 0) > 0)
      .sort((a, b) => (view.bells[b] ?? 0) - (view.bells[a] ?? 0))[0];
    if (loudest !== undefined) ability = { kind: "ring", room: loudest };
  } else if (power?.kind === "reopen" && view.me.roleState.usedThisGame < power.perGame) {
    // design §5.3, §11.1: the Fixer reopens the richest taped-off room.
    const richest = Object.keys(view.taped).sort((a, b) => roomDef(job, b).coins - roomDef(job, a).coins)[0];
    if (richest !== undefined) ability = { kind: "reopen", room: richest };
  }
  return ability ? { ...move, ability } : move;
}

/**
 * Whether the Mole's ring serves its own win (design §8.4, §19.3): it wins a heist sunk by theft, so it
 * rings (a raid seizes the crew's coins) only while it leans toward theft. One raid from the
 * bust line, any ring could bust the crew, and off the Rooftop a bust loses (§5.5), so then it keeps quiet.
 */
function ringServesWin(view: PlayerView, job: JobDef, room: RoomId): boolean {
  if (view.wanted >= job.alarm.bustStars - 1 && !roomDef(job, room).lieLow) return false;
  return leaning(view) === "theft";
}

function chooseRoom(view: PlayerView, p: Personality, random: Random): RoomId {
  const base = jobOf(view);
  // design §13: this round's card can add coins to a room (Shift change).
  const job = jobThisRound(view, base);
  const open = openRooms(view);
  const coinRooms = open.filter((r) => roomDef(job, r).coins > 0);
  const fallback = open.includes(job.defaultRoom) ? job.defaultRoom : (open.find((r) => roomDef(job, r).lieLow) ?? (open[0] as RoomId));
  // design §19.3: the Mole or Fixer leaning toward theft skims the richest room.
  if (leaning(view) === "theft") return [...coinRooms].sort((a, b) => roomDef(job, b).coins - roomDef(job, a).coins)[0] ?? fallback;
  // design §5.5: near the bust line the Rooftop is the only way out, so the cautious go up and wait.
  const roof = open.find((r) => roomDef(job, r).lieLow);
  if (roof && random() < p.caution * bustDanger(view, base) ** 2) return roof;
  const watcher = open.find((r) => roomDef(job, r).info === "watchRoom");
  if (watcher && random() < p.watch) return watcher;
  // Richer rooms are likelier, more so for the greedy; a bell close to a raid (design §5.3) puts the cautious off.
  const options = coinRooms.map((r) => {
    const coins = roomDef(job, r).coins;
    const risk = Math.min(1, raidRisk(view, job, r, coins));
    return [r, coins ** (0.5 + p.greed) * Math.max(0.05, 1 - p.caution * risk ** 2)] as const;
  });
  return weighted(options, random) ?? fallback;
}

/** How many of the grabbed `coins` to pocket. design §3.2; team-minded bots keep honesty above the line (§7.5, §8.1) */
function choosePocket(view: PlayerView, p: Personality, random: Random, coins: number): number {
  if (coins === 0) return 0;
  if (random() < p.noise) return Math.floor(random() * (coins + 1));
  if (random() >= p.pocketChance) return 0;
  let pocket = Math.min(coins, Math.max(1, Math.round(coins * p.greed * (0.5 + random()))));
  // design §19.3: the Mole or Fixer leaning toward theft skims all it can.
  if (leaning(view) !== null) return coins;
  if (random() < p.teamSpirit) {
    // After this grab, honesty (coins that reached the duffel ÷ coins taken) stays a margin above the line.
    const keep = jobOf(view).honestyLine * HONESTY_MARGIN * (view.honesty.taken + coins);
    pocket = Math.min(pocket, Math.max(0, Math.floor(view.honesty.reached + coins - keep)));
  }
  return pocket;
}

// ---------------------------------------------------------------- the plan board (§10)

/**
 * The bot's spot on the board as it picks its move: the room it is going to,
 * unless it is pocketing and decides to break the plan (chance `lie`, unless
 * it lies only when unseen): then a
 * quieter room whose coins are no more than it hands in, so the plan adds up.
 * It pledges its power where its move aims it, unless its role bluffs (the
 * Mole, the Fixer and the evidence-leaving roles keep quiet).
 */
export function chooseSpot(view: PlayerView, p: Personality, random: Random, move: Move): PlanSpot {
  const job = jobThisRound(view);
  const covers = view.rooms.filter((r) => r !== move.room && roomDef(job, r).coins <= move.duffel && openRooms(view).includes(r)).sort((a, b) => roomDef(job, b).coins - roomDef(job, a).coins);
  // One that lies only when unseen can't know yet whether it will be, so it keeps to the plan.
  const breaks = move.pocket > 0 && p.lie > 0 && !p.lieOnlyWhenAlone && covers.length > 0 && random() < p.lie;
  const a = move.ability;
  const target = a === undefined || bluffs(view.me.role) ? undefined : a.kind === "lookout" ? a.rooms[0] : a.kind === "absolve" ? a.target : a.room;
  return { room: breaks ? (covers[0] as RoomId) : move.room, power: target === undefined ? null : { role: view.me.role, target } };
}

// ---------------------------------------------------------------- alibis (§11.3)

/**
 * The room to claim for the latest resolved round, or null if already posted.
 * Its plan spot if that was a cover story (it sticks to it, design §10); else the
 * truth, unless the bot pocketed and decides to cover it: then the richest
 * room whose coins are no more than what it really handed in (so the claim adds up).
 */
export function chooseAlibi(view: PlayerView, p: Personality, random: Random): RoomId | null {
  const round = lastResolvedRound(view);
  if (round === 0) return null;
  if (saidOf(view, "alibi").some((a) => a.player === view.me.id && a.round === round)) return null;
  const split = ofType(view.caseFile, "coinsGrabbed").find((e) => e.round === round);
  if (!split) return null;
  const spot = saidOf(view, "plan").find((x) => x.round === round)?.plan.entries.find((e) => e.player === view.me.id)?.room;
  // A line with no room claim (only a placement, or "I agree") is no spot.
  if (spot != null && spot !== split.room) return spot;
  // A bot that never lies (Honest) doesn't post a random alibi either.
  if (p.lie > 0 && random() < p.noise) return random() < 0.3 ? null : pick(view.rooms, random);
  if (split.pocket === 0 || p.lie === 0) return split.room;
  const alone = ofType(view.caseFile, "roomSighting").find((e) => e.round === round)?.others.length === 0;
  if ((p.lieOnlyWhenAlone && !alone) || random() >= p.lie) return split.room;
  const job = jobOf(view);
  const covers = view.rooms
    .filter((r) => r !== split.room && roomDef(job, r).coins <= split.duffel)
    .sort((a, b) => roomDef(job, b).coins - roomDef(job, a).coins);
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
  if (view.emergencies === 0 || view.pendingEmergency) return false;
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
 * (BotOptions), so every bot in the crew shares it but it changes from game
 * to game: seat and meeting ids are the same in every game, and alone they
 * gave each seat a fixed bias (PR #37 review). Nothing in it comes from
 * public view data beyond the meeting id, so nobody can compute it.
 */
export function crewHunch(view: PlayerView, player: PlayerId, crewSeed: string): number {
  const meeting = view.phase.kind === "meeting" || view.phase.kind === "shakedownPending" ? view.phase.meetingId : `stretch-${view.stretch}`;
  return botRandom(`hunch/${meeting}/${player}/crew:${crewSeed}`)() * 2 - 1;
}

/** Suspicion as the bot reads it at a vote: the evidence, the crew's hunch (`hunch`), and its own misreading (`misread`). */
export function misjudged(view: PlayerView, scores: ReadonlyMap<PlayerId, number>, p: Personality, random: Random, crewSeed: string): Map<PlayerId, number> {
  const out = new Map<PlayerId, number>();
  for (const [id, score] of scores) out.set(id, score + p.hunch * crewHunch(view, id, crewSeed) + p.misread * (random() * 2 - 1));
  return out;
}

/**
 * Shake down the most suspicious player once they pass the bot's threshold; otherwise skip. Never a
 * protected player (design §9.7). Suspicion only, no ally logic. design §9.5, §19.3
 */
export function chooseVote(view: PlayerView, p: Personality, random: Random, crewSeed: string): VoteChoice {
  if (random() < p.noise) {
    const target = pick([null, ...view.players.map((o) => o.id).filter((id) => !view.protected.includes(id))], random);
    return target === null ? { kind: "skip" } : { kind: "shakedown", target };
  }
  const scores = misjudged(view, suspicion(view), p, random, crewSeed);
  for (const id of view.protected) scores.delete(id);
  const top = mostSuspicious(scores);
  return top !== null && top.score >= p.voteAt ? { kind: "shakedown", target: top.player } : { kind: "skip" };
}
