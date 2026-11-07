// Leak tests over real scripted games: 3, 5, 9 and 12 players, every vote mode,
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
import type { GameConfig, GameEvent, GameState, LoggedEvent, Move, PlayerId, PlayerState, PlayerView, VoteChoice, VoteVisibility } from "./types";
import { REVEAL, canSee, privateTo, secretTo } from "./types";
import { EVENT_DECK, BANK_JOB } from "@skimjob/content";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { perkCost } from "./overrides";
import { viewFor } from "./view";
import { grantPerks } from "./perks.testkit";
import { fullGrab } from "./grab.testkit";

function config(players: number, voteVisibility: VoteVisibility): GameConfig {
  return {
    seed: `leak-${players}-${voteVisibility}`,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i % 2 === 1 })),
    job: "bank",
    rolePool: [],
    // extension.md "Host settings": every role can be dealt, so Moles and Fixers come up.
    deck: "everything",
    eventsEnabled: true,
    voteVisibility,
    // design §5: bells ring, raids tape rooms off and Wanted rises, but no bust, so the script reaches every meeting.
    contentOverrides: { alarm: { bustStars: 99 } },
  };
}

/** Token triggers these scripts reach (the Detective's and Fixer's: crew and extension tests). extension.md "Roles" */
const EARNED_IN_PLAY: readonly string[] = [
  "auditedShakenDirty",
  "blessedShakenClean",
  "loopHidPocketer",
  "watchedShakenDirty",
  "wonDirtyShakedown",
];

const NO_COINS = new Set(["security", "rooftop"]);

/**
 * Every wildcard and lone wolf at once (two Moles and two Hackers), more than a
 * real deal allows, so the deal is forced: seat i gets DARK_ROLES[i]. The
 * role list is "possible", so the forced deal shows nothing a real one
 * wouldn't. extension.md "Roles", "Tokens and the perk shop"
 */
const DARK_ROLES = ["mole", "hacker", "lookout", "auditor", "mole", "smoothTalker", "detective", "priest", "fixer", "hacker", "lookout", "rookie"];
function darkGame(cfg: GameConfig): GameState {
  const real = setupEvents(cfg);
  const log = real.map((e, i): GameEvent => (e.type === "roleDealt" ? { ...e, role: DARK_ROLES[real.slice(0, i).filter((x) => x.type === "roleDealt").length] ?? "rookie" } : e));
  return replay(cfg, log);
}

/**
 * A full game exercising every event type the default pool can produce: moves
 * (some changed, some missed), Security watches, the Server room, Lookout,
 * Hacker, Auditor, Detective, Mole (a ring) and Fixer (a reopen) powers, bells and raids, alibis,
 * proposals, an emergency meeting, sealed and changed ballots (Smooth talker
 * weight), shakedown windows, shakedowns, the end check (design §6.2), and the event cards (Lockdown avoided), and perks (design §8.3: granted by the test hook,
 * then Peek, Tail, Rig and its pick, +Vote, Ballot, a verified Alibi, Recharge and a Shield that cancels
 * the Act 1 shakedown). Returns the state after every command. (The script reads the
 * full state to pick moves, as a scheduler would; views are what's checked.)
 */
