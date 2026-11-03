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
import type { GameConfig, GameEvent, GameState, LoggedEvent, Move, PlayerId, PlayerState, PlayerView, VoteChoice, VoteVisibility } from "./types";
import { REVEAL, canSee, privateTo, secretTo } from "./types";
import { EVENT_DECK } from "@skimjob/content";
import { createGame, setupEvents } from "./setup";
import { replay } from "./reduce";
import { handleCommand } from "./handle";
import { perkCost } from "./overrides";
import { viewFor } from "./view";
import { grantPerks } from "./perks.testkit";

function config(players: number, voteVisibility: VoteVisibility): GameConfig {
  return {
    seed: `leak-${players}-${voteVisibility}`,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: i % 2 === 1 })),
    job: "bank",
    rolePool: [],
    // extension.md "Host settings": every role can be dealt, so Moles (and police activity) come up.
    deck: "everything",
    eventsEnabled: true,
    voteVisibility,
    starterMode: false,
  };
}

/** Token triggers these scripts reach (the Detective's, Fixer's and Blackmailer's: crew and extension tests). extension.md "Roles" */
const EARNED_IN_PLAY: readonly string[] = [
  "allInStreak",
  "auditedShakenDirty",
  "blessedShakenClean",
  "cancelledClean",
  "checkpointMade",
  "coolingRounds",
  "forgedShakenClean",
  "loopHidPocketer",
  "targetShakenDirty",
  "watchedShakenDirty",
  "wonDirtyShakedown",
];

const NO_LOOT = new Set(["security", "rooftop", "serverRoom"]);

/**
 * Every wildcard and lone wolf at once (two Moles, the Embezzler, the Getaway
 * Driver, the Fence, the Hacker, the Blackmailer and the Forger), more than a
 * real deal allows, so the deal is forced: seat i gets DARK_ROLES[i]. The
 * role list is "possible", so the forced deal shows nothing a real one
 * wouldn't. Low token levels, so the Fence's and Getaway Driver's tokens come
 * in the script. extension.md "Roles", "Tokens and the perk shop"
 */
const DARK_ROLES = ["mole", "getawayDriver", "fence", "hacker", "lookout", "bagman", "mole", "muscle", "snitch", "blackmailer", "embezzler", "forger"];
const DARK_OVERRIDES = { roles: { fence: { tokenSafe: 2 }, getawayDriver: { tokenHeat: 30 } } };
function darkGame(cfg: GameConfig): GameState {
  const real = setupEvents(cfg).filter((e) => e.type !== "snitchTargetAssigned");
  const log = real.map((e, i): GameEvent => (e.type === "roleDealt" ? { ...e, role: DARK_ROLES[real.slice(0, i).filter((x) => x.type === "roleDealt").length] ?? "rookie" } : e));
  const at = log.findIndex((e) => e.type === "roundStarted");
  // The Snitch (seat 8) is set on the Bagman (seat 5), who then skims and faces the Act 3 meeting.
  const snitch: GameEvent = { type: "snitchTargetAssigned", visibility: privateTo("p8"), player: "p8", target: "p5" };
  return replay(cfg, [...log.slice(0, at), snitch, ...log.slice(at)]);
}

/**
 * A full game exercising every event type the default pool can produce: moves
 * (some changed, some missed), Security watches, the Server room, Lookout,
 * Fence, Hacker, Blackmailer, Auditor, Detective and Mole powers (tip-off, Mole allies), the Snitch's target and reward, alibis,
 * proposals, an emergency meeting, sealed and changed ballots (Smooth talker
 * weight), shakedown windows (one cancelled by the Muscle), shakedowns and
 * checkpoints, and the event cards (Lockdown avoided; Double-cross offers
 * accepted by both in even rounds, by one in odd rounds), and perks (design §8.3: granted by the test hook,
 * then Peek, Tail, Rig and its pick, +Vote, Ballot, a verified Alibi, Recharge and a Shield that cancels
 * the Act 1 shakedown). Returns the state after every command. (The script reads the
 * full state to pick moves, as a scheduler would; views are what's checked.)
 */
