// Balance metrics over a batch of game records. design §17.4 "Balance metrics
// and rough targets". Small pure functions, so each definition is testable.
//
// Definitions (provisional, docs/decisions.md):
// - success rate: games won by the crew ÷ games.
// - Heat-bust share: failures caused by Heat ÷ failures (target 10–20%).
// - pocketing: each player who can pocket is put in a band by pocketed ÷ looted
//   (honest ≤ 10%, moderate ≤ 40%, heavy above); win rate over all games, so a
//   heist sunk by pocketing counts as a loss.
// - shakedown accuracy: shakedowns whose target held more than the clean
//   threshold ÷ shakedowns (also: the target had pocketed anything at all).
// - role / personality win share: wins (joint winners share one) ÷ seats, in
//   successful games, against the fair share 1 ÷ crew size (±5 pp target).
// - comeback: in successful games with a leader after Act 1 (top stash above
//   0), how often an Act 1 leader wins (target under 50%).
// - decided early: games reaching Act 3 whose sole Act 2 leader won with a lead
//   of at least half the most one player could add in Act 3 (target under 15%).
import type { GameRecord, PlayerRecord } from "./record";

export const POCKET_BANDS = ["honest", "moderate", "heavy"] as const;
export type PocketBand = (typeof POCKET_BANDS)[number];
/** Upper bounds (inclusive) of pocketed ÷ looted for the honest and moderate bands. */
export const HONEST_MAX_SHARE = 0.1;
export const MODERATE_MAX_SHARE = 0.4;
/** A sole Act 2 leader "has it settled" with a lead of at least this share of the most anyone can add in Act 3. */
export const DECIDED_EARLY_LEAD_SHARE = 0.5;

/** num ÷ den, or null when there is nothing to divide. */
export const rate = (num: number, den: number): number | null => (den === 0 ? null : num / den);

export function pocketBand(p: Pick<PlayerRecord, "looted" | "pocketed">): PocketBand {
  const share = p.looted === 0 ? 0 : p.pocketed / p.looted;
  if (share <= HONEST_MAX_SHARE) return "honest";
  if (share <= MODERATE_MAX_SHARE) return "moderate";
  return "heavy";
}

export interface GroupWins {
  /** Seats in the group, all games. */
  readonly seats: number;
  /** Win credit ÷ seats, all games (a failed heist is a loss). */
  readonly winRate: number | null;
  /** Seats in successful games. */
  readonly successSeats: number;
  /** Win credit ÷ seats, successful games only. */
  readonly successWinShare: number | null;
  /** Mean of 1 ÷ crew size over those seats: the share if every seat won equally. */
  readonly fairShare: number | null;
  /** (successWinShare − fairShare) in percentage points. */
  readonly deltaPp: number | null;
}

/** Win rates for the seats `key` puts in each group. */
export function groupWins(records: readonly GameRecord[], key: (p: PlayerRecord) => string | null): Record<string, GroupWins> {
  const acc = new Map<string, { seats: number; credit: number; successSeats: number; successCredit: number; fair: number }>();
  for (const g of records) {
    for (const p of g.playerRecords) {
      const k = key(p);
      if (k === null) continue;
      const a = acc.get(k) ?? { seats: 0, credit: 0, successSeats: 0, successCredit: 0, fair: 0 };
      a.seats++;
      a.credit += p.winCredit;
      if (g.result === "success") {
        a.successSeats++;
        a.successCredit += p.winCredit;
        a.fair += 1 / g.players;
      }
      acc.set(k, a);
    }
  }
  const out: Record<string, GroupWins> = {};
  for (const [k, a] of [...acc].sort(([x], [y]) => x.localeCompare(y))) {
    const successWinShare = rate(a.successCredit, a.successSeats);
    const fairShare = rate(a.fair, a.successSeats);
    out[k] = {
      seats: a.seats,
      winRate: rate(a.credit, a.seats),
      successSeats: a.successSeats,
      successWinShare,
      fairShare,
      deltaPp: successWinShare === null || fairShare === null ? null : (successWinShare - fairShare) * 100,
    };
  }
  return out;
}

export function successRate(records: readonly GameRecord[]): number | null {
  return rate(records.filter((g) => g.result === "success").length, records.length);
}

