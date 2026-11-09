// Crew meetings and votes: a regular meeting each time a third of the bank is
// gone, a police briefing after a raid, emergencies from the crew's pool in
// the result window, ballots, the tally, shakedowns and their protection.
// design §9; no meeting is held after the last round (§6.2)
//
// Every function is pure: it reads state and returns events, or the reason the
// command is refused. `handleCommand` (handle.ts) folds the events. Nothing
// here draws randomness except the next round's event card (deck.ts, design §13):
// meeting and proposal ids are names and counts of public events.
import { MAX_SLOT_LENGTH, type PerkId } from "@skimjob/content";
import type {
  GameEvent,
  GameState,
  MeetingKind,
  MeetingResult,
  PlayerId,
  PlayerState,
  PrivateVisibility,
  PublicVisibility,
  SecretVisibility,
  VoteChoice,
} from "./types";
import { PUBLIC, privateTo, secretTo } from "./types";
import { powerOf } from "./overrides";
import { aboveShare } from "./crew";
import { roleHandler } from "./roles";
import { applyEvent, nextMeetingId } from "./reduce";
import { isObject, playerFor, show } from "./check";
import type { Draw } from "./handle";
import { startRound } from "./deck";

type Result = GameEvent[] | string;
type Raw = Record<string, unknown>;

const count = (state: GameState, match: (e: GameEvent) => boolean): number => state.log.filter(match).length;

/** The next meeting's slot is locked in, not yet open. */
const lockedReason = "the next meeting is already scheduled";

/** A slot is free text the engine only stores and compares, so its length is capped (content). design §9.4 */
function checkSlot(slot: unknown): string | null {
  if (typeof slot !== "string" || slot === "") return "slot must be a non-empty string";
  return slot.length > MAX_SLOT_LENGTH ? `slot must be at most ${MAX_SLOT_LENGTH} characters` : null;
}

function scheduled(meetingId: string, slot: string, proposalId: string | null): GameEvent {
  return { type: "meetingScheduled", visibility: PUBLIC, meetingId, slot, proposalId };
}

/** design §9.5: votes are public in "open" mode, private to the voter while hidden, secret for good in "secret" mode. */
function ballotVisibility(state: GameState, player: PlayerId): PublicVisibility | PrivateVisibility | SecretVisibility {
  switch (state.config.voteVisibility) {
    case "open":
      return PUBLIC;
    case "secret":
      return secretTo(player);
    default:
      return privateTo(player);
  }
}

