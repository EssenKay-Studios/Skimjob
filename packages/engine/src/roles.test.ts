// Info and vote roles: Hacker, Smooth talker, Muscle, Blackmailer, Snitch.
// design §8 (and §11.2 / §11.3 where they change votes and shakedowns)
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { BANK_JOB, DEFAULT_ROLE_POOL, ROLES, STARTER_ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId, VoteVisibility } from "./types";
import { privateTo } from "./types";
import { createGame, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "roles-seed",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [],
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    ...extra,
  };
}

/**
 * A new game with chosen roles (seat i gets roles[i], Rookie if missing) and,
 * optionally, Snitch targets. The dealt Snitch targets are dropped.
 */
function game(players: number, roles: string[], extra: Partial<GameConfig> = {}, snitchTargets: Record<PlayerId, PlayerId> = {}): GameState {
  const cfg = config(players, extra);
  const log = setupEvents(cfg)
    .filter((e) => e.type !== "snitchTargetAssigned")
    .flatMap((e, i, all): GameEvent[] => {
      if (e.type !== "roleDealt") return [e];
      const seat = all.slice(0, i).filter((x) => x.type === "roleDealt").length;
      const dealt: GameEvent = { ...e, role: roles[seat] ?? "rookie" };
      const target = snitchTargets[e.player];
      return target ? [dealt, { type: "snitchTargetAssigned", visibility: privateTo(e.player), player: e.player, target }] : [dealt];
    });
  return replay(cfg, log);
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

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { room, pocket, ...extra } });
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const vote = (player: string, target: string | null) => ({
  type: "castVote",
  player,
  vote: target === null ? { kind: "skip" } : { kind: "shakedown", target },
});
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
const cancel = (player: string) => ({ type: "useAbility", player, ability: { kind: "cancelShakedown" } });
/** `caller` calls an emergency meeting and it opens at once. design §11.1 */
const emergency = (s: GameState, caller: string): GameState =>
  run(s, { type: "callEmergency", player: caller }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `emergency-${caller}` } });

const { cleanBelowPerAct } = BANK_JOB.shakedown;
const power = <K extends string>(role: string, kind: K) => {
  const p = ROLES[role]?.power;
  if (p?.kind !== kind) throw new Error(`${role} has no ${kind} power`);
  return p as Extract<NonNullable<typeof p>, { kind: K }>;
};

