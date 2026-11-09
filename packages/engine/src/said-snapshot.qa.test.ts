// QA (S3a.9, #96): attacks on the plan board's said snapshot and the said
// union. The snapshot rides the round deadline and is logged once, first, as
// the round resolves; nothing said logs nothing; no wall time; order fixed
// whatever happened in secret; the board aliases nothing; alibis and claims
// keep their limits. design §10, §11.3, §12, §18, §19.2 seam 5
import { describe, expect, it } from "vitest";
import { PERK_IDS } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlanSnapshot, PlayerState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { revealSummary } from "./reveal";
import { fullGrab } from "./grab.testkit";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const config = (n: number, extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: "qa-said-snapshot",
  players: ids(n).map((id, i) => ({ id, name: `P${i}`, isBot: false })),
  job: "bank",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  ...extra,
});

/** Every seat a Lookout but those in `roles`; every perk on sale; every stash at 9. */
function game(n: number, roles: Readonly<Record<string, string>> = {}, extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(n, extra);
  const s = replay(
    cfg,
    setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[e.player] ?? "lookout" } : e.type === "shopDealt" ? { ...e, perks: PERK_IDS } : e)),
  );
  return { ...s, players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...(p as PlayerState), stash: 9 }])) };
}

function ok(state: GameState, command: unknown) {
  const r = handleCommand(state, command);
  if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
  return r;
}
/** Applies each command in turn; a function is called on the state so far to build its command. */
const run = (state: GameState, ...commands: unknown[]) => commands.reduce<GameState>((s, c) => ok(s, typeof c === "function" ? (c as (x: GameState) => unknown)(s) : c).state, state);
const refused = (state: GameState, command: unknown): string => {
  const r = handleCommand(state, command);
  if (r.ok) throw new Error(`expected a refusal: ${JSON.stringify(command)}`);
  return r.reason;
};

const ROUND = (s: GameState, plan?: unknown) => ({ type: "advance", deadline: { kind: "round", round: s.round, plan } });
const RESULT = (s: GameState) => ({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } });
const mv = (p: string, room = "lobby", pocket = 0, extra: object = {}) => ({ type: "submitMove", player: p, move: { ...fullGrab(room, pocket), ...extra } });
const saids = (log: readonly GameEvent[]) => log.filter((e): e is Extract<GameEvent, { type: "said" }> => e.type === "said");

const PLAN: PlanSnapshot = {
  entries: [
    { player: "p0", placed: "vault", room: "vault", power: null, agreed: true },
    { player: "p1", placed: "office", room: "office", power: { role: "electrician", target: "vault" }, agreed: true },
    { player: "p2", placed: null, room: null, power: { role: "priest", target: "p0" }, agreed: false },
  ],
  history: [
    { actor: "p2", kind: "place", subject: "p0", value: "vault", target: null, msBeforeDeadline: 90_000 },
    { actor: "p1", kind: "power", subject: "p1", value: "electrician", target: "vault", msBeforeDeadline: 30_000 },
    { actor: "p0", kind: "agree", subject: "p0", value: "true", target: null, msBeforeDeadline: null },
  ],
};

/** Every key anywhere in `x`. */
function keys(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) for (const v of x) keys(v, out);
  else if (typeof x === "object" && x !== null)
    for (const [k, v] of Object.entries(x)) {
      out.add(k);
      keys(v, out);
    }
  return out;
}

