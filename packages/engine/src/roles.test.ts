// Info and vote roles: Hacker, Smooth talker.
// design §8 (and §11.2 / §11.3 where they change votes and shakedowns)
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { BANK_JOB, POOL_ROLES, ROLES, STARTER_ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId, VoteVisibility } from "./types";
import { privateTo } from "./types";
import { createGame, setupEvents, validateConfig } from "./setup";
import { opensShakedownWindow } from "./meeting";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { fullGrab } from "./grab.testkit";
import { R6_COINS } from "./v01-numbers.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "roles-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
    contentOverrides: { ...R6_COINS, ...extra.contentOverrides }, // R6 room yields as coins (R6 role rules)
  };
}

/**
 * A new game with chosen roles (seat i gets roles[i], Rookie if missing).
 */
function game(players: number, roles: string[], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  let seat = 0;
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "rookie" } : e)));
}

type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, typeof c === "function" ? c(s) : c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(typeof c === "function" ? c(s) : c)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const before = JSON.stringify(state);
  const r = handleThroughAlibis(state, command);
  if (r.ok) throw new Error("expected a rejection");
  expect(JSON.stringify(state)).toBe(before);
  return r.reason;
}
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, pocket, R6_COINS), ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const vote = (player: string, target: string | null) => ({
  type: "castVote",
  player,
  vote: target === null ? { kind: "skip" } : { kind: "shakedown", target },
});
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
/** `caller` calls an emergency meeting and it opens at once. design §11.1 */
const emergency = (s: GameState, caller: string): GameState =>
  run(s, { type: "callEmergency", player: caller }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `emergency-${caller}` } });

const { cleanBelow } = BANK_JOB.shakedown;
const power = <K extends string>(role: string, kind: K) => {
  const p = ROLES[role]?.power;
  if (p?.kind !== kind) throw new Error(`${role} has no ${kind} power`);
  return p as Extract<NonNullable<typeof p>, { kind: K }>;
};

describe("content — design §8", () => {
  it("content overrides can tune each power's own numbers, never another role's (design §17.4)", () => {
    const roles = { hacker: { perAct: 2 }, smoothTalker: { weight: 3 }, mole: { perAct: 2 } };
    expect(validateConfig(config(5, { contentOverrides: { roles } }))).toEqual([]);
    expect(validateConfig(config(5, { contentOverrides: { roles: { hacker: { steal: 5 } as never } } }))).toEqual([expect.stringMatching(/hacker\.steal/)]);
    expect(validateConfig(config(5, { contentOverrides: { roles: { mole: { perAct: 0 } } } }))).toEqual([expect.stringMatching(/mole\.perAct/)]);
  });
});

