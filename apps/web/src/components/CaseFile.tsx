// The ledger and case file as one manila sheet (M2-10; ui-style "Ledger / case
// file"): public rows on dashed rules, private rows on a clay highlighter with
// a lock, grouped under paper-clipped round cards, filterable by source, act
// and round. Every line comes from describeEvent; nothing here knows roles.
// design §13
import { memo, useMemo, useState } from "react";
import type { PlayerView } from "@skimjob/engine";
import { EmptyFileSpot } from "../art/Spots";
import { describeEvent, type DescribeContext } from "../game/describeEvent";
import { ALL_RECORDS, filterChoices, filterRows, groupByRound, recordRows, roundLabel, type RecordFilter, type RecordSource } from "../game/records";
import { Button } from "./Button";
import { Lock } from "./icons";
import { stretchName } from "../game/wording";
import { SketchFrame } from "./SketchFrame";
import "./casefile.css";

const SOURCES: readonly { value: RecordSource; label: string; list: string; note: string }[] = [
  { value: "ledger", label: "Ledger", list: "Ledger", note: "What everyone sees." },
  { value: "case", label: "Case file", list: "Case file", note: "Only you see these." },
  { value: "all", label: "Both", list: "Ledger and case file", note: "The public ledger with your private notes (highlighted)." },
];

/** The ledger tab first, as before M2-10. */
const START: RecordFilter = { ...ALL_RECORDS, source: "ledger" };

export interface CaseFileProps {
  readonly view: Pick<PlayerView, "ledger" | "caseFile">;
  readonly ctx: DescribeContext;
  /** Starting filter (the gallery shows a few). */
  readonly initial?: RecordFilter;
  readonly seed?: string;
}

/**
 * Re-renders only when an entry is added (or the context changes): views
 * arrive many times a round, and the sheet is the biggest part of the screen.
 */
export const CaseFile = memo(
  CaseFileSheet,
  (a, b) =>
    a.view.ledger.length === b.view.ledger.length &&
    a.view.caseFile.length === b.view.caseFile.length &&
    a.ctx.me === b.ctx.me &&
    a.seed === b.seed,
);

function CaseFileSheet({ view, ctx, initial = START, seed = "records" }: CaseFileProps) {
  const [filter, setFilter] = useState<RecordFilter>(initial);
  const rows = useMemo(() => recordRows(view), [view]);
  const choices = useMemo(() => filterChoices(rows, filter.act), [rows, filter.act]);
  const shown = useMemo(() => groupByRound(filterRows(rows, filter)), [rows, filter]);
  const counts = { all: rows.length, ledger: view.ledger.length, case: view.caseFile.length };
  const source = SOURCES.find((s) => s.value === filter.source)!;
  const set = (patch: Partial<RecordFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const empty = shown.length === 0;
  return (
    <SketchFrame as="section" seed={`${seed}-sheet`} radius={18} shadow={0.5} fill="var(--manilla)" holes className="records" aria-label="Ledger and case file">
      <span className="records__folder-tab" aria-hidden="true">
        Case file
      </span>
      <div className="records__tabs" role="group" aria-label="Show">
        {SOURCES.map((s) => (
          <Button key={s.value} variant="toggle" seed={`${seed}-tab-${s.value}`} pressed={filter.source === s.value} onClick={() => set({ source: s.value })}>
            {s.label} <span className="num">{counts[s.value]}</span>
          </Button>
        ))}
      </div>
      <p className="meta records__note">{source.note}</p>
      {choices.acts.length > 0 && (
        <div className="records__filters">
          <div className="records__chips" role="group" aria-label="Rounds">
            <Button variant="toggle" seed={`${seed}-act-all`} pressed={filter.act === null} onClick={() => set({ act: null, round: null })}>
              Whole job
            </Button>
            {choices.acts.map((a) => (
              <Button key={a} variant="toggle" seed={`${seed}-act-${a}`} pressed={filter.act === a} onClick={() => set({ act: a, round: null })}>
                {stretchName(a)}
              </Button>
            ))}
          </div>
          <div className="records__chips" role="group" aria-label="Round">
            <Button variant="toggle" seed={`${seed}-round-all`} pressed={filter.round === null} onClick={() => set({ round: null })}>
              All rounds
            </Button>
            {choices.rounds.map((r) => (
              <Button key={r} variant="toggle" seed={`${seed}-round-${r}`} pressed={filter.round === r} onClick={() => set({ round: r })} aria-label={`Round ${r}`}>
                R{r}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="records__scroll" role="list" aria-label={source.list}>
        {shown.map((g, i) => (
          <section key={g.round} className="records__round" role="listitem" aria-label={roundLabel(g)}>
            <h3 className={i % 2 ? "records__card is-right" : "records__card"}>
              <span className="records__clip" aria-hidden="true" />
              {roundLabel(g)}
            </h3>
            <ol className="records__list">
              {g.rows.map(({ seq, event, private: priv }) => (
                <li key={seq} className={priv ? "records__row is-private" : "records__row"}>
                  {priv && (
                    <span className="records__lock" aria-label="Only you" role="img">
                      <Lock />
                    </span>
                  )}
                  <span>{describeEvent(event, ctx)}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
        {empty && (
          <p className="records__row meta" role="listitem">
            {counts[filter.source] === 0 ? "Nothing yet." : "Nothing here for this filter."}
          </p>
        )}
        {empty && filter.source === "case" && <EmptyFileSpot className="records__spot" />}
      </div>
    </SketchFrame>
  );
}
