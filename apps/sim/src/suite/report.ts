// The suite report: every cell's rates with Wilson 95% intervals and
// PASS/FAIL against the targets, role parity per player count and setup, a
// per-role summary (★ wins by ending, tokens), and the text and JSON forms of
// it. Pure: cell results in, report out, so a single run and merged shards
// give the same bytes. design §17.4, docs/roles-v2.md §5, extension.md Build notes "Sim"
import { ROLES } from "@skimjob/content";
import { checkBand, wilson, type Band, type CheckResult, type Verdict } from "../stats";
import type { Setup, SuiteOptions } from "./matrix";
import type { CellResult } from "./run";
import { PARITY_MAX_SPREAD, PARITY_MIN_SEATS, RATES } from "./targets";
import { addTallies, emptyTally, type SeatTally } from "./tally";

export const REPORT_KIND = "skimjob-sim-suite";
export const SHARD_KIND = "skimjob-sim-suite-shard";
export const REPORT_FORMAT = 1;

export interface Versions {
  readonly engine: string;
  readonly content: string;
}

export interface RateResult {
  readonly num: number;
  readonly den: number;
  readonly rate: number | null;
  readonly lo: number | null;
  readonly hi: number | null;
  readonly halfWidth: number | null;
  readonly band: Band | null;
  readonly check: CheckResult | null;
}

export interface CellReport {
  readonly key: string;
  readonly players: number;
  readonly setup: Setup;
  readonly events: boolean;
  readonly games: number;
  readonly converged: boolean;
  readonly rejections: number;
  readonly rates: Readonly<Record<string, RateResult>>;
}

export interface ParityRole {
  readonly role: string;
  readonly seats: number;
  /** Win credit ÷ fair share; 1 = wins exactly its fair share. */
  readonly ratio: number;
  readonly lo: number;
  readonly hi: number;
}

export interface ParityGroup {
  /** e.g. "9p/balanced": events on and off pooled. */
  readonly key: string;
  readonly players: number;
  readonly setup: Setup;
  readonly games: number;
  readonly roles: readonly ParityRole[];
  /** Roles dealt too rarely here to count (fewer than PARITY_MIN_SEATS seats). */
  readonly fewSeats: readonly string[];
  /** max − min ratio over the counted roles, with the range the intervals allow. */
  readonly spread: number | null;
  readonly spreadLo: number | null;
  readonly spreadHi: number | null;
  readonly check: CheckResult;
}

/**
 * Only interval-confirmed results count as PASS or FAIL: the whole 95%
 * interval inside the target (PASS) or outside it (FAIL). Anything else is
 * inconclusive, whatever side its point estimate is on (for parity the point
 * spread is biased upward by noise, so only its interval range is used).
 * `--strict` fails on `fail` only.
 */
export interface CheckCounts {
  /** Confirmed passes. */
  readonly pass: number;
  /** Confirmed failures, plus one if bots sent refused commands. */
  readonly fail: number;
  /** The interval crosses the target: more games needed to tell. */
  readonly inconclusive: number;
}

/**
 * One role over the whole run (every cell pooled): how its wins split by
 * ending (★ roles also win failures) and its shop tokens per seat.
 * extension.md Build notes "Sim"
 */
export interface RoleSummary {
  readonly role: string;
  /** A ★ role (wins on some failures). */
  readonly star: boolean;
  readonly seats: number;
  /** Win credit ÷ fair share, every cell pooled (setups and crew sizes mixed: a rough guide; parity is per group). */
  readonly ratio: number;
  /** Share of its win credit from successful heists. */
  readonly fromSuccess: number | null;
  readonly earnedPerSeat: number;
  readonly spentPerSeat: number;
}

export interface SuiteReport {
  readonly kind: typeof REPORT_KIND;
  readonly format: typeof REPORT_FORMAT;
  readonly versions: Versions;
  readonly options: SuiteOptions;
  readonly games: number;
  readonly rejections: number;
  readonly checks: CheckCounts;
  readonly cells: readonly CellReport[];
  readonly parity: readonly ParityGroup[];
  readonly roles: readonly RoleSummary[];
}

