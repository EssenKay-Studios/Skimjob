// One finished game as a flat record: what the balance metrics need, read from
// the event log (the full record of the game). design §17.4
//
// Pure: a finished GameState (plus the bot crew) in, plain data out.
import type { PerkId, RoleId } from "@skimjob/content";
import type { PersonalityId } from "@skimjob/bots";
import { honesty, jobFor, type GameConfig, type GameEvent, type GameState, type MeetingKind, type PlayerId } from "@skimjob/engine";

export interface PlayerRecord {
  readonly id: PlayerId;
  readonly personality: PersonalityId;
  readonly role: RoleId;
  /** Final stash: share received + pocketed − taken back. design §7.6 */
  readonly stash: number;
  /** Coins grabbed over the game, after any short-bank cut. design §3.2 */
  readonly grabbed: number;
  /** Of that, kept for the stash. */
  readonly pocketed: number;
  readonly timesShakenDown: number;
  readonly winner: boolean;
  /** 1 ÷ number of winners if a winner (joint winners share one win), else 0. */
  readonly winCredit: number;
  /** Perks bought, in order, and the coins they cost. design §12 */
  readonly perks: readonly PerkId[];
  readonly spent: number;
}

export interface ShakedownRecord {
  /** The meeting that passed it: regular, briefing or emergency. design §9.1–§9.3 */
  readonly kind: MeetingKind;
  readonly target: PlayerId;
  readonly stashRevealed: number;
  /** At or below the share: nothing taken. design §9.6 */
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
  /** Honesty at the end: coins that reached the duffel ÷ coins taken. design §7.5 */
  readonly honesty: number;
  /** Coins left in the bank at the end. design §6.1 */
  readonly bankLeft: number;
  /** It ended at the round cap with over a quarter of the bank left (design §21 G4). */
  readonly capWithBankLeft: boolean;
  /** Wanted at the end, and the raids that raised it. design §5.3, §5.4 */
  readonly wanted: number;
  readonly raids: number;
  /** Rounds with more than half the crew on the Rooftop (design §21 G4). */
  readonly stalls: number;
  /** Event cards flipped (design §13: a 4-in-10 chance each round from round 2). */
  readonly cards: number;
  /** Room claims on the plan board as rounds resolved, and how many of them were where the player really went. design §10 */
  readonly planSpots: number;
  readonly planKept: number;
  /** Meetings held, by kind. design §9.1–§9.3 */
  readonly meetings: Readonly<Record<MeetingKind, number>>;
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
  const order = state.playerOrder;
  const n = order.length;
  const roleOf = new Map<PlayerId, RoleId>(order.map((id) => [id, state.players[id]?.role ?? "?"]));

  const grabbed = new Map<PlayerId, number>(order.map((id) => [id, 0]));
  const pocketed = new Map<PlayerId, number>(order.map((id) => [id, 0]));
  const sinceShakedown = new Map<PlayerId, number>(order.map((id) => [id, 0]));
  const perks = new Map<PlayerId, PerkId[]>();
  const spent = new Map<PlayerId, number>();
  const shakedowns: ShakedownRecord[] = [];
  let meetingKind: MeetingKind = "regular";
  const meetings: Record<MeetingKind, number> = { regular: 0, briefing: 0, emergency: 0 };
  let endedRound = 0;
  let raids = 0;
  let cards = 0;
  const lyingLow = new Map<number, number>();
  // design §10: each round's room claims, then where everyone really went.
  const claimed = new Map<string, string>();
  const went = new Map<string, string>();

  const add = (m: Map<PlayerId, number>, id: PlayerId, v: number) => m.set(id, (m.get(id) ?? 0) + v);
  for (const event of state.log as readonly GameEvent[]) {
    switch (event.type) {
      case "said":
        if (event.statement.kind === "plan") for (const e of event.statement.plan.entries) if (e.room !== null) claimed.set(`${e.player}/${event.statement.round}`, e.room);
        break;
      case "coinsGrabbed":
        went.set(`${event.player}/${event.round}`, event.room);
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
      case "eventFlipped":
        cards++;
        break;
      case "meetingOpened":
        meetings[event.kind]++;
        meetingKind = event.kind;
        break;
      case "shakedownResolved":
        shakedowns.push({
          kind: meetingKind,
          target: event.target,
          stashRevealed: event.stashRevealed,
          clean: event.clean,
          targetHadPocketed: (sinceShakedown.get(event.target) ?? 0) > 0,
        });
        sinceShakedown.set(event.target, 0);
        break;
      case "perkBought":
        perks.set(event.player, [...(perks.get(event.player) ?? []), event.perk.kind]);
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
    honesty: honesty({ reached: state.reached, taken: job.bank.coinsPerPlayer * n - state.bank - state.seized }),
    bankLeft: state.bank,
    capWithBankLeft: !(outcome.result === "failed" && outcome.reason === "bust") && endedRound === job.roundCap && state.bank * 4 > job.bank.coinsPerPlayer * n,
    wanted: state.wanted,
    raids,
    stalls: [...lyingLow.values()].filter((k) => k > n / 2).length,
    cards,
    planSpots: claimed.size,
    planKept: [...claimed].filter(([key, room]) => went.get(key) === room).length,
    meetings,
    shakedowns,
    winners,
    playerRecords: order.map((id, i): PlayerRecord => {
      const entry = ranked.get(id);
      const role = roleOf.get(id) as RoleId;
      const winner = winners.includes(id);
      return {
        id,
        personality: crew[i] as PersonalityId,
        role,
        stash: entry?.stash ?? 0,
        grabbed: grabbed.get(id) ?? 0,
        pocketed: pocketed.get(id) ?? 0,
        timesShakenDown: shakedowns.filter((s) => s.target === id).length,
        winner,
        winCredit: winner ? 1 / winners.length : 0,
        perks: perks.get(id) ?? [],
        spent: spent.get(id) ?? 0,
      };
    }),
    rejections,
  };
}
