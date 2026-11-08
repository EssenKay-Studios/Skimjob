// QA for role deck v2 R2b (PR #30): boundaries and interplay of the seven new
// crew roles, with tokens for rewards (extension.md "Roles", "Tokens and the
// perk shop"). design §7, §8, §8.1, §10, §11.1, §11.3, §16.1
import { describe, expect, it } from "vitest";
import { closeResultWindow } from "./alibis.testkit";
import { handleCommand, type CommandResult } from "./handle";
import { BANK_JOB, STARTER_ROLES } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { createGame, rolePoolFor, setupEvents, validateConfig } from "./setup";
import { replay } from "./reduce";
import { viewFor } from "./view";
import { privateTo } from "./types";
import { grantPerks } from "./perks.testkit";
import { fullGrab } from "./grab.testkit";
import { R6_COINS } from "./v01-numbers.testkit";

const SEVEN = ["smoothTalker", "priest", "auditor", "fixer", "lookout"];

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "r2b-qa",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    rolePool: [...STARTER_ROLES],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
    contentOverrides: { ...R6_COINS, ...extra.contentOverrides }, // R6 room yields as coins (R6 role rules)
  };
}
/** Seat i gets roles[i] (Rookie if missing). */
function game(players: number, roles: string[], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  const log = setupEvents(cfg).map((e, i, all): GameEvent => {
    if (e.type !== "roleDealt") return e;
    return { ...e, role: roles[all.slice(0, i).filter((x) => x.type === "roleDealt").length] ?? "rookie" };
  });
  return replay(cfg, log);
}
const withStash = (s: GameState, id: string, stash: number): GameState => ({
  ...s,
  players: { ...s.players, [id]: { ...(s.players[id] as PlayerState), stash } },
});
/**
 * A command, with a round deadline followed by its alibi deadline (nobody
 * posts). The result window (design §9.3) stays open, so an emergency can be
 * called in it, until a move or a round deadline closes it.
 */
function handleThroughAlibis(state: GameState, command: unknown): CommandResult {
  const c = command as { type?: unknown; deadline?: { kind?: unknown } } | null;
  const planning = c?.type === "submitMove" || c?.deadline?.kind === "round";
  const s = state.phase.kind === "result" && !state.pendingEmergency && planning ? must(closeResultWindow(state)) : state;
  const r = handleCommand(s, command);
  if (!r.ok || r.state.phase.kind !== "alibis" || c?.deadline?.kind !== "round") return r;
  return handleCommand(r.state, { type: "advance", deadline: { kind: "alibis", round: r.state.phase.round } });
}
const must = (r: CommandResult): GameState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};
type Cmd = unknown | ((s: GameState) => unknown);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const command = typeof c === "function" ? c(s) : c;
    const r = handleThroughAlibis(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const r = handleThroughAlibis(state, command);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const granted = (s: GameState, player: string) => ofType(s.log, "tokenEarned").filter((e) => e.player === player).map((e) => e.trigger);
const since = (before: GameState, after: GameState) => after.log.slice(before.log.length);
const mv = (player: string, room: string, pocket = 0) => ({ type: "submitMove", player, move: fullGrab(room, pocket, R6_COINS) });
/** The round being planned; from the result window, the next one (closing the window first). */
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.phase.kind === "result" ? s.round + 1 : s.round } });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
/** Resolve a waiting shakedown nobody cancels (the shop may hold a Shield). */
const settle = (s: GameState): GameState => (s.phase.kind === "shakedownPending" ? run(s, RESOLVE) : s);
const use = (player: string, ability: object) => ({ type: "useAbility", player, ability });
/** `caller` spends the crew's emergency in the result window (design §9.3). */
const emergency = (s: GameState, caller: string) =>
  run(s, { type: "callEmergency", player: caller }, (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.pendingEmergency?.meetingId } }));

describe("Smooth Talker's ballot — design §9.5, extension.md \"Roles\"", () => {
  it("switching its ballot away before the close → no reward (last ballot counts)", () => {
    let s = run(game(5, ["smoothTalker"]), mv("p1", "vault", 6), ROUND);
    s = emergency(s, "p2");
    s = settle(run(s, vote("p0", "p1"), vote("p2", "p1"), vote("p3", "p1"), vote("p4", "p1"), vote("p0", null), CLOSE));
    expect(ofType(s.log, "shakedownResolved")[0]?.clean).toBe(false);
    expect(granted(s, "p0")).toEqual([]);
  });
});