export interface ShardFile {
  readonly kind: typeof SHARD_KIND;
  readonly format: typeof REPORT_FORMAT;
  readonly versions: Versions;
  readonly options: SuiteOptions;
  readonly shard: { readonly index: number; readonly count: number };
  readonly cells: readonly CellResult[];
}

/** Rates rounded to 0.01 pp in the report, so it reads (and diffs) cleanly. */
const r4 = (v: number | null): number | null => (v === null ? null : Math.round(v * 1e4) / 1e4);
const r3 = (v: number): number => Math.round(v * 1e3) / 1e3;

function rateResult(num: number, den: number, band: Band | null): RateResult {
  const iv = wilson(num, den);
  const rounded = { rate: r4(iv.rate), lo: r4(iv.lo), hi: r4(iv.hi) };
  return { num: r4(num) as number, den, ...rounded, halfWidth: r4(iv.halfWidth), band, check: band === null ? null : checkBand(iv, band) };
}

function cellReport(c: CellResult): CellReport {
  const rates: Record<string, RateResult> = {};
  for (const r of RATES) if (r.applies(c)) rates[r.id] = rateResult(r.num(c.tally), r.den(c.tally), r.checked(c) ? r.band : null);
  return { key: c.key, players: c.players, setup: c.setup, events: c.events, games: c.tally.games, converged: c.converged, rejections: c.tally.rejections, rates };
}

/** Role parity for a pool of games at one crew size. docs/roles-v2.md §5 */
export function parityOf(roles: Readonly<Record<string, SeatTally>>): Pick<ParityGroup, "roles" | "fewSeats" | "spread" | "spreadLo" | "spreadHi" | "check"> {
  const counted: ParityRole[] = [];
  const fewSeats: string[] = [];
  for (const [role, s] of Object.entries(roles)) {
    if (s.seats < PARITY_MIN_SEATS || s.fair === 0) {
      fewSeats.push(role);
      continue;
    }
    // The win rate's interval, scaled to the ratio (seats ÷ fair = the crew size).
    const iv = wilson(s.credit, s.seats);
    const scale = s.seats / s.fair;
    counted.push({ role, seats: s.seats, ratio: r3((iv.rate as number) * scale), lo: r3((iv.lo as number) * scale), hi: r3((iv.hi as number) * scale) });
  }
  if (counted.length < 2) return { roles: counted, fewSeats, spread: null, spreadLo: null, spreadHi: null, check: { verdict: "n/a", sure: false } };
  const ratios = counted.map((r) => r.ratio);
  const spread = r3(Math.max(...ratios) - Math.min(...ratios));
  const spreadHi = r3(Math.max(...counted.map((r) => r.hi)) - Math.min(...counted.map((r) => r.lo)));
  const spreadLo = r3(Math.max(0, Math.max(...counted.map((r) => r.lo)) - Math.min(...counted.map((r) => r.hi))));
  const verdict: Verdict = spread <= PARITY_MAX_SPREAD ? "pass" : "fail";
  const sure = verdict === "pass" ? spreadHi <= PARITY_MAX_SPREAD : spreadLo > PARITY_MAX_SPREAD;
  return { roles: counted, fewSeats, spread, spreadLo, spreadHi, check: { verdict, sure } };
}

/**
 * Parity groups: one per player count and setup, events on and off pooled, in
 * matrix order. Only gated groups (Balanced, 4–12 players) get a verdict; the
 * rest are reported. extension.md Build notes "Sim"
 */
