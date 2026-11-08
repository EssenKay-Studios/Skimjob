// QA (S3a.4, PR #169): adversarial tests for equal shares, the kitty, the
// share, missing and honesty, the getaway car and the whole-crew win.
// design §4.2 step 5, §5.5, §6.3, §7, §8, §18
import { isDeepStrictEqual } from "node:util";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Command, ContentOverrides, GameConfig, GameEvent, GameState, Outcome, PlayerId, VoteVisibility } from "./types";
import { canSee, privateTo } from "./types";
import { createGame, setupEvents } from "./setup";
import { handleCommand } from "./handle";
import { replay } from "./reduce";
import { viewFor } from "./view";
import { jobFor } from "./overrides";
import { honesty } from "./shares";
import { NO_RAIDS } from "./v01-numbers.testkit";

// ---------------------------------------------------------------- helpers

const ids = (n: number): PlayerId[] => Array.from({ length: n }, (_, i) => `p${i}`);

function config(players: number, contentOverrides: ContentOverrides | null = NO_RAIDS, seed = "shares-qa"): GameConfig {
  return {
    seed,
    players: ids(players).map((id, i) => ({ id, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    contentOverrides,
  };
}

/** Every seat a Lookout, so no role power moves coins. */
function game(players: number, contentOverrides: ContentOverrides | null = NO_RAIDS, seed?: string): GameState {
  const cfg = config(players, contentOverrides, seed);
  return replay(cfg, setupEvents(cfg).map((e): GameEvent => (e.type === "roleDealt" ? { ...e, role: "lookout" } : e)));
}

/** The deadline(s) that pass next outside planning (as the scheduler would send them); nobody votes. */
function deadlineFor(state: GameState): Command {
  const phase = state.phase;
  if (state.pendingEmergency) {
    return { type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency.meetingId } };
  }
  switch (phase.kind) {
    case "planning":
      return { type: "advance", deadline: { kind: "round", round: phase.round } };
    case "alibis":
      return { type: "advance", deadline: { kind: "alibis", round: phase.round } };
    case "result":
      return { type: "advance", deadline: { kind: "result", round: phase.round } };
    case "meeting":
      return { type: "advance", deadline: { kind: "closeMeeting", meetingId: phase.meetingId } };
    case "shakedownPending":
      return { type: "advance", deadline: { kind: "resolveShakedown", meetingId: phase.meetingId } };
    case "awaitingMeeting":
      return state.scheduledMeeting
        ? { type: "advance", deadline: { kind: "openMeeting", meetingId: state.scheduledMeeting.meetingId } }
        : { type: "scheduleMeeting", meetingId: phase.meetingId, slot: `qa-${phase.meetingId}` };
    default:
      throw new Error(`no deadline in ${phase.kind}`);
  }
}

function must(state: GameState, command: Command): GameState {
  const r = handleCommand(state, command);
  if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
  return r.state;
}

/** Runs past alibis and any meeting (nobody votes) to the next planning phase or the end. */
function settle(state: GameState): GameState {
  let s = state;
  for (let i = 0; s.phase.kind !== "planning" && s.phase.kind !== "ended"; i++) {
    if (i > 50) throw new Error(`stuck in ${s.phase.kind}`);
    s = must(s, deadlineFor(s));
  }
  return s;
}

type Grab = readonly [room: string, duffel?: number, pocket?: number];

/** One round: each seat's move (a missing seat goes to the Rooftop), the round deadline, then on to the next round. */
function round(state: GameState, moves: Readonly<Record<PlayerId, Grab>>): GameState {
  let s = state;
  for (const id of s.playerOrder) {
    const [room, duffel = 0, pocket = 0] = moves[id] ?? ["rooftop"];
    s = must(s, { type: "submitMove", player: id, move: { room, duffel, pocket } } as Command);
  }
  if (s.phase.kind !== "planning") throw new Error(`not planning: ${s.phase.kind}`);
  return settle(must(s, { type: "advance", deadline: { kind: "round", round: s.phase.round } }));
}

const ofType = <T extends GameEvent["type"]>(s: GameState, type: T) => s.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const stashes = (s: GameState) => s.playerOrder.map((id) => s.players[id]?.stash);
const outcome = (s: GameState): Outcome => {
  if (s.phase.kind !== "ended") throw new Error(`game not over (${s.phase.kind})`);
  return s.phase.outcome;
};
const all = (n: number, grab: Grab): Record<PlayerId, Grab> => Object.fromEntries(ids(n).map((id) => [id, grab]));

// ---------------------------------------------------------------- the split and the kitty

describe("QA: the split and the kitty with 3 and 12 players — design §7.1, §7.2, §7.3", () => {
  it("3 players: the kitty is carried through a round with no hand-ins and is never lost", () => {
    // R1: 5 in, 3 ways → cut 1, kitty 2. R2: nothing in → duffel 2 → cut 0, kitty 2. R3: 1 in → duffel 3 → cut 1, kitty 0.
    let s = round(game(3), { p0: ["vault", 3], p1: ["office", 2] });
    s = round(s, { p0: ["vault", 0, 3], p1: ["lobby", 0, 1] });
    s = round(s, { p2: ["lobby", 1] });
    expect(ofType(s, "duffelSplit").map(({ handedIn, setAside, kittyIn, cut, kitty, share }) => [handedIn, setAside, kittyIn, cut, kitty, share])).toEqual([
      [5, 0, 0, 1, 2, 1],
      [0, 0, 2, 0, 2, 1],
      [1, 0, 2, 1, 0, 2],
    ]);
    // design §7.6: stash = share received + coins pocketed.
    expect(stashes(s)).toEqual([2 + 3, 2 + 1, 2]);
    // design §7.5: kitty coins re-split in rounds 2 and 3 never count again.
    expect(s.reached).toBe(6);
  });

  it("12 players: 11 handed in all go to the kitty (cut 0), then one more coin pays everyone 1", () => {
    const eleven = Object.fromEntries(ids(11).map((id) => [id, ["lobby", 1] as Grab]));
    let s = round(game(12), eleven);
    expect(ofType(s, "duffelSplit")[0]).toMatchObject({ handedIn: 11, cut: 0, kitty: 11, share: 0 });
    expect(stashes(s)).toEqual(Array(12).fill(0));
    // A round with zero hand-ins: the kitty stays whole.
    s = round(s, all(12, ["lobby", 0, 1]));
    expect(ofType(s, "duffelSplit")[1]).toMatchObject({ handedIn: 0, kittyIn: 11, cut: 0, kitty: 11, share: 0 });
    s = round(s, { p11: ["lobby", 1] });
    expect(ofType(s, "duffelSplit")[2]).toMatchObject({ handedIn: 1, kittyIn: 11, cut: 1, kitty: 0, share: 1 });
    expect(stashes(s)).toEqual(Array(12).fill(1 + 1));
    expect([s.share, s.kitty, s.reached]).toEqual([1, 0, 12]);
    for (const id of s.playerOrder) expect([viewFor(s, id).share, viewFor(s, id).kitty]).toEqual([1, 0]);
  });

  it("12 players: the kitty is always change smaller than the crew and share × 12 + kitty = every coin handed in", () => {
    let s = game(12);
    let handed = 0;
    for (let r = 0; r < 6; r++) {
      // A different number of hand-ins each round: 1, 4, 7, 10, 13, 16 (lobby 1 each, vault 3 each).
      const n = 1 + 3 * r;
      const moves: Record<PlayerId, Grab> = {};
      let left = n;
      for (const id of ids(12)) {
        if (left >= 3) (moves[id] = ["vault", 3]), (left -= 3);
        else if (left > 0) (moves[id] = ["lobby", 1]), (left -= 1);
      }
      handed += n;
      s = round(s, moves);
      expect(s.kitty).toBeLessThan(12);
      expect(s.share * 12 + s.kitty).toBe(handed);
      expect(stashes(s)).toEqual(Array(12).fill(s.share));
    }
  });

  it("everyone pockets everything: every split is 0, missing = taken, honesty 0", () => {
    const s = round(game(3), { p0: ["vault", 0, 3], p1: ["office", 0, 2], p2: ["lobby", 0, 1] });
    expect(ofType(s, "duffelSplit")[0]).toMatchObject({ handedIn: 0, cut: 0, kitty: 0, share: 0 });
    expect(ofType(s, "roundResolved")[0]).toMatchObject({ taken: 6, missing: 6, honesty: { reached: 0, taken: 6 } });
    expect(stashes(s)).toEqual([3, 2, 1]);
  });
});

// ---------------------------------------------------------------- honesty

describe("QA: honesty counts each coin once — design §7.4, §7.5", () => {
  it("seized coins count neither as taken nor as missing, and never reach the split", () => {
    // Shipped bells (4 bulbs): two Vault grabs of 3 ring 6 → raid; the Office hand-in is safe.
    const s = round(game(3, null), { p0: ["vault", 3], p1: ["vault", 1, 2], p2: ["office", 2] });
    expect(ofType(s, "roomRaided")).toHaveLength(1);
    expect(ofType(s, "roundResolved")[0]).toMatchObject({ bank: 48 - 8, taken: 2, missing: 0, honesty: { reached: 2, taken: 2 } });
    expect(ofType(s, "duffelSplit")[0]).toMatchObject({ handedIn: 2, cut: 0, kitty: 2 });
    expect([s.seized, s.reached]).toEqual([6, 2]);
    expect(viewFor(s, "p0").honesty).toEqual({ reached: 2, taken: 2 });
    expect(stashes(s)).toEqual([0, 0, 0]);
  });

  it("set-aside coins (shakedown returns) count toward honesty once, as they reach the split; kitty coins never do (design §7.5, §9.6)", () => {
    const pocketed = round(game(3), { p0: ["vault", 0, 3], p1: ["office", 0, 2] });
    // As a shakedown would leave them: 5 of the pocketed coins set aside, and a kitty of 2.
    const s = round({ ...pocketed, setAside: 5, kitty: 2 }, { p0: ["lobby", 1] });
    expect(ofType(s, "duffelSplit").at(-1)).toMatchObject({ handedIn: 1, setAside: 5, kittyIn: 2, cut: 2, kitty: 2 });
    expect(s.reached).toBe(1 + 5);
    expect(ofType(s, "roundResolved").at(-1)).toMatchObject({ taken: 1, missing: 0, honesty: { reached: 6, taken: 6 } });
  });

  it("honesty over many rounds is Σ hand-ins ÷ Σ taken, whatever the kitty does", () => {
    let s = game(3);
    const script: Record<PlayerId, Grab>[] = [
      { p0: ["vault", 2, 1], p1: ["office", 1, 1], p2: ["lobby", 1] },
      { p0: ["vault", 3], p1: ["office", 0, 2] },
      { p1: ["vault", 1, 2], p2: ["office", 2] },
      {},
    ];
    let reached = 0;
    let taken = 0;
    for (const moves of script) {
      for (const [, d = 0, p = 0] of Object.values(moves)) (reached += d), (taken += d + p);
      s = round(s, moves);
      const last = ofType(s, "roundResolved").at(-1);
      expect(last?.honesty).toEqual({ reached, taken });
      expect(viewFor(s, "p2").honesty).toEqual({ reached, taken });
    }
    expect(honesty(viewFor(s, "p0").honesty)).toBe(10 / 16);
  });

  const ending = (moves: Record<PlayerId, Grab>, overrides: ContentOverrides) => outcome(round(game(3, { ...NO_RAIDS, ...overrides }), moves));

  it("exactly two-thirds succeeds; one coin under is sunk by theft (round cap)", () => {
    // 6 taken: 4 handed in is exactly 2/3, 3 handed in is one coin under.
    expect(ending({ p0: ["vault", 3], p1: ["vault", 1, 2] }, { roundCap: 1 })).toMatchObject({ result: "success" });
    expect(ending({ p0: ["vault", 2, 1], p1: ["vault", 1, 2] }, { roundCap: 1 })).toMatchObject({ result: "failed", reason: "theft", winners: [] });
    // 9 taken: 6 handed in is exactly 2/3, 5 one under.
    expect(ending({ p0: ["vault", 3], p1: ["vault", 3], p2: ["vault", 0, 3] }, { roundCap: 1 })).toMatchObject({ result: "success" });
    expect(ending({ p0: ["vault", 3], p1: ["vault", 2, 1], p2: ["vault", 0, 3] }, { roundCap: 1 })).toMatchObject({ result: "failed", reason: "theft" });
  });

  it("exactly two-thirds succeeds; one coin under is sunk by theft (bank empty)", () => {
    // A bank of 2 per player (6 coins) empties in one round.
    const ok = ending({ p0: ["vault", 3], p1: ["vault", 1, 2] }, { bank: { coinsPerPlayer: 2 } });
    expect(ok).toMatchObject({ result: "success", winners: ["p1"], getaway: 1 });
    const under = ending({ p0: ["vault", 2, 1], p1: ["vault", 1, 2] }, { bank: { coinsPerPlayer: 2 } });
    expect(under).toMatchObject({ result: "failed", reason: "theft", winners: [], getaway: 0 });
  });
});

// ---------------------------------------------------------------- the getaway car, the bust

describe("QA: the getaway car and what a bust loses — design §5.5, §6.3", () => {
  it("at the round cap the kitty pays for the getaway car; the state keeps it, no stash gets it", () => {
    let s = game(12, { ...NO_RAIDS, roundCap: 2 });
    s = round(s, { p0: ["vault", 3], p1: ["vault", 3], p2: ["lobby", 1] }); // 7 in: cut 0, kitty 7
    s = round(s, { p3: ["vault", 3], p4: ["office", 2] }); // 5 more + 7 = 12: cut 1, kitty 0
    expect(outcome(s)).toMatchObject({ result: "success", getaway: 0, winners: ids(12) });
    let t = game(12, { ...NO_RAIDS, roundCap: 2 });
    t = round(t, { p0: ["vault", 3], p1: ["vault", 3], p2: ["lobby", 1] });
    t = round(t, { p3: ["vault", 3], p4: ["office", 1] }); // 4 + 7 = 11: cut 0, kitty 11
    expect(outcome(t)).toMatchObject({ result: "success", getaway: 11, winners: ids(12) });
    expect(stashes(t)).toEqual(Array(12).fill(0));
    // The getaway car is in every player's end view.
    for (const id of t.playerOrder) expect(viewFor(t, id).reveal?.outcome).toMatchObject({ getaway: 11 });
  });

  it("on a bust there is no getaway: the kitty and the round's hand-ins are lost, only the Rooftop escapes", () => {
    // R1: 4 handed in, 3 ways: kitty 1, share 1, p1 pockets 1. R2: Wanted at 2, the Vault raided → bust.
    let s = round(game(3, null), { p0: ["office", 2], p1: ["office", 1, 1], p2: ["lobby", 1] });
    expect([s.share, s.kitty, stashes(s)]).toEqual([1, 1, [1, 2, 1]]);
    s = round({ ...s, wanted: 2 }, { p0: ["vault", 3], p1: ["vault", 3], p2: ["rooftop"] });
    const o = outcome(s);
    expect(o).toMatchObject({ result: "failed", reason: "bust", escapees: ["p2"], winners: ["p2"] });
    expect(o).not.toHaveProperty("getaway");
    expect(ofType(s, "duffelSplit")).toHaveLength(1);
    // The ranking still shows every stash (§5.5).
    expect(o.ranking.map((r) => [r.player, r.stash])).toEqual([
      ["p1", 2],
      ["p0", 1],
      ["p2", 1],
    ]);
  });

  it("a bust after hand-ins in a safe room: those hand-ins reach no stash and don't count toward honesty", () => {
    let s = round(game(3, null), { p0: ["office", 2] });
    s = round({ ...s, wanted: 2 }, { p0: ["vault", 3], p1: ["vault", 3], p2: ["office", 2] });
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "bust", escapees: [], winners: [] });
    expect(ofType(s, "roundResolved").at(-1)).toMatchObject({ taken: 2, missing: 0, honesty: { reached: 2, taken: 4 } });
    expect(stashes(s)).toEqual([0, 0, 0]);
    expect(s.kitty).toBe(2);
  });
});

