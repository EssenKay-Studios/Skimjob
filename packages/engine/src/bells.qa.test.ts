// QA (PR #159): adversarial tests for bells, raids, tape, cooling, Wanted and
// the bust with the Rooftop escape; the Mole's ring and the Fixer's reopen.
// design §3.3, §4.2, §5.1–§5.6, §8.3, §8.5, §11.1, §18
import { describe, expect, it } from "vitest";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { closeAlibiWindow, closeResultWindow, handleThroughResult } from "./result.testkit";
import { viewFor } from "./view";
import { canSee } from "./types";
import type { Command, GameConfig, GameEvent, GameState } from "./types";

function config(players: number, seed = "bells-qa"): GameConfig {
  return {
    seed,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    contentOverrides: null,
  };
}

/** A new game with seat i dealt roles[i] (a Lookout if missing: its power acts only when used). */
function game(players: number, roles: string[] = [], seed?: string): GameState {
  const cfg = config(players, seed);
  let seat = 0;
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: roles[seat++] ?? "lookout" } : e)));
}

type Step = Command | ((s: GameState) => Command);
function run(state: GameState, ...commands: Step[]): GameState {
  return commands.reduce<GameState>((s, c) => {
    const r = handleThroughResult(s, typeof c === "function" ? c(s) : c);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(c)}: ${r.reason}`);
    return r.state;
  }, state);
}
function reason(state: GameState, command: unknown): string {
  const r = handleCommand(state, command);
  if (r.ok) throw new Error("expected a rejection");
  return r.reason;
}

const mv = (player: string, room: string, duffel = 0, pocket = 0, extra: object = {}): Command =>
  ({ type: "submitMove", player, move: { room, duffel, pocket, ...extra } }) as Command;
const ROUND = (s: GameState): Command => ({ type: "advance", deadline: { kind: "round", round: s.round } });
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const since = (before: GameState, after: GameState) => after.log.slice(before.log.length);
const withStash = (g: GameState, stash: Record<string, number>): GameState => ({
  ...g,
  players: Object.fromEntries(Object.entries(g.players).map(([id, p]) => [id, { ...p, stash: stash[id] ?? p.stash }])),
});
const outcome = (s: GameState) => {
  if (s.phase.kind !== "ended") throw new Error(`not ended: ${s.phase.kind}`);
  return s.phase.outcome as typeof s.phase.outcome & { escapees?: readonly string[] };
};
/** Every seat but those listed lands in the Lobby with 1 coin handed in (silent). */
const lobbyRest = (n: number, busy: string[]): Command[] =>
  Array.from({ length: n }, (_, i) => `p${i}`)
    .filter((p) => !busy.includes(p))
    .map((p) => mv(p, "lobby", 1));
/** Through the meeting the last round called (a raid's police briefing, design §9.2), nobody voting, then the result window (§9.3). */
const MEETING: Step[] = [
  (s) => ({ type: "scheduleMeeting", meetingId: s.phase.kind === "awaitingMeeting" ? s.phase.meetingId : "", slot: "x" }),
  (s) => ({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId ?? "" } }),
  (s) => ({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id ?? "" } }),
  (s) => ({ type: "advance", deadline: { kind: "result", round: s.resolvedRound } }),
];

describe("QA: the raid line is exactly the 5th bulb — design §5.1, §5.3", () => {
  it("3 lit bulbs is no raid; the bell cools to 2", () => {
    const s = run(game(3), mv("p0", "vault", 3), mv("p1", "lobby", 1), mv("p2", "lobby", 1), ROUND);
    expect(ofType(s.log, "bellsRung")[0]?.bells.vault).toBe(3);
    expect(ofType(s.log, "roomRaided")).toEqual([]);
    expect([s.wanted, s.taped, s.bells.vault]).toEqual([0, {}, 2]);
  });

  it("a bell left at 4 stays unraided with no new ring; one more ring raids it", () => {
    const g = game(3);
    const hot = { ...g, bells: { ...g.bells, vault: 4 } };
    const quiet = run(hot, mv("p0", "lobby", 1), mv("p1", "lobby", 1), mv("p2", "lobby", 1), ROUND);
    expect([quiet.wanted, quiet.bells.vault]).toEqual([0, 3]);
    const loud = run(hot, mv("p0", "vault", 1), mv("p1", "lobby", 1), mv("p2", "lobby", 1), ROUND);
    expect(ofType(loud.log, "roomRaided")).toMatchObject([{ room: "vault", seized: 1, wanted: 1, closedThrough: 3 }]);
  });

  it("the Office rings once per coin: 2 visitors grabbing 2 is 4 bulbs, a 3rd visitor raids it", () => {
    const two = run(game(4), mv("p0", "office", 2), mv("p1", "office", 2), mv("p2", "lobby", 1), mv("p3", "lobby", 1), ROUND);
    expect([ofType(two.log, "bellsRung")[0]?.bells.office, two.wanted]).toEqual([4, 0]);
    const three = run(game(4), mv("p0", "office", 2), mv("p1", "office", 2), mv("p2", "office", 2), mv("p3", "lobby", 1), ROUND);
    expect(ofType(three.log, "roomRaided")).toMatchObject([{ room: "office", seized: 6, wanted: 1 }]);
  });

  it("the Mole's ring is the 5th bulb on a bell at 4, even in a room nobody visits", () => {
    const g = game(3, ["mole"]);
    const s = run({ ...g, bells: { ...g.bells, office: 4 } }, mv("p0", "lobby", 1, 0, { ability: { kind: "ring", room: "office" } }), mv("p1", "lobby", 1), mv("p2", "lobby", 1), ROUND);
    expect(ofType(s.log, "roomRaided")).toMatchObject([{ room: "office", seized: 0, wanted: 1 }]);
    // The Mole's own Lobby grab stands: a raid seizes only the raided room's visitors.
    expect(ofType(s.log, "coinsGrabbed").find((e) => e.player === "p0")).toMatchObject({ room: "lobby", duffel: 1, seized: 0 });
  });
});

describe("QA: two rooms raided in one round — design §4.2 steps 3–4, §5.4", () => {
  /** 12 players: four Office grabs of 2 (8 rings) and two Vault grabs (3 + 2 rings); everyone else in the Lobby. */
  const double = (wanted: number, rooftop: string[] = []) => {
    const busy = ["p0", "p1", "p2", "p3", "p4", "p5", ...rooftop];
    return run(
      { ...game(12), wanted },
      ...["p0", "p1", "p2", "p3"].map((p) => mv(p, "office", 1, 1)),
      mv("p4", "vault", 0, 3),
      mv("p5", "vault", 2),
      ...rooftop.map((p) => mv(p, "rooftop")),
      ...lobbyRest(12, busy),
      ROUND,
    );
  };

  it("from Wanted 0, Wanted jumps by 2 and the game goes on (to one police briefing, design §9.2)", () => {
    const s = double(0);
    expect(ofType(s.log, "roomRaided").map((e) => [e.room, e.seized, e.wanted])).toEqual([["vault", 5, 1], ["office", 8, 2]]);
    expect([s.wanted, s.phase]).toEqual([2, { kind: "awaitingMeeting", meeting: "briefing", meetingId: "meeting-1" }]);
    expect(s.taped).toEqual({ vault: 3, office: 3 });
  });

  it("from Wanted 1, two raids reach the bust line at once", () => {
    const s = double(1, ["p6"]);
    expect(s.wanted).toBe(3);
    expect(outcome(s)).toMatchObject({ reason: "bust", escapees: ["p6"], winners: ["p6"] });
  });

  it("from Wanted 2, two raids overshoot to 4: still a bust (Wanted 3 or more)", () => {
    const s = double(2);
    expect(s.wanted).toBe(4);
    expect(outcome(s)).toMatchObject({ reason: "bust", escapees: [], winners: [] });
  });
});

describe("QA: a raid seizes only the raided room's visitors' grabs — design §5.3, §7.6", () => {
  it("pockets and hand-ins elsewhere stand; the raided visitors' pocket-bound coins never reach a stash", () => {
    const s = run(game(4), mv("p0", "vault", 0, 3), mv("p1", "vault", 2), mv("p2", "office", 0, 2), mv("p3", "office", 2), ROUND);
    expect(ofType(s.log, "coinsGrabbed").map((e) => [e.player, e.duffel, e.pocket, e.seized])).toEqual([
      ["p0", 0, 0, 3],
      ["p1", 0, 0, 2],
      ["p2", 0, 2, 0],
      ["p3", 2, 0, 0],
    ]);
    expect([s.players.p0?.stash, s.players.p2?.stash, s.reached, s.kitty, s.seized]).toEqual([0, 2, 2, 2, 5]);
  });

  it("a short bank's cut is what is seized, not what was asked for (design §3.2)", () => {
    const g = game(3);
    const s = run({ ...g, bank: 4, bells: { ...g.bells, vault: 2 } }, mv("p0", "vault", 3), mv("p1", "vault", 3), mv("p2", "lobby", 1), ROUND);
    const seized = ofType(s.log, "coinsGrabbed").reduce((n, e) => n + e.seized, 0);
    expect(ofType(s.log, "roomRaided")[0]?.seized).toBe(seized);
    expect(s.bank + seized + s.kitty + Object.values(s.players).reduce((n, p) => n + p.stash, 0)).toBe(4);
  });
});

describe("QA: the tape lasts exactly 2 rounds and the bell is off — design §5.3", () => {
  /** Raid the Vault in round 2 (3 players): taped through round 4; then its police briefing (design §9.2). */
  const raidedInRound2 = () =>
    run(game(3, ["mole", "fixer"]), mv("p0", "lobby", 1), mv("p1", "lobby", 1), mv("p2", "lobby", 1), ROUND, mv("p0", "lobby", 1), mv("p1", "vault", 3), mv("p2", "vault", 2), ROUND, ...MEETING);

  it("closed in rounds 3 and 4 (after the briefing), open in round 5 with its bell at 0", () => {
    let s = raidedInRound2();
    expect(ofType(s.log, "roomRaided")).toMatchObject([{ round: 2, room: "vault", closedThrough: 4 }]);
    expect([s.round, s.taped]).toEqual([3, { vault: 4 }]);
    expect(reason(s, mv("p1", "vault", 1))).toMatch(/taped off/);
    s = run(s, ROUND);
    expect([s.round, s.taped]).toEqual([4, { vault: 4 }]);
    expect(reason(s, mv("p1", "vault", 1))).toMatch(/taped off/);
    s = run(s, ROUND);
    expect([s.round, s.taped, s.bells.vault]).toEqual([5, {}, 0]);
    for (const id of s.playerOrder) expect(viewFor(s, id).bells.vault).toBe(0);
    s = run(s, mv("p1", "vault", 1), ROUND);
    expect(ofType(s.log, "bellsRung").at(-1)?.bells.vault).toBe(1);
  });

  it("while taped off the bell is off: absent from every bellsRung / bellsCooled and every view, and nothing rings it", () => {
    let s = raidedInRound2();
    // The Mole can't ring it.
    expect(reason(s, mv("p0", "lobby", 1, 0, { ability: { kind: "ring", room: "vault" } }))).toMatch(/off/);
    const before = s;
    s = run(s, mv("p0", "lobby", 1), mv("p1", "office", 2), mv("p2", "rooftop"), ROUND);
    for (const e of [...ofType(since(before, s), "bellsRung"), ...ofType(since(before, s), "bellsCooled")]) expect(Object.hasOwn(e.bells, "vault")).toBe(false);
    for (const id of s.playerOrder) {
      const v = viewFor(s, id);
      expect(Object.hasOwn(v.bells, "vault")).toBe(false);
      expect(v.taped).toEqual({ vault: 4 });
    }
  });

  it("a Rooftop player's cooling never lands on the taped room (its bell is off)", () => {
    const g = game(3);
    // The Vault is raided this round; the Office is the only open hot bell, so both Rooftop players cool it.
    const s = run({ ...g, bells: { ...g.bells, vault: 4, office: 3 } }, mv("p0", "vault", 1), mv("p1", "rooftop"), mv("p2", "rooftop"), ROUND);
    expect(ofType(s.log, "bellsCooled")[0]?.bells).toEqual({ office: 0, lobby: 0, security: 0, rooftop: 0 });
  });

  it("the Fixer's reopen brings it back at 0 the next round, whatever it read when raided", () => {
    let s = raidedInRound2();
    expect(ofType(s.log, "bellsRung").at(-1)?.bells.vault).toBe(5);
    s = run(s, mv("p0", "lobby", 1), mv("p1", "lobby", 1, 0, { ability: { kind: "reopen", room: "vault" } }), mv("p2", "lobby", 1), ROUND);
    expect([s.taped, s.bells.vault]).toEqual([{}, 0]);
    expect([s.round, s.bells.vault]).toEqual([4, 0]);
    // Open and ringable again: the Mole's ring alone lights 1 bulb.
    s = run(s, mv("p0", "lobby", 1, 0, { ability: { kind: "ring", room: "vault" } }), mv("p1", "lobby", 1), mv("p2", "lobby", 1), ROUND);
    expect(ofType(s.log, "bellsRung").at(-1)?.bells.vault).toBe(1);
  });

  it("a room raided again after it reopens is taped again and raises Wanted again", () => {
    let s = run(game(3), mv("p0", "vault", 3), mv("p1", "vault", 2), mv("p2", "lobby", 1), ROUND, ...MEETING, ROUND, ROUND);
    expect([s.round, s.taped, s.wanted]).toEqual([4, {}, 1]);
    s = run(s, mv("p0", "vault", 3), mv("p1", "vault", 2), mv("p2", "lobby", 1), ROUND);
    expect([s.taped, s.wanted]).toEqual([{ vault: 6 }, 2]);
  });
});

describe("QA: Rooftop auto-cooling — design §5.6", () => {
  it("three Rooftop players on two tied bells spread the cooling to the hottest each time (6 bulbs → 3 off)", () => {
    const g = game(4);
    const s = run({ ...g, bells: { ...g.bells, vault: 3, office: 3 } }, mv("p0", "lobby", 1), mv("p1", "rooftop"), mv("p2", "rooftop"), mv("p3", "rooftop"), ROUND);
    const b = ofType(s.log, "bellsCooled")[0]?.bells;
    // −1 each: 2 and 2; then three coolings, each on the hottest at that moment: one goes to 0, the other to 1.
    expect([b?.vault, b?.office].sort()).toEqual([0, 1]);
  });

  it("more Rooftop players than lit bulbs stop at 0, everywhere", () => {
    const g = game(12);
    const s = run({ ...g, bells: { ...g.bells, vault: 2 } }, ...Array.from({ length: 12 }, (_, i) => mv(`p${i}`, "rooftop")), ROUND);
    expect(Object.values(ofType(s.log, "bellsCooled")[0]?.bells ?? {}).every((n) => n === 0)).toBe(true);
  });
});

describe("QA: the bust and the Rooftop escape — design §5.5, §8.3, §8.5", () => {
  /** Wanted 2 and the Vault at 4: p0's Vault grab raids it. */
  const hot = (g: GameState): GameState => ({ ...g, wanted: 2, bells: { ...g.bells, vault: 4 } });

  it("at 12 players: only the Rooftop players escape; the biggest stash among them wins, ties all win, the Fixer included", () => {
    const g = withStash(game(12, ["lookout", "fixer", "mole"]), { p0: 20, p1: 6, p2: 6, p3: 5, p4: 30 });
    const s = run(hot(g), mv("p0", "vault", 1), mv("p1", "rooftop"), mv("p2", "rooftop"), mv("p3", "rooftop"), mv("p4", "office", 0, 2), ...lobbyRest(12, ["p0", "p1", "p2", "p3", "p4"]), ROUND);
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "bust", escapees: ["p1", "p2", "p3"], winners: ["p1", "p2"] });
    // The ranking still lists every stash, the arrested included.
    expect(outcome(s).ranking).toHaveLength(12);
  });

  it("at 3 players: nobody on the Rooftop means nobody wins, however rich", () => {
    const s = run(hot(withStash(game(3), { p1: 9 })), mv("p0", "vault", 1), mv("p1", "lobby", 1), mv("p2", "office", 2), ROUND);
    expect(outcome(s)).toMatchObject({ reason: "bust", escapees: [], winners: [] });
  });

  it("an escapee with an empty stash still wins when every escapee is at 0", () => {
    const s = run(hot(withStash(game(3), { p0: 9 })), mv("p0", "vault", 1), mv("p1", "rooftop"), mv("p2", "rooftop"), ROUND);
    expect(outcome(s)).toMatchObject({ escapees: ["p1", "p2"], winners: ["p1", "p2"] });
  });

  it("skips cooling, the result window and every later round; the round's summary still goes out", () => {
    const before = hot(game(3));
    const s = run(before, mv("p0", "vault", 1), mv("p1", "rooftop"), mv("p2", "lobby", 1), ROUND);
    const tail = since(before, s).map((e) => e.type);
    expect(tail).not.toContain("bellsCooled");
    expect(tail).not.toContain("roundStarted");
    expect(tail).toContain("roundResolved");
    expect(tail.at(-1)).toBe("gameEnded");
    expect(handleCommand(s, { type: "advance", deadline: { kind: "result", round: 1 } }).ok).toBe(false);
  });

  it("coins are conserved through a bust: bank + seized + the kitty + stashes = the starting bank", () => {
    const g = game(4);
    const start = g.bank;
    let s = run(g, mv("p0", "vault", 3), mv("p1", "vault", 0, 2), mv("p2", "office", 1, 1), mv("p3", "lobby", 0, 1), ROUND, ...MEETING);
    s = run({ ...s, wanted: 2 }, mv("p0", "office", 0, 2), mv("p1", "office", 2), mv("p2", "office", 0, 2), mv("p3", "office", 2), ROUND);
    expect(outcome(s)).toMatchObject({ reason: "bust" });
    const stashes = Object.values(s.players).reduce((n, p) => n + p.stash, 0);
    expect(s.bank + s.seized + s.kitty + stashes).toBe(start);
    expect(s.seized).toBe(ofType(s.log, "roomRaided").reduce((n, e) => n + e.seized, 0));
  });

  it("a bust takes precedence over a round that also empties the bank", () => {
    const g = hot(game(3));
    const s = run({ ...g, bank: 2 }, mv("p0", "vault", 2), mv("p1", "rooftop"), mv("p2", "rooftop"), ROUND);
    expect(s.bank).toBe(0);
    expect(outcome(s)).toMatchObject({ reason: "bust" });
  });

  // design §3.3 (owner, 7 Nov) replaces the provisional Rooftop fallback: the missed move sits the round out.
  it("a missed move into a taped Lobby sits the round out, so it doesn't escape a bust", () => {
    const g = game(3);
    const s = run({ ...g, wanted: 2, taped: { lobby: 2 }, bells: { vault: 4, office: 0, security: 0, rooftop: 0 } }, mv("p0", "vault", 1), mv("p1", "office", 1), ROUND);
    expect(outcome(s)).toMatchObject({ reason: "bust", escapees: [], winners: [] });
  });
});

describe("QA: end-of-round order — design §4.2", () => {
  it("rings, then grabs and seizures, raids, cooling, a reopen, sightings, the summary", () => {
    const g = game(4, ["mole", "fixer"]);
    const s0 = { ...g, taped: { office: 2 }, bells: { vault: 3, lobby: 0, security: 0, rooftop: 0 } };
    const s = run(
      s0,
      mv("p0", "lobby", 1, 0, { ability: { kind: "ring", room: "vault" } }),
      mv("p1", "lobby", 1, 0, { ability: { kind: "reopen", room: "office" } }),
      mv("p2", "vault", 1),
      mv("p3", "rooftop"),
      ROUND,
    );
    const types = since(s0, s).map((e) => e.type);
    const at = (t: string) => types.indexOf(t as GameEvent["type"]);
    expect(at("bellsRung")).toBeGreaterThan(at("abilityResolved"));
    expect(at("coinsGrabbed")).toBeGreaterThan(at("bellsRung"));
    expect(at("roomRaided")).toBeGreaterThan(at("coinsGrabbed"));
    expect(at("bellsCooled")).toBeGreaterThan(at("roomRaided"));
    expect(at("roomReopened")).toBeGreaterThan(at("bellsCooled"));
    expect(at("roomSighting")).toBeGreaterThan(at("roomReopened"));
    expect(at("roundResolved")).toBeGreaterThan(at("roomSighting"));
    // Vault 3 + 1 grab ring + the Mole's ring = 5: raided before the Rooftop's cooling could save it.
    expect(ofType(s.log, "roomRaided")).toMatchObject([{ room: "vault", wanted: 1 }]);
    expect([s.taped, s.bells.office]).toEqual([{ vault: 3 }, 0]);
  });
});

describe("QA: crew sizes and invalid or out-of-phase commands — design §3.2, §5.3, §11.1", () => {
  it("2 players is not a game (3–12)", () => {
    expect(() => createGame(config(2))).toThrow();
  });

  it("12 players all in the Vault: one raid seizes all 36 coins", () => {
    const s = run(game(12), ...Array.from({ length: 12 }, (_, i) => mv(`p${i}`, "vault", 1, 2)), ROUND);
    expect(ofType(s.log, "roomRaided")).toMatchObject([{ room: "vault", seized: 36, wanted: 1 }]);
    expect([s.seized, s.reached, s.wanted]).toEqual([36, 0, 1]);
    expect(Object.values(s.players).every((p) => p.stash === 0)).toBe(true);
  });

  it("refuses malformed ring and reopen targets", () => {
    const mole = game(3, ["mole"]);
    const ring = (room: unknown) => mv("p0", "lobby", 1, 0, { ability: { kind: "ring", room } });
    for (const room of [undefined, 3, null, "constructor", "__proto__", "toString"]) expect(reason(mole, ring(room))).toMatch(/in play/);
    const fixer = { ...game(3, ["fixer"]), taped: { vault: 3 } };
    const reopen = (room: unknown) => mv("p0", "lobby", 1, 0, { ability: { kind: "reopen", room } });
    for (const room of [undefined, 3, "office", "constructor", "__proto__", "hasOwnProperty"]) expect(reason(fixer, reopen(room))).toMatch(/taped-off room/);
  });

  it("refuses a move or a power out of phase: in the result window and after a bust", () => {
    const g = game(3, ["mole"]);
    const r = handleCommand(run(g, mv("p0", "lobby", 1), mv("p1", "lobby", 1), mv("p2", "lobby", 1)), { type: "advance", deadline: { kind: "round", round: 1 } });
    if (!r.ok) throw new Error(r.reason);
    // design §10: the alibi window opens first, then the result window; both refuse a move and a stale round deadline.
    expect(r.state.phase.kind).toBe("alibi");
    const closed = closeAlibiWindow(r.state);
    if (!closed.ok) throw new Error(closed.reason);
    expect(closed.state.phase.kind).toBe("result");
    for (const s of [r.state, closed.state]) {
      expect(handleCommand(s, mv("p0", "lobby", 1, 0, { ability: { kind: "ring", room: "vault" } })).ok).toBe(false);
      // A stale round deadline is refused too.
      expect(handleCommand(s, { type: "advance", deadline: { kind: "round", round: 1 } }).ok).toBe(false);
    }
  });

  it("a Mole's ring that was refused is not spent", () => {
    const g = game(3, ["mole"]);
    reason({ ...g, taped: { office: 2 } }, mv("p0", "lobby", 1, 0, { ability: { kind: "ring", room: "office" } }));
    const s = run(g, mv("p0", "lobby", 1, 0, { ability: { kind: "ring", room: "vault" } }), mv("p1", "lobby", 1), mv("p2", "lobby", 1), ROUND);
    expect(ofType(s.log, "bellsRung")[0]?.bells.vault).toBe(1);
  });
});

describe("QA: determinism — design §19.1", () => {
  const script = (seed: string) => {
    const g = game(6, ["mole", "fixer"], seed);
    return run(
      { ...g, bells: { ...g.bells, vault: 2, office: 2, depositBoxes: 2 } },
      mv("p0", "lobby", 1, 0, { ability: { kind: "ring", room: "office" } }),
      mv("p1", "office", 1, 1),
      mv("p2", "rooftop"),
      mv("p3", "rooftop"),
      mv("p4", "vault", 0, 3),
      mv("p5", "depositBoxes", 2),
      ROUND,
    );
  };
  it("same seed + same commands = the same log (tie-broken cooling included); the log replays to the state", () => {
    const a = script("det-1");
    expect(script("det-1").log).toEqual(a.log);
    expect(replay(a.config, a.log)).toEqual(a);
    expect(ofType(a.log, "roomRaided").map((e) => [e.room, e.wanted])).toEqual([["vault", 1], ["office", 2]]);
  });
});

describe("QA: viewFor leaks for every new event — design §18", () => {
  /** Round 1 at 4 players: the Mole rings the Vault, p1 and p2 are raided there, p3 lies low (a briefing follows); round 2 the Fixer reopens it and a bust follows. */
  const script = (p1Split: [number, number]) => {
    const g = game(4, ["mole", "fixer"]);
    let s = run(
      { ...g, bells: { ...g.bells, vault: 1 } },
      mv("p0", "lobby", 1, 0, { ability: { kind: "ring", room: "vault" } }),
      mv("p1", "vault", ...p1Split),
      mv("p2", "vault", 0, 1),
      mv("p3", "rooftop"),
      ROUND,
      ...MEETING,
    );
    s = run(
      { ...s, wanted: 2, bells: { ...s.bells, office: 3 } },
      mv("p0", "lobby", 1),
      mv("p1", "lobby", 1, 0, { ability: { kind: "reopen", room: "vault" } }),
      mv("p2", "office", 0, 2),
      ROUND,
    );
    return s;
  };

  it("during and after the game every player sees only public events and their own", () => {
    const s = script([1, 1]);
    expect(outcome(s)).toMatchObject({ reason: "bust", escapees: [], winners: [] });
    const types = new Set(s.log.map((e) => e.type));
    for (const t of ["bellsRung", "roomRaided", "bellsCooled", "roomReopened", "coinsGrabbed", "abilityResolved", "defaultMoveAssigned", "gameEnded"]) expect(types).toContain(t);
    // Mid-game (after round 1) the ledger is public only and the case file the player's own.
    const mid = run(game(4, ["mole", "fixer"]), mv("p0", "lobby", 1, 0, { ability: { kind: "ring", room: "vault" } }), mv("p1", "vault", 1, 1), mv("p2", "vault", 0, 2), mv("p3", "rooftop"), ROUND);
    for (const id of mid.playerOrder) {
      const v = viewFor(mid, id);
      for (const e of v.ledger) expect(e.event.visibility.kind).toBe("public");
      for (const e of v.caseFile) expect(canSee(e.event.visibility, id, false)).toBe(true);
      // The public raid never names who was inside.
      for (const e of v.ledger.filter((x) => x.event.type === "roomRaided")) expect(Object.keys(e.event).sort()).toEqual(["closedThrough", "room", "round", "seized", "type", "visibility", "wanted"]);
    }
    expect(viewFor(mid, "p3").caseFile.some((e) => e.event.type === "abilityResolved")).toBe(false);
  });

  it("how a raided visitor meant to split their seized grab never shows to anyone else", () => {
    const g = game(4, ["mole"]);
    const at = (split: [number, number]) =>
      run({ ...g, bells: { ...g.bells, vault: 2 } }, mv("p0", "lobby", 1), mv("p1", "vault", ...split), mv("p2", "vault", 0, 1), mv("p3", "rooftop"), ROUND);
    const honest = at([2, 0]);
    const thief = at([0, 2]);
    for (const id of ["p0", "p2", "p3"]) expect(viewFor(thief, id)).toEqual(viewFor(honest, id));
  });

  it("the Fixer's reopen and the Mole's ring are public only as their effects, never by name", () => {
    const s = script([1, 1]);
    const v = viewFor(run(game(4, ["mole", "fixer"]), mv("p0", "lobby", 1, 0, { ability: { kind: "ring", room: "office" } }), mv("p1", "lobby", 1), mv("p2", "lobby", 1), mv("p3", "lobby", 1), ROUND), "p2");
    expect(v.ledger.some((e) => (e.event.type as string) === "abilityResolved")).toBe(false);
    expect(JSON.stringify(v.ledger)).not.toMatch(/"ring"/);
    const reopened = ofType(s.log, "roomReopened")[0];
    expect(reopened && Object.keys(reopened).sort()).toEqual(["room", "round", "type", "visibility"]);
  });
});

describe("QA: a missed move into a taped-off Lobby sits the round out — design §3.3 (owner, 7 Nov), §5.5", () => {
  /** The Lobby taped off through round 2 (its bell off); the rest dark, or as given. */
  const lobbyTaped = (g: GameState, bells: Record<string, number> = {}): GameState => ({
    ...g,
    taped: { lobby: 2 },
    bells: { ...Object.fromEntries(Object.entries(g.bells).filter(([r]) => r !== "lobby")), ...bells },
  });

  for (const n of [3, 12]) {
    it(`at ${n} players, everyone missing: nobody plays, nothing is grabbed or rung, the bells still cool; no lock-in marks`, () => {
      const before = lobbyTaped(game(n), { vault: 2 });
      const s = run(before, ROUND);
      const tail = since(before, s);
      expect(ofType(tail, "defaultMoveAssigned").map((e) => [e.player, e.move])).toEqual(before.playerOrder.map((id) => [id, null]));
      for (const t of ["coinsGrabbed", "roomSighting", "roomWatched", "roomRaided", "moveLocked"] as const) expect(ofType(tail, t)).toEqual([]);
      expect(ofType(tail, "bellsRung")[0]?.bells.vault).toBe(2);
      expect(ofType(tail, "bellsCooled")[0]?.bells.vault).toBe(1);
      expect([s.bank, s.reached, s.round]).toEqual([before.bank, 0, 2]);
      for (const p of Object.values(s.players)) expect([p.stash, p.consecutiveMissedMoves]).toEqual([0, 1]);
      // Round 2: the Lobby is still taped, so they sit out again; round 3 it reopens and the default is the Lobby again.
      const r2 = run(s, ROUND);
      expect(ofType(since(s, r2), "defaultMoveAssigned").every((e) => e.move === null)).toBe(true);
      const r3 = run(r2, ROUND);
      expect(ofType(since(r2, r3), "defaultMoveAssigned").every((e) => e.move?.room === "lobby" && e.move.duffel === 1)).toBe(true);
    });
  }

  it("at 12 players, a bust that round: the sitters-out are arrested, only the Rooftop escapes", () => {
    const g = withStash(lobbyTaped({ ...game(12), wanted: 2 }, { vault: 4 }), { p5: 50, p1: 3 });
    const s = run(g, mv("p0", "vault", 1), mv("p1", "rooftop"), mv("p2", "office", 1));
    expect(viewFor(s, "p0").lockedIn).toEqual(["p0", "p1", "p2"]);
    const after = run(s, ROUND);
    expect(ofType(since(s, after), "defaultMoveAssigned")).toHaveLength(9);
    expect(outcome(after)).toMatchObject({ reason: "bust", escapees: ["p1"], winners: ["p1"] });
  });

  it("at 3 players, a bust with everyone else sitting out: nobody escapes, nobody wins", () => {
    const s = run(lobbyTaped({ ...game(3), wanted: 2 }, { vault: 4 }), mv("p0", "vault", 1), ROUND);
    expect(outcome(s)).toMatchObject({ reason: "bust", escapees: [], winners: [] });
  });

  it("a short bank shares out only among the players who play", () => {
    const s = run({ ...lobbyTaped(game(4)), bank: 3 }, mv("p0", "vault", 3), mv("p1", "vault", 3), ROUND);
    const grabs = ofType(s.log, "coinsGrabbed");
    expect(grabs.map((e) => e.player)).toEqual(["p0", "p1"]);
    expect(grabs.reduce((n, e) => n + e.duffel + e.pocket + e.seized, 0)).toBe(3);
    expect(s.bank).toBe(0);
  });

  it("viewFor: only the sitter-out learns it; the others' views are the same as if it had sat in Security", () => {
    const g = lobbyTaped(game(4));
    const sat = run(g, mv("p0", "office", 2), mv("p1", "office", 0, 2), mv("p2", "vault", 1), ROUND);
    expect(viewFor(sat, "p3").caseFile.map((e) => e.event)).toContainEqual({ type: "defaultMoveAssigned", visibility: { kind: "private", player: "p3" }, player: "p3", round: 1, move: null });
    expect(viewFor(sat, "p3").me.move).toBeNull();
    for (const id of ["p0", "p1", "p2"]) {
      const v = viewFor(sat, id);
      expect(v.caseFile.some((e) => e.event.type === "defaultMoveAssigned")).toBe(false);
      for (const e of v.ledger) expect(e.event.visibility.kind).toBe("public");
      expect(JSON.stringify(v.caseFile)).not.toContain('"p3"');
    }
    // Nothing public tells a sit-out from a silent Security watcher (bar the lock-in mark, which is public by design),
    // when both post the same alibi in the window (design §10: one who posts none is shown in their real room).
    const alibied = (...moves: Command[]): GameState => {
      const resolved = handleCommand(run(g, ...moves), ROUND(g));
      if (!resolved.ok) throw new Error(resolved.reason);
      const posted = handleCommand(resolved.state, { type: "postAlibi", player: "p3", round: 1, room: "security" });
      if (!posted.ok) throw new Error(posted.reason);
      const closed = closeResultWindow(posted.state);
      if (!closed.ok) throw new Error(closed.reason);
      return closed.state;
    };
    const moves = [mv("p0", "office", 2), mv("p1", "office", 0, 2), mv("p2", "vault", 1)];
    const pub = (s: GameState) => viewFor(s, "p0").ledger.map((e) => e.event).filter((e) => e.type !== "moveLocked");
    expect(pub(alibied(...moves))).toEqual(pub(alibied(...moves, mv("p3", "security", 0, 0, { watch: "rooftop" }))));
  });

  it("replays deterministically, and the reveal still builds", () => {
    const play = () => run(lobbyTaped({ ...game(4), wanted: 2 }, { vault: 4 }), mv("p0", "vault", 1), mv("p1", "rooftop"), ROUND);
    const s = play();
    expect(play().log).toEqual(s.log);
    expect(outcome(s)).toMatchObject({ escapees: ["p1"] });
    for (const id of s.playerOrder) expect(viewFor(s, id).reveal).not.toBeNull();
  });
});

describe("QA #259: every coin rings once; only the Locksmith rings less — design §3.1, §5.1, §5.2", () => {
  it("12 players, one coin each in every coin room: each bell reads 1, the Lobby 0", () => {
    const rooms = ["office", "vault", "depositBoxes", "serverRoom", "managersOffice"];
    const s = run(game(12), ...rooms.map((r, i) => mv(`p${i}`, r, 1)), ...lobbyRest(12, rooms.map((_, i) => `p${i}`)), ROUND);
    expect(ofType(s.log, "bellsRung")[0]?.bells).toMatchObject({ office: 1, vault: 1, depositBoxes: 1, serverRoom: 1, managersOffice: 1 });
    expect(ofType(s.log, "bellsRung")[0]?.bells.lobby ?? 0).toBe(0);
  });

  it("a full grab rings its coins: Office-like rooms 2, the Vault 3 (no free first coin)", () => {
    const rooms = ["office", "vault", "depositBoxes", "serverRoom", "managersOffice"];
    const s = run(game(12), ...rooms.map((r, i) => mv(`p${i}`, r, r === "vault" ? 3 : 2)), ...lobbyRest(12, rooms.map((_, i) => `p${i}`)), ROUND);
    expect(ofType(s.log, "bellsRung")[0]?.bells).toMatchObject({ office: 2, vault: 3, depositBoxes: 2, serverRoom: 2, managersOffice: 2 });
    expect(s.wanted).toBe(0);
  });

  it("a Locksmith's 3-coin Vault grab on a bell at 4 lights no 5th bulb; anyone else's 1 coin does", () => {
    const g = game(3, ["locksmith"]);
    const hot = { ...g, bells: { ...g.bells, vault: 4 } };
    const smith = run(hot, mv("p0", "vault", 3), mv("p1", "lobby", 1), mv("p2", "lobby", 1), ROUND);
    expect([ofType(smith.log, "roomRaided"), smith.wanted, smith.bells.vault]).toEqual([[], 0, 3]);
    const other = run(hot, mv("p0", "lobby", 1), mv("p1", "vault", 1), mv("p2", "lobby", 1), ROUND);
    expect(ofType(other.log, "roomRaided")).toMatchObject([{ room: "vault", seized: 1, wanted: 1 }]);
  });

  it("the Office at 3 plus one 2-coin grab is the 5th bulb: raided", () => {
    const g = game(3);
    const s = run({ ...g, bells: { ...g.bells, office: 3 } }, mv("p0", "office", 2), mv("p1", "lobby", 1), mv("p2", "lobby", 1), ROUND);
    expect(ofType(s.log, "roomRaided")).toMatchObject([{ room: "office", seized: 2, wanted: 1 }]);
  });
});
