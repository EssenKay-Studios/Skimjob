// State is a fold over the event log. design §17.2, CLAUDE.md "Event-sourced"
//
// `applyEvent` is the only way state changes. Command handlers decide which
// events happen (drawing from `state.rng` where needed); folding those events
// rebuilds the same state, including the RNG, on replay.
import type { GameConfig, GameEvent, GameState, PlayerId, PlayerState } from "./types";
import { seedRng } from "./rng";
import { actOfRound, isLastRoundOfAct } from "./round";

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
    // ------------------------------------------------ round loop. design §5
    case "roundStarted": {
      const next: GameState = { ...state, phase: { kind: "planning", round: event.round }, round: event.round, moves: {} };
      // The Fence's per-act safe allowance starts again with each act. design §8
      return actOfRound(event.round) !== actOfRound(state.round) ? mapPlayers(next, () => ({ safeDepositedThisAct: 0 })) : next;
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
      if (ability.kind !== "fenceSafe") return state;
      return updatePlayer(state, event.player, (p) => ({
        stash: p.stash - ability.amount,
        safe: p.safe + ability.amount,
        safeDepositedThisAct: p.safeDepositedThisAct + ability.amount,
      }));
    }
    case "roomSighting":
    case "roomWatched":
    case "pocketCount":
    case "copsRaided":
      // Information only; no state changes. (copsRaided is followed by gameEnded.)
      return state;
    case "roundResolved": {
      // Haul and Heat are public totals; after an act's last round, the act's meeting comes next (task 6).
      // A new round of alibis opens (design §5.4).
      const next: GameState = {
        ...state,
        haul: event.haul,
        heat: event.heat,
        moves: {},
        resolvedRound: event.round,
        alibisPosted: [],
      };
      return isLastRoundOfAct(event.round) ? { ...next, phase: { kind: "awaitingMeeting", act: actOfRound(event.round) } } : next;
    }
    case "gameEnded":
      return { ...state, phase: { kind: "ended", outcome: event.outcome } };
    case "alibiPosted":
      return { ...state, alibisPosted: [...state.alibisPosted, event.player] };
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
