// The host ends the game early: no winner, no reveal. design §6.2, §16
import { describe, expect, it } from "vitest";
import type { GameConfig } from "./types";
import { createGame } from "./setup";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { isOver } from "./end";

const config: GameConfig = {
  seed: "abort-seed",
  players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i > 0 })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
};

describe("abortGame — design §6.2, §16", () => {
  const start = createGame(config);
  const r = handleCommand(start, { type: "abortGame" });
  if (!r.ok) throw new Error(r.reason);

  it("ends the game with one public gameAborted event and no outcome", () => {
    expect(r.events).toEqual([{ type: "gameAborted", visibility: { kind: "public" } }]);
    expect(r.state.phase).toEqual({ kind: "aborted" });
    expect(isOver(r.state.phase)).toBe(true);
  });

  it("every player sees the event and nobody gets a reveal", () => {
    for (const id of config.players.map((p) => p.id)) {
      const view = viewFor(r.state, id);
      expect(view.ledger.some((x) => x.event.type === "gameAborted")).toBe(true);
      expect(view.reveal).toBeNull();
      expect(view.phase).toEqual({ kind: "aborted" });
    }
  });

  it("takes no more commands (ending twice is refused, the game stays aborted)", () => {
    expect(handleCommand(r.state, { type: "abortGame" })).toEqual({ ok: false, reason: "the game is over" });
    expect(handleCommand(r.state, { type: "advance", deadline: { kind: "result", round: 1 } })).toMatchObject({ ok: false });
  });
});
