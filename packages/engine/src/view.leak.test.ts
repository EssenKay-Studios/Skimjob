// Leak tests over real scripted games: 2, 5, 9 and 12 players, every vote mode,
// with the events deck on (design §10).
// After every command, for every player:
//  - the ledger holds only public events, the case file only their own, and
//    together they are exactly what canSee() allows during the game;
//  - changing, removing or adding anything hidden from them (other players'
//    roles, stashes, safes, moves, ballots, the seed and RNG, hidden events)
//    leaves their view identical, so nothing hidden — not even a count — leaks;
//  - after the game the reveal opens everything except others' secret-mode
//    ballots, which never leak (design §11.2).
// design §13, §17.2, §11.2, §10
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState, LoggedEvent, PlayerId, PlayerState, PlayerView, VoteVisibility } from "./types";
import { REVEAL, canSee, privateTo, secretTo } from "./types";
import { EVENT_DECK } from "@skimjob/content";
import { createGame } from "./setup";
import { handleCommand } from "./handle";
import { viewFor } from "./view";

function config(players: number, voteVisibility: VoteVisibility): GameConfig {
  return {
    seed: `leak-${players}-${voteVisibility}`,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i % 2 === 1 })),
    job: "bank",
    rolePool: [],
    // design §8.1: one Mole at 5–8 players, two (who know each other) at 9–12.
    mole: players >= 5 ? "on" : "off",
    eventsEnabled: true,
    voteVisibility,
    starterMode: false,
  };
}

const NO_LOOT = new Set(["security", "rooftop", "serverRoom"]);

/**
 * A full game exercising every event type the default pool can produce: moves
 * (some changed, some missed), Security watches, the Server room, Lookout,
 * Fence, Hacker, Blackmailer and Mole powers (tip-off, Mole allies), the Snitch's target and payout, alibis,
 * proposals, an emergency meeting, sealed and changed ballots (Smooth talker
 * weight), shakedown windows (one cancelled by the Muscle), shakedowns and
 * checkpoints, and the event cards (Lockdown avoided; Double-cross offers
 * accepted by both in even rounds, by one in odd rounds). Returns the state after every command. (The script reads the
 * full state to pick moves, as a scheduler would; views are what's checked.)
 */
