// Bot role claims and bluffs, and claims in the suspicion model. docs/roles-v2.md §4; design §8, §12.1, §17.3
import { describe, expect, it } from "vitest";
import { handleCommand, viewFor, type GameState, type PlayerCommand } from "@skimjob/engine";
import { PERSONALITIES, type Personality } from "./personalities";
import { decide, type Random } from "./bot";
import { accused, bluffFor, chooseClaim, publicSuspicion } from "./claims";
import { SUSPICION_WEIGHTS, suspicion } from "./suspicion";
import { game, run } from "./testkit";

/** A personality with no noise or misreading at votes, so a test can pin its behaviour. */
const exact = (base: Personality, change: Partial<Personality> = {}): Personality => ({ ...base, noise: 0, misread: 0, hunch: 0, ...change });
const rolls = (...values: number[]): Random => () => values.shift() ?? 0.5;

const withRole = (s: GameState, player: string, role: string): GameState => {
  const me = s.players[player] as GameState["players"][string];
  return { ...s, players: { ...s.players, [player]: { ...me, role } } };
};
/** Ana is the target of a shakedown that has just passed (the shakedown window). */
const pending = (s: GameState, target = "ana"): GameState => ({ ...s, phase: { kind: "shakedownPending", meetingId: "meeting-1", target } });
/** A regular meeting is due: claims are made now (v2 §4), but nobody accuses ana. */
const awaiting = (s: GameState): GameState => ({ ...s, phase: { kind: "awaitingMeeting", meeting: "regular", meetingId: "meeting-1" } });
const claims = (cmds: PlayerCommand[]) => cmds.filter((c) => c.type === "claimRole");

describe("bot claims — docs/roles-v2.md §4", () => {
  it("a crew bot claims its true role when accused, with chance 1 − its lie", () => {
    const s = pending(withRole(game(5), "ana", "lookout"));
    expect(accused(viewFor(s, "ana"))).toBe("shakedown");
    expect(chooseClaim(viewFor(s, "ana"), exact(PERSONALITIES.honest), rolls(0.99))).toBe("lookout"); // lie 0: always
    expect(chooseClaim(viewFor(s, "ana"), exact(PERSONALITIES.opportunist), rolls(0.05))).toBe("lookout"); // lie 0.9: 10%
    expect(chooseClaim(viewFor(s, "ana"), exact(PERSONALITIES.opportunist), rolls(0.2))).toBeNull();
    // Not accused: no claim (the Lookout's own line is "truthfully, with its sightings").
    expect(chooseClaim(viewFor(awaiting(withRole(game(5), "ana", "lookout")), "ana"), exact(PERSONALITIES.honest), rolls(0))).toBeNull();
  });

  it("claims only around meetings, once between meetings, and the engine accepts the claim", () => {
    const s = pending(withRole(game(5), "ana", "rookie"));
    const cmds = claims(decide(viewFor(s, "ana"), exact(PERSONALITIES.honest), rolls(0), "test-crew"));
    expect(cmds).toEqual([{ type: "claimRole", player: "ana", role: "rookie" }]);
    const after = run(s, ...cmds);
    expect(claims(decide(viewFor(after, "ana"), exact(PERSONALITIES.honest), rolls(0), "test-crew"))).toEqual([]);
    // Planning, no meeting coming: never.
    expect(chooseClaim(viewFor(withRole(game(5), "ana", "rookie"), "ana"), exact(PERSONALITIES.honest), rolls(0))).toBeNull();
  });

  it("per-role lines: the Rookie claims freely; the Auditor, Fixer and Priest don't unprompted", () => {
    const free = (role: string) => chooseClaim(viewFor(awaiting(withRole(game(5), "ana", role)), "ana"), exact(PERSONALITIES.honest), rolls(0));
    expect(free("rookie")).toBe("rookie");
    expect(free("auditor")).toBeNull();
    expect(free("fixer")).toBeNull();
    expect(free("priest")).toBeNull();
  });

  it("the Priest claims only after its own vote", () => {
    const s = withRole(game(5), "ana", "priest");
    const meeting: GameState = { ...pending(s), phase: { kind: "meeting", meetingId: "meeting-1" } } as GameState;
    // Accused through an open-mode ballot isn't needed here: a pending shakedown has no vote to wait for.
    expect(chooseClaim(viewFor(pending(s), "ana"), exact(PERSONALITIES.honest), rolls(0), true)).toBeNull();
    expect(chooseClaim(viewFor(meeting, "ana"), exact(PERSONALITIES.honest), rolls(0), false)).toBeNull();
  });

  // extension.md Build notes "Bots": ★ and evidence-leaving roles bluff a low-risk role on the role list nobody else claimed.
  it("a ★ bot bluffs a safe role when accused, never one someone else claimed", () => {
    // The Starter pool's Exact role list: rookie, lookout.
    const mole = pending(withRole(game(5), "ana", "mole"));
    expect(chooseClaim(viewFor(mole, "ana"), exact(PERSONALITIES.greedy), rolls(0))).toBe("rookie");
    const taken = run(mole, { type: "claimRole", player: "ben", role: "rookie" });
    expect(bluffFor(viewFor(taken, "ana"))).toBeNull();
    expect(bluffFor(viewFor(pending(withRole(game(5), "ana", "hacker")), "ana"))).toBe("rookie");
    // Not accused: it keeps quiet.
    expect(chooseClaim(viewFor(awaiting(withRole(game(5), "ana", "mole")), "ana"), exact(PERSONALITIES.greedy), rolls(0))).toBeNull();
    // It sticks to its story in later stretches.
    const told = run(mole, { type: "claimRole", player: "ana", role: "fixer" });
    expect(bluffFor(viewFor(told, "ana"))).toBe("fixer");
  });

  it("someone else claiming my (unique) role counts as an accusation, and I know they lie", () => {
    const s = run(awaiting(withRole(game(5), "ana", "lookout")), { type: "claimRole", player: "ben", role: "lookout" });
    expect(accused(viewFor(s, "ana"))).toBe("suspected");
    const scores = suspicion(viewFor(s, "ana"));
    expect(scores.get("ben")).toBe(SUSPICION_WEIGHTS.falseClaim);
    expect(chooseClaim(viewFor(s, "ana"), exact(PERSONALITIES.honest), rolls(0))).toBe("lookout"); // the counter-claim
  });
});

