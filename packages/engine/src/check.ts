// Shape checks shared by command handlers. Commands arrive as untrusted JSON.
import type { GameState, PlayerState } from "./types";

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const SHOW_MAX = 40;

/**
 * A command value as text for a refusal reason. Never throws: JSON.parse can
 * build objects with no string form (`{"toString":null}`), so raw command
 * values never go through String() or a template string directly. Long
 * strings are cut short, so huge input doesn't end up in reasons or logs.
 */
export function show(v: unknown): string {
  if (typeof v === "string") return v.length > SHOW_MAX ? `${v.slice(0, SHOW_MAX)}…` : v;
  if (v === null || typeof v === "number" || typeof v === "boolean" || typeof v === "undefined" || typeof v === "bigint") return String(v);
  if (Array.isArray(v)) return "(a list)";
  return typeof v === "object" ? "(an object)" : `(a ${typeof v})`;
}

/** The player a command names (own keys only), or the reason it's refused. */
export function playerFor(state: GameState, command: Record<string, unknown>): PlayerState | string {
  const id = command.player;
  if (typeof id !== "string" || !Object.hasOwn(state.players, id)) return `unknown player ${show(id)}`;
  return state.players[id] as PlayerState;
}
