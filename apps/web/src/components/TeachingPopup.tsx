// The teaching pop-up (design §15.6, §20.6): "What just happened / What it
// means / What you can do", one lesson at a time. A native modal dialog, so
// focus moves into it and goes back to where it was; the text is from content.
import { LESSONS, type LessonId } from "@skimjob/content";
import type { PlayerView } from "@skimjob/engine";
import { useState } from "react";
import { dueLesson, loadSeen, saveSeen } from "../game/teaching";
import { Button } from "./Button";
import { DialogSheet } from "./MeetingKit";
import "./teaching.css";

/** Stays mounted while closed, so the browser can hand focus back to where it was. */
export function TeachingPopup({ lesson, busy, onGotIt, onTipsOff }: { lesson: LessonId | null; busy: boolean; onGotIt: () => void; onTipsOff: () => void }) {
  return (
    <DialogSheet open={lesson !== null} onClose={onGotIt} seed="teaching" labelledBy="teaching-h">
      {lesson && (
        <div className="teaching">
          <p className="meta">Tip</p>
          <h2 id="teaching-h">{LESSONS[lesson].title}</h2>
          <dl className="teaching__rows">
            <dt>What just happened</dt>
            <dd>{LESSONS[lesson].happened}</dd>
            <dt>What it means</dt>
            <dd>{LESSONS[lesson].means}</dd>
            <dt>What you can do</dt>
            <dd>{LESSONS[lesson].canDo}</dd>
          </dl>
          <div className="teaching__foot">
            <Button variant="primary" seed="teaching-ok" onClick={onGotIt}>
              Got it
            </Button>
            {/* Busy, not disabled: one save at a time, and a disabled button drops keyboard focus. */}
            <Button variant="small" seed="teaching-off" aria-disabled={busy || undefined} onClick={() => !busy && onTipsOff()}>
              Turn tips off
            </Button>
          </div>
        </div>
      )}
    </DialogSheet>
  );
}

/** Shows the due pop-up for this player, if any; "Got it" (or Esc) marks it seen for good. */
export function TeachingPopups({ view, player, tips, saving, onTipsOff }: { view: PlayerView; player: string; tips: boolean; saving: boolean; onTipsOff: () => void }) {
  const [seen, setSeen] = useState(() => loadSeen(player));
  const lesson = dueLesson(view, seen, tips);
  const gotIt = () => {
    // The dialog's own close event lands here once more after it hides: nothing is due then.
    if (!lesson) return;
    const next = new Set(seen).add(lesson);
    saveSeen(player, next);
    setSeen(next);
  };
  return <TeachingPopup lesson={lesson} busy={saving} onGotIt={gotIt} onTipsOff={onTipsOff} />;
}
