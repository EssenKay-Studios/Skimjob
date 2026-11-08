// Test helper (not exported from the package): for scripted tests that aren't
// about alibis or emergencies. A round deadline that leaves the game in the
// round's alibi window (design §5.4) is followed at once by its alibi deadline,
// as when nobody posts, and then by the result window's close (§9.3), as when
// nobody calls an emergency; a meeting the round called (§9.1, §9.2) is left to
// the test.
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

export function handleThroughAlibis(state: GameState, command: unknown): CommandResult {
  const r = handleCommand(state, command);
  if (!r.ok || !isRoundDeadline(command) || r.state.phase.kind !== "alibis") return r;
  const closed = handleCommand(r.state, { type: "advance", deadline: { kind: "alibis", round: r.state.phase.round } });
  if (!closed.ok) throw new Error(`alibi deadline refused: ${closed.reason}`);
  const result = closeResultWindow(closed.state);
  if (!result.ok) return result;
  const events: GameEvent[] = [...r.events, ...closed.events, ...result.events];
  return { ok: true, state: result.state, events };
}
