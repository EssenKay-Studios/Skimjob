// Leak tests over real scripted games: 3, 5, 9 and 12 players, every vote mode,
// with the events deck on (design §13).
// After every command, for every player:
//  - the ledger holds only public events, the case file only their own, and
//    together they are exactly what canSee() allows during the game;
//  - changing, removing or adding anything hidden from them (other players'
//    roles, stashes, moves, ballots, a hidden bell's bulbs, an unannounced
//    power cut, the seed and RNG, hidden events)
//    leaves their view identical, so nothing hidden — not even a count — leaks;
//  - after the game the reveal opens everything except others' secret-mode
//    ballots, which never leak (design §9.5).
// design §5.1, §9.5, §11, §13, §18
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import type { GameConfig, GameEvent, GameState, LoggedEvent, Move, PlayerId, PlayerState, PlayerView, VoteChoice, VoteVisibility } from "./types";
import { REVEAL, canSee, privateTo, secretTo } from "./types";
import { EVENT_DECK, BANK_JOB, PERK_IDS } from "@skimjob/content";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { viewFor } from "./view";
import { fullGrab } from "./grab.testkit";

function config(players: number, voteVisibility: VoteVisibility): GameConfig {
  return {
    seed: `scrub-${players}-${voteVisibility}`,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i % 2 === 1 })),
    job: "bank",
    // design §11.3: every role can be dealt, so Moles and Fixers come up.
    eventsEnabled: true,
    voteVisibility,
    // design §5: bells ring, raids tape rooms off (briefings) and Wanted rises, but no bust, so the script reaches every meeting.
    contentOverrides: { alarm: { bustStars: 99 } },
  };
}

const NO_COINS = new Set(["security", "rooftop"]);
const ofType = <T extends GameEvent["type"]>(s: GameState, type: T) => s.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/**
 * Every role at once, with two Moles and two Hackers (copies at 12 players,
 * design §11.3, §11.4), so the deal is forced: seat i gets DARK_ROLES[i]. The
 * role list is "possible", so the forced deal shows nothing a real one
 * wouldn't.
 */
const DARK_ROLES = ["mole", "hacker", "lookout", "auditor", "mole", "smoothTalker", "detective", "priest", "fixer", "hacker", "electrician", "locksmith"];
function darkGame(cfg: GameConfig): GameState {
  const real = setupEvents(cfg);
  const log = real.map((e, i): GameEvent => (e.type === "roleDealt" ? { ...e, role: DARK_ROLES[real.slice(0, i).filter((x) => x.type === "roleDealt").length] ?? "lookout" } : e));
  return replay(cfg, log);
}

/**
 * A full game exercising every event type a dealt game can produce: moves
 * (some changed, some missed), Security watches, the Server room, every
 * role's power (design §11.1), bells and raids, alibis,
 * proposals, briefings and regular meetings, an emergency in round 2's result
 * window, sealed and changed ballots (Smooth Talker weight), Bail choice windows,
 * shakedowns and their protection, the end check (design §6.2), and the event cards (Lockdown avoided), and every perk
 * (design §12: all seven on the black market and coins to buy them, a Tail, a Check ballot, a stamped alibi, Soft shoes,
 * a Blackout, Plant evidence, and a Bail used on the first meeting's shakedown). Returns the state after every command.
 * (The script reads the full state to pick moves, as a scheduler would; views are what's checked.)
 */
