// QA (PR #55, M2-11): the end-of-game reveal summary against the engine's own
// truth in seeded whole bot games (design §8, §12, §15.5). Truth comes from
// folding the full log with the reducer
// (power cuts, stashes), not from the reveal's own heuristics.
import { describe, expect, it } from "vitest";
import type { PerkId } from "@skimjob/content";
import {
  applyEvent,
  createGame,
  handleCommand,
  initialState,
  leadersOf,
  roleHandler,
  viewFor,
  type Command,
  type GameConfig,
  type GameEvent,
  type GameState,
  type PlayerId,
  type RevealItem,
  type RevealSummary,
} from "@skimjob/engine";
import { PERSONALITIES, type PersonalityId } from "./personalities";
import { createBots } from "./run";
import { R6_COINS } from "./testkit";

const IDS: PersonalityId[] = ["honest", "opportunist", "greedy", "cautious", "random"];

function config(n: number, seed: string, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `q${i}`, name: `Q${i}`, isBot: true })),
    job: "bank",
    eventsEnabled: true,
    voteVisibility: "secret",
    contentOverrides: R6_COINS,
    ...extra,
  };
}

/**
 * runBotGame, step by step, checking every view before the end: no reveal and
 * no summary for any seat, including an absent seat (no agent). There are no
 * spectators: viewFor refuses a non-seat.
 */
function play(c: GameConfig, absent: readonly PlayerId[] = [], ids: readonly PersonalityId[] = IDS): GameState {
  const seats = c.players.filter((p) => !absent.includes(p.id));
  const agents = createBots(seats, (_, i) => PERSONALITIES[ids[i % ids.length] as PersonalityId], c.seed);
  let state = createGame(c);
  const viewers = c.players.map((p) => p.id);
  const noLeak = () => {
    for (const v of viewers) {
      const view = viewFor(state, v);
      expect(view.reveal, `${c.seed} ${v} round ${state.round}`).toBeNull();
      expect(JSON.stringify(view)).not.toContain('"summary"');
    }
  };
  const system = (command: Command) => {
    const r = handleCommand(state, command);
    if (!r.ok) throw new Error(`refused ${JSON.stringify(command)}: ${r.reason}`);
    state = r.state;
  };
  for (let steps = 0; state.phase.kind !== "ended"; steps++) {
    if (steps > 200) throw new Error("game not over");
    noLeak();
    for (const agent of agents) {
      for (const command of agent.act(viewFor(state, agent.player))) {
        if (state.phase.kind === "ended") break;
        const r = handleCommand(state, command);
        if (r.ok) state = r.state;
      }
    }
    if (state.phase.kind === "ended") break;
    noLeak();
    const phase = state.phase;
    if (phase.kind === "meeting") system({ type: "advance", deadline: { kind: "closeMeeting", meetingId: phase.meetingId } });
    else if (phase.kind === "shakedownPending") system({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: phase.meetingId } });
    else if (state.pendingEmergency)
      system({ type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency.meetingId } });
    else if (phase.kind === "planning") system({ type: "advance", deadline: { kind: "round", round: phase.round } });
    else if (phase.kind === "result") system({ type: "advance", deadline: { kind: "result", round: phase.round } });
    else if (phase.kind === "awaitingMeeting") {
      if (!state.scheduledMeeting) system({ type: "scheduleMeeting", meetingId: phase.meetingId, slot: `server-${phase.meetingId}` });
      system({ type: "advance", deadline: { kind: "openMeeting", meetingId: phase.meetingId } });
    }
  }
  return state;
}

type Coverage = Set<string>;

/** The Mole and the Fixer win a heist sunk by theft by their own rule. design §8.4 */
const winsSunk = (role: string): boolean => roleHandler(role).winsSunk !== undefined;