function parityGroups(cells: readonly CellResult[]): ParityGroup[] {
  const groups = new Map<string, CellResult[]>();
  for (const c of cells) {
    const key = `${c.players}p/${c.setup}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups].map(([key, cs]) => {
    const tally = cs.reduce((t, c) => addTallies(t, c.tally), emptyTally());
    const first = cs[0] as CellResult;
    const parity = parityOf(tally.roles);
    const check: CheckResult = first.gated ? parity.check : { verdict: "n/a", sure: false };
    return { key, players: first.players, setup: first.setup, games: tally.games, ...parity, check };
  });
}

/** Every role over the whole run, in content order. extension.md Build notes "Sim" */
function roleSummaries(cells: readonly CellResult[]): RoleSummary[] {
  const roles = cells.reduce((t, c) => addTallies(t, c.tally), emptyTally()).roles;
  const order = Object.keys(ROLES);
  return Object.entries(roles)
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([role, s]) => ({
      role,
      star: (Object.hasOwn(ROLES, role) ? ROLES[role]?.winsOn.length ?? 0 : 0) > 0,
      seats: s.seats,
      ratio: s.fair > 0 ? r3(s.credit / s.fair) : 0,
      fromSuccess: s.credit > 0 ? r3(s.successCredit / s.credit) : null,
      earnedPerSeat: s.seats > 0 ? r3(s.earned / s.seats) : 0,
      spentPerSeat: s.seats > 0 ? r3(s.spent / s.seats) : 0,
    }));
}

export function buildReport(options: SuiteOptions, versions: Versions, cells: readonly CellResult[]): SuiteReport {
  const cellReports = cells.map(cellReport);
  const parity = parityGroups(cells);
  const all: CheckResult[] = [...cellReports.flatMap((c) => Object.values(c.rates).flatMap((r) => (r.check ? [r.check] : []))), ...parity.map((p) => p.check)];
  const decided = all.filter((c) => c.verdict !== "n/a");
  const rejections = cells.reduce((s, c) => s + c.tally.rejections, 0);
  return {
    kind: REPORT_KIND,
    format: REPORT_FORMAT,
    versions,
    options,
    games: cells.reduce((s, c) => s + c.tally.games, 0),
    rejections,
    checks: {
      pass: decided.filter((c) => c.verdict === "pass" && c.sure).length,
      fail: decided.filter((c) => c.verdict === "fail" && c.sure).length + (rejections > 0 ? 1 : 0),
      inconclusive: decided.filter((c) => !c.sure).length,
    },
    cells: cellReports,
    parity,
    roles: roleSummaries(cells),
  };
}

/**
 * JSON with one line per cell, parity group and role, so a diff between two
 * reports shows which ones moved. Same data as JSON.stringify.
 */
export function stringifyJson(value: unknown, depth = 0, lineDepth = 2): string {
  if (depth >= lineDepth || typeof value !== "object" || value === null) return JSON.stringify(value);
  const pad = " ".repeat(depth + 1);
  const end = " ".repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((v) => pad + stringifyJson(v, depth + 1, lineDepth)).join(",\n")}\n${end}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";
  return `{\n${entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${stringifyJson(v, depth + 1, lineDepth)}`).join(",\n")}\n${end}}`;
}

export const reportJson = (r: SuiteReport): string => stringifyJson(r) + "\n";
export const shardJson = (s: ShardFile): string => stringifyJson(s) + "\n";

// ---- text ----

/** min = max: a fixed number of games per cell (`-n`), not adaptive. */
export const fixedGames = (o: SuiteOptions): boolean => o.minGames === o.maxGames;

const pp = (v: number | null): string => (v === null ? "—" : (v * 100).toFixed(1));

/** PASS / FAIL only when the interval confirms it; otherwise "inconcl.". */
export function verdictText(c: CheckResult | null): string {
  if (!c || c.verdict === "n/a") return "";
  return c.sure ? c.verdict.toUpperCase() : "inconcl.";
}

/** "66.1±1.9 PASS": the rate and half-width in percentage points, and the check. */
function rateCell(r: RateResult | undefined): string {
  if (!r) return "";
  if (r.rate === null) return "—";
  return `${pp(r.rate)}±${pp(r.halfWidth)} ${verdictText(r.check)}`.trimEnd();
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: readonly string[]) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0))).join("  ").trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}

const bandText = (b: Band): string => (b.lo === 0 ? `≤${Math.round(b.hi * 100)}%` : `${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%`);

