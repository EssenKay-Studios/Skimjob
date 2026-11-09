// Commands in, events out. design §17.2
//
// `handleCommand` checks a command against the state, works out its events,
// folds them, and returns the new state — or a rejection that leaves the state
// untouched. Commands may come from untrusted clients, so bad input is always
// a rejection, never a throw.
//
// Randomness: handlers only draw through the `Draw` they are given. If they
// draw anything, `withRng` appends the reveal-only `rngAdvanced` after their
// events automatically, so replay restores the RNG (docs/decisions.md).
import type { GameEvent, GameState, RngState } from "./types";
import { PUBLIC, REVEAL, privateTo } from "./types";
import { pick, randomInt, shuffle } from "./rng";
import { applyEvent } from "./reduce";
import { checkMove, resolveRound } from "./round";
import { isObject, playerFor, show } from "./check";
import { claimRole, planSaid, postAlibi } from "./said";
import { buyPerk, chooseBail } from "./perks";
import {
  acceptMeeting,
  callEmergency,
  castVote,
  closeMeeting,
  closeResult,
  openMeeting,
  proposeMeeting,
  resolveShakedown,
  scheduleMeeting,
  sealVote,
  useAbility,
} from "./meeting";

export type CommandResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly reason: string };

/** Seeded draws for one command. All engine randomness goes through here. */
export interface Draw {
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
}

/** A handler's events, or the reason the command is refused. */
type HandlerResult = GameEvent[] | string;

/**
 * Run `fn` with a `Draw` over `rng`. If it drew anything and produced events,
 * `rngAdvanced` with the post-draw state is appended after them. A rejection
 * discards the draws.
 */
export function withRng(rng: RngState, fn: (draw: Draw) => HandlerResult): HandlerResult {
  let state = rng;
  let drew = false;
  const step = <T>(r: { readonly value: T; readonly rng: RngState }): T => {
    state = r.rng;
    drew = true;
    return r.value;
  };
  const draw: Draw = {
    int: (n) => step(randomInt(state, n)),
    pick: (items) => step(pick(state, items)),
    shuffle: (items) => step(shuffle(state, items)),
  };
  const out = fn(draw);
  if (typeof out === "string" || !drew) return out;
  return [...out, { type: "rngAdvanced", visibility: REVEAL, words: state.words }];
}

type Handler = (state: GameState, command: Record<string, unknown>, draw: Draw) => HandlerResult;

/**
 * design §5.1: a move can be changed until the round deadline; the last one counts.
 * The first one of the round also emits the public `moveLocked` (owner decision, 2 Nov).
 */
const submitMove: Handler = (state, command) => {
  if (state.phase.kind !== "planning") return "moves can only be submitted while a round is being planned";
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const move = checkMove(state, player, command.move);
  if (typeof move === "string") return move;
  const round = state.phase.round;
  const submitted: GameEvent = { type: "moveSubmitted", visibility: privateTo(player.id), player: player.id, round, move };
  return Object.hasOwn(state.moves, player.id) ? [submitted] : [{ type: "moveLocked", visibility: PUBLIC, player: player.id, round }, submitted];
};

/** design §10: the round's plan board goes into the log as it resolves, before what really happened. */
function withPlan(state: GameState, round: number, plan: unknown, draw: Draw): HandlerResult {
  const said = planSaid(state, round, plan);
  return typeof said === "string" ? said : [...said, ...resolveRound(state, round, draw)];
}

/** The scheduler says a deadline has passed. design §4.1, §9 */
const advance: Handler = (state, command, draw) => {
  const deadline = command.deadline;
  if (!isObject(deadline) || typeof deadline.kind !== "string") return "advance needs a deadline";
  switch (deadline.kind) {
    case "round":
      if (state.phase.kind !== "planning") return "no round deadline is pending";
      // Named round, so a retried or late deadline is refused instead of resolving the next round.
      if (deadline.round !== state.phase.round) return `the round ${show(deadline.round)} deadline is not pending (round ${state.phase.round} is)`;
      return withPlan(state, state.phase.round, deadline.plan, draw);
    case "result":
      return closeResult(state, deadline.round, draw);
    case "openMeeting":
      return openMeeting(state, deadline.meetingId);
    case "closeMeeting":
      return closeMeeting(state, deadline.meetingId, draw);
    case "resolveShakedown":
      return resolveShakedown(state, deadline.meetingId, draw);
    default:
      return `unknown deadline ${deadline.kind}`;
  }
};

const HANDLERS: Readonly<Record<string, Handler>> = {
  submitMove,
  postAlibi,
  claimRole,
  proposeMeeting,
  acceptMeeting,
  callEmergency,
  castVote,
  sealVote,
  useAbility,
  buyPerk: (state, command) => buyPerk(state, command),
  chooseBail: (state, command) => chooseBail(state, command),
  advance,
  scheduleMeeting,
};

/** Every command type the engine handles. */
export const COMMAND_TYPES: readonly string[] = Object.keys(HANDLERS);

/** Apply one command. Never throws for bad input; a rejection leaves state as it was. */
export function handleCommand(state: GameState, command: unknown): CommandResult {
  if (!isObject(command) || typeof command.type !== "string") return { ok: false, reason: "command must be an object with a type" };
  if (state.phase.kind === "ended") return { ok: false, reason: "the game is over" };
  if (state.phase.kind === "setup") return { ok: false, reason: "the game has not started" };
  const handler = Object.hasOwn(HANDLERS, command.type) ? HANDLERS[command.type] : undefined;
  if (!handler) return { ok: false, reason: `command ${command.type} is not supported` };
  const out = withRng(state.rng, (draw) => handler(state, command, draw));
  if (typeof out === "string") return { ok: false, reason: out };
  return { ok: true, state: out.reduce(applyEvent, state), events: out };
}
