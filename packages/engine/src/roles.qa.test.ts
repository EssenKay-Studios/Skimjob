// QA (PR #12): info and vote roles — Hacker, Smooth talker. design §8, §11.2, §11.3
//
// 1. Counterfactual leak pairs (the view.qa.test.ts approach, with these roles
//    dealt): games A and B run the same commands from the same seed, except for
//    one hidden difference (a Smooth talker dealt or not, a camera loop).
//    After every step every other player's view must be identical
//    until the rules make a difference public, and every other player's
//    rejection reasons for role commands must be the same in both games.
// 2. Edge cases per role: limits, wrong phase / wrong role, vote maths at ties
//    and quorum edges in every vote mode, threshold and stash edges.
import { describe, expect, it } from "vitest";
import { handleThroughAlibis } from "./alibis.testkit";
import { STARTER_ROLES, BANK_JOB } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerId, PlayerState, PlayerView, VoteVisibility } from "./types";
import { privateTo } from "./types";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
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
    rolePool: [],
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
    contentOverrides: { ...R6_COINS, ...extra.contentOverrides }, // R6 room yields as coins (R6 role rules)
  };
}

/** A new game with seat i dealt roles[i] (Rookie if missing). */
function game(players: number, roles: string[], extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, extra);
  let seat = 0;
  const log = setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "rookie" } : e));
  return replay(cfg, log);
}

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
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const vote = (player: string, target: string | null) => ({ type: "castVote", player, vote: target === null ? { kind: "skip" } : { kind: "shakedown", target } });
const CLOSE = (s: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
const RESOLVE = (s: GameState) => ({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.pendingShakedown?.meetingId } });
const emergency = (s: GameState, caller: string): GameState =>
  run(s, { type: "callEmergency", player: caller }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `emergency-${caller}` } });
const actMeeting = (s: GameState, act: number): GameState =>
  run(s, { type: "scheduleMeeting", act, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: `act-${act}` } });
/** Close the open meeting and, if a shakedown window opened, end it. */
const closeAll = (s: GameState): GameState => {
  const closed = run(s, CLOSE);
  return closed.phase.kind === "shakedownPending" ? run(closed, RESOLVE) : closed;
};
const INFO_VOTE_ROLES = ["hacker", "smoothTalker"] as const;
const NO_WINDOW = { rolePool: [...STARTER_ROLES, ...INFO_VOTE_ROLES.filter((r) => r !== "smoothTalker")] };

// ------------------------------------------------------------------ 1. counterfactual leak pairs

type Kind = "smoothDealt" | "hackerLoop";
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
  const hacking = kind === "hackerLoop";
  const pool = hacking || n <= 5 ? [...INFO_VOTE_ROLES] : [];
  // extension.md "Host settings": the counterfactual holds where the role list doesn't name the dealt
  // roles ("Possible"); with "Exact" the dealt roles are public by design.
  const cfg = config(n, { seed: `rqa-${seed}`, voteVisibility: mode, rolePool: pool, deck: "everything", roleList: "possible" });
  let A = createGame(cfg);
  const ids = A.playerOrder;
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
      B = withRole(A, x, "rookie");
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
    return [{ type: "useAbility", player: y, ability: { kind: "loopCameras" } }, mv(y, room, 0, { ability: { kind: "loopCameras", room } })].map((c) => {
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
    if (role === "hacker" && kind !== "hackerLoop" && round % 3 === 1 && rand() < 0.7) m.ability = { kind: "loopCameras", room: pick(A.rooms) };
    return m;
  };

  function planRound(round: number): void {
    const planA = new Map<PlayerId, unknown[]>();
    for (const id of ids) planA.set(id, rand() < 0.1 ? [] : [{ type: "submitMove", player: id, move: move(id, round) }]);
    const planB = new Map(planA);
    const lastMove = (id: PlayerId) => ((planA.get(id)?.[0] as { move?: Record<string, unknown> } | undefined)?.move ?? { ...fullGrab("lobby", 0, R6_COINS) });
    if (round === changeRound && kind === "hackerLoop") {
      const h = holder("hacker");
      if (h) {
        const room = pick(A.rooms);
        applied = true;
        involved.add(h);
        // Both games submit a move (a move is public as "locked in"); only B loops.
        planA.set(h, [{ type: "submitMove", player: h, move: lastMove(h) }]);
        planB.set(h, [{ type: "submitMove", player: h, move: { ...lastMove(h), ability: { kind: "loopCameras", room } } }]);
        // Security watching that room sees a difference by the rules.
        for (const y of ids) if (lastMove(y).room === "security" && lastMove(y).watch === room) tainted.add(y);
      }
    }
    for (const id of ids) step(planA.get(id) ?? [], planB.get(id) ?? []);
  }

  function meeting(open: unknown): void {
    step([open]);
    const target = pick(ids);
    for (const id of ids) {
      if (rand() < 0.2) continue;
      const t = rand() < 0.7 ? target : pick(ids);
      step([{ type: "castVote", player: id, vote: t === id ? { kind: "skip" } : { kind: "shakedown", target: t } }]);
    }
    step([{ type: "advance", deadline: { kind: "closeMeeting", meetingId: A.meeting?.id } }]);
    if (over() || A.phase.kind !== "shakedownPending") return;
    step([{ type: "advance", deadline: { kind: "resolveShakedown", meetingId: A.pendingShakedown?.meetingId } }]);
  }

  for (let round = 1; round <= BANK_JOB.roundCap && !over(); round++) {
    const caller = ids.find((id) => !A.players[id]?.emergencyMeetingUsed);
    if (caller && rand() < 0.3) {
      step([{ type: "callEmergency", player: caller }]);
      meeting({ type: "advance", deadline: { kind: "openMeeting", meetingId: `emergency-${caller}` } });
    }
    if (over()) break;
    planRound(round);
    step([{ type: "advance", deadline: { kind: "round", round } }]);
    if (round % 3 === 0 && !over()) {
      step([{ type: "scheduleMeeting", act: round / 3, slot: `s${round}` }]);
      meeting({ type: "advance", deadline: { kind: "openMeeting", meetingId: A.scheduledMeeting?.meetingId } });
    }
  }
  if (!diverged) expect(A.phase.kind === "ended" || B.phase.kind === "ended").toBe(true);
  return { applied, effective, diverged, compared, a: A, commands };
}

