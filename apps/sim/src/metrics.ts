// Balance metrics over a batch of game records. design §17.4 "Balance metrics
// and rough targets". Small pure functions, so each definition is testable.
//
// Definitions (provisional, docs/decisions.md):
// - success rate: games won by the crew ÷ games.
// - bust rate: games ended by a bust ÷ games (design §21 G3: 8–20%).
// - raids: raids per game (G2: 1–3 on average), and games with at least one
//   raid (G2: 50–90%).
// - Rooftop stalls: rounds with more than half the crew on the Rooftop ÷
//   rounds played (G4: at most 15%).
// - pocketing: each player who can pocket is put in a band by pocketed ÷ grabbed
//   (honest ≤ 10%, moderate ≤ 40%, heavy above); win rate over all games, so a
//   heist sunk by pocketing counts as a loss.
// - meetings: regular meetings, police briefings and emergencies per game
//   (design §9.1–§9.3).
// - shakedown accuracy: shakedowns whose target held anything above the share
//   ÷ shakedowns (also: the target had pocketed anything at all).
// - role / personality win share: wins (joint winners share one) ÷ seats, in
//   successful games, against the fair share 1 ÷ crew size; and each role's win
//   rate ÷ the average seat's, all endings pooled, each copy its own seat
//   (design §21 G5: 0.75–1.33).
// - sunk by theft: games that ended below the honesty line ÷ games, and of
//   those, the games a Mole or Fixer won (design §8.4, §21 G8, reported only).
// - whole-crew wins: successful games every player won, every stash equal ÷
//   successful games (design §8.2, §21 G6: 5–20%).
// - cap stalls: games that ended at the round cap with over a quarter of the
//   bank left ÷ games (G4: at most 10%).
import type { GameRecord, PlayerRecord } from "./record";

export const POCKET_BANDS = ["honest", "moderate", "heavy"] as const;
export type PocketBand = (typeof POCKET_BANDS)[number];
/** Upper bounds (inclusive) of pocketed ÷ grabbed for the honest and moderate bands. */
export const HONEST_MAX_SHARE = 0.1;
export const MODERATE_MAX_SHARE = 0.4;

/** num ÷ den, or null when there is nothing to divide. */
export const rate = (num: number, den: number): number | null => (den === 0 ? null : num / den);

export function pocketBand(p: Pick<PlayerRecord, "grabbed" | "pocketed">): PocketBand {
  const share = p.grabbed === 0 ? 0 : p.pocketed / p.grabbed;
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

/** Share of games sunk by theft (honesty below the line at the end). design §8.4, §21 G8 (reported) */
export function theftRate(records: readonly GameRecord[]): number | null {
  return rate(records.filter((g) => g.reason === "theft").length, records.length);
}

/** A success the whole crew won together: every stash equal. design §8.2 */
export const wholeCrewWin = (g: Pick<GameRecord, "result" | "players" | "winners">): boolean => g.result === "success" && g.winners.length === g.players;

/** Share of games that ended in a bust. design §21 G3: 8–20% */
export function bustRate(records: readonly GameRecord[]): number | null {
  return rate(records.filter((g) => g.reason === "bust").length, records.length);
}

export interface RaidMetrics {
  /** Raids per game. design §21 G2: 1–3 */
  readonly perGame: number | null;
  /** Games with at least one raid. design §21 G2: 50–90% */
  readonly games: number | null;
  /** Rounds with more than half the crew on the Rooftop ÷ rounds played. design §21 G4: ≤ 15% */
  readonly stalls: number | null;
}

export function raidMetrics(records: readonly GameRecord[]): RaidMetrics {
  return {
    perGame: rate(records.reduce((s, g) => s + g.raids, 0), records.length),
    games: rate(records.filter((g) => g.raids > 0).length, records.length),
    stalls: rate(records.reduce((s, g) => s + g.stalls, 0), records.reduce((s, g) => s + g.endedRound, 0)),
  };
}

/** Meetings held per game, by kind. design §9.1–§9.3 */
export interface MeetingMetrics {
  readonly regular: number | null;
  readonly briefing: number | null;
  readonly emergency: number | null;
}

function meetingMetrics(records: readonly GameRecord[]): MeetingMetrics {
  const per = (kind: keyof GameRecord["meetings"]) => rate(records.reduce((s, g) => s + g.meetings[kind], 0), records.length);
  return { regular: per("regular"), briefing: per("briefing"), emergency: per("emergency") };
}

export interface ShakedownMetrics {
  readonly count: number;
  readonly perGame: number | null;
  /** Not clean ÷ shakedowns: found something above the share. design §17.4 target 50–70% */
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

/** design §8.4, §21 G8: of the games sunk by theft, the share a Mole or Fixer won (per game, however many copies won). */
export function sunkWinMetric(records: readonly GameRecord[]): RateOf {
  const sunk = records.filter((g) => g.reason === "theft");
  return { games: sunk.length, rate: rate(sunk.filter((g) => g.winners.length > 0).length, sunk.length) };
}

/**
 * design §21 G5: each role's win rate per seat holding it (all endings, joint
 * winners sharing one win) ÷ the average seat's win rate; null without wins.
 */
export function roleParity(roles: Readonly<Record<string, GroupWins>>): Record<string, number | null> {
  const groups = Object.values(roles);
  const seats = groups.reduce((s, g) => s + g.seats, 0);
  const average = rate(groups.reduce((s, g) => s + (g.winRate ?? 0) * g.seats, 0), seats);
  return Object.fromEntries(Object.entries(roles).map(([role, g]) => [role, average ? (g.winRate ?? 0) / average : null]));
}

export interface Metrics {
  readonly games: number;
  readonly successRate: number | null;
  readonly failures: number;
  readonly busts: number;
  readonly bustRate: number | null;
  readonly raids: RaidMetrics;
  readonly theftRate: number | null;
  /** Successful games won by the whole crew ÷ successful games. design §21 G6: 5–20% */
  readonly wholeCrewRate: number | null;
  /** Games ended at the round cap with over a quarter of the bank left. design §21 G4: ≤ 10% */
  readonly capStalls: number | null;
  /** Share of games the empty bank ended (design §6.2). */
  readonly bankEmptied: number | null;
  readonly meetings: MeetingMetrics;
  readonly shakedowns: ShakedownMetrics;
  readonly pocketing: Record<string, GroupWins>;
  readonly roles: Record<string, GroupWins>;
  readonly personalities: Record<string, GroupWins>;
  /** Games sunk by theft that a Mole or Fixer won. design §21 G8 */
  readonly sunkWins: RateOf;
  readonly rejections: number;
}

function metrics(records: readonly GameRecord[]): Metrics {
  const failed = records.filter((g) => g.result === "failed");
  return {
    games: records.length,
    successRate: successRate(records),
    failures: failed.length,
    busts: failed.filter((g) => g.reason === "bust").length,
    bustRate: bustRate(records),
    raids: raidMetrics(records),
    theftRate: theftRate(records),
    wholeCrewRate: rate(records.filter(wholeCrewWin).length, records.filter((g) => g.result === "success").length),
    capStalls: rate(records.filter((g) => g.capWithBankLeft).length, records.length),
    bankEmptied: rate(records.filter((g) => g.bankLeft === 0).length, records.length),
    meetings: meetingMetrics(records),
    shakedowns: shakedownMetrics(records),
    pocketing: groupWins(records, pocketBand),
    roles: groupWins(records, (p) => p.role),
    personalities: groupWins(records, (p) => p.personality),
    sunkWins: sunkWinMetric(records),
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