function playGame(players: number, voteVisibility: VoteVisibility, dark = false): GameState[] {
  let s = dark ? darkGame({ ...config(players, voteVisibility), roleList: "possible" }) : createGame(config(players, voteVisibility));
  const ids = s.playerOrder;
  const last = ids[ids.length - 1] as PlayerId;
  // design §12: every perk on the black market, and coins in every stash to buy them with.
  s = { ...s, shop: PERK_IDS, players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, stash: 20 }])) };
  const states = [s];
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
  const meeting = (wanted: PlayerId): void => {
    // design §9.7: a protected player can't be voted for, so the target is the first unprotected one from `wanted`.
    const from = ids.indexOf(wanted);
    const target = [...ids.slice(from), ...ids.slice(0, from)].find((id) => !s.protected.includes(id)) as PlayerId;
    ids.forEach((id, i) => {
      if (id === target || i % 3 === 2) return; // a few stay away (sealed votes still count)
      step(vote(id, i % 2 === 0 ? target : null));
      if (i === 1) step(vote(id, target)); // changes their mind
    });
    step({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
    if (s.phase.kind !== "shakedownPending") return;
    // design §9.6: a target holding Bail uses it (changing their mind once).
    if (s.players[s.phase.target]?.roleState.bail) {
      step({ type: "chooseBail", player: s.phase.target, use: false });
      step({ type: "chooseBail", player: s.phase.target, use: true });
    }
    step({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.phase.meetingId } });
  };
  let meetings = 0;
  for (let round = 1; round <= BANK_JOB.roundCap && !over(); round++) {
    const stretch = s.stretch;
    // design §12: one perk per player per round, while planning.
    const buys: Record<number, [PlayerId, object][]> = {
      // A Tail, and a Bail for the first meeting's target.
      1: [["p0", { kind: "tail", room: s.rooms[0] }], [ids[1] as PlayerId, { kind: "bail" }]],
      // A Check ballot on p1 for the next meeting (Soft shoes in Open mode, where ballots are public), and a Stamped alibi.
      2: [["p0", voteVisibility === "open" ? { kind: "softShoes" } : { kind: "ballot", target: ids[1] }], [last, { kind: "alibi" }]],
      3: [["p0", { kind: "softShoes" }], [ids[2] as PlayerId, { kind: "blackout", room: "office" }]],
      4: [[ids[2] as PlayerId, { kind: "plantEvidence", target: "p0", room: "vault" }]],
    };
    // A shakedown may have emptied a buyer's stash; every perk is still bought in some game (checked below).
    for (const [id, perk] of buys[round] ?? []) if (handleCommand(s, { type: "buyPerk", player: id, perk }).ok) step({ type: "buyPerk", player: id, perk });
    // design §11.1: the Auditor audits the Vault (latest round) once between meetings; the Detective looks into its neighbour.
    const auditor = holder("auditor");
    if (auditor && round % 3 === 2 && (s.players[auditor]?.roleState.usedThisStretch ?? 1) === 0) {
      step({ type: "useAbility", player: auditor, ability: { kind: "audit", room: "vault" } });
    }
    const detective = holder("detective");
    if (detective && round % 3 === 1 && round > 1) {
      step({ type: "useAbility", player: detective, ability: { kind: "detect", target: ids[(ids.indexOf(detective) + 1) % ids.length] } });
    }
    // design §11.1: the Priest absolves the greedy seat, then the next seat round (never the same twice in a row).
    const absolveTarget = ids[(3 + stretch) % ids.length] as PlayerId;
    ids.forEach((id, i) => {
      if (round % 2 === 1 && i === ids.length - 1 && players > 2) return; // misses the deadline
      const role = (s.players[id] as PlayerState).role;
      // One seat is in the Vault every third round (the one the Auditor audits).
      const drawn = id === ids[3 % ids.length] && round % 3 === 1 ? "vault" : (s.rooms[(i + round) % s.rooms.length] as string);
      const room = drawn === s.card?.room || Object.hasOwn(s.taped, drawn) ? "lobby" : drawn; // design §13 Lockdown, §5.3 taped off
      const canKeep = !NO_COINS.has(room);
      // That seat pockets everything it can, so its shakedown is dirty.
      const greedy = id === ids[3 % ids.length];
      const move: Record<string, unknown> = fullGrab(room, canKeep && (greedy || (i + round) % 3 === 0) ? Math.min(greedy ? 2 : 1, fullGrab(room).duffel) : 0);
      if (room === "security") move.watch = "vault";
      if (role === "lookout") move.ability = { kind: "lookout", rooms: [s.rooms[(i + round + 1) % s.rooms.length]] };
      // design §11.1: the Hacker hides the Vault's bell (or the Office's) every third round, when charged; two Hackers collide (§11.4).
      const fresh = s.players[id]?.roleState.usedThisStretch === 0;
      if (role === "hacker" && round % 3 === 1 && fresh) move.ability = { kind: "hide", room: Object.hasOwn(s.taped, "vault") ? "office" : "vault" };
      // design §11.1: the Electrician cuts the Office's power for the next round every third round, when charged.
      if (role === "electrician" && round % 3 === 2 && fresh) move.ability = { kind: "blackout", room: "office" };
      if (role === "priest" && round % 3 === 1 && fresh && absolveTarget !== id) move.ability = { kind: "absolve", target: absolveTarget };
      // design §5.2, §11.1: each Mole rings the Office once, in round 8, unless it is taped off or its ring is spent.
      if (role === "mole" && round === 8 && fresh && !Object.hasOwn(s.taped, "office")) move.ability = { kind: "ring", room: "office" };
      // design §5.3, §11.1: a Fixer reopens the first taped-off room once.
      const taped = Object.keys(s.taped)[0];
      if (role === "fixer" && taped !== undefined && s.players[id]?.roleState.usedThisGame === 0) move.ability = { kind: "reopen", room: taped };
      if (i === 0) step({ type: "submitMove", player: id, move: fullGrab("lobby") }); // later changed
      step({ type: "submitMove", player: id, move });
    });
    step({ type: "advance", deadline: { kind: "round", round } });
    ids.forEach((id, i) => {
      // design §12: in round 2 the last player posts a true alibi, stamped "verified" by its Stamped alibi.
      if (round === 2 && id === last) {
        const split = s.log.find((e) => e.type === "coinsGrabbed" && e.player === id && e.round === round);
        if (split?.type !== "coinsGrabbed") throw new Error("no split");
        step({ type: "postAlibi", player: id, room: split.room });
      } else if (i % 4 !== 3) step({ type: "postAlibi", player: id, room: s.rooms[i % s.rooms.length] });
    });
    // design §5.4: the alibi deadline closes the round's alibis before the next round's planning.
    if (!over()) step({ type: "advance", deadline: { kind: "alibis", round } });
    // design §4.2 steps 9–10: the meeting the round called, then the result window (an emergency in round 2's).
    while (!over() && (s.phase.kind === "awaitingMeeting" || s.phase.kind === "result")) {
      const p = s.phase;
      if (p.kind === "awaitingMeeting") {
        meetings++;
        if (meetings === 1 && !s.scheduledMeeting) {
          // A bot (p1) proposes, so the people's backing locks it (design §9.4, owner decision 2 Nov: bots don't count).
          step({ type: "proposeMeeting", player: "p1", slot: "sat-8pm" });
          for (const id of ids.filter((x) => x !== "p1")) if (!s.scheduledMeeting) step({ type: "acceptMeeting", player: id, proposalId: "proposal-1" });
        } else if (!s.scheduledMeeting) {
          step({ type: "scheduleMeeting", meetingId: p.meetingId, slot: `${p.meetingId}-slot` });
        }
        if (meetings === 2) step({ type: "sealVote", player: last, vote: { kind: "skip" } });
        step({ type: "advance", deadline: { kind: "openMeeting", meetingId: p.meetingId } });
        meeting(ids[meetings % ids.length] as PlayerId);
      } else if (round === 2 && !s.pendingEmergency && s.emergencies > 0 && ofType(s, "emergencyMeetingCalled").length === 0) {
        // An emergency in the result window, with a sealed vote waiting for it. design §9.3, §9.5
        step({ type: "sealVote", player: last, vote: { kind: "shakedown", target: "p0" } });
        step({ type: "callEmergency", player: "p1" });
        step({ type: "advance", deadline: { kind: "openMeeting", meetingId: "emergency-1" } });
        meeting("p0");
      } else {
        step({ type: "advance", deadline: { kind: "result", round: p.round } });
      }
    }
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
    { type: "voteCast", visibility: secretTo(other), meetingId: "meeting-1", player: other, vote: { kind: "shakedown", target: viewer }, sealed: false },
    { type: "voteSealed", visibility: secretTo(other), player: other, vote: { kind: "shakedown", target: viewer } },
    ...(gameOver
      ? []
      : ([
          { type: "rngAdvanced", visibility: REVEAL, words: [9, 9, 9, 9] },
          { type: "roleDealt", visibility: privateTo(other), player: other, role: "hacker" },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "hide", room: "vault", bulbs: 2 } },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "blackout", room: "office" } },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "absolve", target: viewer, taken: 3 } },
          { type: "abilityAlreadyDone", visibility: privateTo(other), player: other, round: 1, ability: { kind: "hide", room: "vault" } },
          { type: "sinsAbsolved", visibility: privateTo(other), player: other, round: 1, taken: 2 },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "ring", room: "office" } },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "reopen", room: "vault" } },
          { type: "perkBought", visibility: privateTo(other), player: other, round: 1, perk: { kind: "plantEvidence", target: viewer, room: "vault" }, cost: 3 },
          { type: "bailChosen", visibility: privateTo(other), player: other, meetingId: "meeting-1", use: true },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "audit", round: 1, room: "vault", duffel: 4 } },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "detect", round: 1, target: viewer, grabbed: 3 } },
          { type: "insideTip", visibility: privateTo(other), player: other, round: 2, subject: viewer, role: "mole" },
          { type: "coinsGrabbed", visibility: privateTo(other), player: other, round: 1, room: "vault", duffel: 0, pocket: 3, seized: 0 },
          { type: "coinsGrabbed", visibility: privateTo(other), player: other, round: 1, room: "vault", duffel: 0, pocket: 0, seized: 3 },
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
            role: p.role === "hacker" ? "lookout" : "hacker",
            stash: p.stash + 101,
            roleState: { usedThisStretch: 4, usedThisGame: 1, bail: !p.roleState.bail },
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
  // Who has locked in is public (owner decision, 2 Nov: `moveLocked`, design §5.1); what they picked is not.
  const moves: Record<PlayerId, Move> = {};
  for (const id of state.playerOrder) {
    if (!Object.hasOwn(state.moves, id)) continue;
    moves[id] = id === viewer ? (state.moves[id] as Move) : { room: "vault", duffel: 0, pocket: 3 };
  }
  // design §12: others' Check ballots are hidden; the ballots the viewer paid to see stay as they are.
  const seen = state.meeting?.ballotGrants[viewer] ?? [];
  const votesSeen = (votes: Readonly<Record<PlayerId, VoteChoice>>): Record<PlayerId, VoteChoice> => {
    const out = keepOwn(votes, { kind: "shakedown", target: viewer });
    for (const id of seen) {
      if (Object.hasOwn(votes, id)) out[id] = votes[id] as VoteChoice;
      else delete out[id];
    }
    return out;
  };
  const meeting = state.meeting && {
    ...state.meeting,
    votes: votesSeen(state.meeting.votes),
    ballotGrants: { ...Object.fromEntries(state.playerOrder.map((id) => [id, [viewer]])), [viewer]: seen },
  };
  // design §5.1, §11.1: a hidden bell's real bulbs are only its Hacker's; a blackout for next round is unannounced.
  const hid = (room: string) =>
    state.log.some((e) => e.type === "abilityResolved" && e.player === viewer && e.round === state.round && e.ability.kind === "hide" && e.ability.room === room);
  const bells = Object.fromEntries(Object.entries(state.bells).map(([room, n]) => [room, state.hidden.includes(room) && !hid(room) ? n + 7 : n]));
  // design §9.6, §12: Check ballots waiting for the next meeting, and another target's Bail choice, are hidden.
  const ballotChecks = [{ player: other, target: viewer }, ...state.ballotChecks.filter((c) => c.player === viewer)];
  const pending = state.pendingShakedown;
  const pendingShakedown = pending && (pending.target === viewer ? pending : { ...pending, useBail: !pending.useBail });
  return {
    ...state,
    ballotChecks,
    pendingShakedown,
    bells,
    cutsPending: ["vault", "lobby"],
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
  expect([view.me.role, view.me.stash, view.me.sealedVote]).toEqual([me.role, me.stash, me.sealedVote]);
  expect(view.players.map((p) => p.id)).toEqual(state.playerOrder.filter((id) => id !== viewer));

  if (!gameOver) {
    expect(view.reveal).toBeNull();
  } else {
    // design §13: every role, room, split and ability; §9.5: never others' secret ballots.
    const reveal = view.reveal?.log ?? [];
    expect(sameEvents(reveal, state.log.filter((e) => e.visibility.kind !== "secret" || owned(e, viewer)))).toBe(true);
    expect(reveal.filter((e) => e.event.type === "roleDealt").length).toBe(state.playerOrder.length);
  }

  // design §9.5: in Secret mode no other player's ballot ever reaches you, during or after.
  if (state.config.voteVisibility === "secret") {
    const all = [...view.ledger, ...view.caseFile, ...(view.reveal?.log ?? [])].map((e) => e.event);
    const othersBallots = all.filter((e) => (e.type === "voteCast" || e.type === "voteSealed") && e.player !== viewer);
    expect(othersBallots).toEqual([]);
    expect(all.some((e) => e.type === "meetingClosed" && e.ballots !== null)).toBe(false);
  }
}

