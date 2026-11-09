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
  Outcome,
  PlayerId,
  PlayerView,
  PublicEvent,
  VoteChoice,
} from "./types";
import { canSee } from "./types";
import { perkCost } from "./overrides";
import { revealSummary } from "./reveal";
import { honestyOf } from "./shares";

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

/**
 * Throws for a player who isn't in the game: the server only asks for seated players.
 *
 * The view is a deep copy: nothing in it is shared with the game state or its
 * log, so a client or bot that changes its view can't change the game
 * (task 8 review, docs/decisions.md).
 */
export function viewFor(state: GameState, playerId: PlayerId): PlayerView {
  return copyData(buildView(state, playerId));
}

/**
 * Deep copy of plain data (objects, arrays, primitives): all a view holds.
 * Much faster than structuredClone on views, which bots ask for constantly.
 */
function copyData<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(copyData) as T;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const copy = copyData((value as Record<string, unknown>)[key]);
    // Plain assignment to "__proto__" would set the prototype and drop the entry.
    if (key === "__proto__") Object.defineProperty(out, key, { value: copy, enumerable: true, writable: true, configurable: true });
    else out[key] = copy;
  }
  return out as T;
}

function buildView(state: GameState, playerId: PlayerId): PlayerView {
  const me = Object.hasOwn(state.players, playerId) ? state.players[playerId] : undefined;
  if (!me) throw new Error(`viewFor: unknown player ${playerId}`);

  // During the game: public + own private/secret. These stay the same after it ends.
  const seen = visibleLog(state.log, playerId, false);
  const ledger = seen.filter((e): e is LoggedEvent<PublicEvent> => isPublic(e.event));
  const caseFile = seen.filter((e): e is LoggedEvent<CaseFileEvent> => isCaseFile(e.event));

  const ownVote = state.meeting && Object.hasOwn(state.meeting.votes, playerId) ? state.meeting.votes[playerId] : undefined;
  const ownMove = Object.hasOwn(state.moves, playerId) ? state.moves[playerId] : undefined;
  // design §12 Check ballot: the ballots you paid to see in the open meeting (also in Secret mode).
  const seenBallots: Record<PlayerId, VoteChoice | null> = {};
  const meeting = state.meeting;
  if (meeting && Object.hasOwn(meeting.ballotGrants, playerId)) {
    for (const target of meeting.ballotGrants[playerId] as readonly PlayerId[]) {
      seenBallots[target] = Object.hasOwn(meeting.votes, target) ? (meeting.votes[target] as VoteChoice) : null;
    }
  }

  return {
    me: {
      id: me.id,
      role: me.role,
      stash: me.stash,
      roleState: me.roleState,
      move: ownMove ?? null,
      sealedVote: me.sealedVote,
      vote: ownVote ?? null,
      seenBallots,
    },
    players: state.config.players.filter((seat) => seat.id !== playerId).map((seat) => ({ id: seat.id, name: seat.name, isBot: seat.isBot })),
    phase: state.phase,
    round: state.round,
    stretch: state.stretch,
    rooms: state.rooms,
    // design §6.1: the bank count is public.
    bank: state.bank,
    // design §7.2, §7.3, §7.5: the share, the kitty and honesty are public.
    share: state.share,
    kitty: state.kitty,
    honesty: honestyOf(state),
    // design §5.1, §5.3, §5.4: bells (a taped-off room's is off; one a Hacker hid shows "?", except to that Hacker), the tape and Wanted are public.
    bells: bellsSeenBy(state, playerId),
    hiddenBells: state.hidden,
    taped: state.taped,
    // design §11.1: this round's power cuts are announced to everyone.
    dark: state.dark,
    wanted: state.wanted,
    // design §13: the card is public.
    card: state.card,
    voteVisibility: state.config.voteVisibility,
    // design §9.3, §9.4, §9.7: the meeting slot, a called emergency, the pool left and who is protected are public.
    scheduledMeeting: state.scheduledMeeting,
    pendingEmergency: state.pendingEmergency,
    emergencies: state.emergencies,
    protected: state.protected,
    lockedIn: lockedIn(state),
    proposals: state.proposals,
    shop: state.shop.map((perk) => ({ perk, cost: perkCost(state.config, perk) })),
    roleList: roleListOf(state.log),
    ledger,
    caseFile,
    // design §13: everything opens up at the end, except others' secret-mode ballots (§11.2).
    reveal: state.phase.kind === "ended" ? revealOf(state, state.phase.outcome, visibleLog(state.log, playerId, true)) : null,
  };
}

/** design §13: the summary reads only the viewer's reveal log, so it can't leak more than that log. */
function revealOf(state: GameState, outcome: Outcome, log: readonly LoggedEvent[]): NonNullable<PlayerView["reveal"]> {
  const summary = revealSummary(
    log.map((e) => e.event),
    outcome,
  );
  return { outcome, log, summary };
}

/** design §5.1, §11.1: every bell but the hidden ones, which only the Hacker who hid one sees. */
function bellsSeenBy(state: GameState, viewer: PlayerId): GameState["bells"] {
  if (state.hidden.length === 0) return state.bells;
  const mine = (room: string) =>
    state.log.some((e) => e.type === "abilityResolved" && e.player === viewer && e.round === state.round && e.ability.kind === "hide" && e.ability.room === room);
  return Object.fromEntries(Object.entries(state.bells).filter(([room]) => !state.hidden.includes(room) || mine(room)));
}

function roleListOf(log: readonly GameEvent[]): PlayerView["roleList"] {
  const shown = log.find((e) => e.type === "roleListShown");
  return shown?.type === "roleListShown" ? { list: shown.list, roles: shown.roles } : null;
}

/**
 * Who has locked in a move this round (design §5.1, public by owner decision):
 * the seats with a submitted move while the round is unresolved. Default moves
 * are only assigned as the round resolves, so they never show here.
 */
export function lockedIn(state: GameState): PlayerId[] {
  return state.phase.kind === "planning" ? state.playerOrder.filter((id) => Object.hasOwn(state.moves, id)) : [];
}

/**
 * Input for the "while you were away" summary (design §13): the events in this
 * view after `seq` (the last one the player saw), oldest first. -1 gives all.
 */
export function eventsSince(view: PlayerView, seq: number): LoggedEvent[] {
  return [...view.ledger, ...view.caseFile].filter((e) => e.seq > seq).sort((a, b) => a.seq - b.seq);
}
