// /dev/gallery sections: the "While you were away" recap with its raccoon
// narrator, and the case board with the Players strip's private note
// (design §15.3, §15.4), on a small hand-made view (no server).
import { useState, type ReactNode } from "react";
import { RaccoonNarrator } from "../art/Raccoon";
import { AwayRecap } from "../components/AwayRecap";
import { Button } from "../components/Button";
import { BottomSheet } from "../components/BottomSheet";
import { CaseBoard } from "../components/CaseBoard";
import { SeatNote } from "../components/SeatNote";
import { SketchFrame } from "../components/SketchFrame";
import { Underline } from "../components/Underline";
import { togglePin } from "../game/caseBoard";
import { FIXTURE } from "../game/caseBoard.fixture";
import { NO_LEADS } from "../game/caseBoard";
import type { Board, BoardChannel, PinsChannel } from "../game/notes";

const people = [
  { id: "p2", name: "Ben", look: 1, isBot: false },
  { id: "p3", name: "Cy", look: 2, isBot: false },
  { id: "p4", name: "DotB", look: 3, isBot: true },
];

/** Notes kept in the page (no server); an empty note clears it, as on the server. */
function useDemoBoard(): BoardChannel {
  const [board, setBoard] = useState<Board>({ p2: "Said Lobby, but I saw them in the Vault." });
  const save = async (subject: string, note: string) => {
    setBoard((b) => {
      const next = { ...b };
      if (note === "") delete next[subject];
      else next[subject] = note;
      return next;
    });
    return null;
  };
  return { board, error: null, save };
}

/** The case board with pins and notes kept in the page (no server): a fixture adapter's data. */
export function CaseBoardDemo({ empty = false, seed = "g-case" }: { empty?: boolean; seed?: string }) {
  const [list, setList] = useState<readonly string[]>(["fact:r4.vault.saw"]);
  const pins: PinsChannel = { pins: new Set(list), ready: true, error: null, toggle: (id) => setList((l) => togglePin(l, id)) };
  return <CaseBoard seed={seed} data={empty ? NO_LEADS : FIXTURE} people={people} pins={pins} board={useDemoBoard()} />;
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

export function CaseSections() {
  const [away, setAway] = useState(true);
  const [sheet, setSheet] = useState(false);
  const board = useDemoBoard();
  return (
    <>
      <Section id="away" title="While you were away" note="M2-10 · §13 recap as feed chirps, raccoon narrator">
        {away ? (
          <AwayRecap
            seed="g-away"
            lines={["Rounds 1–2: 21 taken, 7 coins went missing, 51 coins left in the bank.", "Only you: Round 1: in the Vault, you saw Ben.", "Now: round 3. Pick your room before the deadline."]}
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
      <Section id="caseboard" title="Case board" note="S3b.5 · §15.4 suspect card, Players strip (tap a seat for its leads and your note), Pinned, Leads; fixture adapter, pins and notes kept in the page">
        <CaseBoardDemo />
        <Button variant="secondary" seed="g-case-sheet-open" onClick={() => setSheet(true)}>
          Open as a phone sheet
        </Button>
        <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Case board" seed="g-case-sheet">
          <CaseBoardDemo seed="g-case-in-sheet" />
        </BottomSheet>
        <CaseBoardDemo empty seed="g-case-empty" />
      </Section>
      <Section id="seat-note" title="Your note on a seat" note="§15.3 the Players strip's private note: with a note, without one, loading and unreachable">
        <SeatNote seed="g-note-ben" person={people[0]!} board={board} />
        <SeatNote seed="g-note-cy" person={people[1]!} board={board} />
        <SeatNote seed="g-note-load" person={people[1]!} board={{ board: null, error: null, save: board.save }} />
        <SeatNote seed="g-note-err" person={people[1]!} board={{ board: null, error: "Can't reach the hideout.", save: board.save }} />
      </Section>
    </>
  );
}