describe("QA: the snapshot is logged once, as the round resolves — design §10", () => {
  it("one said per resolved round, at index 0 of that deadline's events, whatever the round leads to (result window, meeting, next round)", () => {
    let s = game(3);
    for (let r = 1; r <= 4; r++) {
      const out = ok(s, ROUND(s, PLAN));
      expect(out.events[0]).toMatchObject({ type: "said", statement: { kind: "plan", round: r } });
      expect(saids(out.events)).toHaveLength(1);
      s = out.state;
      s = s.phase.kind === "result" ? run(s, RESULT(s)) : s;
      if (s.phase.kind !== "planning") break;
    }
    const plans = saids(s.log).map((e) => e.statement);
    expect(plans.map((p) => (p.kind === "plan" ? p.round : -1))).toEqual(plans.map((_, i) => i + 1));
  });

  it("a retried round deadline with a board is refused and logs no second snapshot; a wrong round's is refused before anything is said", () => {
    const s = game(3);
    const after = ok(s, ROUND(s, PLAN)).state;
    const retry = { type: "advance", deadline: { kind: "round", round: 1, plan: PLAN } };
    expect(refused(after, retry)).toMatch(/not pending|no round deadline is pending/);
    expect(refused(s, { type: "advance", deadline: { kind: "round", round: 2, plan: PLAN } })).toMatch(/not pending/);
    expect(saids(after.log)).toHaveLength(1);
  });

  it("a refused board leaves the round, the log and the RNG untouched; the retry with a good board is the same as a first try", () => {
    const s = game(3);
    const bad = { ...PLAN, entries: [...PLAN.entries, { ...PLAN.entries[0], player: "zed" }] };
    expect(handleCommand(s, ROUND(s, bad)).ok).toBe(false);
    expect(handleCommand(s, ROUND(s, null)).ok).toBe(false);
    expect(s.phase).toEqual({ kind: "planning", round: 1 });
    expect(ok(s, ROUND(s, PLAN)).events).toEqual(ok(game(3), ROUND(game(3), PLAN)).events);
  });

  it("a plan on any other deadline is ignored: nothing is said outside the round's resolution", () => {
    const s = run(game(3), ROUND(game(3)));
    expect(s.phase.kind).toBe("result");
    const out = ok(s, { type: "advance", deadline: { kind: "result", round: 1, plan: PLAN } });
    expect(saids(out.events)).toEqual([]);
  });

  it("the snapshot comes before the round's facts even on a round that ends the game, and the reveal reads it", () => {
    const s = game(3, {}, { contentOverrides: { roundCap: 1 } });
    const out = ok(run(s, mv("p0", "office")), ROUND(s, PLAN));
    expect(out.state.phase.kind).toBe("ended");
    expect(out.events[0]?.type).toBe("said");
    expect(out.events.at(-1)?.type).toBe("gameEnded");
    const outcome = out.state.phase.kind === "ended" ? out.state.phase.outcome : null;
    const moves = revealSummary(out.state.log, outcome!).rounds.find((r) => r.round === 1)!.moves;
    expect(moves.map((m) => [m.player, m.room, m.planned])).toEqual([
      ["p0", "office", "vault"],
      ["p1", "lobby", "office"],
      ["p2", "lobby", null],
    ]);
  });
});

describe("QA: nothing said, nothing logged — design §10", () => {
  it("omitted and empty boards give byte-identical games, round after round", () => {
    let a = game(3);
    let b = game(3);
    for (let r = 0; r < 3; r++) {
      a = run(a, ROUND(a));
      b = run(b, ROUND(b, { entries: [], history: [] }));
      if (a.phase.kind === "result") a = run(a, RESULT(a));
      if (b.phase.kind === "result") b = run(b, RESULT(b));
    }
    expect(b).toEqual(a);
    expect(saids(a.log)).toEqual([]);
  });
});

describe("QA: no wall time in the log — design §10, §19.1", () => {
  it("time stamps smuggled anywhere in the board (plan, entries, pledges, edits) never reach the log", () => {
    const at = { at: "2026-11-09T10:00:00.000Z", ts: 1_762_682_400_000, createdAt: "now", updated_at: "x" };
    const plan = {
      ...at,
      entries: PLAN.entries.map((e) => ({ ...e, ...at, power: e.power && { ...e.power, ...at } })),
      history: PLAN.history.map((h) => ({ ...h, ...at })),
    };
    const out = ok(game(3), ROUND(game(3), plan));
    const said = saids(out.events)[0]!;
    expect(said).toEqual({ type: "said", visibility: { kind: "public" }, statement: { kind: "plan", round: 1, plan: PLAN } });
    const found = keys(said);
    for (const k of Object.keys(at)) expect(found.has(k)).toBe(false);
    expect([...found].filter((k) => /time|date|at$|stamp/i.test(k) && k !== "msBeforeDeadline")).toEqual([]);
  });
});