function playGame(players: number, voteVisibility: VoteVisibility): GameState[] {
  let s = createGame(config(players, voteVisibility));
  const states = [s];
  const ids = s.playerOrder;
  const last = ids[ids.length - 1] as PlayerId;
  const over = (): boolean => s.phase.kind === "ended"; // a function, since `step` reassigns `s`
  const step = (command: unknown): void => {
    if (over()) return;
    const r = handleCommand(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    s = r.state;
    states.push(s);
  };
  const vote = (player: PlayerId, target: PlayerId | null) => ({
    type: "castVote",
    player,
    vote: target === null || target === player ? { kind: "skip" } : { kind: "shakedown", target },
  });
  const holder = (role: string): PlayerId | undefined => ids.find((id) => s.players[id]?.role === role);
  const meeting = (target: PlayerId, act: number): void => {
    ids.forEach((id, i) => {
      if (id === target || i % 3 === 2) return; // a few stay away (sealed votes still count)
      step(vote(id, i % 2 === 0 ? target : null));
      if (i === 1) step(vote(id, target)); // changes their mind
    });
    step({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
    if (s.phase.kind !== "shakedownPending") return;
    // design §8: in Act 2 the Muscle (if dealt) cancels the shakedown before its window ends.
    const muscle = holder("muscle");
    if (act === 2 && muscle) step({ type: "useAbility", player: muscle, ability: { kind: "cancelShakedown" } });
    step({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.phase.meetingId } });
  };
  // The Snitch's target pockets everything it can, and is the Act 3 meeting's target, so the Snitch gets paid.
  const snitchTarget = (): PlayerId | null => {
    const snitch = holder("snitch");
    return snitch ? (s.players[snitch] as PlayerState).roleState.target : null;
  };

  for (let round = 1; round <= 9 && !over(); round++) {
    const act = Math.ceil(round / 3);
    if (round === 2) {
      // An emergency mid-act, with a sealed vote waiting for it. design §11.1, §11.2
      step({ type: "sealVote", player: last, vote: { kind: "shakedown", target: "p0" } });
      step({ type: "callEmergency", player: "p1" });
      step({ type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-p1" } });
      meeting("p0", act);
    }
    ids.forEach((id, i) => {
      if (round % 2 === 1 && i === ids.length - 1 && players > 2) return; // misses the deadline
      const role = (s.players[id] as PlayerState).role;
      const drawn = s.rooms[(i + round) % s.rooms.length] as string;
      const room = drawn === s.card?.room ? "lobby" : drawn; // design §10 Lockdown
      const canKeep = role !== "insider" && !NO_LOOT.has(room);
      const greedy = id === snitchTarget();
      const move: Record<string, unknown> = { room, pocket: canKeep && (greedy || (i + round) % 3 === 0) ? (greedy ? 2 : 1) : 0 };
      if (room === "security") move.watch = "vault";
      if (role === "lookout") move.ability = { kind: "lookout", rooms: [s.rooms[(i + round + 1) % s.rooms.length]] };
      if (role === "fence" && round % 2 === 0) move.ability = { kind: "fenceSafe", amount: 1 };
      // design §8: the Hacker loops the Vault once per act; the Blackmailer guesses once per act (right in Acts 1 and 3).
      if (role === "hacker" && round % 3 === 1) move.ability = { kind: "loopCameras", room: "vault" };
      // design §8: each Mole tips off the cops once, in round 8 (late, so the script still reaches every meeting).
      if (role === "mole" && round === 8) move.ability = { kind: "tipOff" };
      if (role === "blackmailer" && round % 3 === 2) {
        const target = ids[(i + 1) % ids.length] as PlayerId;
        move.ability = { kind: "blackmail", target, role: act === 2 ? "mole" : (s.players[target] as PlayerState).role };
      }
      if (i === 0) step({ type: "submitMove", player: id, move: { room: "lobby", pocket: 0 } }); // later changed
      step({ type: "submitMove", player: id, move });
    });
    // design §10 Double-cross: both accept in even rounds (a swap), only the first in odd ones (none).
    s.card?.offer?.players.forEach((id, k) => {
      if (round % 2 === 0 || k === 0) step({ type: "answerDoubleCross", player: id, accept: true });
    });
    step({ type: "advance", deadline: { kind: "round", round } });
    ids.forEach((id, i) => {
      if (i % 4 !== 3) step({ type: "postAlibi", player: id, room: s.rooms[i % s.rooms.length] });
    });
    if (round % 3 === 0 && !over()) {
      if (act === 1) {
        step({ type: "proposeMeeting", player: "p0", slot: "sat-8pm" });
        for (const id of ids.slice(1)) if (!s.scheduledMeeting) step({ type: "acceptMeeting", player: id, proposalId: "proposal-1" });
      } else {
        step({ type: "scheduleMeeting", act, slot: `act-${act}-slot` });
      }
      if (act === 2) step({ type: "sealVote", player: last, vote: { kind: "skip" } });
      step({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId } });
      meeting((act === 3 ? snitchTarget() : null) ?? (ids[act % ids.length] as PlayerId), act);
    }
  }
  return states;
}

/**
 * design §16.1: a Duel game with events on. Both players skim in some rounds;
 * each act one or both call the other out (made in different rounds, so a
 * call is pending across a round), caught and wrong calls both happen.
 */
function playDuel(seed: string): GameState[] {
  let s = createGame({ ...config(2, "hiddenThenRevealed"), seed, duel: true });
  const states = [s];
  const step = (command: unknown): void => {
    if (s.phase.kind === "ended") return;
    const r = handleCommand(s, command);
    if (!r.ok) throw new Error(`rejected ${JSON.stringify(command)}: ${r.reason}`);
    s = r.state;
    states.push(s);
  };
  for (let round = 1; round <= 9 && s.phase.kind !== "ended"; round++) {
    if (round % 3 === 2) step({ type: "callOut", player: "p0" });
    if (round === 3 || round === 9) step({ type: "callOut", player: "p1" });
    s.playerOrder.forEach((id, i) => {
      const role = (s.players[id] as PlayerState).role;
      const room = s.card?.room === "office" ? "lobby" : "office"; // design §10 Lockdown
      const pocket = role !== "insider" && (round + i) % 4 === 0 ? 1 : 0;
      step({ type: "submitMove", player: id, move: { room, pocket } });
    });
    s.card?.offer?.players.forEach((id) => step({ type: "answerDoubleCross", player: id, accept: true }));
    step({ type: "advance", deadline: { kind: "round", round } });
    step({ type: "postAlibi", player: "p0", room: "office" });
  }
  return states;
}

const owned = (e: GameEvent, viewer: PlayerId): boolean =>
  (e.visibility.kind === "private" || e.visibility.kind === "secret") && e.visibility.player === viewer;

/**
 * The state with everything hidden from `viewer` changed: other players'
 * private fields, their moves and ballots, the seed and RNG, and the log's
 * hidden events (removed, and junk ones added). After the game only others'
 * secret ballots stay hidden, so only those are swapped out of the log.
 */
function scrub(state: GameState, viewer: PlayerId): GameState {
  const gameOver = state.phase.kind === "ended";
  const other = state.playerOrder.find((id) => id !== viewer) as PlayerId;
  const junk: GameEvent[] = [
    { type: "voteCast", visibility: secretTo(other), meetingId: "act-1", player: other, vote: { kind: "shakedown", target: viewer }, sealed: false },
    { type: "voteSealed", visibility: secretTo(other), player: other, vote: { kind: "shakedown", target: viewer } },
    ...(gameOver
      ? []
      : ([
          { type: "rngAdvanced", visibility: REVEAL, words: [9, 9, 9, 9] },
          { type: "roleDealt", visibility: privateTo(other), player: other, role: "fence" },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "fenceSafe", amount: 5 } },
          { type: "snitchTargetAssigned", visibility: privateTo(other), player: other, target: viewer },
          { type: "moleAllies", visibility: privateTo(other), player: other, allies: [viewer] },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "tipOff", heat: 10 } },
          { type: "blackmailed", visibility: privateTo(other), player: other, round: 1, stolen: 3 },
          { type: "snitchPaid", visibility: privateTo(other), player: other, meetingId: "act-1", target: viewer, amount: 10 },
          { type: "doubleCrossOffered", visibility: privateTo(other), player: other, round: 2, partner: viewer },
          { type: "doubleCrossAnswered", visibility: privateTo(other), player: other, round: 2, accept: true },
          { type: "doubleCrossResolved", visibility: privateTo(other), player: other, round: 2, partner: viewer, swap: { role: "mole", roleState: { usedThisAct: 1, usedThisGame: 0, target: null, allies: [] } } },
          { type: "raidRumourHit", visibility: privateTo(other), player: other, round: 2, lost: 3 },
          { type: "insideTip", visibility: privateTo(other), player: other, round: 2, subject: viewer, role: "mole" },
          { type: "callOutMade", visibility: privateTo(other), player: other, act: 1 },
        ] satisfies GameEvent[])),
  ];
  const log = state.log.filter((e) => canSee(e.visibility, viewer, gameOver)).flatMap((e) => [e, ...junk]);

  const players = Object.fromEntries(
    Object.entries(state.players).map(([id, p]): [string, PlayerState] => [
      id,
      id === viewer
        ? p
        : {
            ...p,
            role: p.role === "insider" ? "fence" : "insider",
            stash: p.stash + 101,
            safe: p.safe + 7,
            roleState: { usedThisAct: 4, usedThisGame: 1, target: viewer, allies: [viewer] },
            totalHandedIn: p.totalHandedIn + 33,
            consecutiveMissedMoves: 5,
            sealedVote: { kind: "shakedown", target: viewer },
          },
    ]),
  );
  // Others all get a move and a ballot: even whether they've moved or voted is hidden.
  const keepOwn = <T>(record: Readonly<Record<PlayerId, T>>, fake: T): Record<PlayerId, T> => {
    const out: Record<PlayerId, T> = {};
    for (const id of state.playerOrder) {
      if (id !== viewer) out[id] = fake;
      else if (Object.hasOwn(record, id)) out[id] = record[id] as T;
    }
    return out;
  };
  const moves = keepOwn(state.moves, { room: "vault", pocket: 6 });
  const meeting = state.meeting && { ...state.meeting, votes: keepOwn(state.meeting.votes, { kind: "shakedown", target: viewer }) };
  // Whether the Muscle has cancelled the pending shakedown is hidden until its window ends. design §8
  const pendingShakedown = state.pendingShakedown && { ...state.pendingShakedown, cancelled: !state.pendingShakedown.cancelled };
  // design §10: a Double-cross offer is hidden from everyone else, and the partner's answer from both.
  const offer = state.card?.offer;
  let card = state.card;
  if (card && offer) {
    const [a, b] = offer.players;
    const toggled = (id: PlayerId): boolean => !offer.accepted.includes(id);
    if (a === viewer || b === viewer) {
      const partner = a === viewer ? b : a;
      const accepted = [...offer.accepted.filter((id) => id === viewer), ...(toggled(partner) ? [partner] : [])];
      card = { ...card, offer: { players: offer.players, accepted } };
    } else {
      const others = state.playerOrder.filter((id) => id !== viewer);
      const pair: [PlayerId, PlayerId] = [others[others.length - 1] as PlayerId, others[0] as PlayerId];
      card = { ...card, offer: { players: pair, accepted: toggled(a) ? pair : [] } };
    }
  }
  return {
    ...state,
    card,
    pendingShakedown,
    config: { ...state.config, seed: "scrubbed" },
    rng: { words: [1, 2, 3, 4] },
    players,
    moves,
    meeting,
    log,
  };
}

