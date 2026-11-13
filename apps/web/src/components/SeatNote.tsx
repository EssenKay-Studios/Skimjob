// Your private note on one player (design §15.3), shown in the case board's
// Players strip when you tap their seat (§15.4). Saved on the server for your
// seat only; nobody else ever sees it.
import { useState } from "react";
import type { PlayerId } from "@skimjob/engine";
import { NOTE_MAX_CHARS, type BoardChannel } from "../game/notes";
import { Button } from "./Button";
import { Lock } from "./icons";
import { TextField } from "./TextField";

export interface SeatNoteProps {
  readonly person: { readonly id: PlayerId; readonly name: string };
  readonly board: BoardChannel;
  readonly seed: string;
}

export function SeatNote({ person, board, seed }: SeatNoteProps) {
  const note = board.board?.[person.id] ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    const r = await board.save(person.id, draft.trim());
    setBusy(false);
    setProblem(r);
    if (r === null) setEditing(false);
  };
  return (
    <div className="cb__note" role="group" aria-label={`Your note on ${person.name}`}>
      <h3 className="cb__h">
        Your note on {person.name}
        <span className="meta cb__private">
          <span className="cb__lock" aria-hidden="true">
            <Lock />
          </span>
          Only you
        </span>
      </h3>
      {board.board === null ? (
        board.error ? (
          <p className="cb__error" role="alert">
            Couldn't load your notes. {board.error}
          </p>
        ) : (
          <p className="meta">Opening your notes…</p>
        )
      ) : editing ? (
        <div className="cb__note-edit">
          <TextField
            label={`Note on ${person.name}`}
            hideLabel
            seed={`${seed}-field`}
            value={draft}
            placeholder="Said Vault, but the cameras had them in the Office…"
            // Capped in code points, as the server counts (maxLength would count UTF-16 units: 140 emoji).
            onChange={(e) => setDraft([...e.target.value].slice(0, NOTE_MAX_CHARS).join(""))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void save();
              if (e.key === "Escape") {
                // Esc cancels the edit; it doesn't also close the sheet the case board sits in.
                e.preventDefault();
                e.stopPropagation();
                setEditing(false);
              }
            }}
            hint={`${[...draft].length}/${NOTE_MAX_CHARS}`}
          />
          <div className="cb__note-actions">
            <Button variant="secondary" seed={`${seed}-save`} disabled={busy} onClick={() => void save()}>
              Save note
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {note && <p className="cb__note-text">{note}</p>}
          <Button
            variant="ghost"
            className="cb__note-btn"
            onClick={() => {
              setDraft(note);
              setProblem(null);
              setEditing(true);
            }}
          >
            {note ? "Edit note" : "Add note"}
          </Button>
        </>
      )}
      {problem && (
        <p className="cb__error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