describe("content — design §8", () => {
  it("the five roles are data, with their numbers, and join the default pool", () => {
    expect(power("hacker", "loopCameras").perAct).toBe(1);
    expect(power("smoothTalker", "voteWeight").weight).toBe(2);
    expect(power("muscle", "cancelShakedown").perGame).toBe(1);
    expect(power("blackmailer", "blackmail")).toEqual({ kind: "blackmail", perAct: 1 }); // v2 §2: steals a vote, not loot
    expect(power("snitch", "snitch").extraVotes).toBe(1); // role deck v2 §2: +Vote for the rest of the game
    for (const r of ["hacker", "smoothTalker", "muscle", "blackmailer", "snitch"]) expect(DEFAULT_ROLE_POOL).toContain(r);
    expect(validateConfig(config(7, { rolePool: ["hacker", "smoothTalker", "muscle", "blackmailer", "snitch"] }))).toEqual([]);
  });

  it("content overrides can tune each power's own numbers, never another role's (design §17.4)", () => {
    const roles = { hacker: { perAct: 2 }, smoothTalker: { weight: 3 }, muscle: { perGame: 2 }, blackmailer: { perAct: 2 }, snitch: { extraVotes: 2 } };
    expect(validateConfig(config(5, { contentOverrides: { roles } }))).toEqual([]);
    expect(validateConfig(config(5, { contentOverrides: { roles: { hacker: { steal: 5 } } } }))).toEqual([expect.stringMatching(/hacker\.steal/)]);
    expect(validateConfig(config(5, { contentOverrides: { roles: { muscle: { perGame: 0 } } } }))).toEqual([expect.stringMatching(/perGame/)]);
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

describe("Blackmailer: guess a role (v2 §2: the vote steal is in dark.test.ts) — design §8", () => {
  // p0 Blackmailer, p1 Fence, p2 Rookie.
  const base = game(3, ["blackmailer", "fence", "rookie"]);
  const guess = (target: string, role: string) => mv("p0", "lobby", 0, { ability: { kind: "blackmail", target, role } });

  it("a right or wrong guess takes nothing from any stash (v2 §2); only a right one tells the target", () => {
    const right = run(base, guess("p1", "fence"), mv("p1", "vault", 6), ROUND);
    expect(ofType(since(base, right), "abilityResolved").find((e) => e.player === "p0")?.ability).toEqual({ kind: "blackmail", target: "p1", role: "fence", correct: true });
    expect(ofType(since(base, right), "voteCompromised")).toEqual([{ type: "voteCompromised", visibility: privateTo("p1"), player: "p1", round: 1 }]);
    expect([right.players.p0?.stash, right.players.p1?.stash]).toEqual([0, 6]);
    const wrong = run(base, guess("p1", "rookie"), ROUND);
    expect(ofType(since(base, wrong), "abilityResolved")[0]?.ability).toMatchObject({ correct: false });
    expect(ofType(since(base, wrong), "voteCompromised")).toEqual([]);
  });

  it("once per act; not yourself; a known role; only the Blackmailer", () => {
    const s = run(base, guess("p2", "rookie"), ROUND);
    expect(reason(s, guess("p1", "fence"))).toMatch(/already blackmailed/);
    expect(reason(base, guess("p0", "blackmailer"))).toMatch(/yourself/);
    expect(reason(base, guess("p9", "rookie"))).toMatch(/unknown player/);
    expect(reason(base, guess("p1", "wizard"))).toMatch(/unknown role/);
    expect(() => run(base, guess("p1", "mole"))).not.toThrow(); // the Mole is a role you can guess
    expect(reason(base, mv("p2", "lobby", 0, { ability: { kind: "blackmail", target: "p1", role: "fence" } }))).toMatch(/no blackmail/);
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

describe("Muscle: cancel a shakedown after the vote passes — design §8, §11.3", () => {
  // 3 players, p0 Muscle; p1 pockets the Vault's 6 in round 1, then p0 and p2 vote p1 down.
  const setup = (roles: string[], extra: Partial<GameConfig> = {}) => {
    const s = run(game(3, roles, extra), mv("p1", "vault", 6), ROUND);
    return run(emergency(s, "p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
  };

  it("a passed shakedown waits in a public window; nothing is taken yet", () => {
    const s = setup(["muscle"]);
    expect(s.phase).toEqual({ kind: "shakedownPending", meetingId: "emergency-p2", target: "p1" });
    expect(s.log.at(-1)).toMatchObject({ type: "shakedownPending", visibility: { kind: "public" }, kind: "emergency", act: 1, target: "p1" });
    expect(s.players.p1?.stash).toBe(6);
  });

  it("the window opens whenever the pool holds the Muscle, dealt or not, so it never tells who is in the crew", () => {
    expect(setup([]).phase.kind).toBe("shakedownPending"); // default pool, no Muscle dealt
    const starter = setup([], { rolePool: [...STARTER_ROLES] });
    expect(starter.phase.kind).toBe("planning");
    expect(ofType(starter.log, "shakedownResolved")).toHaveLength(1);
  });

  it("without a cancel, the shakedown is applied when the window ends", () => {
    const s = setup(["muscle"]);
    const after = run(s, RESOLVE);
    expect(since(s, after).map((e) => e.type)).toEqual(["shakedownResolved"]);
    expect(after.players.p1?.stash).toBe(0);
    expect(after.phase).toEqual({ kind: "planning", round: 2 });
  });

  it("the Muscle's cancel is private until the window ends; then the ledger says it was cancelled, and names the Muscle as the target was dirty (v2 §2)", () => {
    const s = setup(["muscle"]);
    const cancelled = run(s, cancel("p0"));
    expect(cancelled.log.at(-1)).toMatchObject({ type: "abilityResolved", visibility: { kind: "private", player: "p0" }, ability: { kind: "cancelShakedown", meetingId: "emergency-p2", target: "p1" } });
    // Nobody else's view changes when the Muscle acts.
    for (const id of ["p1", "p2"]) expect(JSON.stringify(viewFor(cancelled, id))).toBe(JSON.stringify(viewFor(s, id)));
    const after = run(cancelled, RESOLVE);
    expect(since(cancelled, after)).toEqual([
      { type: "shakedownCancelled", visibility: { kind: "public" }, meetingId: "emergency-p2", target: "p1" },
      { type: "muscleNamed", visibility: { kind: "public" }, meetingId: "emergency-p2", player: "p0", target: "p1" },
    ]);
    expect(after.players.p1).toMatchObject({ stash: 6, timesShakenDown: 0 });
    expect(after.players.p0?.roleState.usedThisGame).toBe(1);
    expect(after.phase).toEqual({ kind: "planning", round: 2 });
  });

  it("the Muscle may cancel their own shakedown (provisional)", () => {
    let s = run(game(3, ["rookie", "muscle"]), mv("p1", "vault", 6), ROUND);
    s = run(emergency(s, "p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE, cancel("p1"), RESOLVE);
    expect(s.players.p1?.stash).toBe(6);
  });

  it("once per game, only in the window, only the Muscle", () => {
    const s = setup(["muscle"]);
    expect(reason(s, cancel("p2"))).toMatch(/no cancelShakedown/);
    expect(reason(s, { type: "useAbility", player: "p0", ability: { kind: "loopCameras" } })).toMatch(/no loopCameras/);
    expect(reason(s, { type: "useAbility", player: "p0", ability: "cancel" })).toMatch(/object with a kind/);
    expect(reason(run(s, cancel("p0")), cancel("p0"))).toMatch(/already cancelled/);
    expect(reason(game(3, ["muscle"]), cancel("p0"))).toMatch(/no shakedown is pending/);
    // A second shakedown later in the game can't be cancelled.
    let later = run(s, cancel("p0"), RESOLVE, mv("p1", "vault", 6), ROUND);
    later = run(emergency(later, "p0"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(reason(later, cancel("p0"))).toMatch(/already cancelled a shakedown this game/);
  });

  it("while the window is open: no rounds, no new meetings or proposals, and only the pending meeting's deadline", () => {
    const s = setup(["muscle"]);
    expect(reason(s, ROUND(s))).toMatch(/paused/);
    expect(reason(s, mv("p0", "lobby"))).toMatch(/round is being planned/);
    expect(reason(s, { type: "callEmergency", player: "p0" })).toMatch(/shakedown is pending/);
    expect(reason(s, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: "act-1" } })).toMatch(/no shakedown is pending/);
    expect(reason(s, CLOSE(s))).toMatch(/not open/);
  });

  it("after the act's regular meeting the checkpoint comes once the window ends (design §11.4)", () => {
    let s = run(game(3, ["muscle"]), mv("p1", "vault", 6), ROUND, ROUND, ROUND);
    s = run(s, { type: "scheduleMeeting", act: 1, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } });
    s = run(s, vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    expect(reason(s, { type: "proposeMeeting", player: "p0", slot: "y" })).toMatch(/already scheduled/);
    const after = run(s, RESOLVE);
    // design §8.3 (v2 §2): the two Rookies' Tails for the checkpoint made.
    expect(since(s, after).map((e) => e.type)).toEqual(["shakedownResolved", "checkpointChecked", "perkGranted", "perkGranted", "roundStarted"]);
    expect(after.round).toBe(4);
  });
});

describe("Snitch: a secret target — design §8", () => {
  it("each dealt Snitch gets a private target, another player, at setup (deterministic)", () => {
    for (let i = 0; i < 20; i++) {
      const cfg = config(6, { seed: `snitch-${i}`, rolePool: ["snitch"] });
      const events = setupEvents(cfg);
      const snitch = ofType(events, "roleDealt").find((e) => e.role === "snitch");
      const targets = ofType(events, "snitchTargetAssigned");
      expect(targets).toHaveLength(1);
      expect(targets[0]).toMatchObject({ visibility: { kind: "private", player: snitch?.player }, player: snitch?.player });
      expect(targets[0]?.target).not.toBe(snitch?.player);
      expect(cfg.players.map((p) => p.id)).toContain(targets[0]?.target);
      expect(createGame(cfg).players[snitch?.player as string]?.roleState.target).toBe(targets[0]?.target);
      expect(setupEvents(cfg)).toEqual(events);
    }
    // No Snitch, no target.
    expect(ofType(setupEvents(config(4, { starterMode: true })), "snitchTargetAssigned")).toEqual([]);
  });

  // p0 Snitch with target p1; p1 pockets `pocket` in round 1 and is shaken down in an emergency meeting (act 1).
  const shaken = (pocket: number, extra: Partial<GameConfig> = { rolePool: [...STARTER_ROLES] }) => {
    const s = run(game(3, ["snitch"], extra, { p0: "p1" }), mv("p1", "vault", pocket), ROUND);
    return run(emergency(s, "p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
  };
  const votes = power("snitch", "snitch").extraVotes;

  it("rewarded privately when the target is shaken down holding at least the clean threshold (provisional: not clean; v2 §2)", () => {
    const s = shaken(cleanBelowPerAct * 1);
    const paid = ofType(s.log, "snitchRewarded");
    expect(paid).toEqual([{ type: "snitchRewarded", visibility: privateTo("p0"), player: "p0", meetingId: "emergency-p2", target: "p1", votes }]);
    expect(s.players.p0?.stash).toBe(0);
    expect(s.players.p0?.roleState.bonusVotes).toBe(votes);
  });

  it("not paid when the target is clean", () => {
    const s = shaken(cleanBelowPerAct - 1);
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(true);
    expect(ofType(s.log, "snitchRewarded")).toEqual([]);
  });

  it("not paid when someone else is shaken down, or when the Muscle cancels the shakedown", () => {
    let s = run(game(3, ["snitch"], { rolePool: [...STARTER_ROLES] }, { p0: "p2" }), mv("p1", "vault", 6), ROUND);
    s = run(emergency(s, "p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(ofType(s.log, "snitchRewarded")).toEqual([]);
    let m = run(game(3, ["snitch", "rookie", "muscle"], {}, { p0: "p1" }), mv("p1", "vault", 6), ROUND);
    m = run(emergency(m, "p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE, cancel("p2"), RESOLVE);
    expect(ofType(m.log, "snitchRewarded")).toEqual([]);
  });

  it("the reward weighs in every later meeting: the Snitch's ballot alone is a majority of 3 (v2 §2)", () => {
    // After the reward p0 weighs 2 of 3: its lone vote shakes down p2 against p1's skip.
    let s = run(shaken(cleanBelowPerAct), mv("p2", "vault", 6), ROUND);
    s = run(emergency(s, "p1"), vote("p0", "p2"), { type: "castVote", player: "p1", vote: { kind: "skip" } }, CLOSE);
    expect(ofType(s.log, "meetingClosed").at(-1)?.result).toEqual({ kind: "shakedown", target: "p2" });
  });
});
