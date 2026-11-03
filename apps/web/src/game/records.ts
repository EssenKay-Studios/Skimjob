// The ledger and case file as one sheet (M2-10): every entry in the player's
// own view, tagged with the round and act it happened in, filterable by
// source, act and round, and grouped by round. Pure, and generic over events:
// it never looks inside an event except `roundStarted` (public) for the round
// and act. design §13; docs/m2-plan.md M2-10
import type { GameEvent, LoggedEvent, PlayerView } from "@skimjob/engine";

export interface RecordRow {
  readonly seq: number;
  readonly event: GameEvent;
  /** From the case file (only you see it), not the public ledger. */
  readonly private: boolean;
  /** The round it happened in (0: before round 1, the setup). Meetings after a round count in that round. */
  readonly round: number;
  /** The act of that round (0 for the setup). */
  readonly act: number;
}

export type RecordSource = "all" | "ledger" | "case";

export interface RecordFilter {
  readonly source: RecordSource;
  /** An act, or null for every act. */
  readonly act: number | null;
  /** A round, or null for every round (of the act, if one is set). */
  readonly round: number | null;
}

export const ALL_RECORDS: RecordFilter = { source: "all", act: null, round: null };

/** Every entry in the view, oldest first, with its round and act. */
export function recordRows(view: Pick<PlayerView, "ledger" | "caseFile">): RecordRow[] {
  const merged: (LoggedEvent & { private: boolean })[] = [
    ...view.ledger.map((e) => ({ ...e, private: false })),
    ...view.caseFile.map((e) => ({ ...e, private: true })),
  ].sort((a, b) => a.seq - b.seq);
  let round = 0;
  let act = 0;
  return merged.map(({ seq, event, private: priv }) => {
    if (event.type === "roundStarted") {
      round = event.round;
      act = event.act;
    }
    return { seq, event, private: priv, round, act };
  });
}

export function filterRows(rows: readonly RecordRow[], f: RecordFilter): RecordRow[] {
  return rows.filter(
    (r) => (f.source === "all" || (f.source === "case") === r.private) && (f.act === null || r.act === f.act) && (f.round === null || r.round === f.round),
  );
}

export interface RoundGroup {
  readonly round: number;
  readonly act: number;
  /** Newest first. */
  readonly rows: readonly RecordRow[];
}

/** Rows grouped by round, newest round first and newest entry first in each. */
export function groupByRound(rows: readonly RecordRow[]): RoundGroup[] {
  const groups = new Map<number, { round: number; act: number; rows: RecordRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.round) ?? { round: r.round, act: r.act, rows: [] };
    g.rows.push(r);
    groups.set(r.round, g);
  }
  return [...groups.values()].sort((a, b) => b.round - a.round).map((g) => ({ ...g, rows: [...g.rows].reverse() }));
}

/** The acts and rounds that have entries (for the filter chips), ascending. Rounds only of `act` if given. */
export function filterChoices(rows: readonly RecordRow[], act: number | null): { acts: number[]; rounds: number[] } {
  const acts = [...new Set(rows.filter((r) => r.act > 0).map((r) => r.act))].sort((a, b) => a - b);
  const rounds = [...new Set(rows.filter((r) => r.round > 0 && (act === null || r.act === act)).map((r) => r.round))].sort((a, b) => a - b);
  return { acts, rounds };
}

/** A round group's heading. */
export const roundLabel = (g: Pick<RoundGroup, "round" | "act">) => (g.round === 0 ? "Before the job" : `Round ${g.round}`);