describe("QA: determinism and aliasing — design §19.1", () => {
  it("entries in any order give the same event; the history keeps the order it came in (the server fixes that order)", () => {
    const perms = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const events = perms.map((p) => ok(game(3), ROUND(game(3), { entries: p.map((i) => PLAN.entries[i]), history: PLAN.history })).events);
    for (const e of events) expect(e).toEqual(events[0]);
    const reversed = ok(game(3), ROUND(game(3), { entries: PLAN.entries, history: [...PLAN.history].reverse() })).events[0];
    expect(reversed).toMatchObject({ statement: { plan: { history: [...PLAN.history].reverse() } } });
  });

  it("same seed + same commands (plans, alibis, claims, perks) → identical logs; the log replays", () => {
    const play = () =>
      run(
        game(4, { p1: "electrician" }),
        { type: "buyPerk", player: "p0", perk: { kind: "alibi" } },
        mv("p0", "office", 1),
        mv("p1", "lobby", 0, { ability: { kind: "blackout", room: "vault" } }),
        (s: GameState) => ROUND(s, PLAN),
        { type: "postAlibi", player: "p0", round: 1, room: "office" },
        { type: "claimRole", player: "p1", role: "lookout" },
        (s: GameState) => (s.phase.kind === "result" ? RESULT(s) : { type: "postAlibi", player: "p3", round: 1, room: "vault" }),
      );
    const a = play();
    const b = play();
    expect(a.log).toEqual(b.log);
    expect(saids(a.log).map((e) => e.statement.kind)).toEqual(["plan", "alibi", "role"]);
    // A game with no patched stashes folds from its log alone.
    const plain = run(game(3), (s: GameState) => ROUND(s, PLAN), RESULT, { type: "postAlibi", player: "p1", round: 1, room: "vault" });
    expect(replay(plain.config, plain.log)).toEqual({ ...plain, players: replay(plain.config, plain.log).players });
    expect(replay(plain.config, plain.log).log).toEqual(plain.log);
  });

  it("changing the command's board after it was logged changes nothing in the state", () => {
    const plan = structuredClone(PLAN) as unknown as { entries: { room: string | null; power: { target: string } | null }[]; history: { value: string | null }[] };
    const s = ok(game(3), ROUND(game(3), plan)).state;
    const before = structuredClone(s.log);
    plan.entries[0]!.room = "rooftop";
    plan.entries[1]!.power!.target = "office";
    plan.history[0]!.value = "rooftop";
    expect(s.log).toEqual(before);
  });

  it("a viewer changing its view's snapshot changes neither the state nor another viewer's view", () => {
    const s = ok(game(3), ROUND(game(3), PLAN)).state;
    const before = structuredClone(s.log);
    const v = viewFor(s, "p0").ledger.find(({ event }) => event.type === "said")!.event as Extract<GameEvent, { type: "said" }>;
    if (v.statement.kind !== "plan") throw new Error("expected the plan");
    (v.statement.plan.entries as unknown as { room: string }[])[0]!.room = "rooftop";
    (v.statement.plan.history as unknown as unknown[]).length = 0;
    expect(s.log).toEqual(before);
    expect(viewFor(s, "p1").ledger.find(({ event }) => event.type === "said")?.event).toEqual(saids(before)[0]);
  });
});