describe("claims in the suspicion model — v2 §4", () => {
  it("a role claimed twice raises suspicion of both claimants (not the Rookie: Rookies fill seats and repeat)", () => {
    const s = run(game(5), { type: "claimRole", player: "ben", role: "detective" }, { type: "claimRole", player: "carl", role: "detective" }, { type: "claimRole", player: "dee", role: "rookie" }, { type: "claimRole", player: "eve", role: "rookie" });
    const viewer = s.players.ana?.role === "detective" ? "ben" : "ana";
    const scores = suspicion(viewFor(s, viewer));
    for (const id of ["ben", "carl"].filter((x) => x !== viewer)) expect(scores.get(id)).toBe(SUSPICION_WEIGHTS.doubleClaim);
    for (const id of ["dee", "eve"]) expect(scores.get(id)).toBe(SUSPICION_WEIGHTS.claimed);
    const pub = publicSuspicion(viewFor(s, viewer));
    expect(pub.get("ben")).toBeGreaterThan(pub.get("dee") ?? 0);
  });

  it("a Peek catches a lie, and a Peek of a dark role is damning", () => {
    const s = run(game(5), { type: "claimRole", player: "ben", role: "auditor" });
    const peek = (role: string): GameState => ({
      ...s,
      log: [...s.log, { type: "perkUsed", visibility: { kind: "private", player: "ana" }, player: "ana", round: 1, perk: { kind: "peek", target: "ben", role } }],
    });
    expect(suspicion(viewFor(peek("auditor"), "ana")).get("ben")).toBe(SUSPICION_WEIGHTS.claimed);
    expect(suspicion(viewFor(peek("rookie"), "ana")).get("ben")).toBe(SUSPICION_WEIGHTS.falseClaim);
    expect(suspicion(viewFor(peek("mole"), "ana")).get("ben")).toBe(SUSPICION_WEIGHTS.falseClaim + SUSPICION_WEIGHTS.knownDark);
  });

  it("changing one's claimed role is suspicious", () => {
    let s = run(game(5), { type: "claimRole", player: "ben", role: "rookie" });
    s = { ...s, stretch: 2 }; // after a regular meeting
    const r = handleCommand(s, { type: "claimRole", player: "ben", role: "fixer" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(suspicion(viewFor(r.state, "ana")).get("ben")).toBe(SUSPICION_WEIGHTS.falseClaim / 2 + SUSPICION_WEIGHTS.claimed);
  });
});
