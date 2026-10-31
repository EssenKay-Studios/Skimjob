// One sample of every event and command type, keyed by type.
//
// The `{ [T in ...]: ... }` shapes make the compiler fail when a new event or
// command type is added without a sample here. The viewFor() leak tests
// (STATUS.md task 8) iterate over these, so every event type gets covered.
import type { Command, CommandType } from "./commands";
import type { EventOfType, GameEventType } from "./events";
import { PUBLIC, REVEAL, privateTo } from "./visibility";

const ana = "ana";
const ben = "ben";

export const sampleEvents: { readonly [T in GameEventType]: EventOfType<T> } = {
  gameCreated: {
    type: "gameCreated",
    visibility: PUBLIC,
    players: [
      { id: ana, name: "Ana", isBot: false },
      { id: ben, name: "Ben", isBot: true },
    ],
    job: "bank",
    mole: "off",
    eventsEnabled: false,
    voteVisibility: "hiddenThenRevealed",
    starterMode: true,
  },
  rngSeeded: { type: "rngSeeded", visibility: REVEAL, seed: "sample-seed" },
  roomsSet: { type: "roomsSet", visibility: PUBLIC, rooms: ["vault", "office", "lobby", "security", "rooftop"] },
  roleDealt: { type: "roleDealt", visibility: privateTo(ana), player: ana, role: "fence" },
  roundStarted: { type: "roundStarted", visibility: PUBLIC, round: 1, act: 1 },
  moveSubmitted: {
    type: "moveSubmitted",
    visibility: privateTo(ana),
    player: ana,
    round: 1,
    move: { room: "vault", pocket: 2 },
  },
  defaultMoveAssigned: {
    type: "defaultMoveAssigned",
    visibility: privateTo(ben),
    player: ben,
    round: 1,
    move: { room: "lobby", pocket: 0 },
  },
  lootSplit: {
    type: "lootSplit",
    visibility: privateTo(ana),
    player: ana,
    round: 1,
    room: "vault",
    loot: 6,
    toHaul: 4,
    toStash: 2,
  },
  abilityResolved: {
    type: "abilityResolved",
    visibility: privateTo(ana),
    player: ana,
    round: 1,
    ability: { kind: "fenceSafe", amount: 2 },
  },
  roomSighting: { type: "roomSighting", visibility: privateTo(ana), player: ana, round: 1, room: "vault", others: [] },
  roomWatched: {
    type: "roomWatched",
    visibility: privateTo(ben),
    player: ben,
    round: 1,
    source: "security",
    room: "vault",
    seen: [ana],
  },
  pocketCount: { type: "pocketCount", visibility: privateTo(ben), player: ben, round: 1, pocketed: 1 },
  roundResolved: { type: "roundResolved", visibility: PUBLIC, round: 1, haulDelta: 6, haul: 6, heatDelta: 14, heat: 14 },
  copsRaided: { type: "copsRaided", visibility: PUBLIC, round: 7, heat: 104 },
  alibiPosted: { type: "alibiPosted", visibility: PUBLIC, player: ana, round: 1, room: "lobby" },
  meetingProposed: { type: "meetingProposed", visibility: PUBLIC, proposalId: "p1", by: ana, act: 1, slot: "2026-11-01T19:00Z" },
  meetingProposalAccepted: { type: "meetingProposalAccepted", visibility: PUBLIC, proposalId: "p1", by: ben },
  meetingScheduled: { type: "meetingScheduled", visibility: PUBLIC, meetingId: "m1", act: 1, slot: "2026-11-01T19:00Z", proposalId: "p1" },
  emergencyMeetingCalled: { type: "emergencyMeetingCalled", visibility: PUBLIC, by: ben, meetingId: "m2" },
  meetingOpened: { type: "meetingOpened", visibility: PUBLIC, meetingId: "m1", kind: "regular", act: 1 },
  voteSealed: { type: "voteSealed", visibility: privateTo(ben), player: ben, vote: { kind: "skip" } },
  voteCast: {
    type: "voteCast",
    visibility: privateTo(ben),
    meetingId: "m1",
    player: ben,
    vote: { kind: "shakedown", target: ana },
    sealed: false,
  },
  meetingClosed: {
    type: "meetingClosed",
    visibility: PUBLIC,
    meetingId: "m1",
    tally: { skip: 1, targets: { [ana]: 1 } },
    ballots: { [ben]: { kind: "shakedown", target: ana }, [ana]: { kind: "skip" } },
    result: { kind: "noMajority" },
  },
  shakedownResolved: {
    type: "shakedownResolved",
    visibility: PUBLIC,
    meetingId: "m1",
    target: ana,
    stashRevealed: 2,
    taken: 2,
    clean: true,
    compensation: 5,
  },
  checkpointChecked: { type: "checkpointChecked", visibility: PUBLIC, act: 1, target: 12, haul: 10, met: false, heatPenalty: 15 },
  gameEnded: {
    type: "gameEnded",
    visibility: PUBLIC,
    outcome: {
      result: "success",
      ranking: [
        { player: ana, score: 9, stash: 9, timesShakenDown: 0, totalHandedIn: 30 },
        { player: ben, score: 4, stash: 4, timesShakenDown: 1, totalHandedIn: 40 },
      ],
      winners: [ana],
    },
  },
};

export const sampleCommands: { readonly [T in CommandType]: Extract<Command, { type: T }> } = {
  submitMove: { type: "submitMove", player: ana, move: { room: "security", pocket: 0, watch: "vault" } },
  postAlibi: { type: "postAlibi", player: ana, room: "office" },
  proposeMeeting: { type: "proposeMeeting", player: ana, slot: "2026-11-01T19:00Z" },
  acceptMeeting: { type: "acceptMeeting", player: ben, proposalId: "p1" },
  callEmergency: { type: "callEmergency", player: ben },
  castVote: { type: "castVote", player: ben, vote: { kind: "shakedown", target: ana } },
  sealVote: { type: "sealVote", player: ana, vote: { kind: "skip" } },
  advance: { type: "advance", deadline: { kind: "openMeeting", meetingId: "m2" } },
  scheduleMeeting: { type: "scheduleMeeting", act: 1, slot: "2026-11-01T21:00Z" },
};