/** The same events (equal, since views are copies) in the same order, numbered 0, 1, 2, … */
const sameEvents = (logged: readonly LoggedEvent[], events: readonly GameEvent[]): boolean =>
  logged.length === events.length && logged.every((e, i) => isDeepStrictEqual(e.event, events[i]) && e.seq === i);

function checkView(state: GameState, viewer: PlayerId, view: PlayerView): void {
  const gameOver = state.phase.kind === "ended";
  // design §13: ledger = public; case file = yours.
  // (One expect per check, not per event: expect() is slow over ~400 states × 12 players.)
  expect(view.ledger.every(({ event }) => event.visibility.kind === "public")).toBe(true);
  expect(view.caseFile.every(({ event }) => owned(event, viewer))).toBe(true);
  // Together exactly what canSee allows during the game, in log order, numbered without gaps.
  const merged = [...view.ledger, ...view.caseFile].sort((a, b) => a.seq - b.seq);
  expect(sameEvents(merged, state.log.filter((e) => canSee(e.visibility, viewer, false)))).toBe(true);
  // Own fields come from your own state.
  const me = state.players[viewer] as PlayerState;
  expect([view.me.role, view.me.stash, view.me.safe, view.me.sealedVote]).toEqual([me.role, me.stash, me.safe, me.sealedVote]);
  expect(view.players.map((p) => p.id)).toEqual(state.playerOrder.filter((id) => id !== viewer));

  if (!gameOver) {
    expect(view.reveal).toBeNull();
  } else {
    // design §13: every role, room, split and ability; §11.2: never others' secret ballots.
    const reveal = view.reveal?.log ?? [];
    expect(sameEvents(reveal, state.log.filter((e) => e.visibility.kind !== "secret" || owned(e, viewer)))).toBe(true);
    expect(reveal.filter((e) => e.event.type === "roleDealt").length).toBe(state.playerOrder.length);
  }

  // design §11.2: in Secret mode no other player's ballot ever reaches you, during or after.
  if (state.config.voteVisibility === "secret") {
    const all = [...view.ledger, ...view.caseFile, ...(view.reveal?.log ?? [])].map((e) => e.event);
    const othersBallots = all.filter((e) => (e.type === "voteCast" || e.type === "voteSealed") && e.player !== viewer);
    expect(othersBallots).toEqual([]);
    expect(all.some((e) => e.type === "meetingClosed" && e.ballots !== null)).toBe(false);
  }
}