/** Share of failures that came from Heat. design §17.4 target 10–20% */
export function heatBustShare(records: readonly GameRecord[]): number | null {
  const failed = records.filter((g) => g.result === "failed");
  return rate(failed.filter((g) => g.reason === "heat").length, failed.length);
}

export interface ShakedownMetrics {
  readonly count: number;
  readonly perGame: number | null;
  /** Not clean ÷ shakedowns: caught real loot. design §17.4 target 50–70% */
  readonly accuracy: number | null;
  /** The target had pocketed anything before. */
  readonly hitPocketer: number | null;
}

export function shakedownMetrics(records: readonly GameRecord[]): ShakedownMetrics {
  const all = records.flatMap((g) => g.shakedowns);
  return {
    count: all.length,
    perGame: rate(all.length, records.length),
    accuracy: rate(all.filter((s) => !s.clean).length, all.length),
    hitPocketer: rate(all.filter((s) => s.targetHadPocketed).length, all.length),
  };
}

export interface RateOf {
  readonly games: number;
  readonly rate: number | null;
}

/** How often an Act 1 leader goes on to win a successful heist. design §17.4 target < 50% */
export function comebackMetric(records: readonly GameRecord[]): RateOf {
  const eligible = records.filter((g) => g.result === "success" && g.afterAct1 !== null && g.afterAct1.topScore > 0);
  const leaderWon = eligible.filter((g) => g.afterAct1?.leaders.some((id) => g.winners.includes(id)));
  return { games: eligible.length, rate: rate(leaderWon.length, eligible.length) };
}

/** True if the game was effectively settled before Act 3 (see the definitions above). */
export function decidedEarly(g: GameRecord): boolean {
  const s = g.afterAct2;
  if (g.result !== "success" || !s || s.leaders.length !== 1) return false;
  return g.winners.includes(s.leaders[0] as string) && s.lead >= DECIDED_EARLY_LEAD_SHARE * g.act3MaxGain;
}

/** Share of games reaching Act 3 that were settled before it. design §17.4 target < 15% */
export function decidedEarlyMetric(records: readonly GameRecord[]): RateOf {
  const reached = records.filter((g) => g.endedAct === 3);
  return { games: reached.length, rate: rate(reached.filter(decidedEarly).length, reached.length) };
}

export interface Metrics {
  readonly games: number;
  readonly successRate: number | null;
  readonly failures: number;
  readonly heatFailures: number;
  readonly heatBustShare: number | null;
  /** Games that ended (raided) before Act 3. */
  readonly endedBeforeAct3: number | null;
  readonly checkpointsMissedPerGame: number | null;
  readonly shakedowns: ShakedownMetrics;
  readonly pocketing: Record<string, GroupWins>;
  readonly roles: Record<string, GroupWins>;
  readonly personalities: Record<string, GroupWins>;
  readonly comeback: RateOf;
  readonly decidedEarly: RateOf;
  readonly rejections: number;
}

export function metrics(records: readonly GameRecord[]): Metrics {
  const failed = records.filter((g) => g.result === "failed");
  return {
    games: records.length,
    successRate: successRate(records),
    failures: failed.length,
    heatFailures: failed.filter((g) => g.reason === "heat").length,
    heatBustShare: heatBustShare(records),
    endedBeforeAct3: rate(records.filter((g) => g.endedAct < 3).length, records.length),
    checkpointsMissedPerGame: rate(records.reduce((s, g) => s + g.checkpointsMissed, 0), records.length),
    shakedowns: shakedownMetrics(records),
    pocketing: groupWins(records, (p) => (p.canPocket ? pocketBand(p) : null)),
    roles: groupWins(records, (p) => p.role),
    personalities: groupWins(records, (p) => p.personality),
    comeback: comebackMetric(records),
    decidedEarly: decidedEarlyMetric(records),
    rejections: records.reduce((s, g) => s + g.rejections, 0),
  };
}

export interface Summary {
  readonly overall: Metrics;
  /** Keyed by player count. */
  readonly byPlayers: Readonly<Record<number, Metrics>>;
}

export function summarize(records: readonly GameRecord[]): Summary {
  const counts = [...new Set(records.map((g) => g.players))].sort((a, b) => a - b);
  const byPlayers: Record<number, Metrics> = {};
  for (const n of counts) byPlayers[n] = metrics(records.filter((g) => g.players === n));
  return { overall: metrics(records), byPlayers };
}