describe("QA: event order at resolution identifies nobody — design §10, §12, §18", () => {
  // Two worlds: the same board is said, but who bought which perk (and in which order) differs.
  const world = (buys: [string, object][]) => {
    let s = game(4, { p3: "electrician" });
    for (const [p, perk] of buys) s = run(s, { type: "buyPerk", player: p, perk });
    s = run(s, mv("p0", "office"), mv("p1", "office"), mv("p2", "vault"), mv("p3", "lobby", 0, { ability: { kind: "blackout", room: "office" } }));
    return ok(s, ROUND(s, PLAN));
  };
  const pub = (events: readonly GameEvent[]) => events.filter((e) => e.visibility.kind === "public");

  it("said, then the nameless sales together, then the facts; buyer and buying order change no public event, nor their order", () => {
    const a = world([
      ["p0", { kind: "softShoes" }],
      ["p1", { kind: "blackout", room: "vault" }],
      ["p2", { kind: "alibi" }],
    ]);
    const b = world([
      ["p2", { kind: "blackout", room: "vault" }],
      ["p1", { kind: "alibi" }],
      ["p0", { kind: "softShoes" }],
    ]);
    const types = pub(a.events).map((e) => e.type);
    expect(types.slice(0, 4)).toEqual(["said", "perkSold", "perkSold", "perkSold"]);
    expect(types.slice(4)).not.toContain("perkSold");
    expect(types.slice(1)).not.toContain("said");
    expect(types).not.toContain("powerCut"); // design §11.1: cuts wait for the next round's start
    expect(pub(a.events)).toEqual(pub(b.events));
  });

  it("the next round's power cuts (an Electrician's and a Blackout perk's) come out the same in both worlds, with no source, after the said plan", () => {
    const next = (r: ReturnType<typeof world>) => {
      const s = r.state.phase.kind === "result" ? ok(r.state, RESULT(r.state)) : null;
      if (!s) throw new Error(`expected the result window, got ${r.state.phase.kind}`);
      return s.events;
    };
    const a = next(world([["p1", { kind: "blackout", room: "vault" }]]));
    const b = next(world([["p2", { kind: "blackout", room: "vault" }]]));
    const cuts = a.filter((e) => e.type === "powerCut");
    expect(cuts.map((e) => (e.type === "powerCut" ? e.room : null)).sort()).toEqual(["office", "vault"]);
    for (const e of cuts) {
      expect(e.visibility).toEqual({ kind: "public" });
      expect(Object.values(e)).not.toContain("p1");
      expect(Object.values(e)).not.toContain("p3");
    }
    expect(pub(a)).toEqual(pub(b));
    expect(a.some((e) => e.type === "said")).toBe(false);
  });

  it("the board's content doesn't move anything after it: with, without, or with a pledge naming the real Electrician's room", () => {
    const base = (plan?: unknown) => {
      let s = game(4, { p3: "electrician" });
      s = run(s, { type: "buyPerk", player: "p0", perk: { kind: "softShoes" } }, mv("p3", "lobby", 0, { ability: { kind: "blackout", room: "office" } }));
      return ok(s, ROUND(s, plan)).events;
    };
    const none = base();
    const truth = base({ entries: [{ player: "p3", placed: null, room: null, power: { role: "electrician", target: "office" }, agreed: false }], history: [] });
    const bluff = base({ entries: [{ player: "p0", placed: null, room: null, power: { role: "electrician", target: "office" }, agreed: false }], history: [] });
    expect(truth.slice(1)).toEqual(none);
    expect(bluff.slice(1)).toEqual(none);
  });

  it("the bots' null-timed edits sit first in the history only by how the board gave them: the engine adds no actor-dependent order", () => {
    const human = { actor: "p1", kind: "room", subject: "p1", value: "office", target: null, msBeforeDeadline: null };
    const bot = { actor: "p0", kind: "room", subject: "p0", value: "vault", target: null, msBeforeDeadline: null };
    for (const history of [
      [human, bot],
      [bot, human],
    ]) {
      expect(ok(game(3), ROUND(game(3), { entries: [], history })).events[0]).toMatchObject({ statement: { plan: { history } } });
    }
  });
});

