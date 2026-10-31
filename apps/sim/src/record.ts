// One finished game as a flat record: what the balance metrics need, read from
// the event log (the full record of the game). design §17.4
//
// Pure: a finished GameState (plus the bot crew) in, plain data out.
import { ROUNDS_PER_ACT, SCORE_DECIMALS, type RoleId } from "@skimjob/content";
import type { PersonalityId } from "@skimjob/bots";
import { checkpointTarget, jobFor, rolesFor, type GameConfig, type GameEvent, type GameState, type PlayerId } from "@skimjob/engine";

export interface PlayerRecord {
  readonly id: PlayerId;
  readonly personality: PersonalityId;
  readonly role: RoleId;
  /** False for roles that can't pocket (Insider): left out of the pocketing metric. */
  readonly canPocket: boolean;
  readonly score: number;
  /** Final stash, Fence safe included. */
  readonly stash: number;
  /** Loot collected from rooms over the game. */
  readonly looted: number;
  /** Of that, kept for the stash. */
  readonly pocketed: number;
  readonly timesShakenDown: number;
  readonly winner: boolean;
  /** 1 ÷ number of winners if a winner (joint winners share one win), else 0. */
  readonly winCredit: number;
}

export interface ShakedownRecord {
  readonly act: number;
  readonly emergency: boolean;
  readonly target: PlayerId;
  readonly stashRevealed: number;
  /** Below the clean threshold: nothing worth taking. design §11.3 */
  readonly clean: boolean;
  /** The target had pocketed something earlier in the game. */
  readonly targetHadPocketed: boolean;
}

/** Players tied for the top standing at a checkpoint, and by how much they lead the next player. */
export interface Standing {
  readonly leaders: readonly PlayerId[];
  readonly topScore: number;
  /** Top score minus the best score outside the leaders (0 if everyone is tied). */
  readonly lead: number;
}

export interface GameRecord {
  readonly seed: string;
  readonly players: number;
  readonly result: "success" | "failed";
  readonly reason: "heat" | "target" | null;
  /** Round the game ended in (9 if it reached the final check). */
  readonly endedRound: number;
  readonly endedAct: number;
  readonly haul: number;
  readonly finalTarget: number;
  readonly heat: number;
  readonly checkpointsMissed: number;
  readonly meetings: number;
  readonly shakedowns: readonly ShakedownRecord[];
  readonly winners: readonly PlayerId[];
  /** Standings after the Act 1 and Act 2 checkpoints (null if the game ended first). */
  readonly afterAct1: Standing | null;
  readonly afterAct2: Standing | null;
  /** Most score one player could add in Act 3: rounds × the best room's loot × the best stash multiplier. */
  readonly act3MaxGain: number;
  readonly playerRecords: readonly PlayerRecord[];
  /** Bot commands the engine refused (should be 0). */
  readonly rejections: number;
}

const roundScore = (n: number): number => {
  const f = 10 ** SCORE_DECIMALS;
  return Math.round(n * f) / f;
};

/**
 * Standings from per-player totals (stash + safe), scored as at the end of the
 * game (design §8: stash × multiplier + Insider surplus over the final target
 * at the current Haul).
 */
export function standing(
  totals: ReadonlyMap<PlayerId, number>,
  scoreOf: (player: PlayerId, total: number) => number,
): Standing {
  const scores = [...totals].map(([id, total]) => ({ id, score: scoreOf(id, total) }));
  const topScore = Math.max(...scores.map((s) => s.score));
  const leaders = scores.filter((s) => s.score === topScore).map((s) => s.id);
  const rest = scores.filter((s) => s.score !== topScore).map((s) => s.score);
  return { leaders, topScore, lead: rest.length === 0 ? 0 : roundScore(topScore - Math.max(...rest)) };
}