// ---------------------------------------------------------------- winning

describe("QA: the whole-crew win — design §8.1, §8.2, §8.4, §8.5", () => {
  it("12 honest players with a leftover kitty: every stash is equal, all 12 win", () => {
    let s = game(12, { ...NO_RAIDS, roundCap: 3 });
    for (let r = 0; r < 3; r++) s = round(s, all(12, ["vault", 3]));
    expect(new Set(stashes(s)).size).toBe(1);
    expect(outcome(s)).toMatchObject({ result: "success", winners: ids(12), getaway: 0 });
  });

  it("equal stashes in a heist sunk by theft: nobody wins (no Mole or Fixer)", () => {
    const s = round(game(3, { ...NO_RAIDS, roundCap: 1 }), all(3, ["lobby", 0, 1]));
    expect(stashes(s)).toEqual([1, 1, 1]);
    expect(outcome(s)).toMatchObject({ result: "failed", reason: "theft", winners: [] });
  });

  it("two pocketers tied on top share the win; the honest player loses", () => {
    const s = round(game(3, { ...NO_RAIDS, roundCap: 1 }), { p0: ["vault", 2, 1], p1: ["vault", 2, 1], p2: ["vault", 3] });
    // 7 handed in, 3 ways: cut 2, kitty 1.
    expect(stashes(s)).toEqual([2 + 1, 2 + 1, 2]);
    expect(outcome(s)).toMatchObject({ result: "success", winners: ["p0", "p1"] });
  });
});

