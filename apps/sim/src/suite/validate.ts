// Shape checks for the JSON files the suite reads back (shard files for
// `merge`, a baseline for `--compare`): a bad file gets a clear message, never
// a crash halfway through. They come from disk, so they're untrusted.
import { isSetup, type SuiteOptions } from "./matrix";
import { REPORT_FORMAT, REPORT_KIND, SHARD_KIND, type ShardFile, type SuiteReport } from "./report";
import type { Tally } from "./tally";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string";

const TALLY_COUNTS = [
  "games", "successes", "failures", "heatFailures", "targetFailures", "noWinner", "sharedWin",
  "comebackGames", "act1LeaderWins", "decidedEarly", "shakedowns", "shakedownsCaught", "rejections",
] as const satisfies readonly (keyof Tally)[];

function seatsProblem(v: unknown, what: string): string | null {
  if (!isObj(v)) return `${what} isn't an object`;
  for (const [k, s] of Object.entries(v)) {
    const ok = isObj(s) && isInt(s.seats) && isNum(s.credit) && isNum(s.fair) && isNum(s.successCredit) && isNum(s.earned) && isNum(s.spent);
    if (!ok) return `${what}.${k} isn't { seats, credit, fair, successCredit, earned, spent }`;
  }
  return null;
}

export function tallyProblem(v: unknown): string | null {
  if (!isObj(v)) return "tally isn't an object";
  for (const k of TALLY_COUNTS) if (!isInt(v[k]) || (v[k] as number) < 0) return `tally.${k} isn't a count`;
  return seatsProblem(v.roles, "tally.roles") ?? seatsProblem(v.personalities, "tally.personalities");
}

export function optionsProblem(v: unknown): string | null {
  if (!isObj(v)) return "options isn't an object";
  const o = v as Partial<Record<keyof SuiteOptions, unknown>>;
  if (!isStr(o.seed)) return "options.seed isn't a string";
  if (!Array.isArray(o.playerCounts) || !o.playerCounts.every(isInt)) return "options.playerCounts isn't a list of player counts";
  if (!Array.isArray(o.setups) || !o.setups.every(isSetup)) return "options.setups isn't a list of setups";
  if (!Array.isArray(o.events) || !o.events.every((e) => typeof e === "boolean")) return "options.events isn't a list of booleans";
  if (!Array.isArray(o.mix) || !o.mix.every((m) => isObj(m) && isStr(m.personality) && isNum(m.weight))) return "options.mix isn't a bot mix";
  for (const k of ["ciHalfWidth", "minGames", "maxGames", "batch"] as const) if (!isNum(o[k]) || (o[k] as number) <= 0) return `options.${k} isn't a positive number`;
  return null;
}

const versionsProblem = (v: unknown): string | null => (isObj(v) && isStr(v.engine) && isStr(v.content) ? null : "versions isn't { engine, content }");

/** A shard file from disk, checked (its tallies are checked by merge, after its cell list); or what is wrong with it. */
export function checkShard(v: unknown): ShardFile | string {
  if (!isObj(v) || v.kind !== SHARD_KIND) return `isn't a suite shard (kind "${SHARD_KIND}")`;
  if (v.format !== REPORT_FORMAT) return `has format ${String(v.format)}, expected ${REPORT_FORMAT}`;
  const problem = versionsProblem(v.versions) ?? optionsProblem(v.options);
  if (problem) return problem;
  const shard = v.shard;
  // Range is left to merge: an index past the count holds no cells, which it reports.
  if (!isObj(shard) || !isInt(shard.index) || !isInt(shard.count) || shard.count < 1) return "shard isn't { index, count }";
  if (!Array.isArray(v.cells)) return "cells isn't a list";
  for (const [i, c] of v.cells.entries()) {
    if (!isObj(c) || !isStr(c.key)) return `cell ${i + 1} has no key`;
    if (!isInt(c.players) || !isSetup(c.setup) || typeof c.events !== "boolean" || typeof c.gated !== "boolean") return `cell ${c.key} lacks its settings`;
    if (!isInt(c.batches) || typeof c.converged !== "boolean") return `cell ${c.key} lacks batches/converged`;
  }
  return v as unknown as ShardFile;
}

const checkProblem = (v: unknown): boolean => v === null || (isObj(v) && isStr(v.verdict) && typeof v.sure === "boolean");

/** A suite report from disk (a --compare baseline), checked; or what is wrong with it. */
export function checkReport(v: unknown): SuiteReport | string {
  if (!isObj(v) || v.kind !== REPORT_KIND) return `isn't a suite report (kind "${REPORT_KIND}")`;
  if (v.format !== REPORT_FORMAT) return `has format ${String(v.format)}, expected ${REPORT_FORMAT}`;
  const problem = versionsProblem(v.versions) ?? optionsProblem(v.options);
  if (problem) return problem;
  if (!Array.isArray(v.cells)) return "cells isn't a list";
  for (const [i, c] of v.cells.entries()) {
    if (!isObj(c) || !isStr(c.key) || !isObj(c.rates)) return `cell ${i + 1} isn't { key, rates }`;
    for (const [id, r] of Object.entries(c.rates)) {
      const ok = isObj(r) && (r.rate === null || isNum(r.rate)) && (r.halfWidth === null || isNum(r.halfWidth)) && checkProblem(r.check);
      if (!ok) return `cell ${c.key} rate ${id} isn't a rate`;
    }
  }
  if (!Array.isArray(v.parity)) return "parity isn't a list";
  for (const [i, p] of v.parity.entries()) {
    if (!isObj(p) || !isStr(p.key) || !(p.spread === null || isNum(p.spread)) || !checkProblem(p.check) || p.check === null) return `parity group ${i + 1} isn't { key, spread, check }`;
  }
  return v as unknown as SuiteReport;
}
