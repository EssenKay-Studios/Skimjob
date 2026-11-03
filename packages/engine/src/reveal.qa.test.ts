// QA (PR #55, M2-11): the reveal's ending against the engine's own
// `outcomeFor` on ties with ★ roles (extension.md "Winning and losing":
// a failure is won only by top-group members whose role wins that ending).
import { describe, expect, it } from "vitest";
import { EVENTS, ROLES, type RoleId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { privateTo } from "./types";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { viewFor } from "./view";
import { handleThroughAlibis } from "./alibis.testkit";
import { outcomeFor } from "./end";
import { revealSummary } from "./reveal";

const TABLES = { roles: ROLES, events: EVENTS };

/** A finished-looking 4-seat game with these roles and stashes (no Fence safe, nothing else to break the tie). */
function game(roles: RoleId[], stashes: number[]): GameState {
  const cfg: GameConfig = {
    seed: "qa55-tie",
    players: roles.map((_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
    job: "bank",
    rolePool: [],
    eventsEnabled: true,
    voteVisibility: "secret",
    starterMode: false,
  };
  const base = createGame(cfg);
  const players = Object.fromEntries(
    base.playerOrder.map((id, i) => [id, { ...(base.players[id] as PlayerState), role: roles[i] as RoleId, stash: stashes[i] ?? 0, safe: 0, timesShakenDown: 0, totalHandedIn: 0 }]),
  );
  const log: GameEvent[] = base.playerOrder.map((id, i) => ({ type: "roleDealt", visibility: privateTo(id), player: id, role: roles[i] as RoleId }));
  return { ...base, players, log };
}

describe("QA #55 reveal ending vs outcomeFor on ties — extension.md \"Winning and losing\"", () => {
  const roles: RoleId[] = ["rookie", "getawayDriver", "embezzler", "lookout"];
  const stashes = [3, 9, 9, 1];

  for (const [failure, star] of [
    ["heat", "p1"],
    ["target", "p2"],
  ] as const) {
    it(`a Driver and an Embezzler level at the top: on a ${failure} failure only ${star} wins, the other is top-group and VOID`, () => {
      const state = game(roles, stashes);
      const outcome = outcomeFor(state, failure);
      const s = revealSummary(state.log, outcome, TABLES);
      expect(outcome.winners).toEqual([star]);
      expect(s.ending).toEqual({ result: "failed", reason: failure, topGroup: ["p1", "p2"], winners: [star], why: "failedTopWins" });
      expect(s.seats.map((x) => [x.player, x.topGroup, x.winner])).toEqual([
        ["p1", true, star === "p1"],
        ["p2", true, star === "p2"],
        ["p0", false, false],
        ["p3", false, false],
      ]);
      expect(s.seats.map((x) => x.score)).toEqual(outcome.ranking.map((r) => r.score));
    });
  }

  it("the same tie on a success: both win, and nobody's ★ is needed", () => {
    const state = game(roles, stashes);
    const s = revealSummary(state.log, outcomeFor(state, null), TABLES);
    expect(s.ending).toEqual({ result: "success", reason: null, topGroup: ["p1", "p2"], winners: ["p1", "p2"], why: "success" });
    expect(s.seats.filter((x) => x.winner).map((x) => x.player)).toEqual(["p1", "p2"]);
  });

  it("a ★ role just below the top wins nothing on a failure (failedNobody)", () => {
    const state = game(["rookie", "mole", "lookout", "bagman"], [9, 8, 2, 1]);
    const outcome = outcomeFor(state, "heat");
    const s = revealSummary(state.log, outcome, TABLES);
    expect(s.ending).toMatchObject({ topGroup: ["p0"], winners: [], why: "failedNobody" });
    expect(s.seats.find((x) => x.player === "p1")).toMatchObject({ topGroup: false, winner: false, winsOn: ROLES.mole?.winsOn });
  });
});

// QA (PR #55 review fix): a real two-sided Double-cross moves the Blackmailer role
// before the meeting its steal decides. extension.md owner ruling 5, design §13.
describe("QA #55 stolen vote decided across a Double-cross — extension.md owner ruling 5", () => {
  const cfg = (seed: string): GameConfig => ({
    seed,
    players: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
  });
  const start = (c: GameConfig): GameState => {
    let seat = 0;
    const log = setupEvents(c).flatMap((e): GameEvent[] => {
      if (e.type === "roleDealt") return [{ ...e, role: seat++ === 0 ? "blackmailer" : "rookie" }];
      if (e.type === "snitchTargetAssigned" || (e.type === "roleListShown" && e.list === "exact")) return [];
      return [e];
    });
    return replay(c, log);
  };
  const run = (s: GameState, ...cmds: unknown[]): GameState =>
    cmds.reduce<GameState>((st, c) => {
      const cmd = typeof c === "function" ? (c as (x: GameState) => unknown)(st) : c;
      const r = handleThroughAlibis(st, cmd);
      if (!r.ok) throw new Error(`rejected ${JSON.stringify(cmd)}: ${r.reason}`);
      return r.state;
    }, s);
  const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
  const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
  const open = [{ type: "callEmergency", player: "p6" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-p6" } }];
  const close = { type: "advance", deadline: { kind: "closeMeeting", meetingId: "emergency-p6" } };
  const tokens = (s: GameState) => s.log.filter((e) => e.type === "tokenEarned" && e.trigger === "stolenVoteDecided");

  /** p0 (Blackmailer) steals p1's vote, then swaps roles with p3 (both sides, as deck.ts does) before the meeting. */
  function crossed(seed: string): GameState {
    const c = cfg(seed);
    const right = run(start(c), { type: "submitMove", player: "p0", move: { room: "lobby", pocket: 0, ability: { kind: "blackmail", target: "p1", role: "rookie" } } }, ROUND, ...open);
    const at = right.log.findIndex((e) => e.type === "meetingOpened");
    const rs = (id: string) => right.players[id]!.roleState;
    const dc = (a: string, b: string): GameEvent => ({
      type: "doubleCrossResolved",
      visibility: privateTo(a),
      player: a,
      round: 1,
      partner: b,
      swap: { role: right.players[b]!.role, roleState: { ...rs(b), tokens: rs(a).tokens, perks: rs(a).perks, tail: rs(a).tail } },
    });
    return replay(c, [...right.log.slice(0, at), dc("p0", "p3"), dc("p3", "p0"), ...right.log.slice(at)]);
  }

  it("a decided steal stays credited to the player who made it; neither swapper earns the token; hidden until the end", () => {
    const s0 = crossed("qa55-dc");
    expect(s0.players.p3!.role).toBe("blackmailer");
    expect(s0.players.p0!.role).toBe("rookie");
    const after = run(s0, vote("p0", "p2"), vote("p3", "p2"), vote("p4", "p2"), vote("p1", null), vote("p5", null), vote("p6", null), close);
    expect(after.log.find((e) => e.type === "meetingClosed")).toMatchObject({ result: { kind: "shakedown", target: "p2" } });
    expect(tokens(after)).toEqual([]);
    for (const id of after.playerOrder) expect(JSON.stringify(viewFor(after, id))).not.toMatch(/votesStolen|"decided"/);
    const s = revealSummary(after.log, outcomeFor(after, null), TABLES);
    const steals = s.rounds.flatMap((r) => r.items).filter((i) => i.kind === "voteStolen");
    expect(steals).toEqual([{ kind: "voteStolen", blackmailer: "p0", victim: "p1", meetingId: "emergency-p6", decided: true }]);
  });

  it("the same steal across the swap that did not decide (no majority) reads decided: false", () => {
    const after = run(crossed("qa55-dc"), vote("p0", "p2"), vote("p3", "p2"), vote("p4", null), vote("p1", null), vote("p5", null), vote("p6", null), close);
    expect(after.log.find((e) => e.type === "meetingClosed")).not.toMatchObject({ result: { kind: "shakedown" } });
    const s = revealSummary(after.log, outcomeFor(after, null), TABLES);
    expect(s.rounds.flatMap((r) => r.items).filter((i) => i.kind === "voteStolen")).toEqual([{ kind: "voteStolen", blackmailer: "p0", victim: "p1", meetingId: "emergency-p6", decided: false }]);
  });
});
