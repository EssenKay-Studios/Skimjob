// QA (PR #55, M2-11): the end-of-game reveal summary against the engine's own
// truth in seeded whole bot games (design §13; extension.md "Winning and
// losing", "Tokens and the perk shop", "Police activity", "Situations",
// owner ruling 5). Truth comes from folding the full log with the reducer
// (police queue, Power cut, stashes), not from the reveal's own heuristics.
import { describe, expect, it } from "vitest";
import { ROLES, type PerkId, type RoleId } from "@skimjob/content";
import {
  applyEvent,
  createGame,
  handleCommand,
  initialState,
  isBlackout,
  leadersOf,
  perkCost,
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

const IDS: PersonalityId[] = ["honest", "opportunist", "greedy", "cautious", "random"];

function config(n: number, seed: string, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    seed,
    players: Array.from({ length: n }, (_, i) => ({ id: `q${i}`, name: `Q${i}`, isBot: true })),
    job: "bank",
    rolePool: Object.keys(ROLES) as RoleId[],
    deck: "everything",
    eventsEnabled: true,
    voteVisibility: "secret",
    ...extra,
  };
}

/**
 * runBotGame, step by step, checking every view before the end: no reveal and
 * no summary for any seat, including an absent seat (no agent). There are no
 * spectators: viewFor refuses a non-seat.
 */
function play(c: GameConfig, absent: readonly PlayerId[] = []): GameState {
  const seats = c.players.filter((p) => !absent.includes(p.id));
  const agents = createBots(seats, (_, i) => PERSONALITIES[IDS[i % IDS.length] as PersonalityId], c.seed);
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
    else if (state.pendingEmergency && (phase.kind === "planning" || phase.kind === "alibis" || phase.kind === "awaitingMeeting"))
      system({ type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency.meetingId } });
    else if (phase.kind === "planning") {
      if (state.police) system({ type: "advance", deadline: { kind: "policeMoment", moment: state.police.moment } });
      if (state.phase.kind === "planning") system({ type: "advance", deadline: { kind: "round", round: phase.round } });
    } else if (phase.kind === "alibis") system({ type: "advance", deadline: { kind: "alibis", round: phase.round } });
    else if (phase.kind === "awaitingMeeting") {
      if (!state.scheduledMeeting) system({ type: "scheduleMeeting", act: phase.act, slot: `server-act-${phase.act}` });
      system({ type: "advance", deadline: { kind: "openMeeting", meetingId: state.scheduledMeeting?.meetingId as string } });
    }
  }
  return state;
}