export function formatSuiteReport(r: SuiteReport): string {
  const o = r.options;
  const rateCols = RATES.filter((d) => r.cells.some((c) => c.rates[d.id] !== undefined));
  const cells = table(
    ["cell", "games", ...rateCols.map((d) => (d.band ? `${d.label} ${bandText(d.band)}` : d.label))],
    r.cells.map((c) => [c.key, `${c.games}${c.converged || fixedGames(o) ? "" : "+"}`, ...rateCols.map((d) => rateCell(c.rates[d.id]))]),
  );
  const roles = table(
    ["role", "seats", "win ÷ fair", "wins on success", "on failure", "tokens earned/seat", "spent/seat"],
    r.roles.map((x) => [
      `${x.role}${x.star ? " ★" : ""}`,
      String(x.seats),
      x.ratio.toFixed(2),
      x.fromSuccess === null ? "—" : `${(x.fromSuccess * 100).toFixed(0)}%`,
      x.fromSuccess === null ? "—" : `${((1 - x.fromSuccess) * 100).toFixed(0)}%`,
      x.earnedPerSeat.toFixed(2),
      x.spentPerSeat.toFixed(2),
    ]),
  );
  const parity = table(
    ["parity group (events pooled)", "games", `spread ≤${PARITY_MAX_SPREAD.toFixed(2)}`, "95% range", "", "highest", "lowest"],
    r.parity.map((p) => {
      const sorted = [...p.roles].sort((a, b) => b.ratio - a.ratio);
      const hi = sorted.length > 1 ? sorted[0] : undefined;
      const lo = sorted.length > 1 ? sorted.at(-1) : undefined;
      return [
        p.key,
        String(p.games),
        p.spread === null ? "—" : p.spread.toFixed(2),
        p.spreadLo === null ? "" : `${p.spreadLo.toFixed(2)}–${(p.spreadHi as number).toFixed(2)}`,
        verdictText(p.check),
        hi ? `${hi.role} ${hi.ratio.toFixed(2)}` : "",
        lo ? `${lo.role} ${lo.ratio.toFixed(2)}` : "",
      ];
    }),
  );
  const mix = o.mix.map((m) => `${m.personality}:${m.weight}`).join(",");
  const lines = [
    `Skimjob sim suite (engine ${r.versions.engine}, content ${r.versions.content}): ${r.games} games, seed "${o.seed}", bots ${mix}`,
    (fixedGames(o)
      ? `Fixed: ${o.maxGames} games per cell${o.maxGames % o.batch === 0 ? "" : ` (rounded up to whole batches of ${o.batch})`}`
      : `Adaptive: ${o.minGames}–${o.maxGames} games per cell in batches of ${o.batch}, until every checked 95% interval is within ±${(o.ciHalfWidth * 100).toFixed(1)} pp`) +
      (o.contentOverrides ? `; overrides ${JSON.stringify(o.contentOverrides)}` : ""),
    "",
    "Rates in % ± 95% half-width (Wilson), pp. PASS / FAIL only when the whole interval is inside / outside the target;",
    "inconcl. = the interval crosses it (more games needed). Intervals are nominal (not adjusted for adaptive stopping or for many checks).",
    ...(fixedGames(o) ? [] : ["games+ = stopped at the --max-games cap (rounded up to whole batches) before every interval was narrow enough."]),
    cells,
    "",
    "Role parity (docs/roles-v2.md §5): each role's win credit ÷ fair share 1/n, all games; spread = max − min across roles.",
    "The point spread is biased upward by noise, so the verdict uses the 95% range: FAIL only if even the closest the intervals allow is over the limit.",
    "Gated: Balanced at 4–12 players (extension.md Build notes \"Sim\"); Truly random and the role-list setups are reported only.",
    parity,
    "",
    "Roles, every cell pooled: win credit ÷ fair share, where the wins came from (★ roles also win failures), shop tokens per seat.",
    roles,
    "",
    `Checks: ${r.checks.pass} PASS, ${r.checks.fail} FAIL, ${r.checks.inconclusive} inconclusive (PASS/FAIL confirmed by the 95% interval; --strict fails on FAIL).`,
  ];
  if (r.rejections > 0) lines.push(`FAIL: bots sent ${r.rejections} refused commands (should be 0).`);
  return lines.join("\n") + "\n";
}

