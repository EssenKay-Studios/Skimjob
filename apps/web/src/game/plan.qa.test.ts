// QA (S4.3): the plan panel's history order and its words. design §10
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { handleCommand, viewFor, type GameConfig, type GameState, type PlanEditRecord, type PlayerCommand, type SystemCommand } from "@skimjob/engine";
import { PlanBoard } from "../components/PlanBoard";
import { createGame } from "./deal.testkit";
import { beforeDeadline, historyOrder } from "./plan";

const config = (n: number): GameConfig => ({
  seed: "plan-qa",
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isBot: false })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
});
const apply = (s: GameState, c: PlayerCommand | SystemCommand) => handleCommand(s, c);
function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = apply(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const edit = (ms: number | null, actor = "p1"): PlanEditRecord => ({ actor, kind: "room", subject: actor, value: "vault", target: null, msBeforeDeadline: ms });

describe("history order (design §10)", () => {
  it("puts every null (bot) edit first in log order, then most time left, ties in log order, without touching the input", () => {
    const h = [edit(1000, "a"), edit(null, "b"), edit(0, "c"), edit(null, "d"), edit(5000, "e"), edit(1000, "f")];
    const copy = structuredClone(h);
    expect(historyOrder(h).map((e) => e.actor)).toEqual(["b", "d", "e", "a", "f", "c"]);
    expect(h).toEqual(copy);
    expect(historyOrder([])).toEqual([]);
  });

  it("marks only a null as a bot; 0 ms and huge spans read as time left, never a clock", () => {
    expect(beforeDeadline(null)).toBe("bot");
    expect(beforeDeadline(0)).toBe("under a minute before the deadline");
    expect(beforeDeadline(59_999)).toBe("under a minute before the deadline");
    expect(beforeDeadline(60_000)).toBe("1 min before the deadline");
    expect(beforeDeadline(7 * 86_400_000)).toBe("7 d 0 h before the deadline");
    for (const ms of [null, 0, 61_000, 3_600_000, 90_000_000]) expect(beforeDeadline(ms)).not.toMatch(/\d:\d\d|AM|PM|20\d\d/);
  });

  it("renders the snapshot in that order and never a wall time, even if a record carried one", () => {
    const seats = [
      { id: "p1", name: "Sam", isBot: false, you: true, look: 0 },
      { id: "p2", name: "Eli", isBot: true, you: false, look: 1 },
    ];
    const rooms = [{ id: "vault", name: "Vault", closed: null }];
    const late = { ...edit(20_000, "p1"), at: "2026-11-09T21:45:00.000Z" } as PlanEditRecord;
    const html = renderToStaticMarkup(
      createElement(PlanBoard, {
        seats,
        rooms,
        board: null,
        onEdit: async () => {},
        last: { round: 1, plan: { entries: [], history: [late, edit(null, "p2"), edit(600_000, "p1")] } },
      }),
    );
    expect(html).not.toMatch(/2026|21:45|T21/);
    const order = [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]);
    expect(order[0]).toContain("Eli claimed the Vault");
    expect(order[0]).toContain("bot");
    expect(order[1]).toContain("10 min before the deadline");
    expect(order[2]).toContain("under a minute before the deadline");
  });
});
