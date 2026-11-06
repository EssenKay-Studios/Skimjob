// QA (PR #51): the split parity gate and the success band fail when they
// should, call a result within noise inconclusive, and pass inside the bounds.
// extension.md Build notes "Sim", docs/balance/r6-balance.md, design §17.4
import { describe, expect, it } from "vitest";
import { buildMatrix, type SuiteOptions } from "./matrix";
import { parseSuiteArgs } from "./args";
import { buildReport, compareReports, formatSuiteReport, splitParityOf, stringifyJson, verdictText } from "./report";
import type { CellResult } from "./run";
import { emptyTally, type SeatTally } from "./tally";
import { STAR_BAND, TEAM_PARITY_MAX_SPREAD } from "./targets";
import { checkReport } from "./validate";

const n = 5;
/** `s` seats of a role at crew size 5 winning `share` of them: ratio = share × 5. */
const seats = (s: number, share: number): SeatTally => ({ seats: s, credit: s * share, fair: s / n, successCredit: 0, earned: 0, spent: 0 });
const BIG = 40000;
const team = { auditor: seats(BIG, 0.15), fixer: seats(BIG, 0.15) }; // pooled ratio 0.75
const starOf = (roles: Record<string, SeatTally>, role: string) => splitParityOf(roles).stars.find((x) => x.role === role);

describe("QA #51: team-role spread gate — TEAM_PARITY_MAX_SPREAD", { timeout: 10_000 }, () => {
  it("is 0.20 and the ★ band 0.9–1.8 (PM provisional)", () => {
    expect(TEAM_PARITY_MAX_SPREAD).toBe(0.2);
    expect(STAR_BAND).toEqual({ lo: 0.9, hi: 1.8 });
  });

  it("FAILs a team spread of 0.25 (confirmed with many seats, inconclusive with few)", () => {
    const sure = splitParityOf({ auditor: seats(BIG, 0.12), fixer: seats(BIG, 0.17) }).team;
    expect(sure.spread).toBe(0.25);
    expect(sure.check).toEqual({ verdict: "fail", sure: true });
    const noisy = splitParityOf({ auditor: seats(150, 0.12), fixer: seats(150, 0.17) }).team;
    expect(noisy.check).toEqual({ verdict: "fail", sure: false });
  });

  it("passes exactly 0.20 (inclusive) and a tight 0.10", () => {
    expect(splitParityOf({ auditor: seats(BIG, 0.12), fixer: seats(BIG, 0.16) }).team.check).toEqual({ verdict: "pass", sure: false });
    expect(splitParityOf({ auditor: seats(BIG, 0.14), fixer: seats(BIG, 0.16) }).team.check).toEqual({ verdict: "pass", sure: true });
  });

  it("★ roles never enter the team spread, however far off they are", () => {
    const t = splitParityOf({ ...team, mole: seats(BIG, 0.01) }).team;
    expect(t.spread).toBe(0);
    expect(t.average?.ratio).toBe(0.75);
  });
});

describe("QA #51: ★ band — STAR_BAND 0.9–1.8 × the team average", { timeout: 10_000 }, () => {
  it("FAILs a ★ role at 0.8× and at 2.0× (confirmed)", () => {
    expect(starOf({ ...team, mole: seats(BIG, 0.12) }, "mole")).toMatchObject({ relative: 0.8, check: { verdict: "fail", sure: true } });
    expect(starOf({ ...team, mole: seats(BIG, 0.3) }, "mole")).toMatchObject({ relative: 2, check: { verdict: "fail", sure: true } });
  });

  it("passes inside the band, and exactly at 0.9 and 1.8 (inclusive, inconclusive)", () => {
    expect(starOf({ ...team, mole: seats(BIG, 0.2) }, "mole")).toMatchObject({ relative: 1.333, check: { verdict: "pass", sure: true } });
    expect(starOf({ ...team, mole: seats(BIG, 0.27) }, "mole")).toMatchObject({ relative: 1.8, check: { verdict: "pass", sure: false } });
    expect(starOf({ ...team, mole: seats(BIG, 0.135) }, "mole")).toMatchObject({ relative: 0.9, check: { verdict: "pass", sure: false } });
  });

  it("a 2.0× ★ role with few seats is a FAIL within noise, not confirmed; under 100 seats it is left out", () => {
    expect(starOf({ ...team, mole: seats(200, 0.3) }, "mole")?.check).toEqual({ verdict: "fail", sure: false });
    expect(starOf({ ...team, mole: seats(99, 0.3) }, "mole")).toBeUndefined();
  });

  it("the ★ range divides by the team-average interval (★ lo ÷ team hi … ★ hi ÷ team lo)", () => {
    const thinTeam = { auditor: seats(300, 0.15), fixer: seats(300, 0.15) };
    const x = starOf({ ...thinTeam, mole: seats(BIG, 0.25) }, "mole");
    // The ★ role is measured tightly; the noisy team average alone widens its range past the band.
    expect(x?.relative).toBeCloseTo(1.667, 3);
    expect(x?.check).toEqual({ verdict: "pass", sure: false });
    expect((x?.hi ?? 0) - (x?.lo ?? 0)).toBeGreaterThan(0.5);
  });
});

