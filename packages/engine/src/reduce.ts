// State is a fold over the event log. design §17.2, CLAUDE.md "Event-sourced"
//
// `applyEvent` is the only way state changes. Command handlers decide which
// events happen (drawing from `state.rng` where needed); folding those events
// rebuilds the same state, including the RNG, on replay.
import type { GameConfig, GameEvent, GameState, MeetingState, Phase, PlayerId, PlayerState, RoleState } from "./types";
import { NO_ROLE_STATE } from "./types";
import { seedRng } from "./rng";
import { actOfRound, isLastRoundOfAct } from "./acts";

/** Replace one player's state. Throws for players that weren't dealt in. */
function updatePlayer(state: GameState, id: PlayerId, change: (p: PlayerState) => Partial<PlayerState>): GameState {
  const player = state.players[id];
  if (!player) throw new Error(`unknown player ${id}`);
  return { ...state, players: { ...state.players, [id]: { ...player, ...change(player) } } };
}

function mapPlayers(state: GameState, change: (p: PlayerState) => Partial<PlayerState>): GameState {
  const players = Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, { ...p, ...change(p) }]));
  return { ...state, players };
}

const withRoleState = (p: PlayerState, change: Partial<RoleState>): Partial<PlayerState> => ({ roleState: { ...p.roleState, ...change } });

function openMeeting(state: GameState): MeetingState {
  if (!state.meeting) throw new Error("no meeting is open");
  return state.meeting;
}

/**
 * Where the game goes when a meeting closes: back to planning the current
 * round, or, if that round has resolved (the act's last), awaiting the act's
 * meeting. The regular meeting's close then moves on with `roundStarted` or
 * `gameEnded`. design §4.1
 */
function phaseAfterMeeting(state: GameState): Phase {
  return state.resolvedRound === state.round
    ? { kind: "awaitingMeeting", act: actOfRound(state.round) }
    : { kind: "planning", round: state.round };
}

/** A shakedown window (if one was open) ends: back to where the meeting left the game. design §11.3 */
function afterShakedown(state: GameState): GameState {
  return state.pendingShakedown ? { ...state, pendingShakedown: null, phase: phaseAfterMeeting(state) } : state;
}

/** State before any event: only the host's config is known. */
export function initialState(config: GameConfig): GameState {
  return {
    config,
    rng: { words: [] },
    phase: { kind: "setup" },
    round: 0,
    resolvedRound: 0,
    rooms: [],
    playerOrder: [],
    players: {},
    haul: 0,
    heat: 0,
    card: null,
    cardsFlipped: [],
    moves: {},
    alibisPosted: [],
    proposals: [],
    scheduledMeeting: null,
    pendingEmergency: null,
    meeting: null,
    pendingShakedown: null,
    log: [],
  };
}