describe("Hacker: loop the cameras — design §8", () => {
  // p0 Hacker in the Vault, p1 Security watching the Vault, p2 Lookout watching the Vault, p3 also in the Vault.
  const base = game(4, ["hacker", "rookie", "lookout", "rookie"]);
  const loop = (room = "vault") => mv("p0", "vault", 2, { ability: { kind: "loopCameras", room } });
  const played = (s: GameState) =>
    run(s, loop(), mv("p1", "security", 0, { watch: "vault" }), mv("p2", "office", 0, { ability: { kind: "lookout", rooms: ["vault"] } }), mv("p3", "vault"), ROUND);

  it("Security sees the looped room as empty that round; the Lookout and room-mates still see who was there", () => {
    const after = played(base);
    const events = since(base, after);
    expect(ofType(events, "roomWatched").find((e) => e.source === "security")).toMatchObject({ player: "p1", room: "vault", seen: [] });
    expect(ofType(events, "roomWatched").find((e) => e.source === "lookout")).toMatchObject({ player: "p2", room: "vault", seen: ["p0", "p3"] });
    expect(ofType(events, "roomSighting").find((e) => e.player === "p3")?.others).toEqual(["p0"]);
    // Only the Hacker learns the power was used.
    expect(ofType(events, "abilityResolved").find((e) => e.player === "p0")).toMatchObject({
      visibility: { kind: "private", player: "p0" },
      ability: { kind: "loopCameras", room: "vault" },
    });
    expect(after.players.p0?.roleState.usedThisAct).toBe(1);
  });

  it("without the loop, Security sees everyone in the room", () => {
    const after = run(base, mv("p0", "vault", 2), mv("p1", "security", 0, { watch: "vault" }), ROUND);
    expect(ofType(since(base, after), "roomWatched")[0]?.seen).toEqual(["p0"]);
  });

  it("once per act: refused again in the same act, allowed when the next act starts", () => {
    let s = played(base);
    expect(reason(s, loop())).toMatch(/already looped/);
    s = run(s, ROUND, ROUND, { type: "scheduleMeeting", act: 1, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } }, CLOSE);
    expect(s.round).toBe(4);
    expect(s.players.p0?.roleState.usedThisAct).toBe(0);
    expect(() => run(s, loop("office"))).not.toThrow();
  });

  it("only the Hacker can loop, and only a room in play", () => {
    expect(reason(base, mv("p1", "vault", 0, { ability: { kind: "loopCameras", room: "vault" } }))).toMatch(/no loopCameras/);
    expect(reason(base, loop("tellerLine"))).toMatch(/room in play/);
    expect(reason(base, loop(7 as unknown as string))).toMatch(/room in play/);
  });
});