function playGame(players: number, voteVisibility: VoteVisibility, dark = false): GameState[] {
  let s = dark ? darkGame({ ...config(players, voteVisibility), roleList: "possible", contentOverrides: DARK_OVERRIDES }) : createGame(config(players, voteVisibility));
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

  let round = 0;
  for (round = 1; round <= 9 && !over(); round++) {
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
    // v2 §2: the Priest blesses the round-2 emergency's target (p0) in Act 1, and each later act's meeting target.
    const priest = holder("priest");
    const blessed = act === 1 ? "p0" : ((act === 3 ? snitchTarget() : null) ?? (ids[act % ids.length] as PlayerId));
    if (priest && round % 3 === 1 && priest !== blessed && (s.players[priest]?.roleState.usedThisAct ?? 1) === 0) {
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
      const drawn = s.rooms[(i + round) % s.rooms.length] as string;
      const room = drawn === s.card?.room ? "lobby" : drawn; // design §10 Lockdown
      const canKeep = role !== "insideMan" && !NO_LOOT.has(room);
      const greedy = id === snitchTarget() || (dark && role === "fence");
      const move: Record<string, unknown> = { room, pocket: canKeep && (greedy || (i + round) % 3 === 0) ? (greedy ? 2 : 1) : 0 };
      if (room === "security") move.watch = "vault";
      if (role === "lookout") move.ability = { kind: "lookout", rooms: [s.rooms[(i + round + 1) % s.rooms.length]] };
      if (role === "fence" && (dark || round % 2 === 0) && (s.players[id]?.roleState.usedThisAct ?? 5) < 5) move.ability = { kind: "fenceSafe", amount: 1 };
      // design §8: the Hacker loops the Vault once per act; the Blackmailer guesses once per act.
      if (role === "hacker" && round % 3 === 1) move.ability = { kind: "loopCameras", room: "vault" };
      // extension.md "Police activity": each Mole tips off the cops once, in round 8 (late, so the script still reaches every meeting).
      if (role === "mole" && round === 8) step({ type: "useAbility", player: id, ability: { kind: "tipOff" } });
      // v2 §2: in the all-dark game the Getaway Driver drives Heat up from the Rooftop.
      if (dark && role === "getawayDriver" && s.card?.room !== "rooftop") {
        Object.assign(move, { room: "rooftop", pocket: 0 });
        delete move.watch;
      }
      // v2 §2 (R3b): the Forger plants p0 on the Vault's feeds early in each act; the Embezzler takes in each act's last round.
      if (role === "forger" && round % 3 === 1) move.ability = { kind: "forge", target: ids[0], room: "vault" };
      if (role === "embezzler" && round % 3 === 0) move.ability = { kind: "embezzle" };
      if (role === "blackmailer" && round % 3 === 2) {
        const target = ids[(i + 1) % ids.length] as PlayerId;
        // Right in Act 1 only (in the all-dark game a stolen Act 3 vote would block the Snitch's payout).
        move.ability = { kind: "blackmail", target, role: act === 1 ? (s.players[target] as PlayerState).role : "mole" };
      }
      if (i === 0) step({ type: "submitMove", player: id, move: { room: "lobby", pocket: 0 } }); // later changed
      step({ type: "submitMove", player: id, move });
    });
    // design §10 Double-cross: both accept in even rounds (a swap), only the first in odd ones (none).
    s.card?.offer?.players.forEach((id, k) => {
      if (round % 2 === 0 || k === 0) step({ type: "answerDoubleCross", player: id, accept: true });
    });
    step({ type: "advance", deadline: { kind: "round", round } });
    // extension.md "Police activity": one hidden police moment per round, as the simulator takes them.
    if (s.police) step({ type: "advance", deadline: { kind: "policeMoment", moment: s.police.moment } });
    ids.forEach((id, i) => {
      // design §8.3: in round 2 the last player posts a true alibi and has it stamped Verified.
      if (round === 2 && id === last) {
        const split = s.log.find((e) => e.type === "lootSplit" && e.player === id && e.round === round);
        if (split?.type !== "lootSplit") throw new Error("no split");
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
      const pocket = role !== "insideMan" && (round + i) % 4 === 0 ? 1 : 0;
      step({ type: "submitMove", player: id, move: { room, pocket } });
    });
    s.card?.offer?.players.forEach((id) => step({ type: "answerDoubleCross", player: id, accept: true }));
    step({ type: "advance", deadline: { kind: "round", round } });
    step({ type: "postAlibi", player: "p0", room: "office" });
    step({ type: "advance", deadline: { kind: "alibis", round } }); // design §5.4
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
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "tipOff" } },
          { type: "tipOffLanded", visibility: privateTo(other), player: other, round: 1 },
          { type: "policeScheduled", visibility: REVEAL, moment: 3, gapPermille: 700, patrol: true },
          { type: "tokenEarned", visibility: privateTo(other), player: other, trigger: "tipOffLanded" },
          { type: "perkBought", visibility: privateTo(other), player: other, perk: "shield", cost: 2 },
          { type: "voteCompromised", visibility: privateTo(other), player: other, round: 1 },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "embezzle", amount: 4 } },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "forge", target: viewer, room: "vault" } },
          { type: "sightingForged", visibility: REVEAL, forger: other, round: 1, target: viewer, room: "vault", shownTo: [viewer] },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "audit", round: 1, room: "vault", shortfall: 4 } },
          { type: "abilityResolved", visibility: privateTo(other), player: other, round: 1, ability: { kind: "checkStash", target: viewer, threshold: 3, dirty: true } },
          { type: "doubleCrossOffered", visibility: privateTo(other), player: other, round: 2, partner: viewer },
          { type: "doubleCrossAnswered", visibility: privateTo(other), player: other, round: 2, accept: true },
          { type: "doubleCrossResolved", visibility: privateTo(other), player: other, round: 2, partner: viewer, swap: { role: "mole", roleState: { usedThisAct: 1, usedThisGame: 0, target: null, tokens: 3, perks: ["shield"], tail: "vault" } } },
          { type: "raidRumourHit", visibility: privateTo(other), player: other, round: 2, lost: 3 },
          { type: "insideTip", visibility: privateTo(other), player: other, round: 2, subject: viewer, role: "mole" },
          { type: "callOutMade", visibility: privateTo(other), player: other, act: 1 },
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
            role: p.role === "insideMan" ? "fence" : "insideMan",
            stash: p.stash + 101,
            safe: p.safe + 7,
            roleState: { usedThisAct: 4, usedThisGame: 1, target: viewer, tokens: p.roleState.tokens + 5, perks: ["peek", "shield", "ballot"], tail: "vault" },
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
  // Who has locked in is public (owner decision, 2 Nov: `moveLocked`, design §5.1); what they picked is not.
  const moves: Record<PlayerId, Move> = {};
  for (const id of state.playerOrder) {
    if (!Object.hasOwn(state.moves, id)) continue;
    moves[id] = id === viewer ? (state.moves[id] as Move) : { room: "vault", pocket: 6 };
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
  // extension.md "Police activity": the schedule and the tip-off queue are nobody's to see.
  const police = { moment: (state.police?.moment ?? 0) + 5, gapPermille: 1234, patrol: !state.police?.patrol, queue: [other, other], tipOffs: { [other]: 7, [viewer]: state.police?.tipOffs[viewer] ?? 0 } };
  return {
    ...state,
    card,
    police,
    pendingShakedown,
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
  const seenPerks = new Set<string>();
  const earned = new Set<string>();
  const seenWatch = new Set<string>();
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
      // At 2 players the default pool may deal two roles with no move power (e.g. Rookie and Auditor).
      if ((t === "defaultMoveAssigned" || t === "abilityResolved") && players === 2) continue;
      expect(types, t).toContain(t);
    }
    if (players >= 5) expect(types).toContain("pocketCount");
    for (const t of types) seenTypes.add(t);
    for (const e of final.log) if (e.type === "abilityResolved") seenAbilities.add(e.ability.kind);
    for (const e of final.log) if (e.type === "perkUsed") seenPerks.add(e.perk.kind);
    for (const e of final.log) if (e.type === "tokenEarned") earned.add(e.trigger);
    for (const e of final.log) if (e.type === "roomWatched") seenWatch.add(e.source);
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

  it("the all-wildcard games reach every lone-wolf and wildcard token, police activity and the queued tip-off (extension.md \"Roles\", \"Police activity\")", () => {
    for (const t of ["heatReached", "safeReached", "firstTake", "tipOffLanded"]) expect(earned, t).toContain(t);
    for (const t of ["voteCompromised", "sightingForged", "policeScheduled", "policeActivity", "tipOffLanded"]) expect(darkTypes, t).toContain(t);
    for (const k of ["forge", "embezzle", "blackmail"]) expect(seenAbilities, k).toContain(k);
  });

  it("the games above reach every info, vote, Mole and event-card event (design §8, §8.1, §10)", () => {
    for (const t of ["snitchTargetAssigned", "shakedownPending", "shakedownCancelled", "alibisClosed", "roleListShown", "shopDealt"]) expect(seenTypes, t).toContain(t);
    for (const t of ["eventFlipped", "doubleCrossOffered", "doubleCrossAnswered", "doubleCrossResolved", "raidRumourHit", "insideTip", "auditReport"]) {
      expect(seenTypes, t).toContain(t);
    }
    for (const c of EVENT_DECK) expect(seenCards, c).toContain(c);
    expect(swapped, "a Double-cross swap happened").toBe(true);
    for (const k of ["lookout", "fenceSafe", "loopCameras", "cancelShakedown", "tipOff", "audit", "checkStash"]) expect(seenAbilities, k).toContain(k);
    // design §8.3: every perk event and every perk's effect.
    for (const t of ["tokenEarned", "perkBought", "perkUsed", "rigPicked", "alibiVerified"]) expect(seenTypes, t).toContain(t);
    for (const k of ["peek", "shield", "extraVote", "ballot", "tail", "alibi", "recharge", "rig"]) expect(seenPerks, k).toContain(k);
    expect(seenWatch, "a Tail watch").toContain("tail");
    // extension.md "Roles": tokens are earned in these games (others: crew tests).
    for (const k of EARNED_IN_PLAY) expect(earned, k).toContain(k);
    for (const t of ["blessingPaid", "cardForeseen"]) expect(seenTypes, t).toContain(t);
    for (const k of ["bless", "bagman"]) expect(seenAbilities, k).toContain(k);
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
