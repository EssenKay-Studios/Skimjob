// Duel mode: two players, call-outs instead of meetings and votes; checkpoints
// and Heat as normal. design §16.1
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { DEFAULT_ROLE_POOL, type RoomId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { PUBLIC, privateTo } from "./types";
import { rolePoolFor, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { V01_NUMBERS } from "./v01-numbers.testkit";

function config(extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "duel-seed",
    players: [
      { id: "ana", name: "Ana", isBot: false },
      { id: "ben", name: "Ben", isBot: false },
    ],
    job: "bank",
    rolePool: [],
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    duel: true,
    // Pinned numbers: 2p checkpoints 12 / 28 / 44 (design §11.5 at 0.1.0).
    contentOverrides: V01_NUMBERS,
    ...extra,
  };
}

/** A Duel game with chosen roles (Ana, Ben). */
function game(roles: [string, string] = ["rookie", "rookie"], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(extra);
  let seat = 0;
  const log = setupEvents(cfg)
    .filter((e) => e.type !== "snitchTargetAssigned" && e.type !== "moleAllies")
    .map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] as string } : e));
  return replay(cfg, log);
}

function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}

const refusal = (state: GameState, command: unknown): string => {
  const r = handleThroughAlibis(state, command);
  if (r.ok) throw new Error(`accepted ${JSON.stringify(command)}`);
  return r.reason;
};

type Plan = { room?: RoomId; pocket?: number; ability?: unknown };

/** One round: both players move (Office, hand in all, unless told otherwise), then it resolves. */
function round(s: GameState, ana: Plan = {}, ben: Plan = {}, ...before: unknown[]): GameState {
  const mv = (player: PlayerId, p: Plan) => ({
    type: "submitMove",
    player,
    move: { room: p.room ?? "office", pocket: p.pocket ?? 0, ...(p.ability ? { ability: p.ability } : {}) },
  });
  return run(s, ...before, mv("ana", ana), mv("ben", ben), { type: "advance", deadline: { kind: "round", round: s.round } });
}

const callOut = (player: PlayerId) => ({ type: "callOut", player });
const stash = (s: GameState, id: PlayerId) => s.players[id]?.stash;
const resolved = (s: GameState) => s.log.filter((e) => e.type === "callOutResolved");

describe("Duel config — design §16.1", () => {
  it("is valid only with exactly 2 players", () => {
    expect(validateConfig(config())).toEqual([]);
    const three = config({ players: ["a", "b", "c"].map((id) => ({ id, name: id, isBot: false })) });
    expect(validateConfig(three)).toEqual(["Duel mode needs exactly 2 players, got 3"]);
    expect(validateConfig({ ...config(), duel: "yes" })).toEqual(["duel must be a boolean"]);
    // Absent means a normal game.
    const { duel: _, ...plain } = config();
    expect(validateConfig(plain)).toEqual([]);
  });

  it("is announced in the public gameCreated", () => {
    expect(setupEvents(config())[0]).toMatchObject({ type: "gameCreated", visibility: PUBLIC, duel: true });
    expect(setupEvents(config({ duel: false }))[0]).toMatchObject({ duel: false });
  });

  it("never deals the meeting-only roles (Smooth talker, Muscle, Snitch) — provisional", () => {
    const pool = rolePoolFor(config());
    expect(pool).not.toContain("smoothTalker");
    expect(pool).not.toContain("muscle");
    expect(pool).not.toContain("snitch");
    // design §8.1: nor the Inside Man, dealt only from 5 players (owner answers, 1 Nov).
    expect(pool).not.toContain("insideMan");
    expect(pool.length).toBe(DEFAULT_ROLE_POOL.length - 4);
    expect(rolePoolFor(config({ duel: false }))).toEqual(DEFAULT_ROLE_POOL.filter((r) => r !== "insideMan"));
  });
});

