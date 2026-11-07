// A bot's public ending forecast and its own stash rank (extension.md Build
// notes "Bots"): the chance of success, a raid or a missed final target, from
// the Haul's pace, the Heat (heat.ts: card, baseline, police activity) and the
// role list; and whether it rates itself top. The four ★ roles lean toward the
// failure they win on once its forecast passes `LEAN_AT` and they rate
// themselves top; everyone else plays for success. Bot settings, not rules.
import type { FailureReason } from "@skimjob/content";
import { checkpointTarget, roomDef, type PlayerView } from "@skimjob/engine";
import { heatDanger } from "./heat";
import { crewSize, jobOf, lastResolvedRound, ofType, roleOf, totalRounds } from "./read";

export interface Forecast {
  readonly success: number;
  readonly heat: number;
  readonly target: number;
}

/** A ★ role leans toward its failure once that ending's forecast passes this [0.8] (R6 balance pass: was 0.4, r6-balance.md). extension.md Build notes "Bots" */
export const LEAN_AT = 0.8;

/** It rates itself top when its score is at least this many times the average other player's estimated stash (bot setting). */
const TOP_FACTOR = 2;

const clamp = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * The public ending forecast. Raid: Heat danger (Heat now plus what is still
 * to come, ÷ the raid level; heat.ts) past 0.75, certain by 1.25. Missed
 * target: the Haul at its average pace so far (on pace before any round)
 * against the final target, an even chance when exactly on it, certain an
 * eighth below. Success: neither.
 */
export function forecast(view: PlayerView): Forecast {
  const job = jobOf(view);
  const heat = clamp((heatDanger(view, job) - 0.75) * 2);
  const total = totalRounds(job);
  const final = checkpointTarget(job, job.checkpoints.perPlayer.length as 1 | 2 | 3, crewSize(view));
  const done = lastResolvedRound(view);
  const pace = done > 0 ? view.haul / done : final / total;
  const projected = view.haul + pace * (total - done);
  const target = final > 0 ? clamp((final - projected) / final * 4 + 0.5) : 0;
  return { success: (1 - heat) * (1 - target), heat, target };
}

/**
 * Coins the alibis claim but the Haul never got, summed over the resolved
 * rounds: roughly what the crew has skimmed (cover-up alibis hide some).
 */
function skimEstimate(view: PlayerView): number {
  const job = jobOf(view);
  let total = 0;
  for (const r of ofType(view.ledger, "roundResolved")) {
    const rooms = ofType(view.ledger, "alibiPosted").filter((a) => a.round === r.round).map((a) => a.room);
    const claimed = rooms.reduce((sum, room) => sum + roomDef(job, room).coins, 0);
    total += Math.max(0, claimed - r.haulDelta);
  }
  return total;
}

/** Whether the bot rates itself top: its stash against the others' estimated share of the skim. */
function ratesSelfTop(view: PlayerView): boolean {
  const mine = view.me.stash;
  if (mine === 0) return false;
  const pocketed = ofType(view.caseFile, "coinsGrabbed").reduce((sum, e) => sum + e.pocket, 0);
  const others = Math.max(1, view.players.length);
  return mine >= (TOP_FACTOR * Math.max(0, skimEstimate(view) - pocketed)) / others;
}

/** The failure this bot leans toward now (★ roles only), or null: it plays for success. extension.md Build notes "Bots" */
export function leaning(view: PlayerView): FailureReason | null {
  const { winsOn } = roleOf(view);
  if (winsOn.length === 0 || !ratesSelfTop(view)) return null;
  const f = forecast(view);
  const best = [...winsOn].sort((a, b) => f[b] - f[a])[0];
  return best !== undefined && f[best] >= LEAN_AT ? best : null;
}