function playGame(players: number, voteVisibility: VoteVisibility, dark = false): GameState[] {
  let s = dark ? darkGame({ ...config(players, voteVisibility), roleList: "possible" }) : createGame(config(players, voteVisibility));
  const ids = s.playerOrder;
  const last = ids[ids.length - 1] as PlayerId;
  // extension.md "Tokens and the perk shop": roles earn tokens and buy from the shop in play; the test hook hands out the rest so every perk is used.
  s = grantPerks(s, "p0", "peek", "tail", "ballot", "extraVote");
  s = grantPerks(s, ids[1] as PlayerId, "shield"); // the Act 1 meeting's target
  s = grantPerks(s, last, "rig", "alibi");
  const hacker = ids.find((id) => s.players[id]?.role === "hacker");
  if (hacker) s = grantPerks(s, hacker, "recharge");
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
  const meeting = (target: PlayerId, act: number): void => {
    // design §8.3: in the round-2 emergency p0 spends a Ballot on p1 (a +Vote in Open mode), and a +Vote in Act 1's meeting
    // (one perk per round, extension.md "Tokens and the perk shop").
    if (round === 2) step({ type: "useAbility", player: "p0", ability: voteVisibility !== "open" ? { kind: "ballot", target: ids[1] } : { kind: "extraVote" } });
    if (round === 3 && voteVisibility !== "open") step({ type: "useAbility", player: "p0", ability: { kind: "extraVote" } });
    ids.forEach((id, i) => {
      if (id === target || i % 3 === 2) return; // a few stay away (sealed votes still count)
      step(vote(id, i % 2 === 0 ? target : null));
      if (i === 1) step(vote(id, target)); // changes their mind
    });
    step({ type: "advance", deadline: { kind: "closeMeeting", meetingId: s.meeting?.id } });
    if (s.phase.kind !== "shakedownPending") return;
    step({ type: "advance", deadline: { kind: "resolveShakedown", meetingId: s.phase.meetingId } });
  };
  let round = 0;
  for (round = 1; round <= BANK_JOB.roundCap && !over(); round++) {
    const act = Math.ceil(round / 3);
    // extension.md "Tokens and the perk shop": anyone with enough tokens buys the shop's first perk they can afford.
    for (const id of ids) {
      const perk = s.shop.find((p) => perkCost(s.config, p) <= (s.players[id]?.roleState.tokens ?? 0));
      if (perk) step({ type: "buyPerk", player: id, perk });
    }
    if (round === 4) step({ type: "useAbility", player: "p0", ability: { kind: "peek", target: ids[1] } });
    if (round === 1) {
      // design §8.3: Tail, and a Rig of round 2's card (its second card picked).
      step({ type: "useAbility", player: "p0", ability: { kind: "tail", room: s.rooms[0] } });
      step({ type: "useAbility", player: last, ability: { kind: "rig" } });
      step({ type: "useAbility", player: last, ability: { kind: "rigPick", card: s.rigs.find((r) => r.player === last)?.cards[1] } });
    }
    // design §8.3: the Hacker gets its Act 2 loop back (if it made one).
    if (round === 5 && hacker && s.players[hacker]?.role === "hacker" && (s.players[hacker]?.roleState.usedThisAct ?? 0) > 0) {
      step({ type: "useAbility", player: hacker, ability: { kind: "recharge" } });
    }
    // v2 §2: the Auditor audits the Vault (latest round) and the Detective checks its neighbour, once per act.
    const auditor = holder("auditor");
    if (auditor && round % 3 === 2 && (s.players[auditor]?.roleState.usedThisAct ?? 1) === 0) {
      step({ type: "useAbility", player: auditor, ability: { kind: "audit", room: "vault" } });
    }
    const detective = holder("detective");
    if (detective && round % 3 === 1 && (s.players[detective]?.roleState.usedThisAct ?? 1) === 0) {
      step({ type: "useAbility", player: detective, ability: { kind: "checkStash", target: ids[(ids.indexOf(detective) + 1) % ids.length] } });
    }
    // v2 §2: the Priest blesses the round-2 emergency's target (p0) in Act 1, and each later act's meeting target
    // (rounds 10–12 have no meeting after them, design §6.2).
    const priest = holder("priest");
    const blessed = act === 1 ? "p0" : (ids[act % ids.length] as PlayerId);
    if (priest && act <= 3 && round % 3 === 1 && priest !== blessed && (s.players[priest]?.roleState.usedThisAct ?? 1) === 0) {
      step({ type: "useAbility", player: priest, ability: { kind: "bless", target: blessed } });
    }
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
      // The Act 3 meeting's target is in the Vault in each act's first round (the one the Auditor audits).
      const drawn = id === ids[3 % ids.length] && round % 3 === 1 ? "vault" : (s.rooms[(i + round) % s.rooms.length] as string);
      const room = drawn === s.card?.room || Object.hasOwn(s.taped, drawn) ? "lobby" : drawn; // design §10 Lockdown, §5.3 taped off
      const canKeep = !NO_COINS.has(room);
      // The Act 3 meeting's target pockets everything it can, so that shakedown is dirty.
      const greedy = id === ids[3 % ids.length];
      const move: Record<string, unknown> = fullGrab(room, canKeep && (greedy || (i + round) % 3 === 0) ? Math.min(greedy ? 2 : 1, fullGrab(room).duffel) : 0);
      if (room === "security") move.watch = "vault";
      if (role === "lookout") move.ability = { kind: "lookout", rooms: [s.rooms[(i + round + 1) % s.rooms.length]] };
      // design §8: the Hacker loops the Vault once per act.
      if (role === "hacker" && round % 3 === 1) move.ability = { kind: "loopCameras", room: "vault" };
      // design §5.2, §11.1: each Mole rings the Office once, in round 8, unless it is taped off.
      if (role === "mole" && round === 8 && !Object.hasOwn(s.taped, "office")) move.ability = { kind: "ring", room: "office" };
      // design §5.3, §11.1: a Fixer reopens the first taped-off room once.
      const taped = Object.keys(s.taped)[0];
      if (role === "fixer" && taped !== undefined && s.players[id]?.roleState.usedThisGame === 0) move.ability = { kind: "reopen", room: taped };
      if (i === 0) step({ type: "submitMove", player: id, move: fullGrab("lobby") }); // later changed
      step({ type: "submitMove", player: id, move });
    });
    step({ type: "advance", deadline: { kind: "round", round } });
    ids.forEach((id, i) => {
      // design §8.3: in round 2 the last player posts a true alibi and has it stamped Verified.
      if (round === 2 && id === last) {
        const split = s.log.find((e) => e.type === "coinsGrabbed" && e.player === id && e.round === round);
        if (split?.type !== "coinsGrabbed") throw new Error("no split");
        step({ type: "postAlibi", player: id, room: split.room });
        step({ type: "useAbility", player: id, ability: { kind: "alibi" } });
      } else if (i % 4 !== 3) step({ type: "postAlibi", player: id, room: s.rooms[i % s.rooms.length] });
    });
    // design §5.4: the alibi deadline closes the round's alibis before the next round's planning.
    if (!over()) step({ type: "advance", deadline: { kind: "alibis", round } });
    if (round % 3 === 0 && !over()) {
      if (act === 1) {
        // A bot (p1) proposes, so the people's backing locks it (design §11.1, owner decision 2 Nov: bots don't count).
        step({ type: "proposeMeeting", player: "p1", slot: "sat-8pm" });
        for (const id of ids.filter((x) => x !== "p1")) if (!s.scheduledMeeting) step({ type: "acceptMeeting", player: id, proposalId: "proposal-1" });
      } else {
        step({ type: "scheduleMeeting", act, slot: `act-${act}-slot` });
      }
      if (act === 2) step({ type: "sealVote", player: last, vote: { kind: "skip" } });
      step({ type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting?.meetingId } });
      meeting(ids[act % ids.length] as PlayerId, act);
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
    { type: "voteCast", visibility: secretTo(other), meetingId: "act-1", player: other, vote: { kind: "shakedown", target: viewer }, sealed: false },
    { type: "voteSealed", visibility: secretTo(other), player: other, vote: { kind: "shakedown", target: viewer } },
    ...(gameOver
      ? []
      : ([
          { type: "rngAdvanced", visibility: REVEAL, words: [9, 9, 9, 9] },
          { type: "roleDealt", visibility: privateTo(other), player: other, role: "hacker" },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "loopCameras", room: "vault" } },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "ring", room: "office" } },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "reopen", room: "vault" } },
          { type: "tokenEarned", visibility: privateTo(other), player: other, trigger: "loopHidPocketer" },
          { type: "perkBought", visibility: privateTo(other), player: other, perk: "shield", cost: 2 },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "audit", round: 1, room: "vault", shortfall: 4 } },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "checkStash", target: viewer, threshold: 3, dirty: true } },
          { type: "insideTip", visibility: privateTo(other), player: other, round: 2, subject: viewer, role: "mole" },
          { type: "coinsGrabbed", visibility: privateTo(other), player: other, round: 1, room: "vault", duffel: 0, pocket: 3, seized: 0 },
          { type: "coinsGrabbed", visibility: privateTo(other), player: other, round: 1, room: "vault", duffel: 0, pocket: 0, seized: 3 },
          { type: "perkUsed", visibility: privateTo(other), player: other, round: 1, perk: { kind: "ballot", meetingId: "act-1", target: viewer } },
          { type: "rigPicked", visibility: privateTo(other), player: other, round: 2, card: "audit" },
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
            roleState: { usedThisAct: 4, usedThisGame: 1, tokens: p.roleState.tokens + 5, perks: ["peek", "shield", "ballot"], tail: "vault" },
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
  // design §8.3: others' +Votes and Ballot perks are hidden; the ballots the viewer paid to see stay as they are.
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
    extraVotes: [...state.playerOrder.filter((id) => id !== viewer), ...state.meeting.extraVotes.filter((id) => id === viewer)],
    ballotGrants: { ...Object.fromEntries(state.playerOrder.map((id) => [id, [viewer]])), [viewer]: seen },
  };
  // A Rig is its holder's secret. design §8.3
  const rigs = [...state.rigs.filter((r) => r.player === viewer), { player: other, round: 9, cards: ["audit", "lockdown"], pick: "lockdown" }];
  return {
    ...state,
    rigs,
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
  const seenPerks = new Set<string>();
  const earned = new Set<string>();
  const seenWatch = new Set<string>();
  const seenCards = new Set<string>();
  const cases = [3, 5, 9, 12].flatMap((n) => (["hiddenThenRevealed", "open", "secret"] as const).map((mode) => [n, mode] as const));

  it.each(cases)("%i players, %s votes", (players, mode) => {
    const states = playGame(players, mode);
    const final = states[states.length - 1] as GameState;
    expect(final.phase.kind).toBe("ended");
    // The script covers every starter-game event type.
    const types = new Set(final.log.map((e) => e.type));
    for (const t of ["moveSubmitted", "defaultMoveAssigned", "roomWatched", "abilityResolved", "voteSealed", "voteCast", "shakedownResolved", "gameEnded", "meetingProposalAccepted"]) {
      expect(types, t).toContain(t);
    }
    for (const t of types) seenTypes.add(t);
    for (const e of final.log) if (e.type === "abilityResolved") seenAbilities.add(e.ability.kind);
    for (const e of final.log) if (e.type === "perkUsed") seenPerks.add(e.perk.kind);
    for (const e of final.log) if (e.type === "tokenEarned") earned.add(e.trigger);
    for (const e of final.log) if (e.type === "roomWatched") seenWatch.add(e.source);
    for (const e of final.log) if (e.type === "eventFlipped") seenCards.add(e.card);

    for (const state of states) {
      for (const viewer of state.playerOrder) {
        const view = viewFor(state, viewer);
        checkView(state, viewer, view);
        // JSON, not toEqual: same check, much faster over ~400 states × 12 players.
        expect(JSON.stringify(viewFor(scrub(state, viewer), viewer)), `scrubbed view for ${viewer}`).toBe(JSON.stringify(view));
      }
    }
  }, 30_000);

  // extension.md "Roles": every wildcard and lone wolf dealt, checked by the same view-diff.
  const darkTypes = new Set<string>();
  it.each(["hiddenThenRevealed", "open", "secret"] as const)("12 players, every dark role dealt, %s votes", (mode) => {
    const states = playGame(12, mode, true);
    const final = states[states.length - 1] as GameState;
    expect(final.phase.kind).toBe("ended");
    for (const e of final.log) darkTypes.add(e.type), seenTypes.add(e.type);
    for (const e of final.log) if (e.type === "abilityResolved") seenAbilities.add(e.ability.kind);
    for (const e of final.log) if (e.type === "tokenEarned") earned.add(e.trigger);
    for (const e of final.log) if (e.type === "perkUsed") seenPerks.add(e.perk.kind);
    for (const state of states) {
      for (const viewer of state.playerOrder) {
        const view = viewFor(state, viewer);
        checkView(state, viewer, view);
        expect(JSON.stringify(viewFor(scrub(state, viewer), viewer)), `scrubbed view for ${viewer}`).toBe(JSON.stringify(view));
        // extension.md "Tokens and the perk shop": your tokens are exactly what your case file says you earned less what you spent.
        let tokens = 0;
        for (const { event: e } of view.caseFile) {
          if (e.type === "tokenEarned") tokens++;
          if (e.type === "perkBought") tokens -= e.cost;
        }
        expect(view.me.roleState.tokens).toBe(tokens);
      }
    }
  }, 30_000);

  it("the all-wildcard games reach the Hacker's token, the Mole's ring and the Fixer's reopen (extension.md \"Roles\", design §5.2, §5.3)", () => {
    expect(earned).toContain("loopHidPocketer");
    expect(darkTypes).toContain("roomReopened");
    for (const k of ["ring", "reopen"]) expect(seenAbilities, k).toContain(k);
  });

  it("the games above reach every info, vote, Mole and event-card event (design §8, §8.1, §10)", () => {
    for (const t of ["shakedownPending", "shakedownCancelled", "alibisClosed", "roleListShown", "shopDealt"]) expect(seenTypes, t).toContain(t);
    // design §5: bells, raids and cooling.
    for (const t of ["bellsRung", "roomRaided", "bellsCooled"]) expect(seenTypes, t).toContain(t);
    for (const t of ["eventFlipped", "insideTip", "auditReport"]) {
      expect(seenTypes, t).toContain(t);
    }
    for (const c of EVENT_DECK) expect(seenCards, c).toContain(c);
    for (const k of ["lookout", "loopCameras", "audit", "checkStash"]) expect(seenAbilities, k).toContain(k);
    // design §8.3: every perk event and every perk's effect.
    for (const t of ["tokenEarned", "perkBought", "perkUsed", "rigPicked", "alibiVerified"]) expect(seenTypes, t).toContain(t);
    for (const k of ["peek", "shield", "extraVote", "ballot", "tail", "alibi", "recharge", "rig"]) expect(seenPerks, k).toContain(k);
    expect(seenWatch, "a Tail watch").toContain("tail");
    // extension.md "Roles": tokens are earned in these games (others: crew tests).
    for (const k of EARNED_IN_PLAY) expect(earned, k).toContain(k);
    expect(seenTypes, "blessingPaid").toContain("blessingPaid");
    expect(seenAbilities, "bless").toContain("bless");
  });
});