describe("Smooth talker: their vote counts double — design §8, §11.2", () => {
  // 5 players: p0 Smooth talker. p0 → p4, p1 → p4, p2 + p3 skip (p4 stays away). Weight 3 of 5: passes.
  const play = (roles: string[], mode: VoteVisibility = "hiddenThenRevealed") => {
    const s = emergency(game(5, roles, { voteVisibility: mode, rolePool: [...STARTER_ROLES, "smoothTalker"] }), "p3");
    return run(s, vote("p0", "p4"), vote("p1", "p4"), vote("p2", null), vote("p3", null), CLOSE);
  };

  it.each(["hiddenThenRevealed", "open", "secret"] as const)(
    "%s: the double vote decides the result; the public tally counts one per ballot, so it never singles the Smooth talker out",
    (mode) => {
      const closed = ofType(play(["smoothTalker"], mode).log, "meetingClosed").at(-1);
      expect(closed?.result).toEqual({ kind: "shakedown", target: "p4" });
      expect(closed?.tally).toEqual({ skip: 2, targets: { p4: 2 } });
      expect(closed?.ballots === null).toBe(mode === "secret");
      // Without a Smooth talker the same ballots are a tie.
      expect(ofType(play([], mode).log, "meetingClosed").at(-1)?.result).toEqual({ kind: "noMajority" });
    },
  );

  it("quorum counts voters, not weight: 2 voters in a crew of 5 is no quorum even with a double vote", () => {
    const s = emergency(game(5, ["smoothTalker"]), "p3");
    const after = run(s, vote("p0", "p4"), vote("p1", "p4"), CLOSE);
    expect(ofType(after.log, "meetingClosed").at(-1)?.result).toEqual({ kind: "noQuorum" });
  });

  it("a sealed vote counts double too; skips weigh double as well", () => {
    let s = run(game(5, ["smoothTalker"]), { type: "sealVote", player: "p0", vote: { kind: "skip" } });
    s = emergency(s, "p3");
    s = run(s, vote("p1", "p4"), vote("p2", "p4"), vote("p3", null), CLOSE); // skip weight 3 of 5
    expect(ofType(s.log, "meetingClosed").at(-1)).toMatchObject({ tally: { skip: 2, targets: { p4: 2 } }, result: { kind: "skipped" } });
  });

  it("the power is passive: it can't be used in a move", () => {
    expect(reason(game(3, ["smoothTalker"]), mv("p0", "lobby", 0, { ability: { kind: "voteWeight" } }))).toMatch(/isn't used in a move/);
  });
});


describe("the shakedown window (a Shield in the shop) — design §8.3, §11.3", () => {
  // The shop pinned with a Shield, so a passed shakedown waits for its window (extension.md "Shakedowns").
  const shielded = (s: GameState): GameState => ({ ...s, shop: ["peek", "shield", "extraVote"] });
  // 3 players; p1 pockets the Vault's 6 in round 1, then p0 and p2 vote p1 down.
  const setup = () => {
    const s = run(shielded(game(3, [])), mv("p1", "vault", 6), ROUND);
    return run(emergency(s, "p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
  };

  it("the window opens only when the shop holds a Shield", () => {
    expect(opensShakedownWindow(["peek", "alibi", "extraVote"])).toBe(false);
    expect(opensShakedownWindow(["peek", "shield", "extraVote"])).toBe(true);
    // No Shield in the shop: a passed shakedown is applied at once, no shakedownPending.
    const s = run({ ...game(3, []), shop: ["peek", "alibi", "extraVote"] }, mv("p1", "vault", 6), ROUND);
    const closed = run(emergency(s, "p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(closed.log.some((e) => e.type === "shakedownPending")).toBe(false);
    expect(closed.players.p1?.stash).toBe(0);
  });

  it("a passed shakedown waits in a public window; nothing is taken yet", () => {
    const s = setup();
    expect(s.phase).toEqual({ kind: "shakedownPending", meetingId: "emergency-p2", target: "p1" });
    expect(s.log.at(-1)).toMatchObject({ type: "shakedownPending", visibility: { kind: "public" }, kind: "emergency", act: 1, target: "p1" });
    expect(s.players.p1?.stash).toBe(6);
  });

  it("without a Shield, the shakedown is applied when the window ends", () => {
    const s = setup();
    const after = run(s, RESOLVE);
    expect(since(s, after).map((e) => e.type)).toEqual(["shakedownResolved"]);
    expect(after.players.p1?.stash).toBe(0);
    expect(after.phase).toEqual({ kind: "planning", round: 2 });
  });

  it("while the window is open: no rounds, no new meetings or proposals, and only the pending meeting's deadline", () => {
    const s = setup();
    expect(reason(s, ROUND(s))).toMatch(/paused/);
    expect(reason(s, mv("p0", "lobby"))).toMatch(/round is being planned/);
    expect(reason(s, { type: "callEmergency", player: "p0" })).toMatch(/shakedown is pending/);
    expect(reason(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "act-1" } })).toMatch(/no shakedown is pending/);
    expect(reason(s, CLOSE(s))).toMatch(/not open/);
  });

  it("after the act's regular meeting the checkpoint comes once the window ends (design §11.4)", () => {
    // p1 pockets the Vault's 6; everyone else hands in the Lobby's 2: Haul 16, 22 after the shakedown (target 18).
    const lobby = (...ids: string[]) => ids.map((id) => mv(id, "lobby"));
    let s = run(shielded(game(3, [])), mv("p1", "vault", 6), ...lobby("p0", "p2"), ROUND, ...lobby("p0", "p1", "p2"), ROUND, ...lobby("p0", "p1", "p2"), ROUND);
    s = run(s, { type: "scheduleMeeting", act: 1, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } });
    s = run(s, vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    expect(reason(s, { type: "proposeMeeting", player: "p0", slot: "y" })).toMatch(/already scheduled/);
    const after = run(s, RESOLVE);
    // extension.md "Tokens": the three Rookies each earn a token for the target made.
    expect(since(s, after).map((e) => e.type)).toEqual(["shakedownResolved", "checkpointChecked", "tokenEarned", "tokenEarned", "tokenEarned", "roundStarted"]);
    expect(after.round).toBe(4);
  });
});