const KINDS: readonly Kind[] = ["smoothDealt", "hackerLoop"];
// From 5: the Smooth Talker is dealt only in crews of 5 or more (role deck v2 §3).
const COUNTS = [5, 7, 9, 12];
/** Seeds per player count; raise locally (QA_SEEDS=10) for a wider sweep. */
const SEEDS = Number(process.env.QA_SEEDS ?? 1);

describe("QA: one hidden role difference never changes another player's view or rejections — design §8, §13", () => {
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
        // The change reached the involved player (a Smooth talker who never acts may not see one until the end).
        if (kind !== "smoothDealt") expect(r.effective, `${kind} ${n}p seed ${s}`).toBe(true);
        if (r.diverged) firstPublic.add(r.diverged);
      }
    });
    expect(applied).toBeGreaterThanOrEqual(2 * SEEDS);
    expect(compared).toBeGreaterThan(100 * SEEDS);
    // A loop only ever shows at the end, or in a shakedown. No meeting result or window differs.
    if (kind === "hackerLoop") for (const t of firstPublic) expect(["gameEnded", "shakedownResolved"]).toContain(t);
  }, 60_000);

  it("determinism: same seed + same commands → identical event log, and replay rebuilds the state", () => {
    for (const n of [5, 12]) {
      const r = runPair("hackerLoop", n, "hiddenThenRevealed", 4242 + n);
      const again = r.commands.reduce<GameState>((s, c) => run(s, c), createGame(r.a.config));
      expect(again.log).toEqual(r.a.log);
      expect(replay(r.a.config, r.a.log)).toEqual(r.a);
    }
  });
});

// ------------------------------------------------------------------ 2. edges per role

