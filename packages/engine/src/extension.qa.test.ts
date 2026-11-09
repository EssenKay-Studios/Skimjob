// QA (PR #50, R6a): adversarial tests against docs/extension.md, the R6 rules spec.
// Written against the spec, not the implementation: the win rule, "between
// meetings" windows, shakedowns against the share, the one vote rule.
import { describe, expect, it } from "vitest";
import { handleThroughResult } from "./result.testkit";
import { handleCommand } from "./handle";
import type { GameConfig, GameEvent, GameState, PlayerId, PlayerState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { outcomeFor, ranking } from "./end";
import { meetingResult } from "./meeting";
import { R6_COINS } from "./v01-numbers.testkit";
import { fullGrab } from "./grab.testkit";

function config(n: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "ext-qa",
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
    contentOverrides: { ...R6_COINS, ...extra.contentOverrides }, // R6 room yields as coins (the scripts' numbers)
  };
}

interface Setup {
  readonly roles?: readonly string[];
}

/** A new game with the setup events rewritten as `setup` asks (seat i gets roles[i], a Lookout if missing). */
function game(cfg: GameConfig, setup: Setup = {}): GameState {
  let seat = 0;
  const log = setupEvents(cfg).flatMap((e): GameEvent[] => {
    if (e.type === "roleDealt") {
      const role = setup.roles ? (setup.roles[seat] ?? "lookout") : e.role;
      seat++;
      return [{ ...e, role }];
    }
    if (e.type === "roleListShown" && setup.roles && e.list === "exact") return [];
    return [e];
  });
  return replay(cfg, log);
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const cmd = typeof c === "function" ? (c as (s: GameState) => unknown)(s) : c;
    const r = handleThroughResult(s, cmd);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(cmd)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const r = handleCommand(state, command);
  if (r.ok) throw new Error(`expected a rejection of ${JSON.stringify(command)}`);
  return r.reason;
}
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, pocket, R6_COINS), ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
/** Steps with the bare engine (no result window skipped), refusing on any rejection. */
function step(s: GameState, ...commands: unknown[]): GameState {
  for (const c of commands) {
    const r = handleCommand(s, c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    s = r.state;
  }
  return s;
}
/** Resolves the round being planned, and `p` spends the crew's emergency in its result window; the meeting opens (design §9.3). */
function withEmergency(s: GameState, p: string): GameState {
  s = step(s, ROUND(s), { type: "callEmergency", player: p });
  return step(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: s.pendingEmergency?.meetingId } });
}
const closeMeeting = (s: GameState) => run(s, { type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
/** Rounds until a regular meeting is due (a third of the bank gone, design §9.1); the server schedules and opens it. */
const toRegularMeeting = (s: GameState): GameState => {
  while (s.phase.kind === "planning") s = run(s, ROUND);
  const meetingId = s.phase.kind === "awaitingMeeting" ? s.phase.meetingId : null;
  return run(s, { type: "scheduleMeeting", meetingId, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId } });
};
const withPlayers = (s: GameState, patch: Record<PlayerId, Partial<PlayerState>>): GameState => ({
  ...s,
  players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, ...(patch[id] ?? {}) }])),
});

describe("the win rule (design §8)", () => {
  const base = () => game(config(4), { roles: ["lookout", "hacker", "mole"] });
  const flat = { stash: 10 };

  it("success: the top group wins, whatever the roles; full ties share", () => {
    const s = withPlayers(base(), { p0: flat, p1: flat, p2: { ...flat, stash: 9 }, p3: { ...flat, stash: 1 } });
    expect([...outcomeFor(s, null).winners].sort()).toEqual(["p0", "p1"]);
  });

  it("ties: no tie-break, everyone level at the top wins (design §8.5)", () => {
    const s = withPlayers(base(), { p0: { ...flat }, p1: flat, p2: { ...flat }, p3: { ...flat, stash: 0 } });
    expect(outcomeFor(s, null).winners).toEqual(["p0", "p1", "p2"]);
  });

  it("sunk by theft: only the Mole or Fixer at the top wins; one outside the top group never does (design §8.4)", () => {
    const tied = withPlayers(base(), { p0: flat, p1: flat, p2: flat, p3: flat });
    // Top group = all four; only the Mole wins a heist sunk by theft (design §8.4).
    expect([...outcomeFor(tied, "theft").winners].sort()).toEqual(["p2"]);
    const lookoutTop = withPlayers(base(), { p0: { ...flat, stash: 30 }, p1: flat, p2: flat, p3: flat });
    const out = outcomeFor(lookoutTop, "theft");
    expect(out.winners).toEqual([]);
    expect(out).toMatchObject({ result: "failed", reason: "theft" });
    // The full ranking is still shown on a failure.
    expect(out.ranking.map((r) => r.player)).toEqual(["p0", "p1", "p2", "p3"]);
  });

  it("a bust: the Mole's own rule doesn't help; only the escapees with the biggest stash among them win (design §5.5, §8.3)", () => {
    const tied = withPlayers(base(), { p0: flat, p1: flat, p2: flat, p3: { ...flat, stash: 30 } });
    expect(outcomeFor(tied, "bust", ["p0", "p2"]).winners).toEqual(["p0", "p2"]);
    expect(outcomeFor(tied, "bust", []).winners).toEqual([]);
  });
});