// ---------------------------------------------------------------- missing, never who; leaks

describe("QA: missing is a count, never who; stashes and pockets stay private — design §7.4, §7.6, §18", () => {
  it("the round summary and the split carry no player; other players' grabs and stashes never reach a view", () => {
    const s = round(game(3), { p0: ["vault", 1, 2], p1: ["office", 2], p2: ["lobby", 1] });
    const [summary] = ofType(s, "roundResolved");
    expect(Object.keys(summary ?? {}).sort()).toEqual(["bank", "honesty", "missing", "round", "taken", "type", "visibility"]);
    expect(Object.keys(ofType(s, "duffelSplit")[0] ?? {}).sort()).toEqual(["cut", "handedIn", "kitty", "kittyIn", "round", "setAside", "share", "type", "visibility"]);
    for (const viewer of s.playerOrder) {
      const view = viewFor(s, viewer);
      expect(view.reveal).toBeNull();
      for (const other of view.players) expect(Object.keys(other).sort()).toEqual(["id", "isBot", "name"]);
      const seen = [...view.ledger, ...view.caseFile].map((e) => e.event);
      // Another player's grab (and so their pocket) is never in your view.
      for (const e of seen) if (e.type === "coinsGrabbed") expect(e.player).toBe(viewer);
      expect(view.me.stash).toBe(s.players[viewer]?.stash);
      // No number in the view names another player's stash next to their id.
      const text = JSON.stringify({ ...view, me: null, caseFile: [] });
      for (const other of s.playerOrder.filter((id) => id !== viewer)) expect(text).not.toMatch(new RegExp(`"${other}"[^}]*"stash"`));
    }
  });

  it("at the reveal every stash is shown, and the reveal's last stash per player matches the state", () => {
    let s = game(3, { ...NO_RAIDS, roundCap: 3 });
    s = round(s, { p0: ["vault", 1, 2], p1: ["office", 2] });
    s = round(s, { p1: ["vault", 0, 3], p2: ["office", 2] });
    s = round(s, { p0: ["lobby", 1], p2: ["vault", 2, 1] });
    const view = viewFor(s, "p2");
    const summary = view.reveal?.summary;
    expect(summary?.seats.map((r) => [r.player, r.stash])).toEqual(expect.arrayContaining(s.playerOrder.map((id) => [id, s.players[id]?.stash])));
    const last = summary?.rounds.at(-1);
    expect(last?.split).toEqual({ cut: ofType(s, "duffelSplit").at(-1)?.cut, share: s.share });
  });
});