describe("QA Smooth talker: majority counts weight, quorum counts voters, in every mode — design §8, §11.2", () => {
  // Meetings close straight to their result unless the shop holds a Shield.
  const result = (players: number, roles: string[], ballots: [string, string | null][], mode: VoteVisibility, extra: Partial<GameConfig> = {}) => {
    const caller = ballots[0]?.[0] ?? "p0";
    let s = emergency(game(players, roles, { voteVisibility: mode, ...NO_WINDOW, ...extra }), caller);
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
    // 3 players: the Smooth talker alone is short of quorum (voters count, not weight); with one skip
    // beside it, quorum is met and its weight 2 of 3 is a majority.
    expect(result(3, ST, [["p0", "p1"]], mode)?.result).toEqual({ kind: "noQuorum" });
    expect(result(3, ST, [["p0", "p2"], ["p1", null]], mode)?.result).toEqual({ kind: "shakedown", target: "p2" });
    // A weighted tie: p4 2 vs p3 2 of 4 → no majority.
    expect(result(5, ST, [["p0", "p4"], ["p1", "p3"], ["p2", "p3"]], mode)?.result).toEqual({ kind: "noMajority" });
    // The Smooth talker's skip blocks a plain-count majority: p4 2 vs skip 2 of 4.
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

describe("QA Hacker: loop vs Security and the Lookout — design §8", () => {
  const base = game(5, ["hacker", "rookie", "rookie", "lookout"]);
  const watched = (s: GameState) => ofType(s.log, "roomWatched").map((e) => [e.player, e.source, e.room, e.seen]);

  it("every Security watcher of the looped room sees it empty; Security on another room and the Lookout see normally", () => {
    const s = run(
      base,
      mv("p0", "vault", 6, { ability: { kind: "loopCameras", room: "vault" } }),
      mv("p1", "security", 0, { watch: "vault" }),
      mv("p2", "security", 0, { watch: "office" }),
      mv("p3", "security", 0, { watch: "vault", ability: { kind: "lookout", rooms: ["vault"] } }),
      mv("p4", "office", 2),
      ROUND,
    );
    expect(watched(s)).toEqual([
      ["p1", "security", "vault", []],
      ["p2", "security", "office", ["p4"]],
      ["p3", "security", "vault", []],
      ["p3", "lookout", "vault", ["p0"]],
    ]);
  });

  it("a loop replaced before the deadline isn't used; one loop per act, back next act; refused outside planning", () => {
    const loop = (room: string) => mv("p0", "lobby", 0, { ability: { kind: "loopCameras", room } });
    let s = run(base, loop("vault"), mv("p0", "lobby"), ROUND);
    expect(s.players.p0?.roleState.usedThisAct).toBe(0);
    s = run(s, loop("vault"), ROUND);
    expect(reason(s, loop("office"))).toMatch(/already looped/);
    s = run(s, ROUND);
    expect(reason(s, loop("office"))).toMatch(/round is being planned/);
    s = closeAll(actMeeting(s, 1));
    expect(s.players.p0?.roleState.usedThisAct).toBe(0);
    expect(() => run(s, loop("office"))).not.toThrow();
  });
});

describe("QA shakedown window (a Shield in the shop): deadline, wrong phase — design §8.3, §11.3", () => {
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
    expect(reason(s, { type: "advance", deadline: { kind: "openMeeting", meetingId: "act-1" } })).toMatch(/pending/);
  });

  it("an emergency window mid-round returns to planning with submitted moves intact", () => {
    let s = run(shielded(game(3, [])), mv("p1", "vault", 6), ROUND, mv("p0", "office", 2));
    s = run(emergency(s, "p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    s = run(s, RESOLVE);
    expect(s.phase).toEqual({ kind: "planning", round: 2 });
    expect(s.moves.p0).toEqual({ room: "office", duffel: 2, pocket: 2 });
    s = run(s, ROUND);
    expect((s.players.p0?.stash ?? 0) - s.share).toBe(2);
  });

  it("an emergency window after an act's last round returns to awaiting the act meeting", () => {
    let s = run(shielded(game(3, [])), mv("p1", "vault", 6), ROUND, ROUND, ROUND);
    expect(s.phase.kind).toBe("awaitingMeeting");
    s = run(emergency(s, "p2"), vote("p0", "p1"), vote("p2", "p1"), CLOSE);
    expect(s.phase.kind).toBe("shakedownPending");
    s = run(s, RESOLVE);
    expect(s.phase).toEqual({ kind: "awaitingMeeting", act: 1 });
    s = closeAll(actMeeting(s, 1));
    expect(s.round).toBe(4);
  });

  it("a Shield cancel in the act 3 meeting's window: the target keeps the stash and the next round starts", () => {
    let s = shielded(game(3, []));
    for (let act = 1; act <= 3; act++) {
      for (let r = 0; r < 3; r++) s = run(s, mv("p1", "vault", act === 3 ? 6 : 0), mv("p2", "office"), mv("p0", "office"), ROUND);
      s = actMeeting(s, act);
      if (act === 3) {
        s = grantPerks(s, "p1", "shield");
        s = run(s, vote("p0", "p1"), vote("p2", "p1"), CLOSE);
      } else s = closeAll(s);
    }
    expect(s.phase.kind).toBe("shakedownPending");
    const end = run(s, RESOLVE);
    expect(since(s, end).map((e) => e.type)).toEqual(["perkUsed", "shakedownCancelled", "roundStarted"]);
    expect(end.players.p1?.stash).toBe(18 + end.share);
  });
});