describe("one vote rule for every crew size, 3..12 (extension.md \"Voting\")", () => {
  it("passes when at least half the crew votes and one player has more than half the votes cast", () => {
    for (let n = 3; n <= 12; n++) {
      const half = Math.ceil(n / 2);
      expect(meetingResult(n, half, 0, new Map([["x", half]]), half), `n=${n} quorum`).toEqual({ kind: "shakedown", target: "x" });
      expect(meetingResult(n, half - 1, 0, new Map([["x", half - 1]]), half - 1).kind, `n=${n} below quorum`).toBe("noQuorum");
      // Exactly half of the votes cast is not more than half.
      if (n % 2 === 0) expect(meetingResult(n, n, 0, new Map([["x", n / 2], ["y", n / 2]]), n).kind, `n=${n} split`).toBe("noMajority");
      else expect(meetingResult(n, n, 0, new Map([["x", (n + 1) / 2], ["y", (n - 1) / 2]]), n), `n=${n} bare majority`).toEqual({ kind: "shakedown", target: "x" });
      // Skip wins with more than half; exactly half of each is no majority.
      if (n % 2 === 0) expect(meetingResult(n, n, n / 2, new Map([["x", n / 2]]), n).kind).toBe("noMajority");
    }
    expect(meetingResult(12, 12, 2, new Map([["x", 5], ["y", 3], ["z", 2]]), 12).kind).toBe("noMajority");
    expect(meetingResult(9, 9, 1, new Map([["x", 4], ["y", 2], ["z", 2]]), 9).kind).toBe("noMajority");
  });
});

describe("shakedowns against the share (design §9.6)", () => {
  const shaken = (move: object) => closeMeeting(run(withEmergency(run(game(config(5)), move), "p1"), vote("p1", "p2"), vote("p3", "p2"), vote("p4", "p2")));

  it("whatever is above the share is taken, every coin of it; a target at the share is clean and paid nothing", () => {
    const dirty = shaken(mv("p2", "vault", 5));
    expect(ofType(dirty.log, "shakedownResolved")[0]).toMatchObject({ clean: false, stashRevealed: 5 + dirty.share, taken: 5 });
    expect(dirty.players.p2?.stash).toBe(dirty.share);
    const clean = shaken(mv("p2", "lobby"));
    expect(ofType(clean.log, "shakedownResolved")[0]).toMatchObject({ clean: true, stashRevealed: clean.share, taken: 0 });
    expect([clean.players.p2?.stash, clean.setAside]).toEqual([clean.share, 0]);
  });
});

describe("between-meetings windows (extension.md Build notes \"Between meetings\", gap-fills 2 and 7)", () => {
  const hide = (p: string, room = "vault") => mv(p, "lobby", 0, { ability: { kind: "hide", room } });

  it("a once-between-meetings power stays spent through an emergency meeting and recharges only at the regular meeting (design §9.1, §11.2)", () => {
    // A bank of 40: two-thirds is gone in round 3, after the emergency (design §9.1).
    let s = game(config(5, { contentOverrides: { bank: { coinsPerPlayer: 8 } } }), { roles: ["hacker"] });
    s = run(s, hide("p0"), ROUND);
    expect(handleCommand(s, hide("p0")).ok).toBe(false);
    s = closeMeeting(withEmergency(s, "p1"));
    expect(s.phase.kind).toBe("planning");
    expect(handleCommand(s, hide("p0")).ok).toBe(false);
    s = closeMeeting(toRegularMeeting(s));
    expect(s.phase.kind).toBe("planning");
    expect(handleCommand(s, hide("p0")).ok).toBe(true);
  });

});
