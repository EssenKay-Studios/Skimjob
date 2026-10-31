// What one player may see: viewFor(state, playerId). design §13, §17.2
//
// Clients and bots receive only this. It reads the viewer's own player state,
// the public parts of the game state, and the log filtered by `canSee`. Other
// players' roles, stashes, moves and ballots never reach it except through
// events the viewer may see.
import type {
  CaseFileEvent,
  GameEvent,
  GameState,
  LoggedEvent,
  PlayerId,
  PlayerView,
  PublicEvent,
} from "./types";
import { canSee } from "./types";
import { actOfRound } from "./acts";

const isPublic = (event: GameEvent): event is PublicEvent => event.visibility.kind === "public";
const isCaseFile = (event: GameEvent): event is CaseFileEvent => event.visibility.kind !== "public";

/**
 * The events `viewer` can see, numbered by their position in that stream (not
 * the full log, whose gaps would count hidden events; see `LoggedEvent`).
 */
function visibleLog(log: readonly GameEvent[], viewer: PlayerId, gameOver: boolean): LoggedEvent[] {
  const out: LoggedEvent[] = [];
  for (const event of log) {
    if (canSee(event.visibility, viewer, gameOver)) out.push({ seq: out.length, event });
  }
  return out;
}

/** Throws for a player who isn't in the game: the server only asks for seated players. */
export function viewFor(state: GameState, playerId: PlayerId): PlayerView {
  const me = Object.hasOwn(state.players, playerId) ? state.players[playerId] : undefined;
  if (!me) throw new Error(`viewFor: unknown player ${playerId}`);

  // During the game: public + own private/secret. These stay the same after it ends.
  const seen = visibleLog(state.log, playerId, false);
  const ledger = seen.filter((e): e is LoggedEvent<PublicEvent> => isPublic(e.event));
  const caseFile = seen.filter((e): e is LoggedEvent<CaseFileEvent> => isCaseFile(e.event));

  const ownVote = state.meeting && Object.hasOwn(state.meeting.votes, playerId) ? state.meeting.votes[playerId] : undefined;
  const ownMove = Object.hasOwn(state.moves, playerId) ? state.moves[playerId] : undefined;

  return {
    me: {
      id: me.id,
      role: me.role,
      stash: me.stash,
      safe: me.safe,
      emergencyMeetingUsed: me.emergencyMeetingUsed,
      move: ownMove ?? null,
      sealedVote: me.sealedVote,
      vote: ownVote ?? null,
    },
    players: state.config.players
      .filter((seat) => seat.id !== playerId)
      .map((seat) => ({
        id: seat.id,
        name: seat.name,
        isBot: seat.isBot,
        emergencyMeetingUsed: state.players[seat.id]?.emergencyMeetingUsed ?? false,
      })),
    phase: state.phase,
    round: state.round,
    act: actOfRound(Math.max(1, state.round)),
    rooms: state.rooms,
    haul: state.haul,
    heat: state.heat,
    voteVisibility: state.config.voteVisibility,
    scheduledMeeting: state.scheduledMeeting,
    pendingEmergency: state.pendingEmergency,
    proposals: state.proposals,
    ledger,
    caseFile,
    // design §13: everything opens up at the end, except others' secret-mode ballots (§11.2).
    reveal: state.phase.kind === "ended" ? { outcome: state.phase.outcome, log: visibleLog(state.log, playerId, true) } : null,
  };
}

/**
 * Input for the "while you were away" summary (design §13): the events in this
 * view after `seq` (the last one the player saw), oldest first. -1 gives all.
 */
export function eventsSince(view: PlayerView, seq: number): LoggedEvent[] {
  return [...view.ledger, ...view.caseFile].filter((e) => e.seq > seq).sort((a, b) => a.seq - b.seq);
}
