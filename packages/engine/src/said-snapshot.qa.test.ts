// QA (S3a.9, #96): the said union and the order of a round's public events.
// Order is fixed whatever happened in secret; alibis and claims keep their
// limits. design §10, §11.3, §12, §18, §19.2 seam 5
import { describe, expect, it } from "vitest";
import { PERK_IDS } from "@skimjob/content";
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { fullGrab } from "./grab.testkit";
import { closeResultWindow } from "./result.testkit";

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

const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const ALIBI = (s: GameState) => ({ type: "advance", deadline: { kind: "alibi", round: s.resolvedRound } });
/** Closes the alibi window and then the result window, whichever are open (nobody posts, nobody calls an emergency). design §4.1, §9.3, §10 */
const settle = (s: GameState): GameState => {
  const r = closeResultWindow(s);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};
const mv = (p: string, room = "lobby", pocket = 0, extra: object = {}) => ({ type: "submitMove", player: p, move: { ...fullGrab(room, pocket), ...extra } });
const saids = (log: readonly GameEvent[]) => log.filter((e): e is Extract<GameEvent, { type: "said" }> => e.type === "said");

describe("QA: event order at resolution identifies nobody — design §10, §12, §18", () => {
  // Two worlds: who bought which perk (and in which order) differs.
  const world = (buys: [string, object][]) => {
    let s = game(4, { p3: "electrician" });
    for (const [p, perk] of buys) s = run(s, { type: "buyPerk", player: p, perk });
    s = run(s, mv("p0", "office"), mv("p1", "office"), mv("p2", "vault"), mv("p3", "lobby", 0, { ability: { kind: "blackout", room: "office" } }));
    return ok(s, ROUND(s));
  };
  const pub = (events: readonly GameEvent[]) => events.filter((e) => e.visibility.kind === "public");

  it("the nameless sales together, then the facts; buyer and buying order change no public event, nor their order", () => {
    const a = world([
      ["p0", { kind: "softShoes" }],
      ["p1", { kind: "blackout", room: "vault" }],
      ["p2", { kind: "ballot", target: "p3" }],
    ]);
    const b = world([
      ["p2", { kind: "blackout", room: "vault" }],
      ["p1", { kind: "ballot", target: "p3" }],
      ["p0", { kind: "softShoes" }],
    ]);
    const types = pub(a.events).map((e) => e.type);
    expect(types.slice(0, 3)).toEqual(["perkSold", "perkSold", "perkSold"]);
    expect(types.slice(3)).not.toContain("perkSold");
    expect(types).not.toContain("powerCut"); // design §11.1: cuts wait for the next round's start
    expect(pub(a.events)).toEqual(pub(b.events));
  });

  it("the next round's power cuts (an Electrician's and a Blackout perk's) come out the same in both worlds, with no source", () => {
    const next = (r: ReturnType<typeof world>) => {
      if (r.state.phase.kind !== "alibi") throw new Error(`expected the alibi window, got ${r.state.phase.kind}`);
      const s = closeResultWindow(r.state);
      if (!s.ok) throw new Error(s.reason);
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
  });

});

describe("QA: the said union and its limits — design §11.3, §19.2 seam 5", () => {
  /** Round 1 has resolved; its alibi window is open (design §10). */
  const resolved = (n = 3) => {
    const s = game(n);
    return run(s, ROUND(s));
  };

  it("every statement kind is one public said event every seat sees identically; the old event types are gone", () => {
    const s = run(resolved(), { type: "postAlibi", player: "p0", round: 1, room: "vault" }, { type: "claimRole", player: "p1", role: "hacker" });
    const kinds = saids(s.log).map((e) => e.statement.kind);
    expect(kinds).toEqual(["alibi", "role"]);
    for (const e of saids(s.log)) expect(e.visibility).toEqual({ kind: "public" });
    const seen = ids(3).map((p) => viewFor(s, p).ledger.filter(({ event }) => event.type === "said").map(({ event }) => event));
    for (const v of seen) expect(v).toEqual(saids(s.log));
    expect(s.log.some((e) => ["alibiPosted", "roleClaimed", "alibisClosed"].includes(e.type))).toBe(false);
  });

  it("alibi rounds: only the round whose alibi window is open; never a stale round, 0, a future one or a non-integer; none once it closes (design §10, owner 13 Nov)", () => {
    let s = resolved();
    for (let i = 0; i < 2; i++) s = run(settle(s), ROUND);
    expect(s.phase).toEqual({ kind: "alibi", round: 3 });
    const say = (round: unknown) => ({ type: "postAlibi", player: "p2", round, room: "lobby" });
    for (const r of [0, -1, 1, 2, 4, 5, 2.5, Number.NaN, Infinity, "3", null, undefined, [3], { valueOf: () => 3 }]) expect(refused(s, say(r))).toMatch(/is not open/);
    const posted = run(s, say(3));
    expect(saids(posted.log).filter((e) => e.statement.kind === "alibi")).toHaveLength(1);
    expect(refused(settle(posted), say(3))).toMatch(/is not open/);
  });

});

describe("QA: out of phase — design §4.1, §10, §11.3, owner rulings 9 and 13 Nov", () => {
  const alibi = (p: string, round: unknown, room = "lobby") => ({ type: "postAlibi", player: p, round, room });
  const claim = (p: string, role = "lookout") => ({ type: "claimRole", player: p, role });

  it("before any round resolves no alibi can be posted, for any round; a role claim can", () => {
    const s = game(3);
    for (const r of [0, 1, 2]) expect(refused(s, alibi("p0", r))).toMatch(/is not open/);
    expect(ok(s, claim("p0")).events.map((e) => e.type)).toEqual(["said"]);
  });

  it("alibis only in the alibi window; claims in every between-rounds phase: the alibi window, an awaited meeting, an open vote, a pending shakedown's window", () => {
    // A bank of 9 (3 a seat): round 1's full grabs take a third, so a regular meeting is due (design §9.1).
    let s = game(3, {}, { contentOverrides: { bank: { coinsPerPlayer: 3 } } });
    s = run(s, mv("p0", "vault"), mv("p1", "office"), mv("p2", "lobby"), (x: GameState) => ROUND(x));
    expect(s.phase.kind).toBe("alibi");
    s = run(s, alibi("p0", 1), claim("p0"));
    expect(refused(s, alibi("p0", 1, "vault"))).toMatch(/already posted/);
    s = run(s, ALIBI);
    expect(s.phase.kind).toBe("awaitingMeeting");
    expect(refused(s, alibi("p1", 1))).toMatch(/is not open/);
    s = run(s, claim("p1"));
    const id = s.phase.kind === "awaitingMeeting" ? s.phase.meetingId : "";
    s = run(s, { type: "scheduleMeeting", meetingId: id, slot: "now" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: id } });
    expect(s.phase.kind).toBe("meeting");
    // The regular meeting opened a new stretch: p0 and p1 may claim again, once.
    expect(refused(s, alibi("p1", 1))).toMatch(/is not open/);
    s = run(s, claim("p0", "priest"), claim("p1"));
    expect(refused(s, claim("p0", "hacker"))).toMatch(/already claimed/);
    s = run(s, { type: "castVote", player: "p0", vote: { kind: "shakedown", target: "p2" } }, { type: "castVote", player: "p1", vote: { kind: "shakedown", target: "p2" } });
    s = run(s, (x: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: x.meeting?.id } }));
    expect(s.phase.kind).toBe("shakedownPending");
    expect(refused(s, alibi("p2", 1))).toMatch(/is not open/);
    s = run(s, claim("p2"));
    expect(saids(s.log).filter((e) => e.statement.kind === "alibi").map((e) => e.statement.kind === "alibi" && e.statement.player)).toEqual(["p0"]);
  });

  it("an emergency meeting opens no new stretch: a claim made before it still blocks the next one", () => {
    let s = game(3);
    s = run(s, (x: GameState) => ROUND(x), ALIBI);
    expect(s.phase.kind).toBe("result");
    s = run(s, claim("p0"), { type: "callEmergency", player: "p1" });
    s = run(s, (x: GameState) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: x.pendingEmergency?.meetingId } }));
    expect(s.phase.kind).toBe("meeting");
    expect(s.stretch).toBe(1);
    expect(refused(s, claim("p0", "priest"))).toMatch(/already claimed/);
  });

  it("once the game is over, nothing more can be said: no alibi, no claim", () => {
    const s = game(3, {}, { contentOverrides: { roundCap: 1 } });
    const end = ok(s, ROUND(s)).state;
    expect(end.phase.kind).toBe("ended");
    expect(refused(end, alibi("p0", 1))).toBe("the game is over");
    expect(refused(end, claim("p0"))).toBe("the game is over");
  });
});
