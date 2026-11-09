// QA (PR #219, S4.9): the reveal's plan-against-moves, sat-out rounds and Secret-mode ballots,
// checked against the raw game log of seeded whole bot games (design §3.3, §10, §15.4, §15.5, §18).
import { describe, expect, it } from "vitest";
import { createGame, viewFor, type GameConfig, type GameEvent, type GameState, type PlayerId, type RoomId } from "@skimjob/engine";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots, runBotGame } from "./run";

const IDS: PersonalityId[] = ["honest", "opportunist", "greedy", "cautious", "random"];

/** A Secret-mode game with real content; `absent` seats have no agent (their moves default to the Lobby, §3.3). */
function play(n: number, seed: string, absent: number, extra: Partial<GameConfig> = {}): GameState {
  const config: GameConfig = {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `q${i}`, name: `Q${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: true,
    voteVisibility: "secret",
    ...extra,
  };
  expect(createGame(config).playerOrder).toHaveLength(n);
  const seats = config.players.slice(0, n - absent);
  return runBotGame(config, createBots(seats, (_, i) => PERSONALITIES[IDS[i % IDS.length] as PersonalityId], seed), { maxSteps: 400 }).state;
}

/** Truth straight from the full log: per round, each seat's plan spot, last alibi, grab room and sat-out. */
function truth(log: readonly GameEvent[]) {
  const k = (r: number, p: PlayerId) => `${r}/${p}`;
  const plan = new Map<string, RoomId | null>();
  const plansPerRound = new Map<number, number>();
  const alibi = new Map<string, RoomId>();
  const went = new Map<string, RoomId>();
  const satOut = new Set<string>();
  for (const e of log) {
    if (e.type === "said" && e.statement.kind === "plan") {
      plansPerRound.set(e.statement.round, (plansPerRound.get(e.statement.round) ?? 0) + 1);
      for (const entry of e.statement.plan.entries) plan.set(k(e.statement.round, entry.player), entry.room);
    }
    if (e.type === "said" && e.statement.kind === "alibi") alibi.set(k(e.statement.round, e.statement.player), e.statement.room);
    if (e.type === "coinsGrabbed") went.set(k(e.round, e.player), e.room);
    if (e.type === "defaultMoveAssigned" && e.move === null) satOut.add(k(e.round, e.player));
  }
  return { k, plan, plansPerRound, alibi, went, satOut };
}

function checkAgainstLog(state: GameState): { satOut: number; changed: number; broken: number; secret: number } {
  const t = truth(state.log);
  // design §10: one plan snapshot per round, so "the plan" is never ambiguous.
  for (const [round, count] of t.plansPerRound) expect(count, `round ${round} plan snapshots`).toBe(1);
  const counts = { satOut: 0, changed: 0, broken: 0, secret: state.log.filter((e) => e.type === "voteCast" && e.visibility.kind === "secret").length };
  const summaries = state.playerOrder.map((p) => viewFor(state, p).reveal!.summary);
  const summary = summaries[0]!;
  for (const round of summary.rounds) {
    for (const m of round.moves) {
      const key = t.k(round.round, m.player);
      // design §15.5: the plan line is exactly the logged snapshot's spot (null when unplaced).
      expect(m.planned, key).toBe(t.plan.get(key) ?? null);
      expect(m.alibi, key).toBe(t.alibi.get(key) ?? null);
      expect(m.room, key).toBe(t.went.get(key));
      if (m.planned && m.planned !== m.room) counts.broken++;
      if (m.planned && m.alibi && m.planned !== m.alibi) counts.changed++;
    }
    // design §3.3: everyone who sat out is named, and none of them also has a move.
    const sat = state.playerOrder.filter((p) => t.satOut.has(t.k(round.round, p)));
    expect(round.satOut, `round ${round.round} sat out`).toEqual(sat);
    for (const p of sat) expect(round.moves.some((m) => m.player === p)).toBe(false);
    counts.satOut += sat.length;
    // Every seat is accounted for in a resolved round: a move or a sat-out line.
    if (round.moves.length > 0) expect(round.moves.length + round.satOut.length, `round ${round.round} seats`).toBe(state.playerOrder.length);
  }
  // Every sat-out in the log reaches the reveal.
  expect(counts.satOut).toBe(t.satOut.size);
  // design §18: no ballot of any kind opens; the summary is the same for every seat, so nobody's own Secret ballot shapes theirs.
  for (const s of summaries) {
    expect(JSON.stringify(s)).not.toContain("voteCast");
    expect(s).toEqual(summary);
  }
  return counts;
}

describe("reveal plan against moves, against the log (design §3.3, §10, §15.5, §18)", () => {
  it("matches the logged plan, alibi and grab for every seat in 3-, 6- and 12-seat Secret-mode games", () => {
    const total = { changed: 0, broken: 0, secret: 0 };
    for (const n of [3, 6, 12])
      for (let s = 0; s < 6; s++) {
        const c = checkAgainstLog(play(n, `qa219-plan-${n}-${s}`, n >= 6 ? 2 : 0));
        total.changed += c.changed;
        total.broken += c.broken;
        total.secret += c.secret;
      }
    // The games did exercise the lines under test.
    expect(total.changed).toBeGreaterThan(0);
    expect(total.broken).toBeGreaterThan(0);
    expect(total.secret).toBeGreaterThan(0);
  });

  it("names every seat that sat out when small bells and a loud Lobby get it taped off (design §3.3, §5.3)", () => {
    let satOut = 0;
    for (let s = 0; s < 30 && satOut === 0; s++) {
      const state = play(6, `qa219-satout-${s}`, 4, { contentOverrides: { alarm: { bulbs: 2 }, rooms: { lobby: { quietCoins: 0 } } } });
      expect(state.phase.kind).toBe("ended");
      satOut += checkAgainstLog(state).satOut;
    }
    expect(satOut).toBeGreaterThan(0);
  });

  it("is the same summary for the same seed (determinism)", () => {
    const a = viewFor(play(6, "qa219-det", 2), "q0").reveal!.summary;
    const b = viewFor(play(6, "qa219-det", 2), "q0").reveal!.summary;
    expect(a).toEqual(b);
  });
});