describe("eligibility at 3 and 12 players, events — design §8.1", () => {
  const pool = (n: number, extra: Partial<GameConfig> = {}) => [...rolePoolFor(config(n, { rolePool: SEVEN, ...extra }))];
  it("3: no Smooth Talker or Priest (from 5); 12: all of them", () => {
    expect(pool(3).sort()).toEqual(SEVEN.filter((r) => r !== "smoothTalker" && r !== "priest").sort());
    expect(pool(12).sort()).toEqual([...SEVEN].sort());
  });

  it("dealt over many seeds: never below the minimum, each at most once", () => {
    for (let i = 0; i < 40; i++) {
      for (const n of [3, 4, 5, 12]) {
        const s = createGame(config(n, { seed: `elig-${i}`, rolePool: SEVEN, eventsEnabled: i % 2 === 0 }));
        const roles = s.playerOrder.map((id) => s.players[id]?.role as string);
        if (n < 5) for (const r of ["smoothTalker", "priest"]) expect(roles).not.toContain(r);
        for (const r of SEVEN) expect(roles.filter((x) => x === r).length).toBeLessThanOrEqual(1);
        if (n === 12) expect(SEVEN.every((r) => roles.includes(r))).toBe(true);
      }
    }
  });
});

describe("12 players with all seven dealt: leaks and determinism — design §13, §17.2", () => {
  const cfg = config(12, { seed: "qa-12", rolePool: SEVEN, eventsEnabled: true, voteVisibility: "secret" });
  const play = (): GameState => {
    let s = createGame(cfg);
    const role = (r: string) => s.playerOrder.find((id) => s.players[id]?.role === r) as string;
    const [priest, auditor, fixer] = [role("priest"), role("auditor"), role("fixer")];
    const others = s.playerOrder.filter((id) => ![auditor, fixer].includes(id));
    s = run(s, mv(auditor, "office"), mv(fixer, "rooftop"), ...others.map((id, i) => mv(id, i % 2 ? "vault" : "office", i % 3)), ROUND);
    s = run(s, use(priest, { kind: "bless", target: others.find((id) => id !== priest) as string }));
    const target = others.find((id) => id !== priest) as string;
    s = emergency(s, auditor);
    for (const id of s.playerOrder) if (id !== target) s = run(s, vote(id, target));
    s = run(s, CLOSE);
    if (s.pendingShakedown) s = run(s, RESOLVE);
    return run(s, ...s.playerOrder.map((id) => mv(id, "rooftop")), ROUND);
  };

  it("no view holds another player's private or secret event; same seed + commands → same log; replay rebuilds", () => {
    const a = play();
    expect(SEVEN.every((r) => a.playerOrder.some((id) => a.players[id]?.role === r))).toBe(true);
    for (const viewer of a.playerOrder) {
      const json = JSON.stringify(viewFor(a, viewer));
      for (const other of a.playerOrder) {
        if (other === viewer) continue;
        expect(json).not.toContain(`"private:${other}"`);
        expect(json).not.toContain(`"secret:${other}"`);
        expect(json).not.toMatch(new RegExp(`"visibility":\\{"kind":"(private|secret)","player":"${other}"`));
      }
    }
    const b = play();
    expect(b.log).toEqual(a.log);
    expect(replay(a.config, a.log)).toEqual(a);
  });
});

describe("Shield vs Priest in one shakedown — design §8, §8.3, §11.3", () => {
  // p1 Priest, p2 the target (blessed, holding a Shield); a Shield in the shop opens the window.
  const pending = (pocket: number) => {
    let s = run(game(5, ["rookie", "priest"], { rolePool: [...STARTER_ROLES, "priest"] }), mv("p2", "vault", pocket), ROUND);
    s = { ...s, shop: ["peek", "shield", "extraVote"] };
    s = grantPerks(run(s, use("p1", { kind: "bless", target: "p2" })), "p2", "shield");
    s = emergency(s, "p3");
    for (const id of ["p0", "p1", "p3", "p4"]) s = run(s, vote(id, "p2"));
    s = run(s, CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    return s;
  };

  it("no cancel: the Shield is spent, and the blessed target shaken down clean earns the Priest nothing", () => {
    const p = pending(0);
    const s = run(p, RESOLVE);
    expect(ofType(since(p, s), "perkUsed")[0]?.perk).toMatchObject({ kind: "shield" });
    expect([granted(s, "p1"), s.setAside]).toEqual([[], p.setAside]);
  });
});