function applyChange(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "gameCreated":
      return { ...state, playerOrder: event.players.map((p) => p.id) };
    case "rngSeeded":
      return { ...state, rng: seedRng(event.seed) };
    case "rngAdvanced":
      return { ...state, rng: { words: event.words } };
    case "roomsSet":
      return { ...state, rooms: event.rooms };
    case "roleDealt": {
      const seat = state.config.players.find((p) => p.id === event.player);
      if (!seat) throw new Error(`roleDealt: unknown player ${event.player}`);
      const player: PlayerState = {
        id: seat.id,
        name: seat.name,
        isBot: seat.isBot,
        role: event.role,
        stash: 0,
        safe: 0,
        roleState: NO_ROLE_STATE,
        totalHandedIn: 0,
        timesShakenDown: 0,
        emergencyMeetingUsed: false,
        consecutiveMissedMoves: 0,
        sealedVote: null,
      };
      return { ...state, players: { ...state.players, [seat.id]: player } };
    }
    case "snitchTargetAssigned":
      return updatePlayer(state, event.player, (p) => withRoleState(p, { target: event.target }));
    case "moleAllies":
      return updatePlayer(state, event.player, (p) => withRoleState(p, { allies: event.allies }));
    // ------------------------------------------------ round loop. design §5
    case "roundStarted": {
      const next: GameState = { ...state, phase: { kind: "planning", round: event.round }, round: event.round, moves: {}, card: null };
      // Per-act powers (Fence safe, Hacker, Blackmailer, Mole) start again with each act. design §8
      return actOfRound(event.round) !== actOfRound(state.round) ? mapPlayers(next, (p) => withRoleState(p, { usedThisAct: 0 })) : next;
    }
    case "moveSubmitted":
      return updatePlayer({ ...state, moves: { ...state.moves, [event.player]: event.move } }, event.player, () => ({
        consecutiveMissedMoves: 0,
      }));
    case "defaultMoveAssigned":
      return updatePlayer({ ...state, moves: { ...state.moves, [event.player]: event.move } }, event.player, (p) => ({
        consecutiveMissedMoves: p.consecutiveMissedMoves + 1,
      }));
    case "lootSplit":
      return updatePlayer(state, event.player, (p) => ({
        stash: p.stash + event.toStash,
        totalHandedIn: p.totalHandedIn + event.toHaul,
      }));
    case "abilityResolved": {
      const { ability } = event;
      switch (ability.kind) {
        case "fenceSafe":
          return updatePlayer(state, event.player, (p) => ({
            stash: p.stash - ability.amount,
            safe: p.safe + ability.amount,
            ...withRoleState(p, { usedThisAct: p.roleState.usedThisAct + ability.amount }),
          }));
        case "loopCameras":
        case "tipOff":
          // The tip-off's Heat is already in the round's `roundResolved` total. design §8
          return updatePlayer(state, event.player, (p) => withRoleState(p, { usedThisAct: p.roleState.usedThisAct + 1 }));
        case "blackmail":
          // The target's side is `blackmailed`. design §8
          return updatePlayer(state, event.player, (p) => ({
            stash: p.stash + ability.stolen,
            ...withRoleState(p, { usedThisAct: p.roleState.usedThisAct + 1 }),
          }));
        case "cancelShakedown": {
          const pending = state.pendingShakedown;
          if (!pending) throw new Error("cancelShakedown: no shakedown is pending");
          return updatePlayer({ ...state, pendingShakedown: { ...pending, cancelled: true } }, event.player, (p) =>
            withRoleState(p, { usedThisGame: p.roleState.usedThisGame + 1 }),
          );
        }
        case "lookout":
          return state;
      }
    }
    case "blackmailed":
      return updatePlayer(state, event.player, (p) => ({ stash: p.stash - event.stolen }));
    case "roomSighting":
    case "roomWatched":
    case "pocketCount":
    case "copsRaided":
      // Information only; no state changes. (copsRaided is followed by gameEnded.)
      return state;
    case "roundResolved": {
      // Haul and Heat are public totals; after an act's last round, the act's meeting comes next (design §11).
      // A new round of alibis opens (design §5.4).
      const next: GameState = {
        ...state,
        haul: event.haul,
        heat: event.heat,
        moves: {},
        card: null,
        resolvedRound: event.round,
        alibisPosted: [],
      };
      return isLastRoundOfAct(event.round) ? { ...next, phase: { kind: "awaitingMeeting", act: actOfRound(event.round) } } : next;
    }
    case "gameEnded":
      return { ...state, phase: { kind: "ended", outcome: event.outcome } };
    // ------------------------------------------------ events deck. design §10
    case "eventFlipped":
      return {
        ...state,
        card: { round: event.round, id: event.card, room: event.room, offer: null },
        cardsFlipped: [...state.cardsFlipped, event.card],
      };
    case "doubleCrossOffered": {
      const card = state.card;
      if (!card) throw new Error("doubleCrossOffered: no card flipped");
      // One event per player; the first sets the pair.
      return card.offer ? state : { ...state, card: { ...card, offer: { players: [event.player, event.partner], accepted: [] } } };
    }
    case "doubleCrossAnswered": {
      const offer = state.card?.offer;
      if (!state.card || !offer) throw new Error("doubleCrossAnswered: no offer");
      const rest = offer.accepted.filter((p) => p !== event.player);
      return { ...state, card: { ...state.card, offer: { ...offer, accepted: event.accept ? [...rest, event.player] : rest } } };
    }
    case "doubleCrossResolved": {
      const swap = event.swap;
      return swap ? updatePlayer(state, event.player, () => ({ role: swap.role, roleState: swap.roleState })) : state;
    }
    case "raidRumourHit":
      return updatePlayer(state, event.player, (p) => ({ stash: p.stash - event.lost }));
    case "insideTip":
    case "auditReport":
      return state;
    case "alibiPosted":
      return { ...state, alibisPosted: [...state.alibisPosted, event.player] };
    // ------------------------------------------------ meetings and votes. design §11
    case "meetingProposed": {
      const { proposalId: id, by, act, slot } = event;
      return { ...state, proposals: [...state.proposals, { id, by, act, slot, acceptedBy: [by] }] };
    }
    case "meetingProposalAccepted":
      return {
        ...state,
        proposals: state.proposals.map((p) => (p.id === event.proposalId ? { ...p, acceptedBy: [...p.acceptedBy, event.by] } : p)),
      };
    case "meetingScheduled":
      return { ...state, proposals: [], scheduledMeeting: { meetingId: event.meetingId, act: event.act, slot: event.slot } };
    case "emergencyMeetingCalled":
      return updatePlayer({ ...state, pendingEmergency: { meetingId: event.meetingId, by: event.by } }, event.by, () => ({
        emergencyMeetingUsed: true,
      }));
    case "meetingOpened": {
      const emergency = event.kind === "emergency";
      return {
        ...state,
        phase: { kind: "meeting", meetingId: event.meetingId },
        meeting: { id: event.meetingId, kind: event.kind, act: event.act, calledBy: emergency ? (state.pendingEmergency?.by ?? null) : null, votes: {} },
        scheduledMeeting: emergency ? state.scheduledMeeting : null,
        pendingEmergency: emergency ? null : state.pendingEmergency,
      };
    }
    case "voteSealed":
      return updatePlayer(state, event.player, () => ({ sealedVote: event.vote }));
    case "voteCast": {
      const meeting = openMeeting(state);
      const next: GameState = { ...state, meeting: { ...meeting, votes: { ...meeting.votes, [event.player]: event.vote } } };
      // A sealed vote is used up once it's cast. design §11.2
      return event.sealed ? updatePlayer(next, event.player, () => ({ sealedVote: null })) : next;
    }
    case "meetingClosed":
      openMeeting(state);
      return { ...state, meeting: null, phase: phaseAfterMeeting(state) };
    case "shakedownPending":
      return {
        ...state,
        phase: { kind: "shakedownPending", meetingId: event.meetingId, target: event.target },
        pendingShakedown: { meetingId: event.meetingId, kind: event.kind, act: event.act, target: event.target, cancelled: false },
      };
    case "shakedownCancelled":
      return afterShakedown(state);
    case "snitchPaid":
      return updatePlayer(state, event.player, (p) => ({ stash: p.stash + event.amount }));
    case "shakedownResolved": {
      const next = { ...afterShakedown(state), haul: state.haul + event.taken - event.compensation };
      return updatePlayer(next, event.target, (p) => ({
        stash: p.stash - event.taken + event.compensation,
        timesShakenDown: p.timesShakenDown + 1,
      }));
    }
    case "checkpointChecked":
      return { ...state, heat: state.heat + event.heatPenalty };
    default: {
      const unknown: never = event;
      throw new Error(`applyEvent: unknown event ${JSON.stringify(unknown)}`);
    }
  }
}

/** Fold one event into state and append it to the log. */
export function applyEvent(state: GameState, event: GameEvent): GameState {
  const next = applyChange(state, event);
  return { ...next, log: [...state.log, event] };
}

/** Rebuild state from a config and a log. Same log, same state. */
export function replay(config: GameConfig, log: readonly GameEvent[]): GameState {
  return log.reduce(applyEvent, initialState(config));
}
