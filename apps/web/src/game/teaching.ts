// Which teaching pop-up is due (design §15.6, §20.6): the first lesson, in
// priority order, that happened in about the last two rounds (or, for the Wanted
// warning, holds now) and that this player has not seen. Pure over the
// player's own view; the seen set lives in localStorage per player.
import { LESSONS, type LessonId } from "@skimjob/content";
import type { PlayerView } from "@skimjob/engine";
import { jobOf } from "./hud";

/** Priority order: the most serious first, so a queue never opens with the bell. */
const ORDER: readonly LessonId[] = ["raid", "oneStar", "shakedown", "powerCut", "missing", "bell"];

/** The lessons whose trigger is on in this view. */
export function happened(view: PlayerView): ReadonlySet<LessonId> {
  const resolved = view.ledger.find((x) => x.event.type === "roundResolved" && x.event.round === view.round - 3);
  const recent = view.ledger.filter((x) => x.seq > (resolved?.seq ?? -1)).map((x) => x.event);
  const out = new Set<LessonId>();
  for (const e of recent) {
    if (e.type === "roomRaided") out.add("raid");
    else if (e.type === "shakedownResolved") out.add("shakedown");
    else if (e.type === "powerCut") out.add("powerCut");
    else if (e.type === "roundResolved" && e.missing > 0) out.add("missing");
    else if (e.type === "bellsRung" && Object.values(e.bells).some((n) => n > 0)) out.add("bell");
  }
  if (view.wanted === jobOf(view).alarm.bustStars - 1 && view.wanted > 0) out.add("oneStar");
  return out;
}

/** The lesson to show now, or null: Tips off, the game over (the reveal has the floor), nothing new, or everything already seen. */
export function dueLesson(view: PlayerView, seen: ReadonlySet<string>, tips: boolean): LessonId | null {
  if (!tips || view.phase.kind === "ended") return null;
  const now = happened(view);
  return ORDER.find((id) => now.has(id) && !seen.has(id)) ?? null;
}

const key = (player: string) => `skimjob.lessons.${player}`;

/** The lessons this player has already been shown. */
export function loadSeen(player: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(player)) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x in LESSONS) : []);
  } catch {
    return new Set();
  }
}

export function saveSeen(player: string, seen: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key(player), JSON.stringify([...seen]));
  } catch {
    // Storage blocked: the pop-up may show again next visit, which is harmless.
  }
}
