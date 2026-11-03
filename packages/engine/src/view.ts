// What one player may see: viewFor(state, playerId). design §13, §17.2
//
// Clients and bots receive only this. It reads the viewer's own player state,
// the public parts of the game state, and the log filtered by `canSee`. Other
// players' roles, stashes, moves and ballots never reach it except through
// events the viewer may see.
import type {
  ActiveCard,
  CaseFileEvent,
  GapBox,
  HeatBreakdown,
  GameEvent,
  GameState,
  LoggedEvent,
  PlayerId,
  PlayerView,
  PublicEvent,
  VoteChoice,
} from "./types";
import { canSee } from "./types";
import { actOfRound } from "./acts";
import { ROUNDS_PER_ACT } from "@skimjob/content";
import { roomDef, roomLoot } from "./job";
import { eventsFor, jobFor, perkCost } from "./overrides";
import { roundJob } from "./deck";

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
  // design §8.3 Ballot perk: the ballots you paid to see in the open meeting (also in Secret mode).
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
      safe: me.safe,
      roleState: me.roleState,
      emergencyMeetingUsed: me.emergencyMeetingUsed,
      move: ownMove ?? null,
      sealedVote: me.sealedVote,
      vote: ownVote ?? null,
      seenBallots,
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
    alibiRound: state.alibisOpen ? state.resolvedRound : null,
    rooms: state.rooms,
    haul: state.haul,
    heat: state.heat,
    // design §10: the card is public; a Double-cross offer is not (each of the two has it in their case file).
    card: state.card && { round: state.card.round, id: state.card.id, room: state.card.room },
    voteVisibility: state.config.voteVisibility,
    scheduledMeeting: state.scheduledMeeting,
    pendingEmergency: state.pendingEmergency,
    lockedIn: lockedIn(state),
    proposals: state.proposals,
    shop: state.shop.map((perk) => ({ perk, cost: perkCost(state.config, perk) })),
    roleList: roleListOf(state.log),
    gap: gapBox(state),
    ledger,
    caseFile,
    // design §13: everything opens up at the end, except others' secret-mode ballots (§11.2).
    reveal: state.phase.kind === "ended" ? { outcome: state.phase.outcome, log: visibleLog(state.log, playerId, true) } : null,
  };
}

function roleListOf(log: readonly GameEvent[]): PlayerView["roleList"] {
  const shown = log.find((e) => e.type === "roleListShown");
  return shown?.type === "roleListShown" ? { list: shown.list, roles: shown.roles } : null;
}

/** The gap box for the latest resolved round, from public events only. extension.md "What the app works out for you" */
export function gapBox(state: GameState): GapBox | null {
  const round = state.resolvedRound;
  if (round === 0) return null;
  let haulGrowth = 0;
  let card: ActiveCard | null = null;
  const alibis: string[] = [];
  for (const e of state.log) {
    if (e.type === "roundResolved" && e.round === round) haulGrowth = e.haulDelta;
    else if (e.type === "eventFlipped" && e.round === round) card = { round, id: e.card, room: e.room, offer: null };
    else if (e.type === "alibiPosted" && e.round === round) alibis.push(e.room);
  }
  const job = roundJob(jobFor(state.config), card, eventsFor(state.config), state.playerOrder.length);
  const claimed = alibis.reduce((sum, room) => sum + roomLoot(roomDef(job, room), alibis.filter((r) => r === room).length), 0);
  return { round, posted: alibis.length, alibis: claimed, haulGrowth, unaccounted: claimed - haulGrowth };
}

/**
 * The Heat breakdown of `round` from public events (a ledger is enough):
 * the round summary's parts, police activity under it, and a missed target's
 * penalty at the stretch's last round. Null if the round has nothing yet.
 * extension.md "What the app works out for you", "Police activity"
 */
export function heatBreakdown(log: readonly GameEvent[], round: number): HeatBreakdown | null {
  let parts: HeatBreakdown | null = null;
  const police: number[] = [];
  let missedTarget = 0;
  for (const e of log) {
    if (e.type === "roundResolved" && e.round === round) parts = { round, ...e.heatParts, police: [], missedTarget: 0 };
    else if (e.type === "policeActivity" && e.round === round) police.push(e.heatAdded);
    else if (e.type === "checkpointChecked" && e.act * ROUNDS_PER_ACT === round) missedTarget = e.heatPenalty;
  }
  if (!parts && police.length === 0) return null;
  return { ...(parts ?? { round, base: 0, rooms: {}, events: 0 }), police, missedTarget };
}

/**
 * Who has locked in a move this round (design §5.1, public by owner decision):
 * the seats with a submitted move while the round is unresolved. Default moves
 * are only assigned as the round resolves, so they never show here.
 */
export function lockedIn(state: GameState): PlayerId[] {
  const unresolved = state.phase.kind === "planning" || ((state.phase.kind === "meeting" || state.phase.kind === "shakedownPending") && state.round > state.resolvedRound);
  return unresolved ? state.playerOrder.filter((id) => Object.hasOwn(state.moves, id)) : [];
}

/**
 * Input for the "while you were away" summary (design §13): the events in this
 * view after `seq` (the last one the player saw), oldest first. -1 gives all.
 */
export function eventsSince(view: PlayerView, seq: number): LoggedEvent[] {
  return [...view.ledger, ...view.caseFile].filter((e) => e.seq > seq).sort((a, b) => a.seq - b.seq);
}
