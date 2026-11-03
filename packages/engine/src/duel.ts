// Duel mode: two players, no meetings or votes. Once per act each player may
// call out the other; the call is settled when the act's last round's alibis
// close (design §5.4), just before the checkpoint. design §16.1
//
// Timing (provisional, docs/decisions.md): a call-out is made while any of the
// act's rounds is being planned, stays private until the act ends, and covers
// everything the opponent pocketed in the whole act.
import type { ActNumber, GameEvent, GameState, PlayerId, PlayerState } from "./types";
import { PUBLIC, privateTo } from "./types";
import { actOfRound } from "./acts";
import { playerFor } from "./check";
import { jobFor } from "./overrides";
import { isDuel } from "./setup";
import { applyEvent } from "./reduce";
import { checkpoint } from "./meeting";
import type { Draw } from "./handle";

type Result = GameEvent[] | string;

/** Players who called out their opponent in `act`, in seat order. */
function callersIn(state: GameState, act: ActNumber): PlayerId[] {
  const called = new Set<PlayerId>();
  for (const e of state.log) if (e.type === "callOutMade" && e.act === act) called.add(e.player);
  return state.playerOrder.filter((id) => called.has(id));
}

/** The other seat (Duel games have exactly two). */
const opponentOf = (state: GameState, player: PlayerId): PlayerId => state.playerOrder.find((id) => id !== player) as PlayerId;

/** design §16.1: once per act, while one of the act's rounds is being planned. */
export function callOut(state: GameState, command: Record<string, unknown>): Result {
  if (!isDuel(state.config)) return "call-outs are only played in Duel mode";
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  if (state.phase.kind !== "planning") return "you can only call out while a round is being planned";
  const act = actOfRound(state.phase.round);
  if (callersIn(state, act).includes(player.id)) return `you have already called out your opponent in act ${act}`;
  return [{ type: "callOutMade", visibility: privateTo(player.id), player: player.id, act }];
}

/** What `player` kept from their splits in `act` (before any Fence safe moves). */
function pocketedIn(state: GameState, player: PlayerId, act: ActNumber): number {
  let total = 0;
  for (const e of state.log) if (e.type === "lootSplit" && e.player === player && actOfRound(e.round) === act) total += e.toStash;
  return total;
}

/**
 * The end of a Duel act (its last round has resolved without a raid): each
 * call-out in seat order, then the checkpoint (design §16.1: checkpoints work
 * as normal, with no meeting). A caught opponent hands over everything they
 * pocketed this act, capped by their stash (the Fence safe is never touched,
 * as in a shakedown); a wrong call costs the caller the job's
 * `wrongCallOut` (extension.md gap-fills, provisional), capped by the caller's stash.
 * `prior` are this command's events so far.
 */
export function endOfDuelAct(state: GameState, prior: readonly GameEvent[], act: ActNumber, draw: Draw): GameEvent[] {
  const job = jobFor(state.config);
  let now = prior.reduce(applyEvent, state);
  const events: GameEvent[] = [];
  for (const caller of callersIn(now, act)) {
    const target = opponentOf(now, caller);
    const pocketed = pocketedIn(now, target, act);
    const caught = pocketed > 0;
    const payer = (now.players[caught ? target : caller] as PlayerState).stash;
    const amount = Math.min(caught ? pocketed : job.duel.wrongCallOut, payer);
    const event: GameEvent = { type: "callOutResolved", visibility: PUBLIC, act, caller, target, caught, amount };
    events.push(event);
    now = applyEvent(now, event);
  }
  return [...events, ...checkpoint(state, [...prior, ...events], act, draw)];
}