/** Checks the summary every viewer gets against the truth; adds what the game exercised to `cov`. */
function audit(state: GameState, cov: Coverage): RevealSummary {
  const c = state.config;
  if (state.phase.kind !== "ended") throw new Error("not ended");
  const outcome = state.phase.outcome;
  const viewers = state.playerOrder;
  expect(() => viewFor(state, "qa-spectator")).toThrow();
  const summaries = viewers.map((v) => {
    const r = viewFor(state, v).reveal;
    if (!r) throw new Error(`no reveal for ${v}`);
    expect(r.outcome).toEqual(outcome);
    return r.summary;
  });
  const summary = summaries[0] as RevealSummary;
  // Identical in truth for every seat (no ballots are in the summary).
  for (const s of summaries) expect(s).toEqual(summary);

  const items = summary.rounds.flatMap((r) => r.items.map((item) => ({ round: r.round, item })));
  const has = (f: (i: RevealItem) => boolean) => items.filter((x) => f(x.item));
  const eventItems = (type: GameEvent["type"]) => has((i) => i.kind === "event" && i.event.type === type).map((x) => (x.item as Extract<RevealItem, { kind: "event" }>).event);

  // --- ranking, winners, scores (design §3; extension.md "Winning and losing")
  expect(summary.seats.map((s) => s.player)).toEqual(outcome.ranking.map((r) => r.player));
  const top = leadersOf(outcome.ranking);
  expect(summary.ending.topGroup).toEqual(top);
  expect(summary.ending.winners).toEqual(outcome.winners);
  expect(summary.ending.result).toBe(outcome.result);
  if (outcome.result === "success") {
    expect(summary.ending.why).toBe("success");
    expect(summary.ending.reason).toBeNull();
    expect([...outcome.winners].sort()).toEqual([...top].sort());
    cov.add("success");
  } else {
    expect(summary.ending.reason).toBe(outcome.reason);
    cov.add(`failed:${outcome.reason}`);
    // design §5.5: on a bust, the escapees with the biggest stash among them, whatever their role.
    const escaped = outcome.reason === "bust" ? outcome.ranking.filter((r) => outcome.escapees.includes(r.player)) : [];
    const shouldWin =
      outcome.reason === "bust"
        ? escaped.filter((r) => r.stash === Math.max(...escaped.map((e) => e.stash))).map((r) => r.player)
        : top.filter((p) => winsSunk(state.players[p]?.role as string));
    expect([...outcome.winners].sort()).toEqual([...shouldWin].sort());
    expect(summary.ending.why).toBe(shouldWin.length > 0 ? "failedTopWins" : "failedNobody");
    cov.add(summary.ending.why);
  }
  if (top.length > 1) cov.add("tie");
  summary.seats.forEach((seat, i) => {
    const r = outcome.ranking[i]!;
    const p = state.players[seat.player]!;
    expect(seat.place).toBe(i + 1);
    expect(seat.stash).toBe(p.stash);
    expect(seat.stash).toBe(r.stash);
    expect(seat.role).toBe(p.role);
    expect(seat.winner).toBe(outcome.winners.includes(seat.player));
    expect(seat.topGroup).toBe(top.includes(seat.player));
    // design §8.4: the Mole's and the Fixer's own win on a heist sunk by theft.
    if (seat.winner && outcome.result === "failed" && outcome.reason === "theft") cov.add("sunkWin");
  });

  // --- fold the full log for the truth
  let s = initialState(c);
  let round = 0;
  const bought = new Map<PlayerId, PerkId[]>();
  const cuts = new Set<string>();
  const stashAt = new Map<number, Record<PlayerId, number>>();
  const snap = () => Object.fromEntries(state.playerOrder.map((p) => [p, s.players[p]!.stash]));
  for (const e of state.log) {
    switch (e.type) {
      case "roundStarted":
        if (round > 0) stashAt.set(round, snap());
        round = e.round;
        break;
      case "perkBought":
        bought.set(e.player, [...(bought.get(e.player) ?? []), e.perk.kind]);
        break;
      case "powerCut":
        cuts.add(`${e.round}:${e.room}`);
        break;
      case "roomWatched":
        // design §11.1: a feed is offline exactly when its room was announced blacked out that round.
        expect(e.offline).toBe(cuts.has(`${e.round}:${e.room}`));
        if (e.offline) cov.add("offline:powerCut");
        break;
      case "sinsAbsolved":
        cov.add("absolved");
        break;
      default:
        break;
    }
    s = applyEvent(s, e);
  }
  stashAt.set(round, snap());

  // Stash over time: each round's sheet ends at the reducer's stash when the next round starts.
  for (const r of summary.rounds) if (r.round > 0) expect(r.stashes, `stash after round ${r.round}`).toEqual(stashAt.get(r.round));
  expect(summary.rounds.filter((r) => r.round > 0).map((r) => r.round)).toEqual([...stashAt.keys()]);

  // design §12: every purchase, with its buyer (the stash over time above includes what it cost), and every Bail choice.
  for (const seat of summary.seats) {
    expect(seat.perksBought).toEqual(bought.get(seat.player) ?? []);
    if (seat.perksBought.length > 0) cov.add("perkBought");
  }
  expect(eventItems("perkBought")).toEqual(state.log.filter((e) => e.type === "perkBought"));
  expect(eventItems("bailChosen")).toEqual(state.log.filter((e) => e.type === "bailChosen"));

  // design §5.3: every raid is in the timeline, in its round.
  expect(eventItems("roomRaided")).toEqual(state.log.filter((e) => e.type === "roomRaided"));
  if (eventItems("roomRaided").length > 0) cov.add("raid");

  // design §11.1: every power cut and every power used is in the timeline, in its round.
  expect(eventItems("powerCut")).toEqual(state.log.filter((e) => e.type === "powerCut"));
  expect(eventItems("abilityResolved")).toEqual(state.log.filter((e) => e.type === "abilityResolved"));

  // Real moves: every split, with its alibi and missed flag.
  const splits = state.log.filter((e) => e.type === "coinsGrabbed");
  const moves = summary.rounds.flatMap((r) => r.moves.map((m) => ({ ...m, round: r.round })));
  expect(moves.length).toBe(splits.length);
  for (const sp of splits) {
    const m = moves.find((x) => x.round === sp.round && x.player === sp.player);
    const said = state.log.flatMap((e) => (e.type === "said" ? [e.statement] : []));
    const alibi = said.find((x) => x.kind === "alibi" && x.player === sp.player && x.round === sp.round);
    const spot = said.find((x) => x.kind === "plan" && x.round === sp.round);
    const planned = spot?.kind === "plan" ? (spot.plan.entries.find((e) => e.player === sp.player)?.room ?? null) : null;
    const missed = state.log.some((e) => e.type === "defaultMoveAssigned" && e.player === sp.player && e.round === sp.round);
    expect(m).toEqual({ player: sp.player, round: sp.round, room: sp.room, duffel: sp.duffel, pocket: sp.pocket, missed, alibi: alibi?.kind === "alibi" ? alibi.room : null, planned });
    if (missed) cov.add("missed");
  }
  return summary;
}