// ---------------------------------------------------------------- properties over random games

const STYLES = ["honest", "greedy", "mixed"] as const;
type Style = (typeof STYLES)[number];

interface RandomGame {
  readonly cfg: GameConfig;
  readonly commands: Command[];
  readonly final: GameState;
  /** Every state after an accepted command. */
  readonly states: GameState[];
}

/** A random game: random moves within room limits, random votes, every deadline in time. Roles from the deal (§11.3). */
function randomGame(players: number, seed: string, tape: readonly number[], style: Style, overrides: ContentOverrides | null, vote: VoteVisibility): RandomGame {
  const cfg: GameConfig = {
    seed,
    players: ids(players).map((id, i) => ({ id, name: `P${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: true,
    voteVisibility: vote,
    contentOverrides: overrides,
  };
  let i = 0;
  const int = (n: number) => (n <= 1 ? 0 : (tape[i++ % tape.length] ?? 0) % n);
  let s = createGame(cfg);
  const commands: Command[] = [];
  const states: GameState[] = [s];
  const send = (c: Command) => {
    const r = handleCommand(s, c);
    if (r.ok) {
      s = r.state;
      commands.push(c);
      states.push(s);
    }
    return r.ok;
  };
  for (let steps = 0; s.phase.kind !== "ended"; steps++) {
    if (steps > 3000) throw new Error("game did not end");
    const phase = s.phase;
    if (phase.kind === "planning") {
      const job = jobFor(s.config);
      for (const id of s.playerOrder) {
        const room = s.rooms[int(s.rooms.length)] as string;
        const coins = job.rooms[room]?.coins ?? 0;
        const grab = int(coins + 1);
        const pocket = style === "honest" ? (int(10) === 0 ? int(grab + 1) : 0) : style === "greedy" ? grab - int(Math.min(grab, 1) + 1) : int(grab + 1);
        const move: Record<string, unknown> = { room, duffel: grab - pocket, pocket };
        if (room === "security") move.watch = s.rooms[int(s.rooms.length)];
        send({ type: "submitMove", player: id, move } as unknown as Command);
      }
    } else if (phase.kind === "meeting") {
      // Most voters pick the same target, so shakedowns happen.
      const target = s.playerOrder[int(players)] as PlayerId;
      for (const id of s.playerOrder) {
        send({ type: "castVote", player: id, vote: int(5) === 0 ? { kind: "skip" } : { kind: "shakedown", target } } as Command);
      }
    }
    if (!send(deadlineFor(s))) throw new Error(`deadline refused in ${s.phase.kind}`);
  }
  return { cfg, commands, final: s, states };
}

/** design §7.7 */
function conservation(s: GameState): { lhs: number; rhs: number } {
  const start = jobFor(s.config).bank.coinsPerPlayer * s.playerOrder.length;
  const o = s.phase.kind === "ended" ? s.phase.outcome : null;
  // design §5.5: a bust round's unsplit hand-ins are lost in the bust (its pockets sit in the stashes, still ranked).
  const lost = o?.result === "failed" && o.reason === "bust" ? ofType(s, "coinsGrabbed").filter((e) => e.round === s.resolvedRound).reduce((n, e) => n + e.duffel, 0) : 0;
  const stash = Object.values(s.players).reduce((n, p) => n + p.stash, 0);
  return { lhs: s.bank + s.kitty + s.setAside + stash + s.seized + lost, rhs: start };
}

const gameArb = fc.record({
  players: fc.constantFrom(3, 4, 7, 12),
  seed: fc.string({ minLength: 1, maxLength: 8 }),
  tape: fc.array(fc.nat({ max: 0xffff }), { minLength: 50, maxLength: 300 }),
  style: fc.constantFrom(...STYLES),
  tuning: fc.constantFrom<ContentOverrides | null>(null, { alarm: { bustStars: 9 } }, { alarm: { bustStars: 9 }, roundCap: 4 }, { bank: { coinsPerPlayer: 5 } }),
  vote: fc.constantFrom<VoteVisibility>("hiddenThenRevealed", "open", "secret"),
});

describe("QA: properties over random games — design §7.2, §7.3, §7.5, §7.6, §7.7, §6.3", () => {
  it("§7.7 conservation holds after every command; the split arithmetic, missing and honesty agree with the grabs", () => {
    fc.assert(
      fc.property(gameArb, ({ players, seed, tape, style, tuning, vote }) => {
        const g = randomGame(players, seed, tape, style, tuning, vote);
        for (const s of g.states) {
          const { lhs, rhs } = conservation(s);
          expect(lhs).toBe(rhs);
          expect(s.kitty).toBeLessThan(players);
          for (const p of Object.values(s.players)) expect(p.stash).toBeGreaterThanOrEqual(0);
        }
        const s = g.final;
        // design §7.2: every split is exact, cut × crew + kitty = the duffel.
        for (const e of ofType(s, "duffelSplit")) expect(e.cut * players + e.kitty).toBe(e.handedIn + e.setAside + e.kittyIn);
        // design §7.5: a coin counts once, when it reaches a split: handed in, or set aside by a shakedown (§9.6).
        expect(s.reached).toBe(ofType(s, "duffelSplit").reduce((n, e) => n + e.handedIn + e.setAside, 0));
        // design §7.4: each round's taken and missing match its grabs (seized left out), never negative.
        for (const r of ofType(s, "roundResolved")) {
          const grabs = ofType(s, "coinsGrabbed").filter((e) => e.round === r.round);
          expect(r.taken).toBe(grabs.reduce((n, e) => n + e.duffel + e.pocket, 0));
          expect(r.missing).toBe(grabs.reduce((n, e) => n + e.pocket, 0));
          expect(r.missing).toBeGreaterThanOrEqual(0);
        }
        // design §7.3: the share is the sum of the cuts.
        expect(s.share).toBe(ofType(s, "duffelSplit").reduce((n, e) => n + e.cut, 0));
        // design §7.6: stash = share + pocketed − taken back.
        for (const id of s.playerOrder) {
          const pocketed = ofType(s, "coinsGrabbed").filter((e) => e.player === id).reduce((n, e) => n + e.pocket, 0);
          const back = ofType(s, "shakedownResolved").filter((e) => e.target === id).reduce((n, e) => n + e.taken, 0);
          expect(s.players[id]?.stash).toBe(s.share + pocketed - back);
        }
        // design §6.3: the getaway car takes the kitty and any unsplit duffel, except on a bust.
        const o = outcome(s);
        if (o.result === "failed" && o.reason === "bust") expect(o).not.toHaveProperty("getaway");
        else expect(o.getaway).toBe(s.kitty + s.setAside);
        // design §8.2: a success where every stash is equal is won by the whole crew.
        if (o.result === "success" && new Set(stashes(s)).size === 1) expect([...o.winners].sort()).toEqual([...s.playerOrder].sort());
      }),
      { numRuns: 60 },
    );
  }, 120_000);

  it("determinism: same seed and commands give the same log; replaying the log gives the same state", () => {
    fc.assert(
      fc.property(gameArb, ({ players, seed, tape, style, tuning, vote }) => {
        const a = randomGame(players, seed, tape, style, tuning, vote);
        let b = createGame(a.cfg);
        for (const c of a.commands) b = must(b, c);
        expect(isDeepStrictEqual(b.log, a.final.log)).toBe(true);
        expect(isDeepStrictEqual(replay(a.cfg, a.final.log), a.final)).toBe(true);
      }),
      { numRuns: 15 },
    );
  }, 120_000);

  it("viewFor never shows another player's private grab, stash or split before the reveal", () => {
    fc.assert(
      fc.property(gameArb, ({ players, seed, tape, style, tuning, vote }) => {
        const g = randomGame(players, seed, tape, style, tuning, vote);
        // A mid-game state after at least one round.
        const mid = g.states.find((s) => s.resolvedRound >= 1 && s.phase.kind !== "ended");
        if (!mid) return;
        for (const viewer of mid.playerOrder) {
          const view = viewFor(mid, viewer);
          for (const { event } of [...view.ledger, ...view.caseFile]) {
            expect(canSee(event.visibility, viewer, false)).toBe(true);
            if (event.type === "coinsGrabbed") expect(event.visibility).toEqual(privateTo(viewer));
          }
          for (const other of view.players) expect(other).not.toHaveProperty("stash");
        }
      }),
      { numRuns: 15 },
    );
  }, 120_000);
});
