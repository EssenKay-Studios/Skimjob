// The game screen's guide state (design §14): the step due now and "Got it",
// which marks it seen for good in this browser.
import type { GuideStep } from "@skimjob/content";
import type { PlayerView } from "@skimjob/engine";
import { useMemo, useState } from "react";
import { dueStep, guideKey, guideOf } from "./guide";
import { loadSeen, saveSeen } from "./teaching";

export interface GuideState {
  /** The step to show, or null (none due, no guide, or `held`). */
  readonly step: GuideStep | null;
  /** "3 of 8": the step's place in the guide. */
  readonly place: string;
  readonly gotIt: () => void;
}

/** `held`: another sheet owns the screen (the alibi pop-up, a meeting result card). */
export function useGuide(gameId: string, view: PlayerView | null, held: boolean): GuideState {
  const guide = view ? guideOf(view) : [];
  const key = view && guide.length > 0 ? guideKey(gameId, view.me.id) : null;
  const ids = guide.map((s) => s.id).join(" ");
  const stored = useMemo(() => (key ? loadSeen(key, ids.split(" ")) : new Set<string>()), [key, ids]);
  const [added, setAdded] = useState<readonly string[]>([]);
  const seen = new Set([...stored, ...added]);
  const step = view && key && !held ? dueStep(view, guide, seen) : null;
  return {
    step,
    place: step ? `${guide.indexOf(step) + 1} of ${guide.length}` : "",
    gotIt: () => {
      // The dialog's own close event lands here once more after it hides: nothing is showing then.
      if (!step || !key) return;
      saveSeen(key, seen.add(step.id));
      setAdded((a) => [...a, step.id]);
    },
  };
}