// Seeds picked by a sweep so that together they hit every case below.
const SEEDS: readonly (readonly [number, string])[] = [
  [5, "qa55-5-r6-0"],
  [8, "qa55-8-r6-1"],
  [12, "qa55-12-r6-0"],
];
const MUST = ["success", "failed:theft", "failedTopWins", "sunkWin", "raid", "offline:powerCut", "absolved", "perkBought"];

describe("QA #55 reveal summary vs the engine's truth — design §8, §15.5", () => {
  it("full games at 5/8/12 players: hidden before the end, identical for every viewer after, and true", () => {
    const cov: Coverage = new Set();
    for (const [n, seed] of SEEDS) audit(play(config(n, seed)), cov);
    // Content bells (no R6 pins), so raids happen (design §5.3), and the Rooftop escapees win a bust (§5.5).
    audit(play(config(8, "qa55-8-c-10", { contentOverrides: null })), cov);
    // A greedy crew on the R6 pins (bells too big to bust): sunk by theft below the honesty line, and a Mole or Fixer on top wins it (design §8.4).
    audit(play(config(5, "qa55-greedy-5-4"), [], ["greedy", "random"]), cov);
    for (const k of MUST) expect(cov, k).toContain(k);
  }, 120_000);

  it("an absent seat (default moves only) gets the same reveal and never sees it early", () => {
    const cov: Coverage = new Set();
    const state = play(config(6, "qa55-absent"), ["q2"]);
    const summary = audit(state, cov);
    expect(cov).toContain("missed");
    expect(summary.rounds.flatMap((r) => r.moves).filter((m) => m.player === "q2").every((m) => m.missed)).toBe(true);
  }, 60_000);
});
