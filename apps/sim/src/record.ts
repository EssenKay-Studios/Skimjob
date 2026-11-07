// One finished game as a flat record: what the balance metrics need, read from
// the event log (the full record of the game). design §17.4
//
// Pure: a finished GameState (plus the bot crew) in, plain data out.
import type { RoleId, Temperament } from "@skimjob/content";
import type { PersonalityId } from "@skimjob/bots";
import { jobFor, rolesFor, type GameConfig, type GameEvent, type GameState, type PlayerId } from "@skimjob/engine";

export interface PlayerRecord {
  readonly id: PlayerId;
  readonly personality: PersonalityId;
  readonly role: RoleId;
  /** The role's temperament tag. extension.md "Temperament tags" */
  readonly tag: Temperament;
  /** A ★ role: it also wins some failures (`winsOn` non-empty). extension.md "One crew, and how you win" */
  readonly star: boolean;
  readonly score: number;
  /** Final stash. */
  readonly stash: number;
  /** Coins grabbed over the game, after any short-bank cut. design §3.2 */
  readonly grabbed: number;
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

export interface GameRecord {
  readonly seed: string;
  readonly players: number;
  readonly result: "success" | "failed";
  readonly reason: "bust" | "theft" | null;
  /** Round the game ended in: the bust, the one that emptied the bank, or the round cap. design §6.2 */
  readonly endedRound: number;
  readonly haul: number;
  /** Coins left in the bank at the end. design §6.1 */
  readonly bankLeft: number;
  /** It ended at the round cap with over a quarter of the bank left (design §21 G4). */
  readonly capWithBankLeft: boolean;
  /** Wanted at the end, and the raids that raised it. design §5.3, §5.4 */
  readonly wanted: number;
  readonly raids: number;
  /** Rounds with more than half the crew on the Rooftop (design §21 G4). */
  readonly stalls: number;
  readonly meetings: number;
  readonly shakedowns: readonly ShakedownRecord[];
  readonly winners: readonly PlayerId[];
  readonly playerRecords: readonly PlayerRecord[];
  /** Bot commands the engine refused (should be 0). */
  readonly rejections: number;
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
  const roleOf = new Map<PlayerId, RoleId>(order.map((id) => [id, state.players[id]?.role ?? "?"]));

  const grabbed = new Map<PlayerId, number>(order.map((id) => [id, 0]));
  const pocketed = new Map<PlayerId, number>(order.map((id) => [id, 0]));
  const sinceShakedown = new Map<PlayerId, number>(order.map((id) => [id, 0]));
  const earned = new Map<PlayerId, number>();
  const spent = new Map<PlayerId, number>();
  const shakedowns: ShakedownRecord[] = [];
  let meetingKind: { emergency: boolean; act: number } = { emergency: false, act: 1 };
  let meetings = 0;
  let endedRound = 0;
  let raids = 0;
  const lyingLow = new Map<number, number>();

  const add = (m: Map<PlayerId, number>, id: PlayerId, v: number) => m.set(id, (m.get(id) ?? 0) + v);
  for (const event of state.log as readonly GameEvent[]) {
    switch (event.type) {
      case "coinsGrabbed":
        if (job.rooms[event.room]?.lieLow) lyingLow.set(event.round, (lyingLow.get(event.round) ?? 0) + 1);
        add(grabbed, event.player, event.duffel + event.pocket);
        add(pocketed, event.player, event.pocket);
        add(sinceShakedown, event.player, event.pocket);
        break;
      case "roundResolved":
        endedRound = event.round;
        break;
      case "roomRaided":
        raids++;
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

  const { outcome } = phase;
  const winners = outcome.winners;
  const ranked = new Map(outcome.ranking.map((e) => [e.player, e]));

  return {
    seed: config.seed,
    players: n,
    result: outcome.result,
    reason: outcome.result === "failed" ? outcome.reason : null,
    endedRound,
    haul: state.haul,
    bankLeft: state.bank,
    capWithBankLeft: !(outcome.result === "failed" && outcome.reason === "bust") && endedRound === job.roundCap && state.bank * 4 > job.bank.coinsPerPlayer * n,
    wanted: state.wanted,
    raids,
    stalls: [...lyingLow.values()].filter((k) => k > n / 2).length,
    meetings,
    shakedowns,
    winners,
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
        score: entry?.score ?? 0,
        stash: entry?.stash ?? 0,
        grabbed: grabbed.get(id) ?? 0,
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