const opts = (over: Partial<SuiteOptions>): SuiteOptions => {
  const r = parseSuiteArgs([]);
  if (r.kind !== "run") throw new Error("defaults should parse");
  return { ...r.options, ...over };
};
const versions = { engine: "e", content: "c" };
const o = opts({ playerCounts: [3, 5], setups: ["balanced"], events: [true] });
const cell = (key: string, games: number, successes: number, roles: Record<string, SeatTally> = {}): CellResult => {
  const c = buildMatrix(o).find((x) => x.key === key);
  if (!c) throw new Error(`no cell ${key}`);
  return { ...c, batches: 1, converged: true, tally: { ...emptyTally(), games, successes, failures: games - successes, roles } };
};

describe("QA #51: success band 55–70% and the report's check counts", { timeout: 10_000 }, () => {
  const success = (games: number, wins: number) => buildReport(o, versions, [cell("5p/balanced/events-on", games, wins)]).cells[0]?.rates.success?.check;

  it("FAILs 54% and 71% when the interval confirms; within noise they are inconclusive", () => {
    expect(success(20000, 10800)).toEqual({ verdict: "fail", sure: true });
    expect(success(20000, 14200)).toEqual({ verdict: "fail", sure: true });
    expect(success(1000, 540)).toEqual({ verdict: "fail", sure: false });
    expect(success(1000, 710)).toEqual({ verdict: "fail", sure: false });
    expect(success(20000, 12400)).toEqual({ verdict: "pass", sure: true });
  });

  it("a confirmed ★ or team FAIL counts towards --strict in a gated group; an ungated group (3p) only reports it", () => {
    const bad = { ...team, mole: seats(BIG, 0.4), smoothTalker: seats(BIG, 0.2) };
    const good = { ...team, mole: seats(BIG, 0.2) };
    const ok = buildReport(o, versions, [cell("5p/balanced/events-on", 20000, 12400, good)]);
    const r = buildReport(o, versions, [cell("5p/balanced/events-on", 20000, 12400, bad), cell("3p/balanced/events-on", 20000, 12400, bad)]);
    const g5 = r.parity.find((p) => p.key.startsWith("5p"));
    const g3 = r.parity.find((p) => p.key.startsWith("3p"));
    expect(g5?.team.check).toEqual({ verdict: "fail", sure: true }); // smooth talker 1.0 vs 0.75
    expect(g5?.stars.map((x) => verdictText(x.check))).toEqual(expect.arrayContaining(["FAIL"]));
    expect(g3?.team.check.verdict).toBe("n/a");
    expect(g3?.stars.every((x) => x.check.verdict === "n/a")).toBe(true);
    // team + mole = 2 more confirmed FAILs than the clean report; the all-role spread is report-only.
    expect(ok.parity[0]?.check.verdict).toBe("fail"); // all-role spread 0.25 > 0.10, but not counted
    // Same rates in both (the fake tallies' Heat share FAILs either way), so the difference is the parity checks.
    expect(r.checks.fail - ok.checks.fail).toBe(2);
    expect(formatSuiteReport(r)).toMatch(/5p\/balanced\s+mole\s+2\.40\s+\S+\s+FAIL/);
  });

  it("compares against a pre-split baseline (no team / stars) and flags a ★ verdict flip against a new one", () => {
    const good = { ...team, mole: seats(BIG, 0.2) };
    const before = JSON.parse(stringifyJson(buildReport(o, versions, [cell("5p/balanced/events-on", 20000, 12400, good)])));
    const old = { ...before, parity: before.parity.map(({ team: _t, stars: _s, ...p }: Record<string, unknown>) => p) };
    expect(typeof checkReport(old)).toBe("object");
    const now = buildReport(o, versions, [cell("5p/balanced/events-on", 20000, 12400, { ...team, mole: seats(BIG, 0.3) })]);
    expect(() => compareReports(old, now)).not.toThrow();
    expect(compareReports(before, now)).toMatch(/mole ★ band: PASS → FAIL/);
    expect(checkReport({ ...before, parity: [{ ...before.parity[0], team: { spread: "x" } }] })).toMatch(/team isn't/);
    expect(checkReport({ ...before, parity: [{ ...before.parity[0], stars: [{ role: "mole" }] }] })).toMatch(/stars isn't/);
  });
});
