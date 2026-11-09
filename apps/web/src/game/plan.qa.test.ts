// QA (S4.3): the plan panel's history order, its words and where it offers an alibi, against
// real engine views. design §10, §11.3
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { handleCommand, viewFor, type GameConfig, type GameState, type PlanEditRecord, type PlayerCommand, type SystemCommand } from "@skimjob/engine";
import { PlanBoard } from "../components/PlanBoard";
import { createGame } from "./deal.testkit";
import { alibiState } from "./hud";
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
        alibi: null,
        onAlibi: async () => {},
      }),
    );
    expect(html).not.toMatch(/2026|21:45|T21/);
    const order = [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]);
    expect(order[0]).toContain("Eli claimed the Vault");
    expect(order[0]).toContain("bot");
    expect(order[1]).toContain("10 min before the deadline");
    expect(order[2]).toContain("under a minute before the deadline");
    expect(html).not.toContain("alibi");
  });
});

describe("where the alibi is offered (design §11.3)", () => {
  it("offers, in every phase, only a round the engine takes; none before a round resolves or after the game ends", () => {
    let s = createGame(config(3));
    const offered: string[] = [];
    const check = (st: GameState) => {
      for (const p of ["p1", "p2", "p3"]) {
        const a = alibiState(viewFor(st, p));
        if (st.resolvedRound === 0 || st.phase.kind === "ended") {
          expect(a, `${st.phase.kind} r${st.round}`).toBeNull();
          continue;
        }
        // The latest resolved round, in every phase, and the engine takes it.
        expect(a?.round, `${st.phase.kind} r${st.round}`).toBe(st.resolvedRound);
        if (!a!.posted) expect(apply(st, { type: "postAlibi", player: p, round: a!.round, room: "office" }).ok).toBe(true);
      }
      offered.push(`${st.phase.kind}:${alibiState(viewFor(st, "p1"))?.round ?? "-"}`);
    };
    check(s);
    for (let r = 1; r <= 3; r++) {
      s = run(s, { type: "advance", deadline: { kind: "round", round: r } });
      check(s);
      s = run(s, { type: "advance", deadline: { kind: "result", round: r } });
      check(s);
    }
    // An emergency meeting after round 3 keeps the offer at round 3.
    s = run(s, { type: "advance", deadline: { kind: "round", round: 4 } });
    const m = run(s, { type: "callEmergency", player: "p2" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-1" } });
    expect(m.phase.kind).toBe("meeting");
    check(m);
    expect(offered).toEqual(["planning:-", "result:1", "planning:1", "result:2", "planning:2", "result:3", "planning:3", "meeting:4"]);
  });

  it("shows a posted alibi as posted and offers no second one for that round (the engine refuses it)", () => {
    let s = run(createGame(config(3)), { type: "advance", deadline: { kind: "round", round: 1 } }, { type: "postAlibi", player: "p1", round: 1, room: "vault" });
    expect(alibiState(viewFor(s, "p1"))).toEqual({ round: 1, posted: "vault" });
    expect(apply(s, { type: "postAlibi", player: "p1", round: 1, room: "office" }).ok).toBe(false);
    s = run(s, { type: "advance", deadline: { kind: "result", round: 1 } });
    expect(alibiState(viewFor(s, "p1"))).toEqual({ round: 1, posted: "vault" });
    // Another player's alibi is not taken for yours.
    expect(alibiState(viewFor(s, "p2"))).toEqual({ round: 1, posted: null });
  });
});
