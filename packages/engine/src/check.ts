// Shape checks shared by command handlers. Commands arrive as untrusted JSON.
import type { GameState, PlayerState } from "./types";

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The player a command names (own keys only), or the reason it's refused. */
export function playerFor(state: GameState, command: Record<string, unknown>): PlayerState | string {
  const id = command.player;
  if (typeof id !== "string" || !Object.hasOwn(state.players, id)) return `unknown player ${String(id)}`;
  return state.players[id] as PlayerState;
}
