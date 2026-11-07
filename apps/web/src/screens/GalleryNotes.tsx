// /dev/gallery sections for M2-10: the ledger / case file sheet, the "While
// you were away" recap with its raccoon narrator, and the suspicion board, on
// a small hand-made view (no server).
import { useState, type ReactNode } from "react";
import { RaccoonNarrator } from "../art/Raccoon";
import { AwayRecap } from "../components/AwayRecap";
import { Button } from "../components/Button";
import { BottomSheet } from "../components/BottomSheet";
import { CaseBoard } from "../components/CaseBoard";
import { SketchFrame } from "../components/SketchFrame";
import { SuspicionBoard, SuspicionMark } from "../components/SuspicionBoard";
import { Underline } from "../components/Underline";
import { togglePin } from "../game/caseBoard";
import { FIXTURE } from "../game/caseBoard.fixture";
import { NO_LEADS } from "../game/caseBoard";
import type { Board, BoardMark, PinsChannel } from "../game/notes";

const people = [
  { id: "p2", name: "Ben", look: 1, isBot: false },
  { id: "p3", name: "Cy", look: 2, isBot: false },
  { id: "p4", name: "Bot · Dot", look: 3, isBot: true },
];

/** The case board with pins kept in the page (no server): a fixture adapter's data. */
export function CaseBoardDemo({ empty = false, seed = "g-case" }: { empty?: boolean; seed?: string }) {
  const [list, setList] = useState<readonly string[]>(["fact:r4.vault.saw"]);
  const pins: PinsChannel = { pins: new Set(list), ready: true, error: null, toggle: (id) => setList((l) => togglePin(l, id)) };
  return <CaseBoard seed={seed} data={empty ? NO_LEADS : FIXTURE} people={people} pins={pins} marks={{ p2: { tag: "suspicious", note: "" } }} />;
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <SketchFrame as="section" seed={`g-${id}`} radius={16} shadow={0.5} className="g-section" aria-labelledby={`g-${id}`}>
      <header className="g-section__head">
        <h3 id={`g-${id}`}>
          <Underline seed={id}>{title}</Underline>
        </h3>
        {note && <p className="meta">{note}</p>}
      </header>
      {children}
    </SketchFrame>
  );
}

export function NotesSections() {
  const [board, setBoard] = useState<Board>({ p2: { tag: "suspicious", note: "Said Lobby, but I saw them in the Vault." }, p4: { tag: "trusted", note: "" } });
  const [away, setAway] = useState(true);
  const [sheet, setSheet] = useState(false);
  const save = async (subject: string, mark: BoardMark) => {
    setBoard((b) => {
      const next = { ...b };
      if (mark.tag === null && mark.note === "") delete next[subject];
      else next[subject] = mark;
      return next;
    });
    return null;
  };
  return (
    <>
      <Section id="away" title="While you were away" note="M2-10 · §13 recap as feed chirps, raccoon narrator">
        {away ? (
          <AwayRecap
            seed="g-away"
            lines={["Rounds 1–2 done: 21 taken, 7 went missing, 51 coins left in the bank.", "Only you: Round 1: in the Vault, you saw Ben.", "Now: round 3. Pick your room before the deadline."]}
            onDismiss={() => setAway(false)}
          />
        ) : (
          <Button variant="secondary" seed="g-away-again" onClick={() => setAway(true)}>
            Show the recap again
          </Button>
        )}
        <div className="g-row">
          <RaccoonNarrator size={48} />
          <RaccoonNarrator size={72} />
        </div>
      </Section>
      <Section id="caseboard" title="Case board" note="S3b.5 · §15.4 suspect card, Players strip, Pinned, Leads; fixture adapter, pins kept in the page">
        <CaseBoardDemo />
        <Button variant="secondary" seed="g-case-sheet-open" onClick={() => setSheet(true)}>
          Open as a phone sheet
        </Button>
        <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Case board" seed="g-case-sheet">
          <CaseBoardDemo seed="g-case-in-sheet" />
        </BottomSheet>
        <CaseBoardDemo empty seed="g-case-empty" />
      </Section>
      <Section id="suspicion" title="Suspicion board" note="M2-10 · §12.3 private tags and notes; seat marks">
        <SuspicionBoard seed="g-sus" people={people} board={board} onSave={save} />
        <div className="g-row">
          <SuspicionMark tag="trusted" />
          <SuspicionMark tag="unsure" />
          <SuspicionMark tag="suspicious" />
        </div>
        <SuspicionBoard seed="g-sus-load" people={people} board={null} error="Can't reach the hideout." onSave={save} />
      </Section>
    </>
  );
}
