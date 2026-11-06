// QA (PR #41): Claim role offers and limits, against the real engine.
// Once per act, the offer list never hints at the hidden pool, and every
// offer is a claim the engine accepts. design §8, §12.1
import { ROLES } from "@skimjob/content";
import { createGame, handleCommand, viewFor, type GameConfig, type GameState, type PlayerCommand, type SystemCommand } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { claimState } from "./meeting";

const config = (n: number, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "claim-qa",
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isBot: false })),
  job: "bank",
  rolePool: ["rookie"],
  mole: "off",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  starterMode: true,
  uniqueRoles: false,
  ...extra,
});

function step(s: GameState, c: PlayerCommand | SystemCommand): GameState {
  const r = handleCommand(s, c);
  if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
  return r.state;
}
const claim = (player: string, role: string) => ({ type: "claimRole", player, role }) as PlayerCommand;

/** Finish one round: all move to the lobby, resolve, close alibis, and run the act's meeting if one is due. */
function round(s: GameState): GameState {
  const p = s.phase;
  if (p.kind !== "planning") throw new Error(p.kind);
  for (const id of Object.keys(s.players)) s = step(s, { type: "submitMove", player: id, move: { room: "lobby", pocket: 0 } } as PlayerCommand);
  s = step(s, { type: "advance", deadline: { kind: "round", round: p.round } });
  if (s.phase.kind === "alibis") s = step(s, { type: "advance", deadline: { kind: "alibis", round: p.round } });
  if (s.phase.kind === "awaitingMeeting") {
    s = step(s, { type: "scheduleMeeting", act: s.phase.act, slot: "qa" });
    s = step(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting!.meetingId } });
  }
  if (s.phase.kind === "meeting") s = step(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: s.phase.meetingId } });
  return s;
}

describe("QA: Claim role (PR #41)", () => {
  it("offers exactly the content roles, whatever the hidden pool (no hint), at 3 and 12 seats", () => {
    const all = Object.keys(ROLES).sort();
    const lists = [
      config(3),
      config(3, { rolePool: ["lookout", "bagman"], starterMode: false }),
      config(12, { rolePool: ["auditor", "detective", "fixer"], starterMode: false, mole: "on" }),
    ].map((c) => {
      const s = createGame(c);
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

  it("once per act: claimed shows in every phase of the act, resets in the next act, matches the engine", () => {
    let s = createGame(config(3));
    s = step(s, claim("p1", "lookout"));
    expect(handleCommand(s, claim("p1", "bagman")).ok).toBe(false);
    // Rounds 1-3 (act 1), through the alibi windows and the act's meeting.
    for (let r = 0; r < 3; r++) {
      expect(claimState(viewFor(s, "p1"))).toMatchObject({ act: 1, claimed: "lookout" });
      s = round(s);
    }
    expect(s.phase).toEqual({ kind: "planning", round: 4 });
    const v = claimState(viewFor(s, "p1"))!;
    expect(v).toMatchObject({ act: 2, claimed: null });
    expect(handleCommand(s, claim("p1", "bagman")).ok).toBe(true);
    // Another player's claim never marks yours.
    expect(claimState(viewFor(step(s, claim("p2", "bagman")), "p1"))!.claimed).toBeNull();
  });

  it("the claimed act agrees with the engine in the alibi window of an act's last round", () => {
    let s = createGame(config(3));
    s = round(s);
    s = round(s);
    for (const id of Object.keys(s.players)) s = step(s, { type: "submitMove", player: id, move: { room: "lobby", pocket: 0 } } as PlayerCommand);
    s = step(s, { type: "advance", deadline: { kind: "round", round: 3 } });
    expect(s.phase.kind).toBe("alibis");
    const before = claimState(viewFor(s, "p1"))!;
    const ok = handleCommand(s, claim("p1", "rookie"));
    expect(ok.ok).toBe(true);
    const after = claimState(viewFor((ok as { state: GameState }).state, "p1"))!;
    expect(after).toMatchObject({ act: before.act, claimed: "rookie" });
  });

  it("none once the game is over", () => {
    let g = createGame(config(3));
    for (let i = 0; i < 20 && g.phase.kind !== "ended"; i++) g = round(g);
    expect(g.phase.kind).toBe("ended");
    expect(claimState(viewFor(g, "p1"))).toBeNull();
  });
});