// ---- compare ----

/**
 * What moved between a baseline report and this one: each rate's change in
 * percentage points, with '*' where it is bigger than the two intervals
 * combined (√(hw₁² + hw₂²), conservative when both runs share seeds), checks
 * that flipped, and parity spreads.
 */
export function compareReports(base: SuiteReport, cur: SuiteReport): string {
  const notes: string[] = [];
  if (base.versions.engine !== cur.versions.engine || base.versions.content !== cur.versions.content) {
    notes.push(`versions: engine ${base.versions.engine} → ${cur.versions.engine}, content ${base.versions.content} → ${cur.versions.content}`);
  }
  const sampling = (o: SuiteOptions) => ({ ciHalfWidth: o.ciHalfWidth, minGames: o.minGames, maxGames: o.maxGames, batch: o.batch });
  if (JSON.stringify(sampling(base.options)) !== JSON.stringify(sampling(cur.options))) {
    const show = (o: SuiteOptions) => `±${(o.ciHalfWidth * 100).toFixed(1)} pp, ${o.minGames}–${o.maxGames} games`;
    notes.push(`sampling differs (baseline ${show(base.options)}, now ${show(cur.options)}): the wider run's intervals decide what counts as a real move`);
  }
  if (base.options.seed !== cur.options.seed) notes.push(`seeds differ ("${base.options.seed}" vs "${cur.options.seed}"): games aren't paired, so small moves are noise`);
  const baseCells = new Map(base.cells.map((c) => [c.key, c]));
  const rateCols = RATES.filter((d) => cur.cells.some((c) => c.rates[d.id] !== undefined));
  const flips: string[] = [];
  const rows: string[][] = [];
  for (const c of cur.cells) {
    const b = baseCells.get(c.key);
    if (!b) {
      notes.push(`${c.key}: not in the baseline`);
      continue;
    }
    rows.push([
      c.key,
      ...rateCols.map((d) => {
        const x = c.rates[d.id];
        const y = b.rates[d.id];
        if (!x || !y || x.rate === null || y.rate === null) return "";
        const delta = (x.rate - y.rate) * 100;
        const noise = Math.hypot(x.halfWidth ?? 0, y.halfWidth ?? 0) * 100;
        const xv = verdictText(x.check);
        const yv = verdictText(y.check);
        if (xv !== yv) flips.push(`${c.key} ${d.label}: ${yv} → ${xv} (${pp(y.rate)}% → ${pp(x.rate)}%)`);
        return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}${Math.abs(delta) > noise ? "*" : " "}`;
      }),
    ]);
  }
  const onlyBase = [...baseCells.keys()].filter((k) => !cur.cells.some((c) => c.key === k));
  if (onlyBase.length > 0) notes.push(`${onlyBase.length} baseline cell${onlyBase.length > 1 ? "s" : ""} not in this run${onlyBase.length <= 5 ? ` (${onlyBase.join(", ")})` : ""}`);
  const baseParity = new Map(base.parity.map((p) => [p.key, p]));
  const parityRows = cur.parity.flatMap((p) => {
    const b = baseParity.get(p.key);
    if (!b || b.spread === null || p.spread === null) return [];
    if (verdictText(b.check) !== verdictText(p.check)) flips.push(`${p.key} parity: ${verdictText(b.check)} → ${verdictText(p.check)} (${b.spread.toFixed(2)} → ${p.spread.toFixed(2)})`);
    return [[p.key, b.spread.toFixed(2), p.spread.toFixed(2), `${p.spread - b.spread >= 0 ? "+" : ""}${(p.spread - b.spread).toFixed(2)}`]];
  });
  return [
    "Compared with the baseline: change in percentage points; * = bigger than both intervals together.",
    ...notes.map((n) => `  note: ${n}`),
    table(["cell", ...rateCols.map((d) => d.label)], rows),
    "",
    table(["parity group", "base", "now", "change"], parityRows),
    "",
    flips.length === 0 ? "No check changed verdict." : `Checks that changed verdict:\n${flips.map((f) => `  ${f}`).join("\n")}`,
  ].join("\n") + "\n";
}
