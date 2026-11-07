// A bot's public ending forecast and its own stash rank (extension.md Build
// notes "Bots"): the chance of success, a bust or a heist sunk by theft, from
// honesty so far (design §7.5), Wanted (alarm.ts) and the role list; and
// whether it rates itself top. The four ★ roles lean toward the
// failure they win on once its forecast passes `LEAN_AT` and they rate
// themselves top; everyone else plays for success. Bot settings, not rules.
import type { FailureReason } from "@skimjob/content";
import { honesty, type PlayerView } from "@skimjob/engine";
import { bustDanger } from "./alarm";
import { jobOf, ofType, roleOf } from "./read";

export interface Forecast {
  readonly success: number;
  readonly bust: number;
  readonly theft: number;
}

/** A ★ role leans toward its failure once that ending's forecast passes this [0.8] (R6 balance pass: was 0.4, r6-balance.md). extension.md Build notes "Bots" */
export const LEAN_AT = 0.8;

/** It rates itself top when what it holds above the share is at least this many times the average other player's estimated pocket (bot setting). */
const TOP_FACTOR = 2;

const clamp = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * The public ending forecast. Bust: half as likely one raid short of the
 * bust line (alarm.ts `bustDanger` 1), nothing below half of that. Sunk by
 * theft: honesty so far (design §7.5) against the line, an even chance when
 * exactly on it, certain an eighth of the line below. Success: neither.
 */
export function forecast(view: PlayerView): Forecast {
  const job = jobOf(view);
  const bust = clamp(bustDanger(view, job) - 0.5);
  const line = job.honestyLine;
  const theft = clamp(((line - honesty(view.honesty)) / line) * 4 + 0.5);
  return { success: (1 - bust) * (1 - theft), bust, theft };
}

/**
 * Whether the bot rates itself top: what it holds above the share (design §7.6) against the others'
 * share of the coins that went missing (public, §7.4) that it didn't pocket itself.
 */
function ratesSelfTop(view: PlayerView): boolean {
  const mine = view.me.stash - view.share;
  if (mine <= 0) return false;
  const missing = ofType(view.ledger, "roundResolved").reduce((sum, e) => sum + e.missing, 0);
  const pocketed = ofType(view.caseFile, "coinsGrabbed").reduce((sum, e) => sum + e.pocket, 0);
  const others = Math.max(1, view.players.length);
  return mine >= (TOP_FACTOR * Math.max(0, missing - pocketed)) / others;
}

/** The failure this bot leans toward now (★ roles only), or null: it plays for success. extension.md Build notes "Bots" */
export function leaning(view: PlayerView): FailureReason | null {
  const { winsOn } = roleOf(view);
  if (winsOn.length === 0 || !ratesSelfTop(view)) return null;
  const f = forecast(view);
  const best = [...winsOn].sort((a, b) => f[b] - f[a])[0];
  return best !== undefined && f[best] >= LEAN_AT ? best : null;
}
