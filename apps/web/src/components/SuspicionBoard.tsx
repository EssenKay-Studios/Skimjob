// The suspicion board (design §12.3, M2-10): your own private tags on every
// other player (trusted / unsure / suspicious) with an optional note. Saved on
// the server for your seat only; nobody else ever sees it.
import { useState } from "react";
import type { PlayerId } from "@skimjob/engine";
import { CrookAvatar } from "../art/Crook";
import { NOTE_MAX_CHARS, SUSPICION_TAGS, TAG_LABELS, type Board, type BoardMark, type SuspicionTag } from "../game/notes";
import { Button } from "./Button";
import { Lock } from "./icons";
import { SketchFrame } from "./SketchFrame";
import { TextField } from "./TextField";
import { Underline } from "./Underline";
import "./casefile.css";

export interface BoardPerson {
  readonly id: PlayerId;
  readonly name: string;
  readonly look: number;
  readonly tag?: string | undefined;
  readonly isBot: boolean;
}

export interface SuspicionBoardProps {
  readonly people: readonly BoardPerson[];
  /** Null while loading. */
  readonly board: Board | null;
  readonly error?: string | null;
  readonly onSave: (subject: PlayerId, mark: BoardMark) => Promise<string | null>;
  readonly seed?: string;
}

const EMPTY: BoardMark = { tag: null, note: "" };

/** A small read-only mark for a tag (the crew seats show it too). */
export function SuspicionMark({ tag }: { tag: SuspicionTag | null | undefined }) {
  if (!tag) return null;
  return <span className={`sus-mark sus-mark--${tag}`}>{TAG_LABELS[tag]}</span>;
}

export function SuspicionBoard({ people, board, error, onSave, seed = "sus" }: SuspicionBoardProps) {
  return (
    <SketchFrame as="section" seed={`${seed}-board`} radius={16} shadow={0.45} className="panel sus" aria-labelledby={`${seed}-h`}>
      <div className="panel__head">
        <h2 id={`${seed}-h`} className="panel__title">
          <Underline seed={`${seed}-u`}>Your suspicion board</Underline>
        </h2>
        <span className="meta sus__private">
          <span className="sus__lock" aria-hidden="true">
            <Lock />
          </span>
          Only you see this
        </span>
      </div>
      {error && !board && (
        <p className="sus__error" role="alert">
          Couldn't load your board. {error}
        </p>
      )}
      {!board && !error && <p className="meta">Opening your notes…</p>}
      {board && people.length === 0 && <p className="meta">Nobody else to suspect.</p>}
      {board && (
        <ul className="sus__list">
          {people.map((p) => (
            <SuspicionRow key={p.id} person={p} mark={board[p.id] ?? EMPTY} onSave={onSave} seed={`${seed}-${p.id}`} />
          ))}
        </ul>
      )}
    </SketchFrame>
  );
}

function SuspicionRow({ person, mark, onSave, seed }: { person: BoardPerson; mark: BoardMark; onSave: SuspicionBoardProps["onSave"]; seed: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(mark.note);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (next: BoardMark) => {
    setBusy(true);
    const r = await onSave(person.id, next);
    setBusy(false);
    setProblem(r);
    return r === null;
  };
  const pick = (tag: SuspicionTag) => void save({ tag: mark.tag === tag ? null : tag, note: mark.note });
  const saveNote = async () => {
    if (await save({ tag: mark.tag, note: draft.trim() })) setEditing(false);
  };
  return (
    <li className={mark.tag ? `sus-row is-${mark.tag}` : "sus-row"}>
      <div className="sus-row__who">
        <CrookAvatar name={person.name} look={person.look} tag={person.tag} size={40} bot={person.isBot} expression={mark.tag === "suspicious" ? "nervous" : "neutral"} />
        <span className="sus-row__name">{person.name}</span>
      </div>
      <div className="sus-row__tags" role="group" aria-label={`Your tag for ${person.name}`}>
        {SUSPICION_TAGS.map((t) => (
          <Button key={t} variant="toggle" seed={`${seed}-${t}`} className={`sus-tag sus-tag--${t}`} pressed={mark.tag === t} disabled={busy} onClick={() => pick(t)}>
            {TAG_LABELS[t]}
          </Button>
        ))}
        <Button
          variant="ghost"
          className="sus-row__note-btn"
          aria-expanded={editing}
          onClick={() => {
            setDraft(mark.note);
            setEditing((e) => !e);
          }}
        >
          {mark.note ? "Edit note" : "Add note"}
        </Button>
      </div>
      {mark.note && !editing && <p className="sus-row__note">{mark.note}</p>}
      {editing && (
        <div className="sus-row__edit">
          <TextField
            label={`Note on ${person.name}`}
            hideLabel
            seed={`${seed}-note`}
            value={draft}
            maxLength={NOTE_MAX_CHARS}
            placeholder="Said Vault, but the cameras had them in the Office…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveNote();
              if (e.key === "Escape") setEditing(false);
            }}
            hint={`${[...draft].length}/${NOTE_MAX_CHARS}`}
          />
          <div className="sus-row__actions">
            <Button variant="secondary" seed={`${seed}-save`} disabled={busy} onClick={() => void saveNote()}>
              Save note
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {problem && (
        <p className="sus__error" role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}
