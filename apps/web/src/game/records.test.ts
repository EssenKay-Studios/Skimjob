// The ledger and case file sheet (M2-10): rounds and acts from the view's own
// entries, filters, grouping. design §13
import { createGame, handleCommand, viewFor, type GameConfig, type GameState, type PlayerCommand, type SystemCommand } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { ALL_RECORDS, filterChoices, filterRows, groupByRound, recordRows, roundLabel } from "./records";

const config: GameConfig = {
  seed: "records-test",
  players: ["Ana", "Ben", "Cy"].map((name, i) => ({ id: `p${i + 1}`, name, isBot: false })),
  job: "bank",
  rolePool: ["rookie"],
  mole: "off",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  starterMode: true,
  uniqueRoles: false,
};
function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
function playActOne(): GameState {
  let s = createGame(config);
  while (s.phase.kind === "planning" || s.phase.kind === "alibis") {
    const p = s.phase;
    if (p.kind === "alibis") s = run(s, { type: "advance", deadline: { kind: "alibis", round: p.round } });
    else s = run(s, ...["p1", "p2", "p3"].map((player) => ({ type: "submitMove", player, move: { room: "office", pocket: 0 } }) as PlayerCommand), { type: "advance", deadline: { kind: "round", round: p.round } });
  }
  return run(s, { type: "scheduleMeeting", act: 1, slot: "a1" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } }, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "act-1" } });
}

describe("ledger and case file rows (design §13)", () => {
  const view = viewFor(playActOne(), "p1");
  const rows = recordRows(view);

  it("holds every entry of the view once, oldest first, public and private apart", () => {
    expect(rows.map((r) => r.seq)).toEqual([...view.ledger, ...view.caseFile].map((e) => e.seq).sort((a, b) => a - b));
    expect(rows.filter((r) => r.private).map((r) => r.seq)).toEqual(view.caseFile.map((e) => e.seq));
  });

  it("puts each entry in its round and act; setup is round 0; the act meeting stays in its last round", () => {
    expect(rows.find((r) => r.event.type === "roleDealt")).toMatchObject({ round: 0, act: 0 });
    for (const r of rows) if ("round" in r.event && r.event.type !== "roundStarted" && typeof r.event.round === "number") expect(r.round).toBe(r.event.round);
    expect(rows.find((r) => r.event.type === "checkpointChecked")).toMatchObject({ round: 3, act: 1 });
    expect(rows.at(-1)!.round).toBe(4); // round 4 began after the checkpoint
  });

  it("filters by source, act and round", () => {
    expect(filterRows(rows, ALL_RECORDS)).toHaveLength(rows.length);
    expect(filterRows(rows, { ...ALL_RECORDS, source: "case" }).every((r) => r.private)).toBe(true);
    expect(filterRows(rows, { ...ALL_RECORDS, source: "ledger" }).some((r) => r.private)).toBe(false);
    expect(new Set(filterRows(rows, { ...ALL_RECORDS, act: 1 }).map((r) => r.round))).toEqual(new Set([1, 2, 3]));
    expect(filterRows(rows, { source: "case", act: 1, round: 2 }).every((r) => r.round === 2 && r.private)).toBe(true);
    expect(filterRows(rows, { ...ALL_RECORDS, act: 3 })).toEqual([]);
  });

  it("groups newest round first, newest entry first, and offers only acts and rounds that have entries", () => {
    const groups = groupByRound(rows);
    expect(groups.map((g) => g.round)).toEqual([4, 3, 2, 1, 0]);
    for (const g of groups) expect(g.rows.map((r) => r.seq)).toEqual([...g.rows].map((r) => r.seq).sort((a, b) => b - a));
    expect(filterChoices(rows, null)).toEqual({ acts: [1, 2], rounds: [1, 2, 3, 4] });
    expect(filterChoices(rows, 1).rounds).toEqual([1, 2, 3]);
    expect(roundLabel(groups[0]!)).toBe("Round 4");
    expect(roundLabel(groups.at(-1)!)).toBe("Before the job");
  });
});