describe("Duel has no meetings or votes — design §16.1", () => {
  it("refuses every meeting and vote command", () => {
    const s = game();
    for (const command of [
      { type: "proposeMeeting", player: "ana", slot: "sat" },
      { type: "acceptMeeting", player: "ben", proposalId: "proposal-1" },
      { type: "scheduleMeeting", act: 1, slot: "sat" },
      { type: "callEmergency", player: "ana" },
      { type: "castVote", player: "ana", vote: { kind: "skip" } },
      { type: "sealVote", player: "ana", vote: { kind: "shakedown", target: "ben" } },
    ]) {
      expect(refusal(s, command)).toBe("Duel mode has no meetings or votes");
    }
  });

  it("goes straight from the act's last round to its checkpoint and the next act", () => {
    let s = game();
    for (let r = 0; r < 3; r++) s = round(s);
    expect(s.phase).toEqual({ kind: "planning", round: 4 });
    const tail = s.log.slice(s.log.findIndex((e) => e.type === "roundResolved" && e.round === 3)).map((e) => e.type);
    expect(tail).toEqual(["roundResolved", "alibisClosed", "checkpointChecked", "roundStarted"]);
  });
});

describe("call-outs — design §16.1", () => {
  it("are refused outside Duel mode", () => {
    expect(refusal(game(["rookie", "rookie"], { duel: false }), callOut("ana"))).toBe("call-outs are only played in Duel mode");
  });

  it("are private when made and allowed once per act per player", () => {
    let s = run(game(), callOut("ana"));
    expect(s.log.at(-1)).toEqual({ type: "callOutMade", visibility: privateTo("ana"), player: "ana", act: 1 });
    expect(viewFor(s, "ben").caseFile.some((e) => e.event.type === "callOutMade")).toBe(false);
    expect(refusal(s, callOut("ana"))).toBe("you have already called out your opponent in act 1");
    s = round(s);
    expect(refusal(s, callOut("ana"))).toBe("you have already called out your opponent in act 1");
    s = run(s, callOut("ben")); // Ben's own call this act
    s = round(round(s));
    expect(s.round).toBe(4);
    expect(() => run(s, callOut("ana"))).not.toThrow(); // a new act
    expect(refusal(s, { type: "callOut", player: "zed" })).toBe("unknown player zed");
  });

  it("a caught opponent hands over everything they pocketed that act, last round included", () => {
    let s = round(game(), {}, { pocket: 2 }); // Ben keeps 2 in round 1
    s = round(s, {}, {}, callOut("ana")); // Ana calls in round 2
    s = round(s, {}, { pocket: 1 }); // and Ben keeps 1 more in round 3, after the call
    expect(resolved(s)).toEqual([{ type: "callOutResolved", visibility: PUBLIC, act: 1, caller: "ana", target: "ben", caught: true, amount: 3 }]);
    expect([stash(s, "ana"), stash(s, "ben")]).toEqual([3, 0]);
    // Settled before the checkpoint; the Haul is untouched.
    const types = s.log.map((e) => e.type);
    expect(types.indexOf("callOutResolved")).toBeLessThan(types.indexOf("checkpointChecked"));
    expect(s.haul).toBe(24 - 3);
  });

  it("only this act's pocketing counts", () => {
    let s = round(round(round(game(), {}, { pocket: 4 }))); // Ben pockets in Act 1 only
    s = round(round(round(s, { pocket: 4 }, {}, callOut("ana")), { pocket: 4 }), { pocket: 4 }); // Ana keeps 12 in Act 2
    expect(resolved(s)).toMatchObject([{ act: 2, caller: "ana", caught: false, amount: 10 }]);
    expect([stash(s, "ana"), stash(s, "ben")]).toEqual([2, 14]);
  });

  it("a wrong call pays the opponent 5 × the act number from the caller's stash", () => {
    // Ana keeps 4 + 2 in Act 1; Ben hands everything in.
    let s = round(game(), { pocket: 4 }, {}, callOut("ana"));
    s = round(round(s, { pocket: 2 }));
    expect(resolved(s)).toMatchObject([{ act: 1, caller: "ana", target: "ben", caught: false, amount: 5 }]);
    expect([stash(s, "ana"), stash(s, "ben")]).toEqual([1, 5]);
  });

  it("a wrong call costs at most the caller's stash (provisional)", () => {
    const s = round(round(round(game(), { pocket: 2 }, {}, callOut("ana"))));
    expect(resolved(s)).toMatchObject([{ caught: false, amount: 2 }]);
    expect([stash(s, "ana"), stash(s, "ben")]).toEqual([0, 2]);
  });

  it("never touches the Fence safe (provisional)", () => {
    // Ben (Fence) keeps 4 and hides 4: caught, but there's nothing in the stash to take.
    let s = round(game(["rookie", "fence"]), {}, { pocket: 4, ability: { kind: "fenceSafe", amount: 4 } }, callOut("ana"));
    s = round(round(s));
    expect(resolved(s)).toMatchObject([{ caught: true, amount: 0 }]);
    expect(s.players.ben?.safe).toBe(4);
  });

  it("both players may call in the same act; settled in seat order", () => {
    // Ana keeps 2, Ben keeps 3; both call. Ana takes Ben's 3 first, then Ben takes Ana's 2.
    let s = round(game(), { pocket: 2 }, { pocket: 3 }, callOut("ben"), callOut("ana"));
    s = round(round(s));
    expect(resolved(s)).toMatchObject([
      { caller: "ana", target: "ben", caught: true, amount: 3 },
      { caller: "ben", target: "ana", caught: true, amount: 2 },
    ]);
    expect([stash(s, "ana"), stash(s, "ben")]).toEqual([3, 2]);
  });
});

