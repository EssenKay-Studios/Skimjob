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
import type { GameEvent, GameState, PlayerState, RngState } from "./types";
import { REVEAL, privateTo } from "./types";
import { pick, randomInt, shuffle } from "./rng";
import { applyEvent } from "./reduce";
import { checkMove, resolveRound } from "./round";

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

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function playerFor(state: GameState, command: Record<string, unknown>): PlayerState | string {
  const id = command.player;
  if (typeof id !== "string" || !Object.hasOwn(state.players, id)) return `unknown player ${String(id)}`;
  return state.players[id] as PlayerState;
}

type Handler = (state: GameState, command: Record<string, unknown>, draw: Draw) => HandlerResult;

/** design §5.1: a move can be changed until the round deadline; the last one counts. */
const submitMove: Handler = (state, command) => {
  if (state.phase.kind !== "planning") return "moves can only be submitted while a round is being planned";
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const move = checkMove(state, player, command.move);
  if (typeof move === "string") return move;
  return [{ type: "moveSubmitted", visibility: privateTo(player.id), player: player.id, round: state.phase.round, move }];
};

/** The scheduler says a deadline has passed. design §4.1, §5.2 */
const advance: Handler = (state, command) => {
  const deadline = command.deadline;
  if (!isObject(deadline) || typeof deadline.kind !== "string") return "advance needs a deadline";
  switch (deadline.kind) {
    case "round":
      if (state.phase.kind !== "planning") return "no round deadline is pending";
      return resolveRound(state, state.phase.round);
    case "openMeeting":
    case "closeMeeting":
      return "meetings are not supported yet"; // STATUS.md task 6
    default:
      return `unknown deadline ${deadline.kind}`;
  }
};

const HANDLERS: Readonly<Record<string, Handler>> = { submitMove, advance };

/** Apply one command. Never throws for bad input; a rejection leaves state as it was. */
export function handleCommand(state: GameState, command: unknown): CommandResult {
  if (!isObject(command) || typeof command.type !== "string") return { ok: false, reason: "command must be an object with a type" };
  if (state.phase.kind === "ended") return { ok: false, reason: "the game is over" };
  const handler = Object.hasOwn(HANDLERS, command.type) ? HANDLERS[command.type] : undefined;
  if (!handler) return { ok: false, reason: `command ${command.type} is not supported` };
  const out = withRng(state.rng, (draw) => handler(state, command, draw));
  if (typeof out === "string") return { ok: false, reason: out };
  return { ok: true, state: out.reduce(applyEvent, state), events: out };
}
