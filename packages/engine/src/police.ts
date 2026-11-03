// Hidden background police activity and the Mole's queued tip-off.
// extension.md "Police activity" (owner, 3 Nov: option A), Build notes "Police activity"
//
// When a Mole could be in the game, setup draws a secret schedule of police
// moments (`policeScheduled`, reveal-only). The server fires each one on game
// time with `advance { kind: "policeMoment" }`, never showing clients when;
// the simulator fires one per round. At a moment, at most one activity fires:
// the oldest queued tip-off (replacing a patrol drawn there), else the patrol.
// Either way the crew sees the same public `policeActivity` (+4, scaled for
// small crews), then a raid check that a Fixer can stop. Only the Mole is told
// its tip-off landed (`tipOffLanded`), and earns its token then.
import type { GameEvent, GameState } from "./types";
import { PUBLIC, REVEAL, privateTo } from "./types";
import type { Draw } from "./handle";
import { show } from "./check";
import { clampHeat } from "./job";
import { jobFor, policeFor } from "./overrides";
import { scaledCardHeat } from "./deck";
import { applyEvent } from "./reduce";
import { gameEnded } from "./end";
import { drawPoliceMoment } from "./setup";
import { grantRewards, heatTokens, stopRaid } from "./crew";

/** The police moment `moment` has come. Refused unless it is the next one scheduled, or while a meeting is open (game time is frozen). */
export function policeMoment(state: GameState, moment: unknown, draw: Draw): GameEvent[] | string {
  const police = state.police;
  if (!police) return "no police moment is scheduled";
  if (moment !== police.moment) return `police moment ${show(moment)} is not the next one (${police.moment} is)`;
  if (state.phase.kind === "meeting" || state.phase.kind === "shakedownPending") return "game time is paused while a meeting is open";
  const events: GameEvent[] = [];
  const tipper = police.queue[0];
  if (tipper !== undefined || police.patrol) {
    const job = jobFor(state.config);
    const heatAdded = scaledCardHeat(policeFor(state.config).heat, state.playerOrder.length);
    const heat = clampHeat(job, state.heat + heatAdded);
    events.push({ type: "policeActivity", visibility: PUBLIC, round: state.round, heatAdded, heat });
    events.push({ type: "policeCause", visibility: REVEAL, round: state.round, cause: tipper === undefined ? "patrol" : "tipOff", mole: tipper ?? null });
    if (tipper !== undefined) {
      events.push({ type: "tipOffLanded", visibility: privateTo(tipper), player: tipper, round: state.round });
      events.push(...grantRewards(state, "tipOffLanded", (p) => p.id === tipper));
    }
    if (heat >= job.heat.max) {
      const saved = stopRaid(events.reduce(applyEvent, state), state.round);
      if (saved.length === 0) {
        events.push({ type: "copsRaided", visibility: PUBLIC, round: state.round, heat });
        return [...events, gameEnded(state, events, "heat")];
      }
      events.push(...saved);
    }
    events.push(...heatTokens(events.reduce(applyEvent, state)));
  }
  return [...events, drawPoliceMoment(state.config, police.moment + 1, (n) => draw.int(n))];
}
