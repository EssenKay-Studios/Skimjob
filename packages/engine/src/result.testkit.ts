// Test helper (not exported from the package): for scripted tests that aren't
// about emergencies. A round deadline that leaves the game in the result window
// (design §9.3) is followed at once by the window's close, as when nobody calls
// an emergency; a meeting the round called (§9.1, §9.2) is left to the test.
import type { GameEvent, GameState } from "./types";
import { handleCommand, type CommandResult } from "./handle";

const isRoundDeadline = (command: unknown): boolean => {
  const c = command as { type?: unknown; deadline?: { kind?: unknown } } | null;
  return c?.type === "advance" && c.deadline?.kind === "round";
};

/** Closes the result window the game is in, if any (nobody called an emergency). */
export function closeResultWindow(state: GameState): CommandResult {
  if (state.phase.kind !== "result") return { ok: true, state, events: [] };
  const closed = handleCommand(state, { type: "advance", deadline: { kind: "result", round: state.phase.round } });
  if (!closed.ok) throw new Error(`result deadline refused: ${closed.reason}`);
  return closed;
}

export function handleThroughResult(state: GameState, command: unknown): CommandResult {
  const r = handleCommand(state, command);
  if (!r.ok || !isRoundDeadline(command)) return r;
  const closed = closeResultWindow(r.state);
  if (!closed.ok) return closed;
  const events: GameEvent[] = [...r.events, ...closed.events];
  return { ok: true, state: closed.state, events };
}