type Coverage = Set<string>;

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
    const shouldWin = top.filter((p) => (ROLES[state.players[p]?.role as RoleId]?.winsOn ?? []).includes(outcome.reason));
    expect([...outcome.winners].sort()).toEqual([...shouldWin].sort());
    expect(summary.ending.why).toBe(shouldWin.length > 0 ? "failedTopWins" : "failedNobody");
    cov.add(summary.ending.why);
  }
  if (top.length > 1) cov.add("tie");
  summary.seats.forEach((seat, i) => {
    const r = outcome.ranking[i]!;
    const p = state.players[seat.player]!;
    expect(seat.place).toBe(i + 1);
    expect(seat.score).toBe(r.score);
    expect(seat.stash).toBe(p.stash);
    expect(seat.stash).toBe(r.stash);
    expect(seat.role).toBe(p.role);
    expect(seat.winner).toBe(outcome.winners.includes(seat.player));
    expect(seat.topGroup).toBe(top.includes(seat.player));
    expect(seat.winsOn).toEqual(ROLES[p.role]?.winsOn ?? []);
    if (seat.winner && seat.winsOn.length > 0 && outcome.result === "failed") cov.add("starFailureWin");
  });

  // --- fold the full log for the truth
  let s = initialState(c);
  let round = 0;
  const tokensTruth = new Map<PlayerId, string[]>();
  const tokenRounds: string[] = [];
  const bought = new Map<PlayerId, PerkId[]>();
  const used = new Map<PlayerId, number>();
  const policeTruth: { cause: string; mole: PlayerId | null; replaced: boolean; round: number }[] = [];
  const offlineTruth: { round: number; watcher: PlayerId; room: string; cause: string; hackers: PlayerId[] }[] = [];
  let loops = new Map<string, PlayerId[]>();
  const stashAt = new Map<number, Record<PlayerId, number>>();
  const snap = () => Object.fromEntries(state.playerOrder.map((p) => [p, s.players[p]!.stash]));
  for (const e of state.log) {
    switch (e.type) {
      case "roundStarted":
        if (round > 0) stashAt.set(round, snap());
        round = e.round;
        loops = new Map();
        break;
      case "tokenEarned":
        tokensTruth.set(e.player, [...(tokensTruth.get(e.player) ?? []), e.trigger]);
        tokenRounds.push(`${round}:${e.player}:${e.trigger}`);
        cov.add(`token:${e.trigger}`);
        break;
      case "perkBought":
        bought.set(e.player, [...(bought.get(e.player) ?? []), e.perk]);
        break;
      case "perkUsed":
        used.set(e.player, (used.get(e.player) ?? 0) + 1);
        break;
      case "policeActivity": {
        const q = s.police?.queue[0];
        policeTruth.push({ cause: q === undefined ? "patrol" : "tipOff", mole: q ?? null, replaced: q !== undefined && s.police?.patrol === true, round });
        break;
      }
      case "abilityResolved":
        if (e.ability.kind === "loopCameras") loops.set(e.ability.room, [...(loops.get(e.ability.room) ?? []), e.player]);
        break;
      case "roomWatched":
        if (e.offline) {
          const cut = isBlackout(s);
          offlineTruth.push({ round, watcher: e.player, room: e.room, cause: cut ? "powerCut" : "hackerLoop", hackers: cut ? [] : (loops.get(e.room) ?? []) });
          if (cut && loops.size > 0) cov.add("loopAndPowerCut");
          if (!cut) expect(e.source).toBe("security");
        }
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

  // Tokens: every one, with its trigger, in the right player and round.
  for (const seat of summary.seats) expect(seat.tokens, `tokens ${seat.player}`).toEqual(tokensTruth.get(seat.player) ?? []);
  expect(has((i) => i.kind === "token").map((x) => {
    const t = x.item as Extract<RevealItem, { kind: "token" }>;
    return `${x.round}:${t.player}:${t.trigger}`;
  })).toEqual(tokenRounds);
  // Perks: every purchase and use; tokens earned = spent + left.
  for (const seat of summary.seats) {
    expect(seat.perksBought).toEqual(bought.get(seat.player) ?? []);
    expect(seat.perksUsed).toBe(used.get(seat.player) ?? 0);
    const spent = seat.perksBought.reduce((n, perk) => n + perkCost(c, perk), 0);
    expect(seat.tokens.length - spent).toBe(state.players[seat.player]!.roleState.tokens);
    if (seat.perksBought.length > 0) cov.add("perkBought");
    if (seat.perksUsed > 0) cov.add("perkUsed");
  }
  expect(eventItems("perkBought")).toEqual(state.log.filter((e) => e.type === "perkBought"));
  expect(eventItems("perkUsed")).toEqual(state.log.filter((e) => e.type === "perkUsed"));

  // Police: patrol vs tip-off from the reducer's queue, incl. a tip-off taking a patrol's moment.
  const police = has((i) => i.kind === "police").map((x) => {
    const p = x.item as Extract<RevealItem, { kind: "police" }>;
    return { cause: p.cause, mole: p.mole, round: x.round };
  });
  expect(police).toEqual(policeTruth.map(({ cause, mole, round: r }) => ({ cause, mole, round: r })));
  for (const p of policeTruth) {
    cov.add(`police:${p.cause}`);
    if (p.replaced) cov.add("tipOffReplacedPatrol");
  }

  // Camera offline: Hacker loop vs Power cut from the reducer's card.
  const offline = has((i) => i.kind === "cameraOffline").map((x) => {
    const o = x.item as Extract<RevealItem, { kind: "cameraOffline" }>;
    return { round: x.round, watcher: o.watcher, room: o.room, cause: o.cause, hackers: [...o.hackers] };
  });
  expect(offline).toEqual(offlineTruth);
  for (const o of offlineTruth) cov.add(`offline:${o.cause}`);

  // Real moves: every split, with its alibi and missed flag.
  const splits = state.log.filter((e) => e.type === "lootSplit");
  const moves = summary.rounds.flatMap((r) => r.moves.map((m) => ({ ...m, round: r.round })));
  expect(moves.length).toBe(splits.length);
  for (const sp of splits) {
    const m = moves.find((x) => x.round === sp.round && x.player === sp.player);
    const alibi = state.log.find((e) => e.type === "alibiPosted" && e.player === sp.player && e.round === sp.round);
    const missed = state.log.some((e) => e.type === "defaultMoveAssigned" && e.player === sp.player && e.round === sp.round);
    expect(m).toEqual({ player: sp.player, round: sp.round, room: sp.room, loot: sp.loot, toHaul: sp.toHaul, toStash: sp.toStash, missed, alibi: alibi?.type === "alibiPosted" ? alibi.room : null });
    if (missed) cov.add("missed");
  }
  return summary;
}

// Seeds picked by a sweep so that together they hit every case below.
const SEEDS: readonly (readonly [number, string])[] = [
  [5, "qa55-5-1"], // target missed, a ★ wins from the top
  [5, "qa55-5-3"], // a tip-off lands on a patrol's moment
  [5, "qa55-5-18"], // a Hacker loop hides a pocketer
  [5, "qa55-5-20"], // a Hacker loop in a Power cut round
  [8, "qa55-8-6"],
  [12, "qa55-12-6"],
  [12, "qa55-12-23"],
];
const MUST = [
  "success",
  "failed:target",
  "failedTopWins",
  "starFailureWin",
  "police:patrol",
  "police:tipOff",
  "tipOffReplacedPatrol",
  "offline:hackerLoop",
  "offline:powerCut",
  "loopAndPowerCut",
  "perkBought",
  "perkUsed",
  "token:tipOffLanded",
  "token:loopHidPocketer",
];

describe("QA #55 reveal summary vs the engine's truth — design §13", () => {
  it("full games at 5/8/12 players: hidden before the end, identical for every viewer after, and true", () => {
    const cov: Coverage = new Set();
    for (const [n, seed] of SEEDS) audit(play(config(n, seed)), cov);
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
