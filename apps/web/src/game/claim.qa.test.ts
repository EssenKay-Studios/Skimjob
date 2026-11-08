// QA (PR #41): Claim role offers and limits, against the real engine.
// Once between meetings (design §11.3), the offer list never hints at the hidden pool, and every
// offer is a claim the engine accepts. design §8, §12.1
import { ROLES } from "@skimjob/content";
import { handleCommand, viewFor, type GameConfig, type GameState, type PlayerCommand, type SystemCommand } from "@skimjob/engine";
import { createGame } from "./deal.testkit";
import { describe, expect, it } from "vitest";
import { claimState } from "./meeting";

const config = (n: number, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "claim-qa",
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isBot: false })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});

function step(s: GameState, c: PlayerCommand | SystemCommand): GameState {
  const r = handleCommand(s, c);
  if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
  return r.state;
}
const claim = (player: string, role: string) => ({ type: "claimRole", player, role }) as PlayerCommand;

/** Finish one round: all move to the lobby, resolve, close alibis, run a due meeting (design §9.1, §9.2) and close the result window. */
function round(s: GameState): GameState {
  const p = s.phase;
  if (p.kind !== "planning") throw new Error(p.kind);
  for (const id of Object.keys(s.players)) s = step(s, { type: "submitMove", player: id, move: { room: "lobby", duffel: 1, pocket: 0 } } as PlayerCommand);
  s = step(s, { type: "advance", deadline: { kind: "round", round: p.round } });
  if (s.phase.kind === "alibis") s = step(s, { type: "advance", deadline: { kind: "alibis", round: p.round } });
  if (s.phase.kind === "awaitingMeeting") {
    const meetingId = s.phase.meetingId;
    s = step(s, { type: "scheduleMeeting", meetingId, slot: "qa" });
    s = step(s, { type: "advance", deadline: { kind: "openMeeting", meetingId } });
  }
  if (s.phase.kind === "meeting") s = step(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: s.phase.meetingId } });
  if (s.phase.kind === "result") s = step(s, { type: "advance", deadline: { kind: "result", round: s.phase.round } });
  return s;
}

describe("QA: Claim role (PR #41)", () => {
  it("offers exactly the content roles, whatever was dealt (no hint), at 3 and 12 seats", () => {
    const all = Object.keys(ROLES).sort();
    const lists = [
      [config(3), []],
      [config(3), ["lookout", "auditor"]],
      [config(12), ["auditor", "detective", "fixer"]],
    ].map(([c, roles]) => {
      const s = createGame(c as GameConfig, roles as string[]);
      return Object.keys(s.players).map((id) => claimState(viewFor(s, id))!.options);
    });
    const first = lists[0]![0]!;
    expect(first.map((o) => o.id).sort()).toEqual(all);
    for (const perGame of lists) for (const opts of perGame) expect(opts).toEqual(first);
  });

  it("every offered role is accepted by the engine, and nothing is offered that it would refuse", () => {
    const s = createGame(config(3));
    for (const o of claimState(viewFor(s, "p1"))!.options) expect(handleCommand(s, claim("p1", o.id)).ok, o.id).toBe(true);
  });

  it("once per stretch: claimed shows until the regular meeting at a third of the bank, then resets, matching the engine (design §9.1, §11.3)", () => {
    let s = createGame(config(3));
    s = step(s, claim("p1", "lookout"));
    expect(handleCommand(s, claim("p1", "auditor")).ok).toBe(false);
    // Rounds through the alibi windows until a third of the bank is gone and its regular meeting is held.
    for (let guard = 0; guard < 12 && viewFor(s, "p1").stretch === 1; guard++) {
      expect(claimState(viewFor(s, "p1"))).toMatchObject({ stretch: 1, claimed: "lookout" });
      s = round(s);
    }
    expect(s.phase.kind).toBe("planning");
    const v = claimState(viewFor(s, "p1"))!;
    expect(v).toMatchObject({ stretch: 2, claimed: null });
    expect(handleCommand(s, claim("p1", "auditor")).ok).toBe(true);
    // Another player's claim never marks yours.
    expect(claimState(viewFor(step(s, claim("p2", "auditor")), "p1"))!.claimed).toBeNull();
  });

  it("the claimed stretch agrees with the engine in a round's alibi window", () => {
    let s = createGame(config(3));
    s = round(s);
    s = round(s);
    for (const id of Object.keys(s.players)) s = step(s, { type: "submitMove", player: id, move: { room: "lobby", duffel: 1, pocket: 0 } } as PlayerCommand);
    s = step(s, { type: "advance", deadline: { kind: "round", round: 3 } });
    expect(s.phase.kind).toBe("alibis");
    const before = claimState(viewFor(s, "p1"))!;
    const ok = handleCommand(s, claim("p1", "locksmith"));
    expect(ok.ok).toBe(true);
    const after = claimState(viewFor((ok as { state: GameState }).state, "p1"))!;
    expect(after).toMatchObject({ stretch: before.stretch, claimed: "locksmith" });
  });

  it("none once the game is over", () => {
    let g = createGame(config(3));
    for (let i = 0; i < 20 && g.phase.kind !== "ended"; i++) g = round(g);
    expect(g.phase.kind).toBe("ended");
    expect(claimState(viewFor(g, "p1"))).toBeNull();
  });
});