describe("QA: the said union and its limits — design §11.3, §19.2 seam 5", () => {
  const resolved = (n = 3) => {
    const s = game(n);
    const r = run(s, ROUND(s, PLAN));
    return r.phase.kind === "result" ? run(r, RESULT(r)) : r;
  };

  it("every statement kind is one public said event every seat sees identically; the old event types are gone", () => {
    const s = run(resolved(), { type: "postAlibi", player: "p0", round: 1, room: "vault" }, { type: "claimRole", player: "p1", role: "hacker" });
    const kinds = saids(s.log).map((e) => e.statement.kind);
    expect(kinds).toEqual(["plan", "alibi", "role"]);
    for (const e of saids(s.log)) expect(e.visibility).toEqual({ kind: "public" });
    const seen = ids(3).map((p) => viewFor(s, p).ledger.filter(({ event }) => event.type === "said").map(({ event }) => event));
    for (const v of seen) expect(v).toEqual(saids(s.log));
    expect(s.log.some((e) => ["alibiPosted", "roleClaimed", "alibisClosed"].includes(e.type))).toBe(false);
  });

  it("a plan pledge is no role claim and a role claim is no pledge: each keeps its own limit", () => {
    const s = resolved();
    // p1 pledged Electrician on the board; it may still claim a role, once.
    const claimed = run(s, { type: "claimRole", player: "p1", role: "priest" });
    expect(refused(claimed, { type: "claimRole", player: "p1", role: "electrician" })).toMatch(/already claimed/);
    // A plan room claim isn't an alibi: p0 said Vault on the board and may still post its one alibi for round 1.
    const alibied = run(claimed, { type: "postAlibi", player: "p0", round: 1, room: "lobby" });
    expect(refused(alibied, { type: "postAlibi", player: "p0", round: 1, room: "vault" })).toMatch(/already posted/);
  });

  it("alibi rounds: a stale round is fine after many rounds, but never 0, the round being planned, a future one, or a non-integer", () => {
    let s = resolved();
    for (let i = 0; i < 2; i++) {
      s = run(s, ROUND(s));
      if (s.phase.kind === "result") s = run(s, RESULT(s));
    }
    expect(s.resolvedRound).toBe(3);
    expect(s.phase.kind).toBe("planning");
    const say = (round: unknown) => ({ type: "postAlibi", player: "p2", round, room: "lobby" });
    for (const r of [0, -1, 4, 5, 1.5, Number.NaN, Infinity, "1", null, undefined, [1], { valueOf: () => 1 }]) expect(refused(s, say(r))).toMatch(/has not resolved/);
    const posted = run(s, say(1), say(3), say(2));
    expect(saids(posted.log).filter((e) => e.statement.kind === "alibi")).toHaveLength(3);
  });

  it("a Stamped alibi bought in round 1 is still stamped when its alibi comes rounds later; a false one is never stamped and can't be redone", () => {
    let s = game(3);
    s = run(s, { type: "buyPerk", player: "p0", perk: { kind: "alibi" } }, { type: "buyPerk", player: "p1", perk: { kind: "alibi" } }, mv("p0", "office"), mv("p1", "vault"));
    s = run(s, ROUND(s, PLAN));
    if (s.phase.kind === "result") s = run(s, RESULT(s));
    s = run(s, ROUND(s));
    if (s.phase.kind === "result") s = run(s, RESULT(s));
    const late = ok(s, { type: "postAlibi", player: "p0", round: 1, room: "office" });
    expect(late.events.map((e) => e.type)).toEqual(["said", "alibiVerified"]);
    const lie = ok(late.state, { type: "postAlibi", player: "p1", round: 1, room: "lobby" });
    expect(lie.events.map((e) => e.type)).toEqual(["said"]);
    expect(refused(lie.state, { type: "postAlibi", player: "p1", round: 1, room: "vault" })).toMatch(/already posted/);
  });

  it("12 players: a full board with every seat claiming, pledging and agreeing, in seat order", () => {
    const s = game(12);
    const entries = ids(12).map((p, i) => ({ player: p, placed: s.rooms[i % s.rooms.length]!, room: s.rooms[(i + 1) % s.rooms.length]!, power: { role: "detective", target: ids(12)[(i + 1) % 12]! }, agreed: i % 2 === 0 }));
    const out = ok(s, ROUND(s, { entries: [...entries].reverse(), history: [] }));
    expect(out.events[0]).toMatchObject({ statement: { plan: { entries } } });
  });
});

describe("QA: out of phase — design §4.1, §11.3, owner ruling 9 Nov", () => {
  const alibi = (p: string, round: unknown, room = "lobby") => ({ type: "postAlibi", player: p, round, room });
  const claim = (p: string, role = "lookout") => ({ type: "claimRole", player: p, role });

  it("before any round resolves no alibi can be posted, for any round; a role claim can", () => {
    const s = game(3);
    for (const r of [0, 1, 2]) expect(refused(s, alibi("p0", r))).toMatch(/has not resolved/);
    expect(ok(s, claim("p0")).events.map((e) => e.type)).toEqual(["said"]);
  });

  it("alibis and claims are taken in every between-rounds phase: the result window, an awaited meeting, an open vote, a pending shakedown's window", () => {
    // A bank of 9 (3 a seat): round 1's full grabs take a third, so a regular meeting is due (design §9.1).
    let s = game(3, {}, { contentOverrides: { bank: { coinsPerPlayer: 3 } } });
    s = run(s, mv("p0", "vault"), mv("p1", "office"), mv("p2", "lobby"), (x: GameState) => ROUND(x, PLAN));
    expect(s.phase.kind).toBe("awaitingMeeting");
    s = run(s, alibi("p0", 1), claim("p0"));
    const id = s.phase.kind === "awaitingMeeting" ? s.phase.meetingId : "";
    s = run(s, { type: "scheduleMeeting", meetingId: id, slot: "now" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: id } });
    expect(s.phase.kind).toBe("meeting");
    // The regular meeting opened a new stretch: p0 may claim again, once.
    s = run(s, alibi("p1", 1), claim("p0", "priest"), claim("p1"));
    expect(refused(s, claim("p0", "hacker"))).toMatch(/already claimed/);
    expect(refused(s, alibi("p0", 1, "vault"))).toMatch(/already posted/);
    s = run(s, { type: "castVote", player: "p0", vote: { kind: "shakedown", target: "p2" } }, { type: "castVote", player: "p1", vote: { kind: "shakedown", target: "p2" } });
    s = run(s, (x: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: x.meeting?.id } }));
    expect(s.phase.kind).toBe("shakedownPending");
    s = run(s, alibi("p2", 1), claim("p2"));
    expect(saids(s.log).filter((e) => e.statement.kind === "alibi").map((e) => e.statement.kind === "alibi" && e.statement.player)).toEqual(["p0", "p1", "p2"]);
  });

  it("an emergency meeting opens no new stretch: a claim made before it still blocks the next one", () => {
    let s = game(3);
    s = run(s, (x: GameState) => ROUND(x));
    expect(s.phase.kind).toBe("result");
    s = run(s, claim("p0"), { type: "callEmergency", player: "p1" });
    s = run(s, (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.pendingEmergency?.meetingId } }));
    expect(s.phase.kind).toBe("meeting");
    expect(s.stretch).toBe(1);
    expect(refused(s, claim("p0", "priest"))).toMatch(/already claimed/);
  });

  it("once the game is over, nothing more can be said: no alibi, no claim, no late board", () => {
    const s = game(3, {}, { contentOverrides: { roundCap: 1 } });
    const end = ok(s, ROUND(s, PLAN)).state;
    expect(end.phase.kind).toBe("ended");
    expect(refused(end, alibi("p0", 1))).toBe("the game is over");
    expect(refused(end, claim("p0"))).toBe("the game is over");
    expect(refused(end, ROUND(end, PLAN))).toBe("the game is over");
  });
});

