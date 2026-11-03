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
/** Ana is the target of a shakedown that has just passed (the Muscle's window). */
const pending = (s: GameState, target = "ana"): GameState => ({ ...s, phase: { kind: "shakedownPending", meetingId: "act-1", target } });
/** The act's meeting is next: claims are made now (v2 §4), but nobody accuses ana. */
const awaiting = (s: GameState): GameState => ({ ...s, phase: { kind: "awaitingMeeting", act: 1 } });
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

  it("claims only around meetings, once per act, and the engine accepts the claim", () => {
    const s = pending(withRole(game(5), "ana", "rookie"));
    const cmds = claims(decide(viewFor(s, "ana"), exact(PERSONALITIES.honest), rolls(0), "test-crew"));
    expect(cmds).toEqual([{ type: "claimRole", player: "ana", role: "rookie" }]);
    const after = run(s, ...cmds);
    expect(claims(decide(viewFor(after, "ana"), exact(PERSONALITIES.honest), rolls(0), "test-crew"))).toEqual([]);
    // Planning, no meeting coming: never.
    expect(chooseClaim(viewFor(withRole(game(5), "ana", "rookie"), "ana"), exact(PERSONALITIES.honest), rolls(0))).toBeNull();
  });

  it("per-role lines: Rookie, Bagman and Cleaner claim freely; Inside Man only against a shakedown; Snitch never", () => {
    const free = (role: string) => chooseClaim(viewFor(awaiting(withRole(game(5), "ana", role)), "ana"), exact(PERSONALITIES.honest), rolls(0));
    expect(free("rookie")).toBe("rookie");
    expect(free("bagman")).toBe("bagman");
    expect(free("cleaner")).toBe("cleaner");
    expect(free("insideMan")).toBeNull();
    expect(chooseClaim(viewFor(pending(withRole(game(5), "ana", "insideMan")), "ana"), exact(PERSONALITIES.greedy), rolls(0.99))).toBe("insideMan"); // always: it's clean
    expect(chooseClaim(viewFor(pending(withRole(game(5), "ana", "snitch")), "ana"), exact(PERSONALITIES.honest), rolls(0))).toBeNull();
  });

  it("the Priest claims only after its own vote", () => {
    const s = withRole(game(5), "ana", "priest");
    const meeting: GameState = { ...pending(s), phase: { kind: "meeting", meetingId: "act-1" } } as GameState;
    // Accused through an open-mode ballot isn't needed here: a pending shakedown has no vote to wait for.
    expect(chooseClaim(viewFor(pending(s), "ana"), exact(PERSONALITIES.honest), rolls(0), true)).toBeNull();
    expect(chooseClaim(viewFor(meeting, "ana"), exact(PERSONALITIES.honest), rolls(0), false)).toBeNull();
  });

  // extension.md Build notes "Bots": ★ and evidence-leaving roles bluff a low-risk role on the role list nobody else claimed.
  it("a ★ bot bluffs a safe role when accused, never one someone else claimed", () => {
    // The Starter pool's Exact role list: rookie, insideMan, lookout, bagman, cleaner.
    const mole = pending(withRole(game(5), "ana", "mole"));
    expect(chooseClaim(viewFor(mole, "ana"), exact(PERSONALITIES.greedy), rolls(0))).toBe("rookie");
    const taken = run(mole, { type: "claimRole", player: "ben", role: "rookie" });
    expect(bluffFor(viewFor(taken, "ana"))).toBe("bagman");
    const both = run(taken, { type: "claimRole", player: "carl", role: "bagman" });
    expect(bluffFor(viewFor(both, "ana"))).toBe("cleaner");
    expect(bluffFor(viewFor(pending(withRole(game(5), "ana", "hacker")), "ana"))).toBe("rookie");
    // Not accused: it keeps quiet.
    expect(chooseClaim(viewFor(awaiting(withRole(game(5), "ana", "mole")), "ana"), exact(PERSONALITIES.greedy), rolls(0))).toBeNull();
    // It sticks to its story in later acts.
    const told = run(mole, { type: "claimRole", player: "ana", role: "cleaner" });
    expect(bluffFor(viewFor(told, "ana"))).toBe("cleaner");
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
    const s = run(game(5), { type: "claimRole", player: "ben", role: "bagman" });
    const peek = (role: string): GameState => ({
      ...s,
      log: [...s.log, { type: "perkUsed", visibility: { kind: "private", player: "ana" }, player: "ana", round: 1, perk: { kind: "peek", target: "ben", role } }],
    });
    expect(suspicion(viewFor(peek("bagman"), "ana")).get("ben")).toBe(SUSPICION_WEIGHTS.claimed);
    expect(suspicion(viewFor(peek("rookie"), "ana")).get("ben")).toBe(SUSPICION_WEIGHTS.falseClaim);
    expect(suspicion(viewFor(peek("mole"), "ana")).get("ben")).toBe(SUSPICION_WEIGHTS.falseClaim + SUSPICION_WEIGHTS.knownDark);
  });

  it("a Detective's dirty read on a claimed Inside Man (who can't pocket) catches the lie", () => {
    const s = run(game(5), { type: "claimRole", player: "ben", role: "insideMan" });
    const checked: GameState = {
      ...s,
      log: [
        ...s.log,
        { type: "abilityResolved", visibility: { kind: "private", player: "ana" }, player: "ana", round: 1, ability: { kind: "checkStash", target: "ben", threshold: 5, dirty: true } },
      ],
    };
    expect(suspicion(viewFor(checked, "ana")).get("ben")).toBe(SUSPICION_WEIGHTS.checkedDirty + SUSPICION_WEIGHTS.falseClaim);
  });

  it("changing one's claimed role is suspicious", () => {
    let s = run(game(5), { type: "claimRole", player: "ben", role: "rookie" });
    s = { ...s, round: 4 }; // act 2
    const r = handleCommand(s, { type: "claimRole", player: "ben", role: "cleaner" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(suspicion(viewFor(r.state, "ana")).get("ben")).toBe(SUSPICION_WEIGHTS.falseClaim / 2 + SUSPICION_WEIGHTS.claimed);
  });
});
