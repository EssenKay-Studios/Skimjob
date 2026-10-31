// State is a fold over the event log. design §17.2, CLAUDE.md "Event-sourced"
//
// `applyEvent` is the only way state changes. Command handlers decide which
// events happen (drawing from `state.rng` where needed); folding those events
// rebuilds the same state, including the RNG, on replay.
import type { GameConfig, GameEvent, GameState, PlayerState } from "./types";
import { seedRng } from "./rng";

/** State before any event: only the host's config is known. */
export function initialState(config: GameConfig): GameState {
  return {
    config,
    rng: { words: [] },
    phase: { kind: "setup" },
    rooms: [],
    playerOrder: [],
    players: {},
    haul: 0,
    heat: 0,
    moves: {},
    alibisPosted: [],
    proposals: [],
    scheduledMeeting: null,
    pendingEmergency: null,
    meeting: null,
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
        safeDepositedThisAct: 0,
        totalHandedIn: 0,
        timesShakenDown: 0,
        emergencyMeetingUsed: false,
        consecutiveMissedMoves: 0,
        sealedVote: null,
      };
      return { ...state, players: { ...state.players, [seat.id]: player } };
    }
    case "roundStarted":
    case "moveSubmitted":
    case "defaultMoveAssigned":
    case "lootSplit":
    case "abilityResolved":
    case "roomSighting":
    case "roomWatched":
    case "pocketCount":
    case "roundResolved":
    case "copsRaided":
    case "alibiPosted":
    case "meetingProposed":
    case "meetingProposalAccepted":
    case "meetingScheduled":
    case "emergencyMeetingCalled":
    case "meetingOpened":
    case "voteSealed":
    case "voteCast":
    case "meetingClosed":
    case "shakedownResolved":
    case "checkpointChecked":
    case "gameEnded":
      // Folded by later tasks (STATUS.md). Fail loudly rather than drop state.
      throw new Error(`applyEvent: ${event.type} is not implemented yet`);
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
