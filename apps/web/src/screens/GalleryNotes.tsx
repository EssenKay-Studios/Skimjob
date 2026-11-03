// /dev/gallery sections for M2-10: the ledger / case file sheet, the "While
// you were away" recap with its raccoon narrator, and the suspicion board, on
// a small hand-made view (no server).
import { useState, type ReactNode } from "react";
import { PUBLIC, privateTo, type CaseFileEvent, type LoggedEvent, type PlayerView, type PublicEvent } from "@skimjob/engine";
import { RaccoonNarrator } from "../art/Raccoon";
import { AwayRecap } from "../components/AwayRecap";
import { Button } from "../components/Button";
import { CaseFile } from "../components/CaseFile";
import { SketchFrame } from "../components/SketchFrame";
import { SuspicionBoard, SuspicionMark } from "../components/SuspicionBoard";
import { Underline } from "../components/Underline";
import type { Board, BoardMark } from "../game/notes";

const NAMES: Record<string, string> = { p1: "Ana", p2: "Ben", p3: "Cy", p4: "Bot · Dot" };
const ctx = { me: "p1", name: (p: string) => NAMES[p] ?? p };

const events: (PublicEvent | CaseFileEvent)[] = [
  { type: "roleDealt", visibility: privateTo("p1"), player: "p1", role: "rookie" },
  { type: "roundStarted", visibility: PUBLIC, round: 1, act: 1 },
  { type: "moveLocked", visibility: PUBLIC, player: "p2", round: 1 },
  { type: "moveSubmitted", visibility: privateTo("p1"), player: "p1", round: 1, move: { room: "vault", pocket: 2 } },
  { type: "lootSplit", visibility: privateTo("p1"), player: "p1", round: 1, room: "vault", loot: 6, toHaul: 4, toStash: 2 },
  { type: "roomSighting", visibility: privateTo("p1"), player: "p1", round: 1, room: "vault", others: ["p2"] },
  { type: "roundResolved", visibility: PUBLIC, round: 1, haulDelta: 9, haul: 9, heatDelta: 12, heat: 12, heatParts: { base: 12, rooms: {}, events: 0 } },
  { type: "alibiPosted", visibility: PUBLIC, player: "p2", round: 1, room: "lobby" },
  { type: "roundStarted", visibility: PUBLIC, round: 2, act: 1 },
  { type: "roundResolved", visibility: PUBLIC, round: 2, haulDelta: 5, haul: 14, heatDelta: 8, heat: 20, heatParts: { base: 8, rooms: {}, events: 0 } },
  { type: "checkpointChecked", visibility: PUBLIC, act: 1, target: 12, haul: 14, met: true, heatPenalty: 0 },
];
let ledger: LoggedEvent<PublicEvent>[] = [];
let caseFile: LoggedEvent<CaseFileEvent>[] = [];
events.forEach((event, seq) => {
  if (event.visibility.kind === "public") ledger = [...ledger, { seq, event: event as PublicEvent }];
  else caseFile = [...caseFile, { seq, event: event as CaseFileEvent }];
});
const sampleView: Pick<PlayerView, "ledger" | "caseFile"> = { ledger, caseFile };

const people = [
  { id: "p2", name: "Ben", look: 1, isBot: false },
  { id: "p3", name: "Cy", look: 2, isBot: false },
  { id: "p4", name: "Bot · Dot", look: 3, isBot: true },
];

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
            lines={["Rounds 1–2 done: Haul +14 (now 14), Heat +20 (now 20).", "Meeting 1 target: Haul 14, target 12, made it.", "Only you: Round 1: in the Vault, you saw Ben.", "Now: round 3. Pick your room before the deadline."]}
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
      <Section id="casefile" title="Ledger and case file" note="M2-10 · manila sheet, round cards, private rows, act / round filters">
        <CaseFile view={sampleView} ctx={ctx} seed="g-records" initial={{ source: "all", act: null, round: null }} />
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
