// The scripted guide of a ruleset that has one (Learn the game, design §14):
// which step is due. Pure over the player's own view; the guide comes from the
// game's ruleset in content (§19.2 seam 3), so nothing here knows its name.
import type { GuideStep } from "@skimjob/content";
import type { PlayerView } from "@skimjob/engine";
import { rulesetOfView } from "./hud";

/** This game's guide steps, in order; none for a ruleset without a guide. */
export const guideOf = (view: PlayerView): readonly GuideStep[] => rulesetOfView(view).guide;

/**
 * Whether `step`'s moment has come: from its round on (a planning taken up by a meeting's
 * card doesn't lose it), once you lock in and after its event, as it asks.
 */
const isNow = (view: PlayerView, step: GuideStep): boolean =>
  (step.round === undefined || view.round >= step.round) &&
  (!step.lockedIn || view.lockedIn.includes(view.me.id)) &&
  (step.after === undefined || view.ledger.some((x) => x.event.type === step.after));

/**
 * The first step not yet seen whose moment is now, or null. Only while planning: the alibi
 * pop-up, a meeting and the reveal own the screen at the other times.
 */
export function dueStep(view: PlayerView, guide: readonly GuideStep[], seen: ReadonlySet<string>): GuideStep | null {
  if (view.phase.kind !== "planning") return null;
  return guide.find((step) => !seen.has(step.id) && isNow(view, step)) ?? null;
}

/** Where a player's seen steps of one game's guide are kept. */
export const guideKey = (gameId: string, player: string) => `skimjob.guide.${gameId}.${player}`;
