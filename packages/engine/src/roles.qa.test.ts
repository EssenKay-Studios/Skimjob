// QA (PR #12): the Hacker and the Smooth Talker. design §5.1, §9.5, §9.6, §11.1
//
// 1. Counterfactual leak pairs (the view.qa.test.ts approach): games A and B
//    run the same commands from the same seed, except for one hidden
//    difference (a Smooth Talker dealt or not).
//    After every step every other player's view must be identical
//    until the rules make a difference public, and every other player's
//    rejection reasons for role commands must be the same in both games.
// 2. Edge cases per role: limits, wrong phase / wrong role, vote maths at ties
//    and quorum edges in every vote mode, threshold and stash edges.
import { describe, expect, it } from "vitest";
import { closeResultWindow } from "./alibis.testkit";
import { BANK_JOB } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId, PlayerState, PlayerView, VoteVisibility } from "./types";
import { privateTo } from "./types";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand, type CommandResult } from "./handle";
import { meetingResult } from "./meeting";
import { viewFor } from "./view";
import { grantPerks } from "./perks.testkit";
import { fullGrab } from "./grab.testkit";
import { R6_COINS } from "./v01-numbers.testkit";

const MODES: readonly VoteVisibility[] = ["hiddenThenRevealed", "open", "secret"];

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "roles-qa",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
    // R6 room yields as coins (the scripts' numbers), and a bank of 20 a player, so regular meetings come every few rounds (design §9.1).
    contentOverrides: { ...R6_COINS, bank: { coinsPerPlayer: 20 }, ...extra.contentOverrides },
  };
}

