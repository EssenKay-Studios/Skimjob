// QA (PR #37): adversarial checks on the claimRole command. design §8, §12.1, §16.1, §17.2
import { STARTER_ROLES } from "@skimjob/content";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState } from "./types";
import { createGame } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { handleThroughAlibis } from "./alibis.testkit";

const cfg = (n: number, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: `qa-claim-${n}`,
  players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false })),
  job: "bank",
  rolePool: [...STARTER_ROLES],
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
const roundAdvance = (s: GameState): GameState => {
  const round = s.round;
  const r = handleThroughAlibis(s, { type: "advance", deadline: { kind: "round", round } });
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

describe("claimRole — QA PR #37, design §8, §12.1", () => {
  it("hostile extra fields can't forge the event: only player, role, the real act and public visibility — design §8", () => {
    const s = createGame(cfg(4));
    const { events } = step(s, { type: "claimRole", player: "p1", role: "lookout", act: 3, visibility: { kind: "secret", player: "p1" }, round: 9 });
    expect(events).toEqual([{ type: "roleClaimed", visibility: { kind: "public" }, player: "p1", role: "lookout", act: 1 }]);
  });

  it("refuses hostile player ids (prototype keys, non-strings) without throwing", () => {
    const s = createGame(cfg(4));
    for (const player of ["__proto__", "constructor", "hasOwnProperty", "", 0, null, undefined, {}, ["p0"]]) {
      expect(refused(s, { type: "claimRole", player, role: "rookie" })).toMatch(/unknown player/);
    }
    expect(refused(s, { type: "claimRole", role: "rookie" })).toMatch(/unknown player/);
  });

  it("a repeated or changed claim in the same act is refused, and the refusal leaves the log as it was", () => {
    const first = step(createGame(cfg(4)), { type: "claimRole", player: "p0", role: "fixer" }).state;
    for (const role of ["fixer", "auditor", "mole"]) expect(refused(first, { type: "claimRole", player: "p0", role })).toMatch(/already claimed/);
    // An unknown role is reported as unknown, even after an earlier claim (no hint either way).
    expect(refused(first, { type: "claimRole", player: "p0", role: "zzz" })).toMatch(/unknown role/);
    expect(first.log.filter((e) => e.type === "roleClaimed")).toHaveLength(1);
  });

  it("allowed in every live phase (planning, alibis, awaitingMeeting, meeting) and in each act, once — design §8", () => {
    let s = createGame(cfg(4));
    const phases: string[] = [];
    const tryClaim = (player: string, role: string) => {
      phases.push(s.phase.kind);
      s = step(s, { type: "claimRole", player, role }).state;
    };
    tryClaim("p0", "rookie"); // planning, act 1
    s = step(s, { type: "advance", deadline: { kind: "round", round: 1 } }).state;
    expect(s.phase.kind).toBe("alibis");
    tryClaim("p1", "auditor");
    s = step(s, { type: "advance", deadline: { kind: "alibis", round: 1 } }).state;
    s = roundAdvance(roundAdvance(s));
    expect(s.phase.kind).toBe("awaitingMeeting");
    tryClaim("p2", "fixer");
    s = step(s, { type: "scheduleMeeting", act: 1, slot: "now" }).state;
    s = step(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } }).state;
    tryClaim("p3", "lookout");
    expect(phases).toEqual(["planning", "alibis", "awaitingMeeting", "meeting"]);
  });

  it("claims in every act up to the round cap, then refused once the game really ends (played out, not a patched phase)", () => {
    let s = createGame(cfg(3));
    const acts: number[] = [];
    for (let guard = 0; s.phase.kind !== "ended" && guard < 100; guard++) {
      const r = handleCommand(s, { type: "claimRole", player: "p0", role: "rookie" });
      if (r.ok) {
        acts.push((r.events[0] as Extract<GameEvent, { type: "roleClaimed" }>).act);
        s = r.state;
      }
      if (s.phase.kind === "awaitingMeeting") {
        const act = s.phase.act;
        s = step(s, { type: "scheduleMeeting", act, slot: "now" }).state;
        s = step(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: `act-${act}` } }).state;
      } else if (s.phase.kind === "meeting") {
        s = step(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: s.phase.meetingId } }).state;
      } else if (s.phase.kind === "planning") {
        s = roundAdvance(s);
      } else if (s.phase.kind === "alibis") {
        s = step(s, { type: "advance", deadline: { kind: "alibis", round: s.phase.round } }).state;
      } else if (s.phase.kind !== "ended") throw new Error(`unexpected phase ${s.phase.kind}`);
    }
    expect(s.phase.kind).toBe("ended");
    expect(acts).toEqual([1, 2, 3, 4]); // rounds 10–12 are act 4, with no meeting after them (design §6.2)
    expect(refused(s, { type: "claimRole", player: "p1", role: "rookie" })).toMatch(/over/);
  });

  it("works at 3 and 12 players; every viewer (claimant included) sees the same claim; replay is identical — design §13, §17.2", () => {
    for (const n of [3, 12]) {
      const c = cfg(n, { rolePool: [] });
      let s = createGame(c);
      for (let i = 0; i < n; i++) s = step(s, { type: "claimRole", player: `p${i}`, role: i % 2 ? "detective" : "rookie" }).state;
      const claims = s.log.filter((e) => e.type === "roleClaimed");
      expect(claims).toHaveLength(n);
      for (let v = 0; v < n; v++) {
        const seen = viewFor(s, `p${v}`).ledger.filter(({ event }) => event.type === "roleClaimed").map(({ event }) => event);
        expect(seen).toEqual(claims);
      }
      expect(replay(c, s.log)).toEqual(s);
      // Same seed + same commands = same log.
      let t = createGame(c);
      for (let i = 0; i < n; i++) t = step(t, { type: "claimRole", player: `p${i}`, role: i % 2 ? "detective" : "rookie" }).state;
      expect(t.log).toEqual(s.log);
    }
  });

  it("accepts known roles outside the game's pool (the pool stays hidden) — design §8", () => {
    const s = createGame(cfg(4, { rolePool: ["rookie"] }));
    // Not in this game's pool, but known content: accepted.
    expect(step(s, { type: "claimRole", player: "p0", role: "fixer" }).events[0]).toMatchObject({ role: "fixer" });
    expect(step(s, { type: "claimRole", player: "p1", role: "hacker" }).events[0]).toMatchObject({ role: "hacker" });
  });
});
