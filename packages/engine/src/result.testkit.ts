// Test helper (not exported from the package): for scripted tests that aren't
// about alibis or emergencies. A round deadline is followed at once by its alibi
// window's close (design §10, nobody posts) and then the result window's
// (§9.3), as when nobody calls an emergency; a meeting the round called (§9.1,
// §9.2) is left to the test.
import type { GameEvent, GameState } from "./types";
import { handleCommand, type CommandResult } from "./handle";

const isRoundDeadline = (command: unknown): boolean => {
  const c = command as { type?: unknown; deadline?: { kind?: unknown } } | null;
  return c?.type === "advance" && c.deadline?.kind === "round";
};

/** Closes the alibi window the game is in, if any (nobody posted). design §10 */
export function closeAlibiWindow(state: GameState): CommandResult {
  if (state.phase.kind !== "alibi") return { ok: true, state, events: [] };
  const closed = handleCommand(state, { type: "advance", deadline: { kind: "alibi", round: state.phase.round } });
  if (!closed.ok) throw new Error(`alibi deadline refused: ${closed.reason}`);
  return closed;
}

/** Closes the alibi window and then the result window the game is in, if any (nobody called an emergency). */
export function closeResultWindow(state: GameState): CommandResult {
  const alibi = closeAlibiWindow(state);
  if (!alibi.ok) return alibi;
  const { phase } = alibi.state;
  if (phase.kind !== "result") return alibi;
  const closed = handleCommand(alibi.state, { type: "advance", deadline: { kind: "result", round: phase.round } });
  if (!closed.ok) throw new Error(`result deadline refused: ${closed.reason}`);
  return { ok: true, state: closed.state, events: [...alibi.events, ...closed.events] };
}

export function handleThroughResult(state: GameState, command: unknown): CommandResult {
  const r = handleCommand(state, command);
  if (!r.ok || !isRoundDeadline(command)) return r;
  const closed = closeResultWindow(r.state);
  if (!closed.ok) return closed;
  const events: GameEvent[] = [...r.events, ...closed.events];
  return { ok: true, state: closed.state, events };
}