describe("no leaks in real games — design §17.2, §13, §9.5", () => {
  // Filled by the games below, then checked: the scripts reach every role power (task 12, design §8).
  const seenTypes = new Set<string>();
  const seenAbilities = new Set<string>();
  const seenPerks = new Set<string>();
  const seenWatch = new Set<string>();
  const seenCards = new Set<string>();
  const meetingKinds = new Set<string>();
  let protectedSeen = false;
  const cases = [3, 5, 9, 12].flatMap((n) => (["hiddenThenRevealed", "open", "secret"] as const).map((mode) => [n, mode] as const));

  it.each(cases)("%i players, %s votes", (players, mode) => {
    const states = playGame(players, mode);
    const final = states[states.length - 1] as GameState;
    expect(final.phase.kind).toBe("ended");
    // The script covers these event types.
    const types = new Set(final.log.map((e) => e.type));
    for (const t of ["moveSubmitted", "defaultMoveAssigned", "roomWatched", "abilityResolved", "voteSealed", "voteCast", "shakedownResolved", "gameEnded", "meetingProposalAccepted"]) {
      expect(types, t).toContain(t);
    }
    for (const t of types) seenTypes.add(t);
    for (const e of final.log) if (e.type === "abilityResolved") seenAbilities.add(e.ability.kind);
    for (const e of final.log) if (e.type === "perkBought") seenPerks.add(e.perk.kind);
    for (const e of final.log) if (e.type === "roomWatched") seenWatch.add(e.source);
    for (const e of final.log) if (e.type === "eventFlipped") seenCards.add(e.card);
    for (const e of final.log) if (e.type === "meetingOpened") meetingKinds.add(e.kind);
    if (states.some((st) => st.protected.length > 0)) protectedSeen = true;

    for (const state of states) {
      for (const viewer of state.playerOrder) {
        const view = viewFor(state, viewer);
        checkView(state, viewer, view);
        // JSON, not toEqual: same check, much faster over ~400 states × 12 players.
        expect(JSON.stringify(viewFor(scrub(state, viewer), viewer)), `scrubbed view for ${viewer}`).toBe(JSON.stringify(view));
      }
    }
  }, 30_000);

  // design §11.3, §11.4: every role dealt, with copies, checked by the same view-diff.
  const darkTypes = new Set<string>();
  it.each(["hiddenThenRevealed", "open", "secret"] as const)("12 players, every role dealt, %s votes", (mode) => {
    const states = playGame(12, mode, true);
    const final = states[states.length - 1] as GameState;
    expect(final.phase.kind).toBe("ended");
    for (const e of final.log) darkTypes.add(e.type), seenTypes.add(e.type);
    for (const e of final.log) if (e.type === "abilityResolved") seenAbilities.add(e.ability.kind);
    for (const e of final.log) if (e.type === "perkBought") seenPerks.add(e.perk.kind);
    for (const state of states) {
      for (const viewer of state.playerOrder) {
        const view = viewFor(state, viewer);
        checkView(state, viewer, view);
        expect(JSON.stringify(viewFor(scrub(state, viewer), viewer)), `scrubbed view for ${viewer}`).toBe(JSON.stringify(view));
      }
    }
  }, 30_000);

  it("the every-role games reach the Mole's ring, the Fixer's reopen, a power cut, an absolve and two Hackers on one bell (design §11.1, §11.4)", () => {
    for (const t of ["roomReopened", "powerCut", "sinsAbsolved", "abilityAlreadyDone"]) expect(darkTypes, t).toContain(t);
    for (const k of ["ring", "reopen", "hide", "blackout", "absolve", "detect"]) expect(seenAbilities, k).toContain(k);
  });

  it("the games above reach every info, vote, role and event-card event (design §11, §13)", () => {
    for (const t of ["shakedownPending", "shakedownCancelled", "alibisClosed", "roleListShown", "shopDealt"]) expect(seenTypes, t).toContain(t);
    // design §5: bells, raids and cooling.
    for (const t of ["bellsRung", "roomRaided", "bellsCooled"]) expect(seenTypes, t).toContain(t);
    // design §7.2, §7.4: the split and the round summary.
    for (const t of ["duffelSplit", "roundResolved"]) expect(seenTypes, t).toContain(t);
    for (const t of ["eventFlipped", "insideTip", "auditReport"]) {
      expect(seenTypes, t).toContain(t);
    }
    for (const c of EVENT_DECK) expect(seenCards, c).toContain(c);
    for (const k of ["lookout", "hide", "audit", "detect", "absolve"]) expect(seenAbilities, k).toContain(k);
    // design §9.6, §12: every perk event and every perk bought.
    for (const t of ["perkSold", "perkBought", "bailChosen", "alibiVerified"]) expect(seenTypes, t).toContain(t);
    for (const k of PERK_IDS) expect(seenPerks, k).toContain(k);
    expect(seenWatch, "a Tail watch").toContain("tail");
    // design §9: every kind of meeting, the pool spent and protection given.
    expect(meetingKinds).toEqual(new Set(["regular", "briefing", "emergency"]));
    for (const t of ["emergencyMeetingCalled", "meetingScheduled"]) expect(seenTypes, t).toContain(t);
    expect(protectedSeen).toBe(true);
  });
});
