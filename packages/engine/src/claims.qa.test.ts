// QA (PR #37): adversarial checks on the claimRole command. design §11.3, §19.1
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState } from "./types";
import { createGame } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { handleThroughResult } from "./result.testkit";

const cfg = (n: number, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: `qa-claim-${n}`,
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});

function step(s: GameState, command: unknown): { state: GameState; events: readonly GameEvent[] } {
  const r = handleCommand(s, command);
  if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
  return r;
}
const refused = (s: GameState, command: unknown): string => {
  const r = handleCommand(s, command);
  if (r.ok) throw new Error(`expected a refusal of ${JSON.stringify(command)}`);
  return r.reason;
};
const roleClaims = (log: readonly GameEvent[]) => log.flatMap((e) => (e.type === "said" && e.statement.kind === "role" ? [e.statement] : []));
const roundAdvance = (s: GameState): GameState => {
  const round = s.round;
  const r = handleThroughResult(s, { type: "advance", deadline: { kind: "round", round } });
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

describe("claimRole — QA PR #37, design §11.3", () => {
  it("hostile extra fields can't forge the event: only player, role, the real stretch and public visibility — design §11.3", () => {
    const s = createGame(cfg(4));
    const { events } = step(s, { type: "claimRole", player: "p1", role: "lookout", stretch: 3, visibility: { kind: "secret", player: "p1" }, round: 9 });
    expect(events).toEqual([{ type: "said", visibility: { kind: "public" }, statement: { kind: "role", player: "p1", role: "lookout", stretch: 1 } }]);
  });

  it("refuses hostile player ids (prototype keys, non-strings) without throwing", () => {
    const s = createGame(cfg(4));
    for (const player of ["__proto__", "constructor", "hasOwnProperty", "", 0, null, undefined, {}, ["p0"]]) {
      expect(refused(s, { type: "claimRole", player, role: "lookout" })).toMatch(/unknown player/);
    }
    expect(refused(s, { type: "claimRole", role: "lookout" })).toMatch(/unknown player/);
  });

  it("a repeated or changed claim in the same stretch is refused, and the refusal leaves the log as it was", () => {
    const first = step(createGame(cfg(4)), { type: "claimRole", player: "p0", role: "fixer" }).state;
    for (const role of ["fixer", "auditor", "mole"]) expect(refused(first, { type: "claimRole", player: "p0", role })).toMatch(/already claimed/);
    // An unknown role is reported as unknown, even after an earlier claim (no hint either way).
    expect(refused(first, { type: "claimRole", player: "p0", role: "zzz" })).toMatch(/unknown role/);
    expect(first.log.filter((e) => e.type === "said")).toHaveLength(1);
  });

  it("allowed in every live phase (planning, alibi, awaitingMeeting, meeting, result) and in each stretch, once — design §11.3, §10", () => {
    // A bank of 12: round 1's default moves take a third of it, so a regular meeting follows (design §9.1).
    let s = createGame(cfg(4, { contentOverrides: { bank: { coinsPerPlayer: 3 } } }));
    const phases: string[] = [];
    const tryClaim = (player: string, role: string) => {
      phases.push(s.phase.kind);
      s = step(s, { type: "claimRole", player, role }).state;
    };
    tryClaim("p0", "lookout"); // planning, stretch 1
    s = step(s, { type: "advance", deadline: { kind: "round", round: 1 } }).state;
    expect(s.phase.kind).toBe("alibi");
    tryClaim("p1", "auditor");
    s = step(s, { type: "advance", deadline: { kind: "alibi", round: 1 } }).state;
    expect(s.phase.kind).toBe("awaitingMeeting");
    tryClaim("p2", "fixer");
    s = step(s, { type: "scheduleMeeting", meetingId: "meeting-1", slot: "now" }).state;
    s = step(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "meeting-1" } }).state;
    tryClaim("p3", "lookout"); // stretch 2 from here
    s = step(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: "meeting-1" } }).state;
    tryClaim("p0", "detective");
    expect(phases).toEqual(["planning", "alibi", "awaitingMeeting", "meeting", "result"]);
    expect(roleClaims(s.log).map((c) => c.stretch)).toEqual([1, 1, 1, 2, 2]);
  });

  it("claims in every stretch up to the round cap, then refused once the game really ends (played out, not a patched phase)", () => {
    let s = createGame(cfg(3));
    const stretches: number[] = [];
    for (let guard = 0; s.phase.kind !== "ended" && guard < 200; guard++) {
      const r = handleCommand(s, { type: "claimRole", player: "p0", role: "lookout" });
      if (r.ok) {
        stretches.push(roleClaims(r.events)[0]!.stretch);
        s = r.state;
      }
      const p = s.phase;
      if (p.kind === "awaitingMeeting") {
        s = step(s, { type: "scheduleMeeting", meetingId: p.meetingId, slot: "now" }).state;
        s = step(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: p.meetingId } }).state;
      } else if (p.kind === "meeting") {
        s = step(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: p.meetingId } }).state;
      } else if (p.kind === "planning") {
        s = roundAdvance(s);
      } else if (p.kind === "result") {
        s = step(s, { type: "advance", deadline: { kind: "result", round: p.round } }).state;
      } else if (p.kind !== "ended") throw new Error(`unexpected phase ${p.kind}`);
    }
    expect(s.phase.kind).toBe("ended");
    // Default moves take 3 of the 48 coins a round: regular meetings after rounds 6 and 11 (design §9.1).
    expect(stretches).toEqual([1, 2, 3]);
    expect(refused(s, { type: "claimRole", player: "p1", role: "lookout" })).toMatch(/over/);
  });

  it("works at 3 and 12 players; every viewer (claimant included) sees the same claim; replay is identical — design §13, §17.2", () => {
    for (const n of [3, 12]) {
      const c = cfg(n);
      let s = createGame(c);
      for (let i = 0; i < n; i++) s = step(s, { type: "claimRole", player: `p${i}`, role: i % 2 ? "detective" : "lookout" }).state;
      const claims = s.log.filter((e) => e.type === "said");
      expect(claims).toHaveLength(n);
      for (let v = 0; v < n; v++) {
        const seen = viewFor(s, `p${v}`).ledger.filter(({ event }) => event.type === "said").map(({ event }) => event);
        expect(seen).toEqual(claims);
      }
      expect(replay(c, s.log)).toEqual(s);
      // Same seed + same commands = same log.
      let t = createGame(c);
      for (let i = 0; i < n; i++) t = step(t, { type: "claimRole", player: `p${i}`, role: i % 2 ? "detective" : "lookout" }).state;
      expect(t.log).toEqual(s.log);
    }
  });

  it("accepts any known role, dealt in this game or not (the deal stays hidden) — design §11.3", () => {
    const s = createGame(cfg(4));
    // Whatever was dealt, known content is accepted.
    expect(step(s, { type: "claimRole", player: "p0", role: "fixer" }).events[0]).toMatchObject({ statement: { role: "fixer" } });
    expect(step(s, { type: "claimRole", player: "p1", role: "hacker" }).events[0]).toMatchObject({ statement: { role: "hacker" } });
  });
});
