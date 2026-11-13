// QA for S3a.6 (PR #173): the R7 deal at 3/10/11/12, per-holder charges,
// copies on one target, each power at its edges, the Mole's and Fixer's win
// through real games, determinism, and viewFor leaks checked by playing two
// games that differ only in a hidden fact. design §8.4, §8.5, §11, §18
import { describe, expect, it } from "vitest";
import { MAX_ROLE_COPIES, ROLES } from "@skimjob/content";
import type { ContentOverrides, GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand, type CommandResult } from "./handle";
import { viewFor } from "./view";
import { closeAlibiWindow, closeResultWindow } from "./result.testkit";
import { fullGrab } from "./grab.testkit";

function config(players: number, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: "qa173",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    ...extra,
  };
}

/** A new game where seat i holds roles[i] (a Lookout past the list: it acts only when used). */
function game(players: number, roles: string[], overrides: ContentOverrides | null = null, extra: Partial<GameConfig> = {}): GameState {
  const cfg = config(players, { ...extra, contentOverrides: overrides });
  let seat = 0;
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "lookout" } : e)));
}

const must = (r: CommandResult): GameState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};
type Cmd = unknown | ((s: GameState) => unknown);
const planningOpen = (s: GameState): GameState => (s.phase.kind === "result" ? must(closeResultWindow(s)) : s);
function run(state: GameState, ...commands: Cmd[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const cmd = typeof c === "function" ? c(s) : c;
    const r = handleCommand(planningOpen(s), cmd);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(cmd)}: ${r.reason}`);
    // design §10: a round's alibi window closes at once, nobody posting.
    return must(closeAlibiWindow(r.state));
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const s = planningOpen(state);
  const before = JSON.stringify(s);
  const r = handleCommand(s, command);
  if (r.ok) throw new Error(`expected a rejection of ${JSON.stringify(command)}`);
  expect(JSON.stringify(s)).toBe(before);
  return r.reason;
}
const ROUND = (s: GameState) => ({ type: "advance", deadline: { kind: "round", round: s.round } });
/**
 * Resolve the round being planned with everyone posting the same alibi `room`, so the closed
 * window shows nobody's real room (design §10) and only what the test is about can differ.
 */
const resolveAlibied = (s: GameState, room: string): GameState => {
  let x = must(handleCommand(s, ROUND(s)));
  for (const player of x.playerOrder) x = must(handleCommand(x, { type: "postAlibi", player, round: s.round, room }));
  return must(closeAlibiWindow(x));
};
/** Resolve the round being planned, stopping in its result window (or the meeting it called). */
const resolve = (s: GameState, ...moves: Cmd[]): GameState => run(s, ...moves, ROUND);
/** Open the due meeting (a briefing or a regular one) and close it with no votes. design §9.1, §9.2 */
function passMeeting(s: GameState): GameState {
  if (s.phase.kind !== "awaitingMeeting") return s;
  const id = s.phase.meetingId;
  const open = run(s, { type: "scheduleMeeting", meetingId: id, slot: "x" }, { type: "advance", deadline: { kind: "openMeeting", meetingId: id } });
  return planningOpen(run(open, (y: GameState) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: y.meeting?.id } })));
}
/** On to the next round's planning (any due meeting held with no votes, result window closed). */
const nextRound = (s: GameState): GameState => {
  const x = planningOpen(passMeeting(s));
  if (x.phase.kind !== "planning") throw new Error(`not planning: ${x.phase.kind}`);
  return x;
};
const since = (before: GameState, after: GameState): GameEvent[] => after.log.slice(before.log.length);
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const roleState = (s: GameState, id: string) => (s.players[id] as PlayerState).roleState;
const stash = (s: GameState, id: string) => (s.players[id] as PlayerState).stash;

const mv = (player: string, room: string, pocket = 0, extra: object = {}) => ({ type: "submitMove", player, move: { ...fullGrab(room, pocket), ...extra } });
const withAbility = (player: string, room: string, ability: object, pocket = 0) => mv(player, room, pocket, { ability });
const lobbyAll = (n: number, except: readonly string[] = []) =>
  Array.from({ length: n }, (_, i) => `p${i}`)
    .filter((id) => !except.includes(id))
    .map((id) => mv(id, "lobby"));
const use = (player: string, ability: object) => ({ type: "useAbility", player, ability });
/** Quiet Lobby rounds until a regular meeting is due, then open and close it with no votes (design §9.1). */
function pastRegularMeeting(s: GameState, n: number): GameState {
  let x = s;
  while (x.phase.kind !== "awaitingMeeting") x = run(x, ...lobbyAll(n), ROUND);
  expect(x.stretch).toBe(1);
  x = passMeeting(x);
  expect(x.stretch).toBe(2);
  return x;
}

// ---------------------------------------------------------------- the deal

describe("QA the deal at 3, 10, 11 and 12 players — design §11.3", () => {
  const kind = (r: string) => (ROLES[r] as (typeof ROLES)[string]).kind;
  const dealt = (n: number, seed: string) => {
    const s = createGame(config(n, { seed }));
    return s.playerOrder.map((id) => (s.players[id] as PlayerState).role);
  };
  const SEEDS = Array.from({ length: 150 }, (_, i) => `qa-deal-${i}`);
  const counts = (roles: readonly string[]) => roles.reduce((m, r) => m.set(r, (m.get(r) ?? 0) + 1), new Map<string, number>());

  it.each([3, 10, 11, 12])("%i players: one role per seat, ≤10 distinct, ≤2 copies, eyes and shadows within one", (n) => {
    const splits = new Set<string>();
    for (const seed of SEEDS) {
      const roles = dealt(n, seed);
      expect(roles).toHaveLength(n);
      const c = counts(roles);
      expect(Math.max(...c.values())).toBeLessThanOrEqual(MAX_ROLE_COPIES);
      expect(c.size).toBe(Math.min(n, 10));
      // Up to 10 every role is distinct; at 11 exactly one role repeats, at 12 exactly two.
      expect([...c.values()].filter((k) => k === 2)).toHaveLength(Math.max(0, n - 10));
      const eyes = roles.filter((r) => kind(r) === "eyes").length;
      const shadows = n - eyes;
      expect(Math.abs(eyes - shadows)).toBeLessThanOrEqual(n % 2);
      splits.add(`${eyes}/${shadows}`);
      if (n === 12) {
        // 6 + 6 from two kinds of 5: one repeat of each kind.
        const twice = [...c].filter(([, k]) => k === 2).map(([r]) => kind(r));
        expect(twice.sort()).toEqual(["eyes", "shadows"]);
      }
    }
    // An odd crew's extra seat goes to either kind, at random.
    expect(splits.size).toBe(n % 2 === 1 ? 2 : 1);
  });

  it("any role, the Mole and Fixer included, can be the repeated one at 11 and at 12", () => {
    for (const n of [11, 12]) {
      const repeated = new Set<string>();
      for (const seed of SEEDS) for (const [r, k] of counts(dealt(n, seed))) if (k === 2) repeated.add(r);
      expect([...repeated].sort()).toEqual(Object.keys(ROLES).sort());
    }
  });

  it("seeded: the same seed deals the same seats; seeds spread the deal; every role reaches every seat at 3", () => {
    for (const n of [3, 10, 11, 12]) {
      expect(dealt(n, "same")).toEqual(dealt(n, "same"));
      expect(new Set(SEEDS.slice(0, 30).map((s) => dealt(n, s).join())).size).toBeGreaterThan(20);
    }
    for (let seat = 0; seat < 3; seat++) {
      expect(new Set(SEEDS.map((s) => dealt(3, s)[seat])).size).toBe(10);
    }
  });

  it("the role list setting never changes who gets what; Exact lists one entry per seat with the repeats", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const exact = createGame(config(12, { seed }));
      const hidden = createGame(config(12, { seed, roleList: "hidden" }));
      const possible = createGame(config(12, { seed, roleList: "possible" }));
      const roles = (s: GameState) => s.playerOrder.map((id) => (s.players[id] as PlayerState).role);
      expect(roles(hidden)).toEqual(roles(exact));
      expect(roles(possible)).toEqual(roles(exact));
      const list = viewFor(exact, "p0").roleList;
      expect(list?.list).toBe("exact");
      expect([...(list?.roles ?? [])].sort()).toEqual([...roles(exact)].sort());
      expect(viewFor(hidden, "p0").roleList).toBeNull();
      expect(viewFor(possible, "p0").roleList?.roles).toEqual(Object.keys(ROLES));
    }
  });

  it("each seat sees only its own roleDealt (design §18)", () => {
    const s = createGame(config(12, { seed: "qa-private" }));
    for (const id of s.playerOrder) {
      const v = viewFor(s, id);
      const mine = [...v.ledger, ...v.caseFile].filter((e) => e.event.type === "roleDealt");
      expect(mine.map((e) => (e.event as Extract<GameEvent, { type: "roleDealt" }>).player)).toEqual([id]);
      expect(v.me.role).toBe((s.players[id] as PlayerState).role);
    }
  });
});

// ---------------------------------------------------------------- charges per holder

describe("QA charges are per holder — design §11.3, §19.2 seam 9", () => {
  it("two Moles at 12: each rings once a stretch on their own charge; a regular meeting recharges both", () => {
    let s = game(12, ["mole", "mole"]);
    s = nextRound(resolve(s, withAbility("p0", "lobby", { kind: "ring", room: "office" }), ...lobbyAll(12, ["p0"])));
    expect([roleState(s, "p0").usedThisStretch, roleState(s, "p1").usedThisStretch]).toEqual([1, 0]);
    expect(reason(s, withAbility("p0", "lobby", { kind: "ring", room: "office" }))).toMatch(/already rung a bell/);
    s = nextRound(resolve(s, withAbility("p1", "lobby", { kind: "ring", room: "office" }), ...lobbyAll(12, ["p1"])));
    expect(reason(s, withAbility("p1", "lobby", { kind: "ring", room: "vault" }))).toMatch(/already rung a bell/);
    s = pastRegularMeeting(s, 12);
    expect([roleState(s, "p0").usedThisStretch, roleState(s, "p1").usedThisStretch]).toEqual([0, 0]);
    s = resolve(s, withAbility("p0", "lobby", { kind: "ring", room: "office" }), withAbility("p1", "lobby", { kind: "ring", room: "vault" }), ...lobbyAll(12, ["p0", "p1"]));
    expect([roleState(s, "p0").usedThisStretch, roleState(s, "p1").usedThisStretch]).toEqual([1, 1]);
  });

  it("two Fixers: one reopening a room leaves the other's once-per-game charge whole", () => {
    // Bells of 1 bulb: a single Vault coin raids it.
    let s = game(12, ["fixer", "fixer"], { alarm: { bulbs: 1, bustStars: 9 } });
    s = nextRound(resolve(s, mv("p2", "vault", 0, { duffel: 1, pocket: 0 }), mv("p3", "office", 0, { duffel: 2, pocket: 0 }), ...lobbyAll(12, ["p2", "p3"])));
    expect(Object.keys(s.taped).sort()).toEqual(["office", "vault"]);
    s = resolve(s, withAbility("p0", "lobby", { kind: "reopen", room: "vault" }), ...lobbyAll(12, ["p0"]));
    expect([roleState(s, "p0").usedThisGame, roleState(s, "p1").usedThisGame]).toEqual([1, 0]);
    s = nextRound(s);
    s = resolve(s, withAbility("p1", "lobby", { kind: "reopen", room: "office" }), ...lobbyAll(12, ["p1"]));
    expect(s.taped).toEqual({});
    expect([roleState(s, "p0").usedThisGame, roleState(s, "p1").usedThisGame]).toEqual([1, 1]);
  });

  it("two Electricians on different rooms: both cuts land, both spent, nothing drawn", () => {
    const s = game(12, ["electrician", "electrician"]);
    const after = resolve(s, withAbility("p0", "lobby", { kind: "blackout", room: "office" }), withAbility("p1", "lobby", { kind: "blackout", room: "vault" }), ...lobbyAll(12, ["p0", "p1"]));
    expect(ofType(since(s, after), "abilityAlreadyDone")).toEqual([]);
    expect(ofType(since(s, after), "rngAdvanced")).toEqual([]);
    expect([roleState(after, "p0").usedThisStretch, roleState(after, "p1").usedThisStretch]).toEqual([1, 1]);
    const next = nextRound(after);
    // design §11.1, §18: announced in the game's room order, not seat order.
    expect(ofType(next.log, "powerCut").map((e) => e.room)).toEqual(["vault", "office"]);
    expect(next.dark).toEqual(["vault", "office"]);
  });
});

// ---------------------------------------------------------------- copies on one target

describe("QA copies acting on the same target — design §11.4", () => {
  const twelve = (roles: string[], seed: string, overrides: ContentOverrides | null = null) => game(12, roles, overrides, { seed });

  it("a second Hacker that found the bell already hidden keeps its charge and can hide another room next round", () => {
    const hide = (room: string) => ({ kind: "hide", room });
    const s = twelve(["hacker", "hacker"], "qa-hack");
    const r1 = resolve(s, withAbility("p0", "lobby", hide("vault")), withAbility("p1", "lobby", hide("vault")), ...lobbyAll(12, ["p0", "p1"]));
    const second = ofType(since(s, r1), "abilityAlreadyDone")[0]?.player as string;
    const first = second === "p0" ? "p1" : "p0";
    expect(roleState(r1, second).usedThisStretch).toBe(0);
    // Only the Hacker whose hide acted sees the real bell (design §11.1); the copy told "already done" isn't it.
    expect(viewFor(r1, first).bells).toHaveProperty("vault");
    const r2 = resolve(nextRound(r1), withAbility(second, "lobby", hide("office")), ...lobbyAll(12, [second]));
    expect(ofType(r2.log, "bellsRung").at(-1)?.hidden).toEqual(["office"]);
    expect(roleState(r2, second).usedThisStretch).toBe(1);
    expect(reason(nextRound(r2), withAbility(first, "lobby", hide("office")))).toMatch(/already hidden a bell/);
  });

  it("a second Electrician on an already cut room keeps its charge and cuts another room next round", () => {
    const cut = (room: string) => ({ kind: "blackout", room });
    const s = twelve(["electrician", "electrician"], "qa-cut");
    const r1 = resolve(s, withAbility("p0", "lobby", cut("vault")), withAbility("p1", "lobby", cut("vault")), ...lobbyAll(12, ["p0", "p1"]));
    const second = ofType(since(s, r1), "abilityAlreadyDone")[0]?.player as string;
    const n2 = nextRound(r1);
    expect(ofType(n2.log, "powerCut").map((e) => e.room)).toEqual(["vault"]);
    const n3 = nextRound(resolve(n2, withAbility(second, "lobby", cut("office")), ...lobbyAll(12, [second])));
    expect(n3.dark).toEqual(["office"]);
  });

  it("a second Fixer on an already reopened room keeps its charge for later", () => {
    const s = twelve(["fixer", "fixer"], "qa-fix", { alarm: { bulbs: 1, bustStars: 9 } });
    let x = nextRound(resolve(s, mv("p2", "vault", 0, { duffel: 1, pocket: 0 }), ...lobbyAll(12, ["p2"])));
    if (x.phase.kind !== "planning") throw new Error("expected planning");
    const r = resolve(x, withAbility("p0", "lobby", { kind: "reopen", room: "vault" }), withAbility("p1", "lobby", { kind: "reopen", room: "vault" }), ...lobbyAll(12, ["p0", "p1"]));
    const events = since(x, r);
    expect(ofType(events, "roomReopened")).toHaveLength(1);
    const second = ofType(events, "abilityAlreadyDone")[0]?.player as string;
    expect(roleState(r, second).usedThisGame).toBe(0);
    x = nextRound(resolve(nextRound(r), mv("p2", "vault", 0, { duffel: 1, pocket: 0 }), ...lobbyAll(12, ["p2"])));
    const again = resolve(x, withAbility(second, "lobby", { kind: "reopen", room: "vault" }), ...lobbyAll(12, [second]));
    expect(ofType(since(x, again), "roomReopened")).toHaveLength(1);
  });

  it("two Priests on one pocketing target: in either seeded order the target loses the coins once, and one is already done", () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 16; i++) {
      const s = twelve(["priest", "priest"], `qa-priest-${i}`);
      const absolve = { kind: "absolve", target: "p2" };
      const r = resolve(s, withAbility("p0", "lobby", absolve), withAbility("p1", "lobby", absolve), mv("p2", "vault", 3), ...lobbyAll(12, ["p0", "p1", "p2"]));
      const events = since(s, r);
      const [res] = ofType(events, "abilityResolved");
      const [done] = ofType(events, "abilityAlreadyDone");
      expect(res?.ability).toEqual({ kind: "absolve", target: "p2", taken: 3 });
      expect(done?.player).toBe(res?.player === "p0" ? "p1" : "p0");
      expect(ofType(events, "sinsAbsolved")).toHaveLength(1);
      expect(r.setAside).toBe(3);
      expect(stash(r, "p2")).toBe(0);
      firsts.add(res?.player as string);
    }
    expect([...firsts].sort()).toEqual(["p0", "p1"]);
  });

  it("Lookouts, Detectives and Auditors on one target each learn the same, and both uses count", () => {
    const s = twelve(["lookout", "lookout", "detective", "detective", "auditor", "auditor"], "qa-learn");
    const look = { kind: "lookout", rooms: ["vault"] };
    let r = resolve(s, withAbility("p0", "lobby", look), withAbility("p1", "lobby", look), mv("p6", "vault", 1), ...lobbyAll(12, ["p0", "p1", "p6"]));
    const watched = ofType(since(s, r), "roomWatched").filter((e) => e.source === "lookout");
    expect(watched.map((e) => [e.player, e.seen])).toEqual([
      ["p0", ["p6"]],
      ["p1", ["p6"]],
    ]);
    expect(ofType(since(s, r), "abilityAlreadyDone")).toEqual([]);
    const before = r;
    r = run(r, use("p2", { kind: "detect", target: "p6" }), use("p3", { kind: "detect", target: "p6" }), use("p4", { kind: "audit", room: "vault" }), use("p5", { kind: "audit", room: "vault" }));
    expect(ofType(since(before, r), "abilityResolved").map((e) => [e.player, e.ability])).toEqual([
      ["p2", { kind: "detect", round: 1, target: "p6", grabbed: 3 }],
      ["p3", { kind: "detect", round: 1, target: "p6", grabbed: 3 }],
      ["p4", { kind: "audit", round: 1, room: "vault", duffel: 2 }],
      ["p5", { kind: "audit", round: 1, room: "vault", duffel: 2 }],
    ]);
    expect([roleState(r, "p4").usedThisStretch, roleState(r, "p5").usedThisStretch]).toEqual([1, 1]);
  });

  it("two Mole rings on a room a Hacker hid stack; the Hacker learns the real bell, nobody else sees it", () => {
    const s = twelve(["mole", "mole", "hacker"], "qa-stack");
    const r = resolve(
      s,
      withAbility("p0", "lobby", { kind: "ring", room: "office" }),
      withAbility("p1", "lobby", { kind: "ring", room: "office" }),
      withAbility("p2", "lobby", { kind: "hide", room: "office" }),
      ...lobbyAll(12, ["p0", "p1", "p2"]),
    );
    // 2 rings, then cooled by 1.
    expect(ofType(since(s, r), "abilityResolved").find((e) => e.player === "p2")?.ability).toEqual({ kind: "hide", room: "office", bulbs: 1 });
    expect(viewFor(r, "p2").bells.office).toBe(1);
    for (const id of ["p0", "p1", "p3"]) expect(viewFor(r, id).bells).not.toHaveProperty("office");
  });
});

// ---------------------------------------------------------------- powers at their edges

describe("QA each power at its edges; invalid and out-of-phase uses — design §11.1", () => {
  const ODD = ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty", "", 7, null, ["vault"], { room: "vault" }];

  it("prototype-ish and malformed rooms are refused by every room power, leaving state untouched", () => {
    const s = game(3, ["hacker", "mole", "electrician"]);
    const f = game(3, ["fixer", "lookout", "lookout"]);
    for (const room of ODD) {
      expect(reason(s, withAbility("p0", "lobby", { kind: "hide", room }))).toMatch(/room in play/);
      expect(reason(s, withAbility("p1", "lobby", { kind: "ring", room }))).toMatch(/room in play/);
      expect(reason(s, withAbility("p2", "lobby", { kind: "blackout", room }))).toMatch(/room in play/);
      expect(reason(f, withAbility("p0", "lobby", { kind: "reopen", room }))).toMatch(/taped-off room/);
      expect(reason(f, withAbility("p1", "lobby", { kind: "lookout", rooms: [room] }))).toMatch(/rooms in play|1 to 1/);
    }
  });

  it("prototype-ish and malformed players are refused by the Priest and Detective", () => {
    const s = run(game(3, ["priest", "detective"]), ...lobbyAll(3), ROUND);
    for (const target of ODD) {
      expect(reason(nextRound(s), withAbility("p0", "lobby", { kind: "absolve", target }))).toMatch(/unknown player/);
      expect(reason(s, use("p1", { kind: "detect", target }))).toMatch(/unknown player/);
    }
  });

  it("the Lookout: exactly one extra room in play, never the same twice; a taped-off room shows nobody", () => {
    const s = game(3, ["lookout"], { alarm: { bulbs: 1, bustStars: 9 } });
    for (const rooms of [[], ["office", "vault"], ["vault", "vault"], "vault", undefined, ["serverRoom"]]) {
      expect(reason(s, withAbility("p0", "lobby", { kind: "lookout", rooms }))).toMatch(/Lookout/);
    }
    const x = nextRound(resolve(s, mv("p1", "vault", 0, { duffel: 1, pocket: 0 }), mv("p2", "lobby")));
    expect(x.taped).toHaveProperty("vault");
    const r = resolve(x, withAbility("p0", "lobby", { kind: "lookout", rooms: ["vault"] }), mv("p1", "lobby"), mv("p2", "lobby"));
    expect(ofType(since(x, r), "roomWatched")).toMatchObject([{ player: "p0", source: "lookout", room: "vault", seen: [], offline: false }]);
  });

  it("the Detective: nothing before round 1 resolves, never yourself, once per resolved round, 0 for a player who sat out", () => {
    const s = game(3, ["detective"]);
    expect(reason(s, use("p0", { kind: "detect", target: "p1" }))).toMatch(/no round has resolved/);
    let x = resolve(s, mv("p1", "office", 1), mv("p2", "lobby"));
    expect(reason(x, use("p0", { kind: "detect", target: "p0" }))).toMatch(/another player/);
    x = run(x, use("p0", { kind: "detect", target: "p1" }));
    expect(ofType(x.log, "abilityResolved").at(-1)?.ability).toEqual({ kind: "detect", round: 1, target: "p1", grabbed: 2 });
    expect(reason(x, use("p0", { kind: "detect", target: "p2" }))).toMatch(/already looked into round 1/);
    // A move can't carry it, and other roles can't use it.
    expect(reason(nextRound(x), withAbility("p0", "lobby", { kind: "detect", target: "p1" }))).toMatch(/isn't used in a move/);
    expect(reason(x, use("p1", { kind: "detect", target: "p2" }))).toMatch(/no detect ability/);
  });

  it("move powers are refused through useAbility, and a role can't send another role's kind", () => {
    const s = game(3, ["hacker", "mole", "priest"]);
    expect(reason(s, use("p0", { kind: "hide", room: "vault" }))).toMatch(/no hide ability to use now/);
    expect(reason(s, use("p2", { kind: "absolve", target: "p1" }))).toMatch(/no absolve ability to use now/);
    expect(reason(s, withAbility("p0", "lobby", { kind: "ring", room: "vault" }))).toMatch(/no ring ability/);
    expect(reason(s, withAbility("p1", "lobby", { kind: "hide", room: "vault" }))).toMatch(/no hide ability/);
    expect(reason(s, withAbility("p2", "lobby", { kind: "reopen", room: "vault" }))).toMatch(/no reopen ability/);
  });

  it("out of phase: no move power in the result window or a meeting", () => {
    const s = game(3, ["hacker", "electrician", "priest"]);
    const result = resolve(s, ...lobbyAll(3));
    expect(result.phase.kind).toBe("result");
    // Straight to the engine: the helpers close the result window first.
    for (const command of [withAbility("p0", "lobby", { kind: "hide", room: "vault" }), withAbility("p1", "lobby", { kind: "blackout", room: "vault" }), withAbility("p2", "lobby", { kind: "absolve", target: "p1" })]) {
      expect(handleCommand(result, command)).toEqual({ ok: false, reason: "moves can only be submitted while a round is being planned" });
    }
    // In a meeting: no moves at all.
    const called = must(handleCommand(result, { type: "callEmergency", player: "p1" }));
    const meet = must(handleCommand(called, { type: "advance", deadline: { kind: "openMeeting", meetingId: called.pendingEmergency?.meetingId } }));
    expect(meet.phase.kind).toBe("meeting");
    expect(reason(meet, withAbility("p0", "lobby", { kind: "hide", room: "vault" }))).toMatch(/while a round is being planned/);
  });

  it("the Priest absolves from planning only; an absolve of a sitting-out player still takes what's above the share", () => {
    // Lobby taped off: missed moves sit the round out (design §3.3). p1 pockets 2 in round 1.
    const s = game(3, ["priest"], { alarm: { bulbs: 1, bustStars: 9 }, rooms: { lobby: { quietCoins: 0 }, office: { quietCoins: 1 } } });
    // p0's Lobby coin rings (quietCoins 0) and raids it; p1's Office coin is made silent, so it isn't seized.
    const x = nextRound(resolve(s, mv("p0", "lobby"), mv("p1", "office", 0, { duffel: 0, pocket: 1 }), mv("p2", "rooftop")));
    expect(x.taped).toHaveProperty("lobby");
    const above = stash(x, "p1") - x.share;
    expect(above).toBeGreaterThan(0);
    const r = resolve(x, withAbility("p0", "rooftop", { kind: "absolve", target: "p1" }), mv("p2", "rooftop"));
    expect(ofType(since(x, r), "defaultMoveAssigned")).toMatchObject([{ player: "p1", move: null }]);
    expect(ofType(since(x, r), "sinsAbsolved")).toMatchObject([{ player: "p1", taken: above }]);
  });
});

// ---------------------------------------------------------------- the Mole's and Fixer's win

describe("QA the Mole's and Fixer's win through played games — design §8.4, §8.5", () => {
  const cap1 = (roles: string[], overrides: ContentOverrides = {}) => game(roles.length, roles, { roundCap: 1, ...overrides });
  const outcome = (s: GameState) => {
    if (s.phase.kind !== "ended") throw new Error(`not ended: ${s.phase.kind}`);
    return s.phase.outcome;
  };

  it("sunk by theft: the Mole on top wins alone; tied with a Lookout, only the Mole; the Fixer tied too, both", () => {
    // Taken 5, reached 2: honesty 40%.
    let o = outcome(run(cap1(["mole", "lookout", "lookout"]), mv("p0", "vault", 3), mv("p1", "lobby"), mv("p2", "lobby"), ROUND));
    expect(o).toMatchObject({ result: "failed", reason: "theft", winners: ["p0"] });
    const wide = { alarm: { bulbs: 12, tapedRounds: 2, bustStars: 3 } };
    o = outcome(run(cap1(["mole", "lookout", "lookout"], wide), mv("p0", "vault", 3), mv("p1", "vault", 3), mv("p2", "lobby"), ROUND));
    expect(o).toMatchObject({ reason: "theft", winners: ["p0"] });
    o = outcome(run(cap1(["mole", "lookout", "fixer"], wide), mv("p0", "vault", 3), mv("p1", "vault", 3), mv("p2", "vault", 3), ROUND));
    expect(o).toMatchObject({ reason: "theft", winners: ["p0", "p2"] });
  });

  it("sunk by theft with nobody of theirs on top: nobody wins; two Moles at 11, only the one on top", () => {
    let o = outcome(run(cap1(["mole", "lookout", "fixer"]), mv("p0", "lobby", 1), mv("p1", "vault", 3), mv("p2", "lobby"), ROUND));
    expect(o).toMatchObject({ reason: "theft", winners: [] });
    const eleven = game(11, ["mole", "mole"], { roundCap: 1 });
    o = outcome(run(eleven, mv("p0", "vault", 3), mv("p1", "office", 2), ...lobbyAll(11, ["p0", "p1"]).map((m) => ({ ...m, move: { room: "lobby", duffel: 0, pocket: 1 } })), ROUND));
    expect(o).toMatchObject({ reason: "theft", winners: ["p0"] });
  });

  it("a last-round absolve lowers the Mole's stash before the end check, so the Mole can lose the win", () => {
    const o = outcome(run(cap1(["mole", "priest", "lookout"]), mv("p0", "vault", 3), withAbility("p1", "lobby", { kind: "absolve", target: "p0" }), mv("p2", "office", 1), ROUND));
    expect(o).toMatchObject({ result: "failed", reason: "theft", winners: [] });
    expect(o.ranking.map((e) => [e.player, e.stash])).toEqual([
      ["p2", 1],
      ["p0", 0],
      ["p1", 0],
    ]);
  });

  it("their own rule never applies to a bust or a success", () => {
    // Bust at 1 star: the Mole holds the biggest stash but isn't on the Rooftop.
    let s = game(3, ["mole", "fixer", "lookout"], { alarm: { bulbs: 3, bustStars: 1 } });
    s = nextRound(run(s, mv("p0", "office", 2), mv("p1", "lobby"), mv("p2", "lobby"), ROUND));
    s = run(s, mv("p0", "lobby"), mv("p1", "rooftop"), mv("p2", "vault"), ROUND);
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "bust", winners: ["p1"] });
    // Success: everyone handed in, every stash equal: the whole crew wins, the Mole and Fixer like anyone.
    const ok = outcome(run(cap1(["mole", "fixer", "lookout"]), ...lobbyAll(3), ROUND));
    expect(ok).toMatchObject({ result: "success", winners: ["p0", "p1", "p2"] });
  });
});

// ---------------------------------------------------------------- determinism

describe("QA determinism with copies — CLAUDE.md engine rules, design §11.4", () => {
  const play = (seed: string): GameState => {
    let s = game(12, ["hacker", "hacker", "priest", "priest", "mole", "mole", "electrician", "electrician", "fixer", "detective"], { alarm: { bulbs: 5, tapedRounds: 2, bustStars: 9 } }, { seed });
    s = resolve(
      s,
      withAbility("p0", "lobby", { kind: "hide", room: "vault" }),
      withAbility("p1", "lobby", { kind: "hide", room: "vault" }),
      withAbility("p2", "lobby", { kind: "absolve", target: "p10" }),
      withAbility("p3", "lobby", { kind: "absolve", target: "p10" }),
      withAbility("p4", "lobby", { kind: "ring", room: "vault" }),
      withAbility("p5", "lobby", { kind: "ring", room: "vault" }),
      withAbility("p6", "lobby", { kind: "blackout", room: "office" }),
      withAbility("p7", "lobby", { kind: "blackout", room: "office" }),
      mv("p8", "rooftop"),
      mv("p9", "lobby"),
      mv("p10", "office", 2),
      mv("p11", "vault"),
    );
    s = run(s, use("p9", { kind: "detect", target: "p10" }));
    s = nextRound(s);
    return resolve(s, withAbility("p8", "lobby", { kind: "reopen", room: "vault" }), mv("p10", "office", 1), mv("p11", "rooftop"));
  };

  it("same seed + same commands → identical log; replay rebuilds the same state; another seed may order copies differently", () => {
    const a = play("qa-det");
    const b = play("qa-det");
    expect(b.log).toEqual(a.log);
    expect(replay(a.config, a.log)).toEqual(a);
    expect(ofType(a.log, "abilityAlreadyDone").map((e) => e.ability.kind).sort()).toEqual(["absolve", "blackout", "hide"]);
    expect(ofType(a.log, "roomReopened")).toHaveLength(1);
    const orders = new Set(Array.from({ length: 10 }, (_, i) => ofType(play(`qa-det-${i}`).log, "abilityAlreadyDone").map((e) => e.player).join()));
    expect(orders.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------- viewFor leaks

describe("QA viewFor leaks: two games differing only in a hidden fact look the same to others — design §18", () => {
  const sameView = (a: GameState, b: GameState, id: string) => expect(JSON.stringify(viewFor(a, id))).toBe(JSON.stringify(viewFor(b, id)));

  it("the hidden bell: a Mole's ring into it changes nothing anyone but the Mole and Hacker see, until the next round", () => {
    const s = game(3, ["hacker", "mole", "lookout"]);
    const play = (ring: boolean) =>
      resolve(s, withAbility("p0", "lobby", { kind: "hide", room: "vault" }), ring ? withAbility("p1", "lobby", { kind: "ring", room: "vault" }) : mv("p1", "lobby"), mv("p2", "vault", 0, { duffel: 1, pocket: 0 }));
    const a = play(true);
    const b = play(false);
    sameView(a, b, "p2");
    // The Hacker does see the difference (the test can tell them apart).
    expect(viewFor(a, "p0").bells.vault).toBe(1);
    expect(viewFor(b, "p0").bells.vault).toBe(0);
    // And it reappears for everyone as the next round starts.
    expect(viewFor(nextRound(a), "p2").bells.vault).toBe(1);
    expect(viewFor(nextRound(b), "p2").bells.vault).toBe(0);
  });

  it("the Electrician's cut is invisible until the next round starts, then announced with no source", () => {
    const s = game(3, ["electrician", "lookout", "lookout"]);
    const a = resolve(s, withAbility("p0", "lobby", { kind: "blackout", room: "office" }), mv("p1", "lobby"), mv("p2", "lobby"));
    const b = resolve(s, mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "lobby"));
    for (const id of ["p1", "p2"]) {
      sameView(a, b, id);
    }
    expect(viewFor(a, "p1").dark).toEqual([]);
    const next = nextRound(a);
    const cut = viewFor(next, "p1").ledger.filter((e) => e.event.type === "powerCut");
    expect(cut.map((e) => e.event)).toEqual([{ type: "powerCut", visibility: { kind: "public" }, round: 2, room: "office" }]);
  });

  it("a blacked-out room: who else was there doesn't reach its occupants or a Security feed into it", () => {
    // Round 1: p0 cuts the Rooftop; every bell stays at 0 (Lobby is silent).
    const s = nextRound(resolve(game(4, ["electrician"]), withAbility("p0", "lobby", { kind: "blackout", room: "rooftop" }), ...lobbyAll(4, ["p0"])));
    expect(s.dark).toEqual(["rooftop"]);
    // Everyone posts the same alibi, so the closed window shows no real room (design §10).
    const a = resolveAlibied(run(s, mv("p0", "lobby"), mv("p1", "rooftop"), mv("p2", "rooftop"), mv("p3", "security", 0, { watch: "rooftop" })), "lobby");
    const b = resolveAlibied(run(s, mv("p0", "lobby"), mv("p1", "security", 0, { watch: "lobby" }), mv("p2", "rooftop"), mv("p3", "security", 0, { watch: "rooftop" })), "lobby");
    sameView(a, b, "p2");
    expect(ofType(since(s, a), "roomWatched").find((e) => e.player === "p3")).toMatchObject({ room: "rooftop", seen: [], offline: true });
  });

  it("whom the Priest absolved: a third player can't tell between two equally guilty targets, even after the next split", () => {
    const s = game(4, ["priest"]);
    const play = (target: string) => {
      const r1 = resolve(s, withAbility("p0", "lobby", { kind: "absolve", target }), mv("p1", "office", 2), mv("p2", "office", 2), mv("p3", "lobby"));
      return { r1, r2: resolve(nextRound(r1), ...lobbyAll(4)) };
    };
    const a = play("p1");
    const b = play("p2");
    sameView(a.r1, b.r1, "p3");
    sameView(a.r2, b.r2, "p3");
    expect(viewFor(a.r1, "p1").caseFile.some((e) => e.event.type === "sinsAbsolved")).toBe(true);
    expect(viewFor(b.r1, "p1").caseFile.some((e) => e.event.type === "sinsAbsolved")).toBe(false);
  });

  it("whom the Detective looked into and which room the Auditor audited stay with them", () => {
    const s = resolve(game(4, ["detective", "auditor"]), mv("p0", "lobby"), mv("p1", "lobby"), mv("p2", "vault", 3), mv("p3", "office", 1));
    const a = run(s, use("p0", { kind: "detect", target: "p2" }), use("p1", { kind: "audit", room: "vault" }));
    const b = run(s, use("p0", { kind: "detect", target: "p3" }), use("p1", { kind: "audit", room: "office" }));
    for (const id of ["p2", "p3"]) sameView(a, b, id);
    expect(JSON.stringify(viewFor(a, "p0"))).not.toBe(JSON.stringify(viewFor(b, "p0")));
  });

  it("'already done' reaches only the copy it tells: everyone else sees what a single use would show", () => {
    const s = game(11, ["hacker", "hacker"], null, { seed: "qa-done" });
    const both = resolve(s, withAbility("p0", "lobby", { kind: "hide", room: "vault" }), withAbility("p1", "lobby", { kind: "hide", room: "vault" }), ...lobbyAll(11, ["p0", "p1"]));
    const first = ofType(since(s, both), "abilityResolved")[0]?.player as string;
    const second = first === "p0" ? "p1" : "p0";
    const one = resolve(s, withAbility(first, "lobby", { kind: "hide", room: "vault" }), mv(second, "lobby"), ...lobbyAll(11, ["p0", "p1"]));
    for (const id of [first, "p2", "p10"]) sameView(both, one, id);
    expect(viewFor(both, second).caseFile.filter((e) => e.event.type === "abilityAlreadyDone")).toHaveLength(1);
  });
});