describe("QA: hostile boards are refused whole — design §10, §19.1", () => {
  const entry = PLAN.entries[1]!;
  const edit = PLAN.history[0]!;
  const bad: [string, unknown][] = [
    ["entry for __proto__", { entries: [{ ...entry, player: "__proto__" }], history: [] }],
    ["entry for constructor", { entries: [{ ...entry, player: "constructor" }], history: [] }],
    ["entry for toString", { entries: [{ ...entry, player: "toString" }], history: [] }],
    ["placed on __proto__", { entries: [{ ...entry, placed: "__proto__" }], history: [] }],
    ["agreed as a string", { entries: [{ ...entry, agreed: "true" }], history: [] }],
    ["power left out", { entries: [{ player: "p0", placed: null, room: null, agreed: false }], history: [] }],
    ["a pledge on yourself", { entries: [{ ...entry, power: { role: "priest", target: "p1" } }], history: [] }],
    ["a pledge of a passive power", { entries: [{ ...entry, power: { role: "locksmith", target: "vault" } }], history: [] }],
    ["entries not an array", { entries: { 0: entry, length: 1 }, history: [] }],
    ["history left out", { entries: [entry] }],
    ["edit by a stranger", { entries: [], history: [{ ...edit, actor: "zed" }] }],
    ["edit with NaN time", { entries: [], history: [{ ...edit, msBeforeDeadline: Number.NaN }] }],
    ["edit with endless time", { entries: [], history: [{ ...edit, msBeforeDeadline: Infinity }] }],
    ["edit with a time string", { entries: [], history: [{ ...edit, msBeforeDeadline: "2026-11-09T10:00:00Z" }] }],
    ["edit with the time left out", { entries: [], history: [{ actor: "p2", kind: "place", subject: "p0", value: "vault", target: null }] }],
    ["a claim edit for someone else", { entries: [], history: [{ ...edit, kind: "room" }] }],
    ["agree cleared", { entries: [], history: [{ actor: "p0", kind: "agree", subject: "p0", value: null, target: null, msBeforeDeadline: 1 }] }],
    ["a room edit with a target", { entries: [], history: [{ actor: "p0", kind: "room", subject: "p0", value: "vault", target: "vault", msBeforeDeadline: 1 }] }],
    ["an unknown edit kind", { entries: [], history: [{ ...edit, kind: "chat" }] }],
  ];
  for (const [name, plan] of bad) {
    it(`${name}: refused, the round still pending and resolvable`, () => {
      const s = game(3);
      const r = handleCommand(s, ROUND(s, plan));
      expect(r.ok).toBe(false);
      expect(s.phase).toEqual({ kind: "planning", round: 1 });
      expect(saids(ok(s, ROUND(s)).events)).toEqual([]);
    });
  }
  it("a refused board throws nothing, whatever its shape", () => {
    const s = game(3);
    for (const plan of [null, 0, "plan", [], { entries: null, history: null }, { entries: [null], history: [] }, { entries: [], history: [null] }, { entries: [[]], history: [[]] }]) {
      expect(() => handleCommand(s, ROUND(s, plan))).not.toThrow();
      expect(handleCommand(s, ROUND(s, plan)).ok).toBe(false);
    }
  });
});
