// One finished game as a flat record: what the balance metrics need, read from
// the event log (the full record of the game). design §17.4
//
// Pure: a finished GameState (plus the bot crew) in, plain data out.
import { ROUNDS_PER_ACT, type RoleId, type Temperament } from "@skimjob/content";
import type { PersonalityId } from "@skimjob/bots";
import {
  applyEvent,
  checkpointTarget,
  initialState,
  jobFor,
  leadersOf,
  ranking,
  rolesFor,
  type GameConfig,
  type GameEvent,
  type GameState,
  type PlayerId,
  type RankEntry,
} from "@skimjob/engine";

export interface PlayerRecord {
  readonly id: PlayerId;
  readonly personality: PersonalityId;
  readonly role: RoleId;
  /** The role's temperament tag. extension.md "Temperament tags" */
  readonly tag: Temperament;
  /** A ★ role: it also wins some failures (`winsOn` non-empty). extension.md "One crew, and how you win" */
  readonly star: boolean;
  /** False for roles that can't pocket (Inside Man): left out of the pocketing metric. */
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
  /** Shop tokens earned and spent. extension.md "Tokens and the perk shop" */
  readonly tokensEarned: number;
  readonly tokensSpent: number;
}

export interface ShakedownRecord {
  readonly act: number;
  readonly emergency: boolean;
  readonly target: PlayerId;
  readonly stashRevealed: number;
  /** Below the clean threshold: nothing worth taking. design §11.3 */
  readonly clean: boolean;
  /** The target had pocketed something since their last shakedown (or the start). */
  readonly targetHadPocketed: boolean;
}

/**
 * The engine's ranking at a checkpoint (after its shakedown), scored as at the
 * end of the game. `leaders` are tied with first place on score and both
 * tie-breaks (design §3), as for joint winners; usually one player.
 */
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
  /** Most score one player could add in Act 3: rounds × the best room's loot (whole-number scores, no multiplier). */
  readonly act3MaxGain: number;
  readonly playerRecords: readonly PlayerRecord[];
  /** Bot commands the engine refused (should be 0). */
  readonly rejections: number;
}

/** Leaders and lead from an engine ranking (best first). design §3 */
export function standing(ranked: readonly RankEntry[]): Standing {
  const leaders = leadersOf(ranked);
  const topScore = ranked[0]?.score ?? 0;
  const rest = ranked.filter((e) => !leaders.includes(e.player)).map((e) => e.score);
  return { leaders, topScore, lead: rest.length === 0 ? 0 : topScore - Math.max(...rest) };
}

/**
 * The engine's ranking after each act's checkpoint (index 0 = Act 1), folding
 * the log with the engine's own `applyEvent`, so no rule is re-implemented
 * here. Acts the game didn't reach are missing.
 */
export function checkpointRankings(config: GameConfig, log: readonly GameEvent[]): (RankEntry[] | undefined)[] {
  const out: (RankEntry[] | undefined)[] = [];
  let state = initialState(config);
  for (const event of log) {
    state = applyEvent(state, event);
    if (event.type === "checkpointChecked") out[event.act - 1] = ranking(state);
  }
  return out;
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

  const looted = new Map<PlayerId, number>(order.map((id) => [id, 0]));
  const pocketed = new Map<PlayerId, number>(order.map((id) => [id, 0]));
  const sinceShakedown = new Map<PlayerId, number>(order.map((id) => [id, 0]));
  const earned = new Map<PlayerId, number>();
  const spent = new Map<PlayerId, number>();
  const shakedowns: ShakedownRecord[] = [];
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
        add(sinceShakedown, event.player, event.toStash);
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
          targetHadPocketed: (sinceShakedown.get(event.target) ?? 0) > 0,
        });
        sinceShakedown.set(event.target, 0);
        break;
      case "checkpointChecked":
        if (!event.met) checkpointsMissed++;
        break;
      case "tokenEarned":
        add(earned, event.player, 1);
        break;
      case "perkBought":
        add(spent, event.player, event.cost);
        break;
      default:
        break;
    }
  }

  const rankings = checkpointRankings(config, state.log);
  const standingAfter = (act: 1 | 2): Standing | null => {
    const r = rankings[act - 1];
    return r ? standing(r) : null;
  };
  const { outcome } = phase;
  const winners = outcome.winners;
  const ranked = new Map(outcome.ranking.map((e) => [e.player, e]));
  const maxLoot = Math.max(...state.rooms.map((r) => job.rooms[r]?.loot ?? 0));

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
    afterAct1: standingAfter(1),
    afterAct2: standingAfter(2),
    act3MaxGain: ROUNDS_PER_ACT * maxLoot,
    playerRecords: order.map((id, i): PlayerRecord => {
      const entry = ranked.get(id);
      const role = roleOf.get(id) as RoleId;
      const winner = winners.includes(id);
      const def = Object.hasOwn(roles, role) ? roles[role] : undefined;
      return {
        id,
        personality: crew[i] as PersonalityId,
        role,
        tag: def?.tag ?? "teamPlayer",
        star: (def?.winsOn.length ?? 0) > 0,
        canPocket: def?.canPocket ?? true,
        score: entry?.score ?? 0,
        stash: entry?.stash ?? 0,
        looted: looted.get(id) ?? 0,
        pocketed: pocketed.get(id) ?? 0,
        timesShakenDown: entry?.timesShakenDown ?? 0,
        winner,
        winCredit: winner ? 1 / winners.length : 0,
        tokensEarned: earned.get(id) ?? 0,
        tokensSpent: spent.get(id) ?? 0,
      };
    }),
    rejections,
  };
}