/** A new game with seat i dealt roles[i] (a Lookout if missing: its power acts only when used). */
function game(players: number, roles: string[], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  let seat = 0;
  const log = setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "lookout" } : e));
  return replay(cfg, log);
}

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
    const cmd = typeof c === "function" ? c(s) : c;
    const r = handleThroughAlibis(s, cmd);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(cmd)}: ${r.reason}`);
    return r.state;
  }, state);
}
/** The rejection reason; the state (and so every view) is untouched. */
function reason(state: GameState, command: unknown): string {
  const before = JSON.stringify(state);
  const r = handleThroughAlibis(state, command);
  if (r.ok) throw new Error(`expected a rejection of ${JSON.stringify(command)}`);
  expect(JSON.stringify(state)).toBe(before);
  return r.reason;
}
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, pocket, R6_COINS), ...extra } });
/** The round being planned; from the result window, the next one (closing the window first). */
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.phase.kind === "result" ? s.round + 1 : s.round } });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
/** `caller` calls an emergency meeting in the result window (resolving the round being planned first) and it opens at once. design §9.3 */
const emergency = (s: GameState, caller: string): GameState =>
  run(
    s,
    ...(s.phase.kind === "planning" ? [ROUND] : []),
    { type: "callEmergency", player: caller },
    (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.pendingEmergency?.meetingId } }),
  );
/** The meeting the last round called opens (the server picks its slot). design §9.1, §9.4 */
const dueMeeting = (s: GameState): GameState => {
  if (s.phase.kind !== "awaitingMeeting") throw new Error(`no meeting is due in ${s.phase.kind}`);
  const { meetingId } = s.phase;
  return run(s, { type: "scheduleMeeting", meetingId, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId } });
};
/** Close the open meeting and, if a shakedown window opened, end it. */
const closeAll = (s: GameState): GameState => {
  const closed = run(s, CLOSE);
  return closed.phase.kind === "shakedownPending" ? run(closed, RESOLVE) : closed;
};
/** A shop with no Shield, so a passed shakedown applies at once (no window). design §9.6 */
const noShield = (s: GameState): GameState => ({ ...s, shop: ["peek", "alibi", "extraVote"] });

// ------------------------------------------------------------------ 1. counterfactual leak pairs

type Kind = "smoothDealt";
// Coin limits in these games: R6_COINS for the pinned rooms, content (design §3.1) for the rest.
const COINS: Record<string, number> = { vault: 6, office: 4, lobby: 2, depositBoxes: 5, managersOffice: 2, serverRoom: 2 };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The first path where two JSON values differ, with both values (for leak messages). */
function diffPath(a: unknown, b: unknown, path = ""): string {
  if (JSON.stringify(a) === JSON.stringify(b)) return "";
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = diffPath((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

function withRole(s: GameState, id: PlayerId, role: string): GameState {
  return {
    ...s,
    players: { ...s.players, [id]: { ...(s.players[id] as PlayerState), role } },
    log: s.log.map((e) => (e.type === "roleDealt" && e.player === id ? { ...e, role } : e)),
  };
}

interface PairResult {
  readonly applied: boolean;
  readonly effective: boolean;
  readonly diverged: string | null;
  readonly compared: number;
  readonly a: GameState;
  /** A as it started, before any command. */
  readonly start: GameState;
  readonly commands: readonly unknown[];
}

/**
 * Plays a seeded random game in A and B with one hidden difference of `kind`,
 * comparing every uninvolved player's view and role-command rejections after
 * each step. Throws on a leak.
 */
function runPair(kind: Kind, n: number, mode: VoteVisibility, seed: number): PairResult {
  const rand = mulberry32(seed);
  const int = (k: number): number => Math.floor(rand() * k);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)] as T;
  // design §11.3: the counterfactual holds where the role list doesn't name the dealt roles
  // ("Possible"); with "Exact" the dealt roles are public by design.
  const cfg = config(n, { seed: `rqa-${seed}`, voteVisibility: mode, roleList: "possible" });
  const ids = createGame(cfg).playerOrder;
  // The Smooth Talker in A is a seat dealt otherwise in B.
  let A = withRole(createGame(cfg), ids[int(ids.length)] as PlayerId, "smoothTalker");
  const start = A;
  const holder = (role: string): PlayerId | undefined => ids.find((id) => A.players[id]?.role === role);
  const involved = new Set<PlayerId>();
  const tainted = new Set<PlayerId>();
  const commands: unknown[] = [];
  let applied = false;
  let effective = false;
  let diverged: string | null = null;
  let compared = 0;

  // Setup differences.
  let B = A;
  if (kind === "smoothDealt") {
    const x = holder("smoothTalker");
    if (x) {
      B = withRole(A, x, "lookout");
      involved.add(x);
      applied = true;
    }
  }
  const allowed = (e: GameEvent | undefined): boolean => {
    if (!e) return false;
    if (e.type === "gameEnded") return true;
    if (e.type === "shakedownResolved" || e.type === "shakedownCancelled") return involved.has(e.target) || tainted.has(e.target);
    // A ballot's weight (Smooth Talker) shows only in a result the plain tally can't explain.
    if (e.type === "meetingClosed") return kind === "smoothDealt";
    return false;
  };
  const over = (): boolean => A.phase.kind === "ended" || B.phase.kind === "ended" || diverged !== null;

  // Rejections a player sees for role commands must depend only on what they may know.
  const probes = (s: GameState, y: PlayerId): string[] => {
    const room = s.rooms[0] as string;
    return [{ type: "useAbility", player: y, ability: { kind: "detect", target: y } }, mv(y, room, 0, { ability: { kind: "hide", room } })].map((c) => {
      const r = handleThroughAlibis(s, c);
      return r.ok ? "ok" : r.reason;
    });
  };

  const compare = (): void => {
    for (const x of involved) effective ||= JSON.stringify(viewFor(A, x)) !== JSON.stringify(viewFor(B, x));
    // After the game the reveal opens every role, move and target (design §13).
    const ended = A.phase.kind === "ended" && B.phase.kind === "ended";
    const shown = (v: PlayerView) => JSON.stringify(ended ? { ...v, reveal: null } : v);
    for (const y of ids) {
      if (involved.has(y) || tainted.has(y)) continue;
      const va: PlayerView = viewFor(A, y);
      const vb: PlayerView = viewFor(B, y);
      if (shown(va) === shown(vb)) {
        compared++;
        continue;
      }
      const i = va.ledger.findIndex((e, k) => JSON.stringify(e) !== JSON.stringify(vb.ledger[k]));
      const at = i === -1 && vb.ledger.length > va.ledger.length ? va.ledger.length : i;
      const first = [va.ledger[at]?.event, vb.ledger[at]?.event];
      if (at === -1 || !first.some(allowed)) {
        throw new Error(`leak (${kind}, ${n}p, ${mode}, seed ${seed}) to ${y}: ${at === -1 ? `same ledger, different view ${diffPath(va, vb)}` : JSON.stringify(first)}`);
      }
      diverged = (first.find(allowed) as GameEvent).type;
      return;
    }
    for (const y of ids) {
      if (involved.has(y)) continue;
      expect(probes(B, y), `probe rejections for ${y} (${kind}, ${n}p, ${mode}, seed ${seed})`).toEqual(probes(A, y));
    }
  };
  const step = (a: readonly unknown[], b: readonly unknown[] = a): void => {
    if (over()) return;
    for (const c of a) {
      commands.push(c);
      const r = handleThroughAlibis(A, c);
      if (!r.ok) throw new Error(`A rejected ${JSON.stringify(c)}: ${r.reason}`);
      A = r.state;
    }
    for (const c of b) {
      const r = handleThroughAlibis(B, c);
      if (!r.ok) throw new Error(`B rejected ${JSON.stringify(c)}: ${r.reason}`);
      B = r.state;
    }
    compare();
  };

  const changeRound = 1 + int(8);

  const move = (id: PlayerId, round: number): Record<string, unknown> => {
    const role = A.players[id]?.role;
    const room = pick(A.rooms);
    const coins = COINS[room] ?? 0;
    const pocket = coins > 0 && rand() < 0.6 ? int(coins + 1) : 0;
    const m: Record<string, unknown> = { room, duffel: coins - pocket, pocket };
    if (room === "security") m.watch = pick(A.rooms);
    // Baseline power use, identical in both games (not for the kind that changes it).
    const open = A.rooms.filter((r) => !Object.hasOwn(A.taped, r));
    if (role === "hacker" && A.players[id]?.roleState.usedThisStretch === 0 && round % 3 === 1 && rand() < 0.7) m.ability = { kind: "hide", room: pick(open) };
    return m;
  };

  function planRound(round: number): void {
    const planA = new Map<PlayerId, unknown[]>();
    for (const id of ids) planA.set(id, rand() < 0.1 ? [] : [{ type: "submitMove", player: id, move: move(id, round) }]);
    const planB = new Map(planA);
    for (const id of ids) step(planA.get(id) ?? [], planB.get(id) ?? []);
  }

  function meeting(open: unknown): void {
    step([open]);
    const target = pick(ids);
    for (const id of ids) {
      if (rand() < 0.2) continue;
      const t = rand() < 0.7 ? target : pick(ids);
      // design §9.7: a protected player can't be voted for; a skip instead.
      const skip = t === id || A.protected.includes(t);
      step([{ type: "castVote", player: id, vote: skip ? { kind: "skip" } : { kind: "shakedown", target: t } }]);
    }
    step([{ type: "advance", deadline: { kind: "closeMeeting", meetingId: A.meeting?.id } }]);
    if (over() || A.phase.kind !== "shakedownPending") return;
    step([{ type: "advance", deadline: { kind: "resolveShakedown", meetingId: A.pendingShakedown?.meetingId } }]);
  }

  for (let round = 1; round <= BANK_JOB.roundCap && !over(); round++) {
    planRound(round);
    step([{ type: "advance", deadline: { kind: "round", round } }]);
    // design §9.1, §9.2: the meeting the round called, then (§9.3) sometimes an emergency in its result window.
    if (!over() && A.phase.kind === "awaitingMeeting") {
      const { meetingId } = A.phase;
      step([{ type: "scheduleMeeting", meetingId, slot: `s${round}` }]);
      meeting({ type: "advance", deadline: { kind: "openMeeting", meetingId } });
    }
    if (!over() && A.phase.kind === "result" && rand() < 0.3) {
      step([{ type: "callEmergency", player: pick(ids) }]);
      meeting({ type: "advance", deadline: { kind: "openMeeting", meetingId: A.pendingEmergency?.meetingId } });
    }
  }
  if (!diverged) expect(A.phase.kind === "ended" || B.phase.kind === "ended").toBe(true);
  return { applied, effective, diverged, compared, a: A, start, commands };
}

const KINDS: readonly Kind[] = ["smoothDealt"];
const COUNTS = [3, 5, 7, 9, 12];
/** Seeds per player count; raise locally (QA_SEEDS=10) for a wider sweep. */
const SEEDS = Number(process.env.QA_SEEDS ?? 1);

describe("QA: one hidden role difference never changes another player's view or rejections — design §11.3, §18", () => {
  it.each(KINDS.flatMap((k) => MODES.map((m) => [k, m] as const)))("%s, %s votes", (kind, mode) => {
    let applied = 0;
    let compared = 0;
    const firstPublic = new Set<string>();
    COUNTS.forEach((n, i) => {
      for (let s = 0; s < SEEDS; s++) {
        const r = runPair(kind, n, mode, 1000 * KINDS.indexOf(kind) + 100 * MODES.indexOf(mode) + 10 * i + s);
        if (!r.applied) continue;
        applied++;
        compared += r.compared;
        // A Smooth Talker who never acts may not see a difference until the end.
        if (r.diverged) firstPublic.add(r.diverged);
      }
    });
    expect(applied).toBeGreaterThanOrEqual(2 * SEEDS);
    expect(compared).toBeGreaterThan(100 * SEEDS);
    for (const t of firstPublic) expect(["gameEnded", "shakedownResolved", "shakedownCancelled", "meetingClosed"]).toContain(t);
  }, 60_000);

  it("determinism: same seed + same commands → identical event log, and replay rebuilds the state", () => {
    for (const n of [5, 12]) {
      const r = runPair("smoothDealt", n, "hiddenThenRevealed", 4242 + n);
      const again = r.commands.reduce<GameState>((s, c) => run(s, c), r.start);
      expect(again.log).toEqual(r.a.log);
      expect(replay(r.a.config, r.a.log)).toEqual(r.a);
    }
  });
});

// ------------------------------------------------------------------ 2. edges per role

describe("QA Smooth Talker: majority counts weight, quorum counts voters, in every mode — design §9.5, §11.1", () => {
  // Meetings close straight to their result unless the shop holds a Shield.
  const result = (players: number, roles: string[], ballots: [string, string | null][], mode: VoteVisibility, extra: Partial<GameConfig> = {}) => {
    const caller = ballots[0]?.[0] ?? "p0";
    let s = emergency(noShield(game(players, roles, { voteVisibility: mode, ...extra })), caller);
    s = run(s, ...ballots.map(([p, t]) => vote(p, t)), CLOSE);
    return ofType(s.log, "meetingClosed").at(-1);
  };

  it.each(MODES)("%s: ties, quorum edges and the plain public tally", (mode) => {
    const ST = ["smoothTalker"];
    // Exactly half the crew votes (quorum met): weight 3, p3 has 2 → passes; a plain count is a tie.
    expect(result(4, ST, [["p0", "p3"], ["p1", null]], mode)).toMatchObject({ result: { kind: "shakedown", target: "p3" }, tally: { skip: 1, targets: { p3: 1 } } });
    expect(result(4, [], [["p0", "p3"], ["p1", null]], mode)?.result).toEqual({ kind: "noMajority" });
    // One voter in a crew of 4 is short of quorum, double weight or not.
    expect(result(4, ST, [["p0", "p3"]], mode)?.result).toEqual({ kind: "noQuorum" });
    // 3 players: the Smooth Talker alone is short of quorum (voters count, not weight); with one skip
    // beside it, quorum is met and its weight 2 of 3 is a majority.
    expect(result(3, ST, [["p0", "p1"]], mode)?.result).toEqual({ kind: "noQuorum" });
    expect(result(3, ST, [["p0", "p2"], ["p1", null]], mode)?.result).toEqual({ kind: "shakedown", target: "p2" });
    // A weighted tie: p4 2 vs p3 2 of 4 → no majority.
    expect(result(5, ST, [["p0", "p4"], ["p1", "p3"], ["p2", "p3"]], mode)?.result).toEqual({ kind: "noMajority" });
    // The Smooth Talker's skip blocks a plain-count majority: p4 2 vs skip 2 of 4.
    expect(result(5, ST, [["p0", null], ["p1", "p4"], ["p2", "p4"]], mode)).toMatchObject({ result: { kind: "noMajority" }, tally: { skip: 1, targets: { p4: 2 } } });
    expect(result(5, [], [["p0", null], ["p1", "p4"], ["p2", "p4"]], mode)?.result).toEqual({ kind: "shakedown", target: "p4" });
    // A changed ballot still weighs double, once.
    expect(result(5, ST, [["p0", null], ["p0", "p4"], ["p1", null], ["p2", null]], mode)?.result).toEqual({ kind: "noMajority" });
    // Overridden weight 3: 3 of 5 passes against two skips.
    const w3 = { contentOverrides: { roles: { smoothTalker: { weight: 3 } } } };
    expect(result(5, ST, [["p0", "p4"], ["p1", null], ["p2", null]], mode, w3)).toMatchObject({ result: { kind: "shakedown", target: "p4" }, tally: { skip: 2, targets: { p4: 1 } } });
    // Ballots are only withheld in Secret mode.
    expect(result(4, ST, [["p0", "p3"], ["p1", null]], mode)?.ballots === null).toBe(mode === "secret");
  });

  it("meetingResult: weight defaults to voters, quorum uses voters only", () => {
    const t = (m: Record<string, number>) => new Map(Object.entries(m));
    expect(meetingResult(4, 2, 1, t({ p3: 1 }))).toEqual({ kind: "noMajority" });
    expect(meetingResult(4, 2, 1, t({ p3: 2 }), 3)).toEqual({ kind: "shakedown", target: "p3" });
    expect(meetingResult(5, 2, 0, t({ p3: 4 }), 4)).toEqual({ kind: "noQuorum" });
    expect(meetingResult(5, 3, 2, t({ p3: 2 }), 4)).toEqual({ kind: "noMajority" });
  });
});

describe("QA Hacker: a hidden bell blinds no feed — design §5.1, §11.1", () => {
  const base = game(5, ["hacker", "lookout", "lookout", "lookout"]);
  const watched = (s: GameState) => ofType(s.log, "roomWatched").map((e) => [e.player, e.source, e.room, e.seen]);
  const hide = (room: string) => mv("p0", "lobby", 0, { ability: { kind: "hide", room } });

  it("Security and the Lookout still see who was in the room whose bell is hidden", () => {
    const s = run(
      base,
      mv("p0", "vault", 6, { ability: { kind: "hide", room: "vault" } }),
      mv("p1", "security", 0, { watch: "vault" }),
      mv("p3", "security", 0, { watch: "office", ability: { kind: "lookout", rooms: ["vault"] } }),
      mv("p4", "office", 2),
      ROUND,
    );
    expect(watched(s)).toEqual([
      ["p1", "security", "vault", ["p0"]],
      ["p3", "security", "office", ["p4"]],
      ["p3", "lookout", "vault", ["p0"]],
    ]);
  });

  it("a hide replaced before the deadline isn't used; one between meetings, back after the next regular one; refused outside planning", () => {
    let s = run(base, hide("vault"), mv("p0", "lobby"), ROUND);
    expect(s.players.p0?.roleState.usedThisStretch).toBe(0);
    s = run(s, hide("vault"), ROUND);
    expect(reason(s, hide("office"))).toMatch(/already hidden/);
    while (s.phase.kind !== "awaitingMeeting") s = run(s, ROUND);
    expect(reason(s, hide("office"))).toMatch(/round is being planned/);
    s = closeAll(dueMeeting(s));
    expect(s.players.p0?.roleState.usedThisStretch).toBe(0);
    expect(() => run(s, hide("office"))).not.toThrow();
  });
});

describe("QA shakedown window (a Shield in the shop): deadline, wrong phase — design §8.3, §9.6", () => {
  const shielded = (s: GameState): GameState => ({ ...s, shop: ["peek", "shield", "extraVote"] });
  const passed = () => {
    const s = run(shielded(game(3, [])), mv("p1", "vault", 6), ROUND);
    return run(emergency(s, "p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
  };

  it("the window's deadline is named and single-use", () => {
    const s = passed();
    expect(s.phase.kind).toBe("shakedownPending");
    const after = run(s, RESOLVE);
    expect(reason(after, RESOLVE(s))).toMatch(/no shakedown is pending/);
    expect(reason(s, { type: "advance", deadline: { kind: "resolveShakedown" } })).toMatch(/no shakedown is pending/);
    expect(reason(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "meeting-1" } })).toMatch(/pending/);
  });

  it("a regular meeting's window ends in the result window, where an emergency can still be called — design §9.3", () => {
    let s = run(shielded(game(3, [])), mv("p1", "vault", 6), ROUND);
    while (s.phase.kind !== "awaitingMeeting") s = run(s, ROUND);
    s = run(dueMeeting(s), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    s = run(s, RESOLVE);
    expect(s.phase).toEqual({ kind: "result", round: s.resolvedRound });
    s = emergency(s, "p2");
    expect(s.meeting).toMatchObject({ kind: "emergency", calledBy: "p2" });
  });

  it("a Shield cancel in the last regular meeting's window: the target keeps the stash, protected, and the result window follows", () => {
    // 14 coins a round out of 60: regular meetings after rounds 2 and 3 (design §9.1); p1 pockets the Vault's 6 in round 3.
    let s = shielded(game(3, []));
    for (let round = 1; round <= 3; round++) {
      s = run(s, mv("p1", "vault", round === 3 ? 6 : 0), mv("p2", "office"), mv("p0", "office"), ROUND);
      if (round === 2) s = closeAll(dueMeeting(s));
    }
    s = grantPerks(dueMeeting(s), "p1", "shield");
    s = run(s, vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    const end = run(s, RESOLVE);
    expect(since(s, end).map((e) => e.type)).toEqual(["perkUsed", "shakedownCancelled"]);
    expect([end.players.p1?.stash, end.protected, end.phase.kind]).toEqual([6 + end.share, ["p1"], "result"]);
  });
});
