// QA (PR #15): adversarial Duel-mode tests. design §16.1
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { STARTER_ROLES, type RoomId } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId } from "./types";
import { createGame, rolePoolFor, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { V01_NUMBERS } from "./v01-numbers.testkit";

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i === 0 ? "ana" : i === 1 ? "ben" : `p${i}`, name: `P${i}`, isBot: false }));

function config(extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "duel-qa",
    players: seats(2),
    job: "bank",
    rolePool: [],
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: false,
    duel: true,
    contentOverrides: V01_NUMBERS, // 2p checkpoints 12 / 28 / 44
    ...extra,
  };
}

/** Both seats Rookies, so the numbers are exact. */
function game(extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(extra);
  const log = setupEvents(cfg)
    .filter((e) => e.type !== "snitchTargetAssigned" && e.type !== "moleAllies")
    .map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "rookie" } : e));
  return replay(cfg, log);
}

function run(state: GameState, ...commands: unknown[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughAlibis(s, c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}

type Plan = { room?: RoomId; pocket?: number };
const mv = (player: PlayerId, p: Plan = {}) => ({ type: "submitMove", player, move: { room: p.room ?? "office", pocket: p.pocket ?? 0 } });
const adv = (round: number) => ({ type: "advance", deadline: { kind: "round", round } });
const round = (s: GameState, ana: Plan = {}, ben: Plan = {}, ...before: unknown[]) => run(s, ...before, mv("ana", ana), mv("ben", ben), adv(s.round));
const callOut = (player: PlayerId) => ({ type: "callOut", player });
const stashes = (s: GameState) => [s.players.ana?.stash, s.players.ben?.stash];
const resolved = (s: GameState) => s.log.filter((e) => e.type === "callOutResolved");
const types = (s: GameState) => s.log.map((e) => e.type);

describe("QA: Duel config edges — design §16.1", () => {
  it("rejects 1, 3 and 12 players; duel: false is unaffected", () => {
    for (const n of [1, 3, 12]) expect(validateConfig(config({ players: seats(n) }))).toContain(`Duel mode needs exactly 2 players, got ${n}`);
    expect(validateConfig(config({ players: seats(3), duel: false }))).toEqual([]);
  });

  it("works with starter mode: only starter roles", () => {
    const cfg = config({ starterMode: true });
    expect(validateConfig(cfg)).toEqual([]);
    for (const r of rolePoolFor(cfg)) expect(STARTER_ROLES).toContain(r);
  });

  it("a pool of only meeting roles deals Rookies rather than failing", () => {
    const s = createGame(config({ rolePool: ["muscle", "snitch", "smoothTalker"] }));
    expect(Object.values(s.players).map((p) => p.role)).toEqual(["rookie", "rookie"]);
  });
});

describe("QA: no meetings in Duel; non-Duel unchanged — design §16.1, §11.1", () => {
  it("meeting deadlines are refused in Duel", () => {
    const s = game();
    for (const kind of ["openMeeting", "closeMeeting", "resolveShakedown"]) {
      expect(handleThroughAlibis(s, { type: "advance", deadline: { kind, meetingId: "m1" } }).ok, kind).toBe(false);
    }
  });

  it("a 2-player non-Duel game still holds meetings and refuses call-outs", () => {
    const s = game({ duel: false });
    expect(handleThroughAlibis(s, { type: "proposeMeeting", player: "ana", slot: "sat" }).ok).toBe(true);
    expect(handleThroughAlibis(s, { type: "callEmergency", player: "ana" }).ok).toBe(true);
    const after = round(round(round(s)));
    expect(types(after)).not.toContain("checkpointChecked"); // waits for the meeting
  });

  it("call-outs are refused once the game has ended", () => {
    let s = game();
    for (let r = 0; r < 9; r++) s = round(s);
    expect(s.phase.kind).toBe("ended");
    expect(handleThroughAlibis(s, callOut("ana")).ok).toBe(false);
  });
});

describe("QA: call-out settlement — design §16.1", () => {
  it("made in the act's last round, after the opponent moved, covers that round", () => {
    const s = round(round(game()));
    const after = run(s, mv("ben", { pocket: 2 }), callOut("ana"), mv("ana"), adv(3));
    expect(resolved(after)).toMatchObject([{ act: 1, caller: "ana", caught: true, amount: 2 }]);
    expect(stashes(after)).toEqual([2, 0]);
  });

  it("both wrong in the same act: each pays from the stash as it stands, in seat order", () => {
    // Act 1: both keep 4. Act 2: both call, neither pockets. Ana pays min(10, 4); then Ben pays min(10, 8).
    let s = round(round(round(game(), { pocket: 4 }, { pocket: 4 })));
    s = round(round(round(s, {}, {}, callOut("ben"), callOut("ana"))));
    expect(resolved(s)).toMatchObject([
      { act: 2, caller: "ana", target: "ben", caught: false, amount: 4 },
      { act: 2, caller: "ben", target: "ana", caught: false, amount: 8 },
    ]);
    expect(stashes(s)).toEqual([8, 0]);
  });

  it("one caught, one wrong: the wrong caller was just emptied, so pays 0", () => {
    let s = round(game(), {}, { pocket: 3 }, callOut("ana"), callOut("ben"));
    s = round(round(s));
    expect(resolved(s)).toMatchObject([
      { caller: "ana", caught: true, amount: 3 },
      { caller: "ben", caught: false, amount: 0 },
    ]);
    expect(stashes(s)).toEqual([3, 0]);
  });

  it("act 3: both caught, real splits counted (not net stash), then the final ranking", () => {
    let s = game();
    for (let r = 0; r < 6; r++) s = round(s);
    s = round(s, {}, { pocket: 4 }, callOut("ana")); // r7: Ben keeps 4
    s = round(s, { pocket: 3 }, {}, callOut("ben")); // r8: Ana keeps 3
    s = round(s);
    // Ana takes 4 (7 / 0), then Ben takes 3 (4 / 3).
    expect(resolved(s)).toMatchObject([
      { act: 3, caller: "ana", caught: true, amount: 4 },
      { act: 3, caller: "ben", caught: true, amount: 3 },
    ]);
    const ended = s.log.at(-1);
    if (ended?.type !== "gameEnded" || ended.outcome.result !== "success") throw new Error("expected a success");
    expect(ended.outcome.ranking.map((e) => [e.player, e.stash])).toEqual([["ana", 4], ["ben", 3]]);
    expect(ended.outcome.winners).toEqual(["ana"]);
  });

  it("call-outs settle before a checkpoint miss that raids", () => {
    let s = game({ contentOverrides: { ...V01_NUMBERS, heat: { missedCheckpoint: 100 } } });
    s = round(s, { room: "lobby", pocket: 1 }, { room: "lobby" }, callOut("ben")); // Haul 11 < 12
    s = round(round(s, { room: "lobby" }, { room: "lobby" }), { room: "lobby" }, { room: "lobby" });
    expect(types(s).slice(types(s).indexOf("callOutResolved"))).toEqual(["callOutResolved", "checkpointChecked", "copsRaided", "gameEnded"]);
    expect(resolved(s)).toMatchObject([{ caller: "ben", caught: true, amount: 1 }]);
    expect(s.log.find((e) => e.type === "checkpointChecked")).toMatchObject({ met: false });
    expect(s.phase.kind).toBe("ended");
  });
});

describe("QA: hidden information — design §16.1, §17.2", () => {
  it("the opponent's view is byte-identical with or without a pending call-out, until the act ends", () => {
    const script = [mv("ben", { pocket: 2 }), mv("ana"), adv(1), mv("ana"), mv("ben"), adv(2), mv("ben"), mv("ana")];
    let plain = game();
    let called = run(plain, callOut("ana"));
    expect(JSON.stringify(viewFor(called, "ben"))).toBe(JSON.stringify(viewFor(plain, "ben")));
    for (const c of script) {
      plain = run(plain, c);
      called = run(called, c);
      expect(JSON.stringify(viewFor(called, "ben")), JSON.stringify(c)).toBe(JSON.stringify(viewFor(plain, "ben")));
    }
    expect(JSON.stringify(viewFor(called, "ana"))).not.toBe(JSON.stringify(viewFor(plain, "ana")));
    // Once the act ends the result is public.
    plain = run(plain, adv(3));
    called = run(called, adv(3));
    expect(viewFor(called, "ben").ledger.some((e) => e.event.type === "callOutResolved")).toBe(true);
  });
});

describe("QA: determinism — design §17.2", () => {
  function play(seed: string): GameState {
    let s = createGame(config({ seed, eventsEnabled: true }));
    for (let r = 1; r <= 9 && s.phase.kind !== "ended"; r++) {
      const cmds: unknown[] = [];
      if (r % 3 === 1) cmds.push(callOut("ana"));
      if (r % 3 === 0) cmds.push(callOut("ben"));
      const room = s.card?.room === "office" ? "lobby" : "office";
      for (const [id, pocket] of [["ana", r % 2], ["ben", (r + 1) % 2]] as const) {
        const role = s.players[id]?.role;
        cmds.push(mv(id, { room, pocket: role === "insider" ? 0 : pocket }));
      }
      s = run(s, ...cmds);
      s.card?.offer?.players.forEach((id) => (s = run(s, { type: "answerDoubleCross", player: id, accept: true })));
      s = run(s, adv(r));
    }
    return s;
  }

  it("same seed and commands give the same log; the log replays to the same state", () => {
    for (const seed of ["d1", "d2", "d3"]) {
      const a = play(seed);
      expect(a.phase.kind).toBe("ended");
      expect(play(seed).log).toEqual(a.log);
      expect(replay(a.config, a.log)).toEqual(a);
    }
  });
});
