// Test helper (not exported from the package): for scripted tests that aren't
// about alibis. A round deadline that leaves the game in the round's alibi
// window (design §5.4) is followed at once by its alibi deadline, as when
// nobody posts, so the next round (or the act's meeting) follows as before.
import type { GameEvent, GameState } from "./types";
import { handleCommand, type CommandResult } from "./handle";

const isRoundDeadline = (command: unknown): boolean => {
  const c = command as { type?: unknown; deadline?: { kind?: unknown } } | null;
  return c?.type === "advance" && c.deadline?.kind === "round";
};

export function handleThroughAlibis(state: GameState, command: unknown): CommandResult {
  const r = handleCommand(state, command);
  if (!r.ok || !isRoundDeadline(command) || r.state.phase.kind !== "alibis") return r;
  const closed = handleCommand(r.state, { type: "advance", deadline: { kind: "alibis", round: r.state.phase.round } });
  if (!closed.ok) throw new Error(`alibi deadline refused: ${closed.reason}`);
  const events: GameEvent[] = [...r.events, ...closed.events];
  return { ok: true, state: closed.state, events };
}