describe("no leaks in real games — design §17.2, §13, §11.2", () => {
  // Filled by the games below, then checked: the scripts reach every role power (task 12, design §8).
  const seenTypes = new Set<string>();
  const seenAbilities = new Set<string>();
  const seenCards = new Set<string>();
  let swapped = false;
  const cases = [2, 5, 9, 12].flatMap((n) => (["hiddenThenRevealed", "open", "secret"] as const).map((mode) => [n, mode] as const));

  it.each(cases)("%i players, %s votes", (players, mode) => {
    const states = playGame(players, mode);
    const final = states[states.length - 1] as GameState;
    expect(final.phase.kind).toBe("ended");
    // The script covers every starter-game event type.
    const types = new Set(final.log.map((e) => e.type));
    for (const t of ["moveSubmitted", "defaultMoveAssigned", "roomWatched", "abilityResolved", "voteSealed", "voteCast", "shakedownResolved", "checkpointChecked", "meetingProposalAccepted"]) {
      // At 2 players the default pool may deal two roles with no move power (e.g. Rookie and Driver).
      if ((t === "defaultMoveAssigned" || t === "abilityResolved") && players === 2) continue;
      expect(types, t).toContain(t);
    }
    if (players >= 5) expect(types).toContain("pocketCount");
    for (const t of types) seenTypes.add(t);
    for (const e of final.log) if (e.type === "abilityResolved") seenAbilities.add(e.ability.kind);
    for (const e of final.log) if (e.type === "eventFlipped") seenCards.add(e.card);
    if (final.log.some((e) => e.type === "doubleCrossResolved" && e.swap !== null)) swapped = true;

    for (const state of states) {
      for (const viewer of state.playerOrder) {
        const view = viewFor(state, viewer);
        checkView(state, viewer, view);
        // JSON, not toEqual: same check, much faster over ~400 states × 12 players.
        expect(JSON.stringify(viewFor(scrub(state, viewer), viewer)), `scrubbed view for ${viewer}`).toBe(JSON.stringify(view));
      }
    }
  }, 30_000);

  it("the games above reach every info, vote, Mole and event-card event (design §8, §8.1, §10)", () => {
    for (const t of ["snitchTargetAssigned", "blackmailed", "shakedownPending", "shakedownCancelled", "snitchPaid", "moleAllies"]) expect(seenTypes, t).toContain(t);
    for (const t of ["eventFlipped", "doubleCrossOffered", "doubleCrossAnswered", "doubleCrossResolved", "raidRumourHit", "insideTip", "auditReport"]) {
      expect(seenTypes, t).toContain(t);
    }
    for (const c of EVENT_DECK) expect(seenCards, c).toContain(c);
    expect(swapped, "a Double-cross swap happened").toBe(true);
    for (const k of ["lookout", "fenceSafe", "loopCameras", "blackmail", "cancelShakedown", "tipOff"]) expect(seenAbilities, k).toContain(k);
  });
});

describe("no leaks in Duel games — design §16.1, §17.2, §13", () => {
  const verdicts = new Set<boolean>();
  it.each(["duel-a", "duel-b", "duel-c"])("seed %s", (seed) => {
    const states = playDuel(seed);
    const final = states[states.length - 1] as GameState;
    expect(final.phase.kind).toBe("ended");
    const resolved = final.log.filter((e) => e.type === "callOutResolved");
    expect(final.log.some((e) => e.type === "callOutMade")).toBe(true);
    expect(resolved.length).toBeGreaterThan(0);
    for (const e of resolved) if (e.type === "callOutResolved") verdicts.add(e.caught);
    for (const state of states) {
      for (const viewer of state.playerOrder) {
        const view = viewFor(state, viewer);
        checkView(state, viewer, view);
        expect(JSON.stringify(viewFor(scrub(state, viewer), viewer)), `scrubbed view for ${viewer}`).toBe(JSON.stringify(view));
      }
    }
  });

  it("the games above reach both a caught and a wrong call-out", () => {
    expect([...verdicts].sort()).toEqual([false, true]);
  });
});