/** Flatten a finished game. `crew[i]` is the personality in seat i. */
export function recordGame(state: GameState, crew: readonly PersonalityId[], rejections = 0): GameRecord {
  const phase = state.phase;
  if (phase.kind !== "ended") throw new Error("recordGame: the game isn't over");
  const config: GameConfig = state.config;
  const job = jobFor(config);
  const roles = rolesFor(config);
  const order = state.playerOrder;
  const n = order.length;
  const finalTarget = checkpointTarget(job, 3, n);
  const roleOf = new Map<PlayerId, RoleId>(order.map((id) => [id, state.players[id]?.role ?? "?"]));

  const scoreOf = (haul: number) => (player: PlayerId, total: number): number => {
    const role = roleOf.get(player) as RoleId;
    const def = Object.hasOwn(roles, role) ? roles[role] : undefined;
    if (!def) return total;
    return roundScore(total * def.scoring.stashMultiplier + def.scoring.perLootOverFinalTarget * Math.max(0, haul - finalTarget));
  };

  const totals = new Map<PlayerId, number>(order.map((id) => [id, 0]));
  const looted = new Map<PlayerId, number>(order.map((id) => [id, 0]));
  const pocketed = new Map<PlayerId, number>(order.map((id) => [id, 0]));
  const shakedowns: ShakedownRecord[] = [];
  const standings: (Standing | null)[] = [null, null];
  let meetingKind: { emergency: boolean; act: number } = { emergency: false, act: 1 };
  let meetings = 0;
  let checkpointsMissed = 0;
  let endedRound = 0;

  const add = (m: Map<PlayerId, number>, id: PlayerId, v: number) => m.set(id, (m.get(id) ?? 0) + v);
  for (const event of state.log as readonly GameEvent[]) {
    switch (event.type) {
      case "lootSplit":
        add(looted, event.player, event.loot);
        add(pocketed, event.player, event.toStash);
        add(totals, event.player, event.toStash);
        break;
      case "roundResolved":
        endedRound = event.round;
        break;
      case "meetingOpened":
        meetings++;
        meetingKind = { emergency: event.kind === "emergency", act: event.act };
        break;
      case "shakedownResolved":
        shakedowns.push({
          act: meetingKind.act,
          emergency: meetingKind.emergency,
          target: event.target,
          stashRevealed: event.stashRevealed,
          clean: event.clean,
          targetHadPocketed: (pocketed.get(event.target) ?? 0) > 0,
        });
        add(totals, event.target, event.compensation - event.taken);
        break;
      case "checkpointChecked":
        if (!event.met) checkpointsMissed++;
        if (event.act < 3) standings[event.act - 1] = standing(totals, scoreOf(event.haul));
        break;
      default:
        break;
    }
  }

  const { outcome } = phase;
  const winners = outcome.winners;
  const ranked = new Map(outcome.ranking.map((e) => [e.player, e]));
  const maxLoot = Math.max(...state.rooms.map((r) => job.rooms[r]?.loot ?? 0));
  const maxMultiplier = Math.max(1, ...order.map((id) => roles[roleOf.get(id) as RoleId]?.scoring.stashMultiplier ?? 1));

  return {
    seed: config.seed,
    players: n,
    result: outcome.result,
    reason: outcome.result === "failed" ? outcome.reason : null,
    endedRound,
    endedAct: Math.ceil(endedRound / ROUNDS_PER_ACT),
    haul: state.haul,
    finalTarget,
    heat: state.heat,
    checkpointsMissed,
    meetings,
    shakedowns,
    winners,
    afterAct1: standings[0] ?? null,
    afterAct2: standings[1] ?? null,
    act3MaxGain: roundScore(ROUNDS_PER_ACT * maxLoot * maxMultiplier),
    playerRecords: order.map((id, i): PlayerRecord => {
      const entry = ranked.get(id);
      const role = roleOf.get(id) as RoleId;
      const winner = winners.includes(id);
      return {
        id,
        personality: crew[i] as PersonalityId,
        role,
        canPocket: (Object.hasOwn(roles, role) ? roles[role]?.canPocket : undefined) ?? true,
        score: entry?.score ?? 0,
        stash: entry?.stash ?? 0,
        looted: looted.get(id) ?? 0,
        pocketed: pocketed.get(id) ?? 0,
        timesShakenDown: entry?.timesShakenDown ?? 0,
        winner,
        winCredit: winner ? 1 / winners.length : 0,
      };
    }),
    rejections,
  };
}