/** A ballot: skip, or shake down another player in the crew (not yourself). design §9.5 */
function checkVote(state: GameState, voter: PlayerState, raw: unknown): VoteChoice | string {
  if (!isObject(raw)) return "vote must be an object";
  if (raw.kind === "skip") return { kind: "skip" };
  if (raw.kind !== "shakedown") return "vote must be a shakedown or a skip";
  const target = raw.target;
  if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${show(target)}`;
  if (target === voter.id) return "you can't vote to shake yourself down";
  return { kind: "shakedown", target };
}

const protectedReason = "that player is protected until the next regular meeting";

/**
 * After a round's result and any meeting it called: the result window while
 * the crew's pool has an emergency left, else the next round at once. design §4.2 step 10, §9.3
 */
export function afterResult(state: GameState, draw: Draw): GameEvent[] {
  return state.phase.kind === "result" && state.emergencies > 0 ? [] : startRound(state, state.round + 1, draw);
}

// ---------------------------------------------------------------- scheduling (§9.4)

/**
 * design §9.4 (owner decision, 2 Nov): a slot locks once more than half of
 * the crew's people (human seats) back it; bots' backing doesn't count. With
 * no people at all (simulator, all-bot tests) more than half the crew does.
 */
export function slotLocks(state: GameState, backers: readonly PlayerId[]): boolean {
  const humans = new Set(state.config.players.filter((seat) => !seat.isBot).map((seat) => seat.id));
  if (humans.size === 0) return backers.length * 2 > state.playerOrder.length;
  return backers.filter((id) => humans.has(id)).length * 2 > humans.size;
}

/** Any player proposes a slot for the next regular meeting or briefing; the proposer counts as accepting (and may lock it alone). */
export function proposeMeeting(state: GameState, command: Raw): Result {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  if (state.scheduledMeeting) return lockedReason;
  const bad = checkSlot(command.slot);
  if (bad) return bad;
  const slot = command.slot as string;
  const same = state.proposals.find((p) => p.slot === slot);
  if (same) return `that slot is already proposed (${same.id})`;
  // Numbered from public data only (earlier proposals this game), never the log length,
  // which would let players count hidden events. Unique and deterministic.
  const proposalId = `proposal-${count(state, (e) => e.type === "meetingProposed") + 1}`;
  const events: GameEvent[] = [{ type: "meetingProposed", visibility: PUBLIC, proposalId, by: player.id, slot }];
  if (slotLocks(state, [player.id])) events.push(scheduled(nextMeetingId(state), slot, proposalId));
  return events;
}

/** Locked in once a majority of the people (or, with none, of the crew) has accepted (`slotLocks`). */
export function acceptMeeting(state: GameState, command: Raw): Result {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  if (state.scheduledMeeting) return lockedReason;
  const proposal = state.proposals.find((p) => p.id === command.proposalId);
  if (!proposal) return `no open proposal ${show(command.proposalId)}`;
  if (proposal.acceptedBy.includes(player.id)) return "you already accepted this proposal";
  const events: GameEvent[] = [{ type: "meetingProposalAccepted", visibility: PUBLIC, proposalId: proposal.id, by: player.id }];
  if (slotLocks(state, [...proposal.acceptedBy, player.id])) events.push(scheduled(nextMeetingId(state), proposal.slot, proposal.id));
  return events;
}

/** System: a meeting is due and nobody locked a slot for it, so the server picks one. design §9.4 */
export function scheduleMeeting(state: GameState, command: Raw): Result {
  if (state.phase.kind !== "awaitingMeeting") return "no meeting is due";
  const { meetingId } = state.phase;
  if (command.meetingId !== meetingId) return `meeting ${show(command.meetingId)} is not due (${meetingId} is)`;
  if (state.scheduledMeeting) return lockedReason;
  const bad = checkSlot(command.slot);
  if (bad) return bad;
  return [scheduled(meetingId, command.slot as string, null)];
}

/**
 * design §9.3 (owner, 6 Nov): any player spends one of the crew's emergency
 * meetings, only in the result window (after a round's result and any meeting
 * it called, before the next planning), one per window. It can't be withdrawn;
 * the caller is named. The notice period is the server's.
 */
export function callEmergency(state: GameState, command: Raw): Result {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  if (state.phase.kind !== "result") return "an emergency meeting can only be called between a round's result and the next planning";
  if (state.pendingEmergency) return "an emergency meeting has already been called";
  if (state.emergencies === 0) return "the crew's emergency meetings are all spent";
  const meetingId = `emergency-${count(state, (e) => e.type === "emergencyMeetingCalled") + 1}`;
  return [{ type: "emergencyMeetingCalled", visibility: PUBLIC, by: player.id, meetingId }];
}

// ---------------------------------------------------------------- voting (§9.5)

/**
 * Left in advance for the next meeting that opens; replaces any earlier sealed
 * vote. It may name a protected player: it counts as a skip if they are still
 * protected when the meeting opens. design §9.5
 */
export function sealVote(state: GameState, command: Raw): Result {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const vote = checkVote(state, player, command.vote);
  if (typeof vote === "string") return vote;
  const visibility = state.config.voteVisibility === "secret" ? secretTo(player.id) : privateTo(player.id);
  return [{ type: "voteSealed", visibility, player: player.id, vote }];
}

/** A live ballot in the open window. A later ballot replaces an earlier (or sealed) one. */
export function castVote(state: GameState, command: Raw): Result {
  const meeting = state.meeting;
  if (!meeting) return "no meeting is open";
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const vote = checkVote(state, player, command.vote);
  if (typeof vote === "string") return vote;
  // design §9.5, §9.7: nobody can vote for a protected player.
  if (vote.kind === "shakedown" && state.protected.includes(vote.target)) return protectedReason;
  return [{ type: "voteCast", visibility: ballotVisibility(state, player.id), meetingId: meeting.id, player: player.id, vote, sealed: false }];
}

// ---------------------------------------------------------------- deadlines (§4.1, §9)

/**
 * The slot (or the emergency's notice period) has arrived. A regular meeting
 * or briefing opens only once the round that called it has resolved
 * (`awaitingMeeting`); an emergency opens when its notice ends. Sealed votes
 * are cast as it opens; one naming a player still protected then counts as a
 * skip (a regular meeting lifts protection as it opens). design §9.4, §9.5, §9.7
 */
export function openMeeting(state: GameState, meetingId: unknown): Result {
  if (state.meeting) return `meeting ${state.meeting.id} is already open`;
  if (state.pendingShakedown) return `the shakedown of meeting ${state.pendingShakedown.meetingId} is pending`;
  // Checked first: an absent id must not match an absent pending meeting.
  if (typeof meetingId !== "string") return `meeting ${show(meetingId)} is not waiting to open`;
  let kind: MeetingKind;
  if (state.scheduledMeeting?.meetingId === meetingId) {
    if (state.phase.kind !== "awaitingMeeting") return `meeting ${meetingId} opens once a round calls it`;
    kind = state.phase.meeting;
  } else if (state.pendingEmergency?.meetingId === meetingId) {
    kind = "emergency";
  } else {
    return `meeting ${show(meetingId)} is not waiting to open`;
  }
  const events: GameEvent[] = [{ type: "meetingOpened", visibility: PUBLIC, meetingId, kind }];
  const guarded = kind === "regular" ? [] : state.protected;
  for (const player of state.playerOrder) {
    const sealed = state.players[player]?.sealedVote;
    if (!sealed) continue;
    const vote: VoteChoice = sealed.kind === "shakedown" && guarded.includes(sealed.target) ? { kind: "skip" } : sealed;
    events.push({ type: "voteCast", visibility: ballotVisibility(state, player), meetingId, player, vote, sealed: true });
  }
  return events;
}

/**
 * design §9.5 (one rule for every crew size): quorum
 * is at least half the crew voting (sealed votes count), counting voters; a
 * shakedown needs more than half of the votes cast, counting weight (the
 * Smooth Talker's ballot counts double, §11.1). `weight` is the total weight
 * cast, and `skip` / `targets` are weights too. Without a Smooth Talker,
 * weight = voters.
 */
export function meetingResult(crewSize: number, voters: number, skip: number, targets: ReadonlyMap<PlayerId, number>, weight: number = voters): MeetingResult {
  if (voters * 2 < crewSize) return { kind: "noQuorum" };
  for (const [target, votes] of targets) if (votes * 2 > weight) return { kind: "shakedown", target };
  if (skip * 2 > weight) return { kind: "skipped" };
  return { kind: "noMajority" };
}

/** How much a player's ballot counts: the Smooth Talker's `weight`, else 1 (each copy's own, §11.4). design §9.5, §11.1 */
function baseWeight(state: GameState, player: PlayerId): number {
  const power = powerOf(state.config, (state.players[player] as PlayerState).role);
  return power?.kind === "voteWeight" ? power.weight : 1;
}

/**
 * design §9.6, §12: a passed shakedown waits for the Bail choice window when
 * Bail is in this game's shop, whoever the target is, so the window never
 * tells who holds one.
 */
export const opensShakedownWindow = (shop: readonly PerkId[]): boolean => shop.includes("bail");

/** The tally of the open meeting's ballots: the public counts, the result by weight, in seat order. */
function tally(state: GameState) {
  const meeting = state.meeting as NonNullable<GameState["meeting"]>;
  // Tally in seat order, so the event is the same however the votes arrived.
  // The public tally counts ballots; the result counts weight (Smooth Talker, design §11.1).
  const ballots: [PlayerId, VoteChoice][] = [];
  for (const id of state.playerOrder) if (Object.hasOwn(meeting.votes, id)) ballots.push([id, meeting.votes[id] as VoteChoice]);
  let skip = 0;
  let skipWeight = 0;
  let weight = 0;
  const counts = new Map<PlayerId, number>();
  const weights = new Map<PlayerId, number>();
  for (const [voter, vote] of ballots) {
    const w = baseWeight(state, voter);
    weight += w;
    if (vote.kind === "skip") {
      skip++;
      skipWeight += w;
    } else {
      counts.set(vote.target, (counts.get(vote.target) ?? 0) + 1);
      weights.set(vote.target, (weights.get(vote.target) ?? 0) + w);
    }
  }
  const inSeatOrder = (m: Map<PlayerId, number>) => new Map(state.playerOrder.filter((id) => m.has(id)).map((id) => [id, m.get(id) as number]));
  const result = meetingResult(state.playerOrder.length, ballots.length, skipWeight, inSeatOrder(weights), weight);
  return { ballots, skip, counts: inSeatOrder(counts), result };
}

/**
 * The window has ended: the tally, then the shakedown (or, with Bail in the
 * shop, its Bail choice window first). Then `afterVote`: after an emergency the next
 * round starts; after a regular meeting or a briefing the result window opens,
 * or the next round starts when the crew's pool is empty. design §9.3, §9.5, §9.6
 */
export function closeMeeting(state: GameState, meetingId: unknown, draw: Draw): Result {
  const meeting = state.meeting;
  if (!meeting || meeting.id !== meetingId) return `meeting ${show(meetingId)} is not open`;
  const { ballots, skip, counts, result } = tally(state);
  const events: GameEvent[] = [
    {
      type: "meetingClosed",
      visibility: PUBLIC,
      meetingId: meeting.id,
      tally: { skip, targets: Object.fromEntries(counts) },
      // design §9.5: in "secret" mode only the tally is ever shown.
      ballots: state.config.voteVisibility === "secret" ? null : Object.fromEntries(ballots),
      result,
    },
  ];
  const { kind } = meeting;
  if (result.kind === "shakedown" && opensShakedownWindow(state.shop)) {
    // design §9.6: the target may use Bail before the stash opens (`advance { resolveShakedown }`).
    events.push({ type: "shakedownPending", visibility: PUBLIC, meetingId: meeting.id, kind, target: result.target });
    return events;
  }
  const shakedown = result.kind === "shakedown" ? { target: result.target, useBail: false } : null;
  return [...events, ...afterVote(state, events, { meetingId: meeting.id, kind }, shakedown, draw)];
}

/** The Bail choice window has ended: the shakedown falls through (Bail used) or the stash opens, then go on. design §9.6 */
export function resolveShakedown(state: GameState, meetingId: unknown, draw: Draw): Result {
  const pending = state.pendingShakedown;
  if (!pending || pending.meetingId !== meetingId) return `no shakedown is pending for meeting ${show(meetingId)}`;
  return afterVote(state, [], pending, pending, draw);
}

/** `useAbility`: a power used outside a move (its role handler, roles.ts). design §11.1 */
export function useAbility(state: GameState, command: Raw): Result {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const ability = command.ability;
  if (!isObject(ability) || typeof ability.kind !== "string") return "ability must be an object with a kind";
  const use = roleHandler(player.role).use;
  if (!use || powerOf(state.config, player.role)?.kind !== ability.kind) return `your role has no ${ability.kind} ability to use now`;
  return use(state, player, ability);
}

/**
 * After the vote (and any Bail choice window): the shakedown, or "a shakedown
 * fell through" when its target used Bail, then the result window, or after an
 * emergency (or with the pool empty) the next round. design §9.3, §9.6. `prior`
 * are this command's events so far.
 */
function afterVote(
  state: GameState,
  prior: readonly GameEvent[],
  meeting: { readonly meetingId: string; readonly kind: MeetingKind },
  shakedown: { readonly target: PlayerId; readonly useBail: boolean } | null,
  draw: Draw,
): GameEvent[] {
  const events: GameEvent[] = [];
  // design §9.6: Bail used, the stash stays closed and the Bail is spent (the fold of `shakedownCancelled`).
  if (shakedown?.useBail && (state.players[shakedown.target] as PlayerState).roleState.bail) {
    events.push({ type: "shakedownCancelled", visibility: PUBLIC, meetingId: meeting.meetingId, target: shakedown.target });
  } else if (shakedown) {
    // design §9.6: what the target holds above the share is set aside for the next split (§7.1); at or below it
    // they are clean and nothing happens. Coins spent on perks are gone and not taken.
    const { target } = shakedown;
    const taken = aboveShare(state, target);
    const clean = taken === 0;
    events.push({ type: "shakedownResolved", visibility: PUBLIC, meetingId: meeting.meetingId, target, stashRevealed: (state.players[target] as PlayerState).stash, taken, clean });
  }
  const now = [...prior, ...events].reduce(applyEvent, state);
  return [...events, ...(meeting.kind === "emergency" ? startRound(now, now.round + 1, draw) : afterResult(now, draw))];
}

/** The result window closed with no emergency called: the next round starts. design §9.3 */
export function closeResult(state: GameState, round: unknown, draw: Draw): Result {
  if (state.phase.kind !== "result") return "no result window is open";
  if (round !== state.phase.round) return `the round ${show(round)} result window is not open (round ${state.phase.round}'s is)`;
  if (state.pendingEmergency) return "an emergency meeting has been called; the next round starts when it closes";
  return startRound(state, state.round + 1, draw);
}