describe("checkpoints and Heat work as normal — design §16.1, §11.5, §7", () => {
  it("a missed checkpoint adds Heat without a meeting", () => {
    let s = game();
    for (let r = 0; r < 3; r++) s = round(s, { room: "lobby" }, { room: "lobby" }); // 12 = the 0.1.0 target at 2p
    expect(s.log.find((e) => e.type === "checkpointChecked")).toMatchObject({ act: 1, target: 12, haul: 12, met: true });
    const lobby = { room: "lobby" } as const;
    const missed = round(round(round(game(), { room: "lobby", pocket: 1 }, lobby), lobby, lobby), lobby, lobby);
    expect(missed.log.find((e) => e.type === "checkpointChecked")).toMatchObject({ haul: 11, met: false, heatPenalty: 15 });
    expect(missed.phase).toEqual({ kind: "planning", round: 4 });
  });

  it("the final act's call-outs come before the final check, and count in the ranking", () => {
    let s = game();
    for (let r = 1; r <= 8; r++) s = round(s, {}, r === 7 ? { pocket: 4 } : {});
    s = round(s, {}, {}, callOut("ana"));
    expect(s.phase.kind).toBe("ended");
    const types = s.log.map((e) => e.type);
    expect(types.slice(types.lastIndexOf("roundResolved"))).toEqual(["roundResolved", "alibisClosed", "callOutResolved", "checkpointChecked", "gameEnded"]);
    const ended = s.log.at(-1);
    if (ended?.type !== "gameEnded" || ended.outcome.result !== "success") throw new Error("expected a success");
    expect(ended.outcome.winners).toEqual(["ana"]);
    expect(ended.outcome.ranking.map((e) => [e.player, e.stash])).toEqual([["ana", 4], ["ben", 0]]);
  });

  it("a raid in the act's last round ends the game before any call-out is settled", () => {
    // Both in the Vault: +24 Heat a round at 2 players (design §7). 72 after Act 1, 80 after round 5, raid in round 6.
    let s = round(round(round(game(), { room: "vault" }, { room: "vault" }), { room: "vault" }, { room: "vault" }), { room: "vault" }, { room: "vault" });
    s = round(round(s, {}, {}, callOut("ana")));
    expect(s.heat).toBe(80);
    s = round(s, { room: "vault" }, { room: "vault" });
    expect(s.phase.kind).toBe("ended");
    expect(s.log.at(-2)).toMatchObject({ type: "copsRaided", round: 6 });
    expect(resolved(s)).toEqual([]);
    expect(s.log.filter((e) => e.type === "checkpointChecked")).toHaveLength(1);
  });

  it("the wrong-call number is content and can be overridden (design §17.4)", () => {
    const overrides = { ...V01_NUMBERS, duel: { wrongCallOutPerAct: 1 } };
    const s = round(round(round(game(["rookie", "rookie"], { contentOverrides: overrides }), { pocket: 4 }, {}, callOut("ana"))));
    expect(resolved(s)).toMatchObject([{ caught: false, amount: 1 }]);
    expect(validateConfig(config({ contentOverrides: { duel: { wrongCallOutPerAct: -1 } } })).length).toBe(1);
  });

  it("replays to the same state — design §17.2", () => {
    let s = round(game(), { pocket: 1 }, { pocket: 2 }, callOut("ana"), callOut("ben"));
    for (let r = 0; r < 4; r++) s = round(s);
    expect(replay(s.config, s.log)).toEqual(s);
  });
});
