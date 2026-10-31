// Crew meetings and votes: scheduling the act's regular meeting, emergency
// meetings, ballots, the tally, shakedowns, and the checkpoint after the act's
// meeting. design §11 (and §4, §3 for the final meeting before the final check)
//
// Every function is pure: it reads state and returns events, or the reason the
// command is refused. `handleCommand` (handle.ts) folds the events. Nothing
// here draws randomness: meeting and proposal ids are names and log positions.
import { ROUNDS_PER_ACT } from "@skimjob/content";
import type {
  ActNumber,
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
import { checkpointTarget, clampHeat, jobById } from "./job";
import { actOfRound } from "./round";
import { isObject, playerFor } from "./check";

type Result = GameEvent[] | string;
type Raw = Record<string, unknown>;

/** The act's regular meeting. Ids are names, never RNG draws (STATUS.md). */
export const regularMeetingId = (act: ActNumber): string => `act-${act}`;
/** Unique because each player calls at most one emergency meeting per game. design §11.1 */
export const emergencyMeetingId = (player: PlayerId): string => `emergency-${player}`;

/** The act being played: the act of the latest round started. */
const currentAct = (state: GameState): ActNumber => actOfRound(state.round);

/** The current act's regular meeting slot is locked in (scheduled, or already open). */
const slotLocked = (state: GameState): boolean => state.scheduledMeeting !== null || state.meeting?.kind === "regular";

const lockedReason = (state: GameState): string => `the act ${currentAct(state)} meeting is already scheduled`;

function checkSlot(slot: unknown): string | null {
  return typeof slot === "string" && slot !== "" ? null : "slot must be a non-empty string";
}

function scheduled(act: ActNumber, slot: string, proposalId: string | null): GameEvent {
  return { type: "meetingScheduled", visibility: PUBLIC, meetingId: regularMeetingId(act), act, slot, proposalId };
}

/** design §11.2: votes are public in "open" mode, private to the voter while hidden, secret for good in "secret" mode. */
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

/** A ballot: skip, or shake down another player in the crew (not yourself, provisional). design §11.2 */
function checkVote(state: GameState, voter: PlayerState, raw: unknown): VoteChoice | string {
  if (!isObject(raw)) return "vote must be an object";
  if (raw.kind === "skip") return { kind: "skip" };
  if (raw.kind !== "shakedown") return "vote must be a shakedown or a skip";
  const target = raw.target;
  if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${String(target)}`;
  if (target === voter.id) return "you can't vote to shake yourself down";
  return { kind: "shakedown", target };
}

// ---------------------------------------------------------------- scheduling (§11.1)

/** Any player proposes a slot for the current act's meeting; the proposer counts as accepting. */
export function proposeMeeting(state: GameState, command: Raw): Result {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  if (slotLocked(state)) return lockedReason(state);
  const bad = checkSlot(command.slot);
  if (bad) return bad;
  const slot = command.slot as string;
  const same = state.proposals.find((p) => p.slot === slot);
  if (same) return `that slot is already proposed (${same.id})`;
  // The id is the event's position in the log: unique and deterministic.
  const proposalId = `proposal-${state.log.length}`;
  return [{ type: "meetingProposed", visibility: PUBLIC, proposalId, by: player.id, act: currentAct(state), slot }];
}

/** Locked in once more than half the crew has accepted. */
export function acceptMeeting(state: GameState, command: Raw): Result {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  if (slotLocked(state)) return lockedReason(state);
  const proposal = state.proposals.find((p) => p.id === command.proposalId);
  if (!proposal) return `no open proposal ${String(command.proposalId)}`;
  if (proposal.acceptedBy.includes(player.id)) return "you already accepted this proposal";
  const events: GameEvent[] = [{ type: "meetingProposalAccepted", visibility: PUBLIC, proposalId: proposal.id, by: player.id }];
  if ((proposal.acceptedBy.length + 1) * 2 > state.playerOrder.length) events.push(scheduled(proposal.act, proposal.slot, proposal.id));
  return events;
}

/** System: nobody locked a slot in by the act deadline, so the server picks one. */
export function scheduleMeeting(state: GameState, command: Raw): Result {
  const act = currentAct(state);
  if (command.act !== act) return `act ${String(command.act)} is not being played (act ${act} is)`;
  if (slotLocked(state)) return lockedReason(state);
  const bad = checkSlot(command.slot);
  if (bad) return bad;
  return [scheduled(act, command.slot as string, null)];
}

/** One per player per game, at any point outside a meeting. The notice period is the server's. */
export function callEmergency(state: GameState, command: Raw): Result {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  if (player.emergencyMeetingUsed) return "you have already called your emergency meeting";
  if (state.meeting) return "a meeting is already open";
  if (state.pendingEmergency) return "an emergency meeting has already been called";
  return [{ type: "emergencyMeetingCalled", visibility: PUBLIC, by: player.id, meetingId: emergencyMeetingId(player.id) }];
}

// ---------------------------------------------------------------- voting (§11.2)

/** Left in advance for the next meeting that opens; replaces any earlier sealed vote. */
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
  return [{ type: "voteCast", visibility: ballotVisibility(state, player.id), meetingId: meeting.id, player: player.id, vote, sealed: false }];
}

// ---------------------------------------------------------------- deadlines (§4.1, §11)

/**
 * The slot (or the emergency's notice period) has arrived. The act's regular
 * meeting opens only once the act's last round has resolved (provisional);
 * an emergency opens whenever it's due. Sealed votes are cast as it opens.
 */
export function openMeeting(state: GameState, meetingId: unknown): Result {
  if (state.meeting) return `meeting ${state.meeting.id} is already open`;
  // Checked first: an absent id must not match an absent pending meeting.
  if (typeof meetingId !== "string") return `meeting ${String(meetingId)} is not waiting to open`;
  const act = currentAct(state);
  let kind: MeetingKind;
  if (state.scheduledMeeting?.meetingId === meetingId) {
    if (state.phase.kind !== "awaitingMeeting") return `the act ${act} meeting opens after round ${act * ROUNDS_PER_ACT} resolves`;
    kind = "regular";
  } else if (state.pendingEmergency?.meetingId === meetingId) {
    kind = "emergency";
  } else {
    return `meeting ${String(meetingId)} is not waiting to open`;
  }
  const events: GameEvent[] = [{ type: "meetingOpened", visibility: PUBLIC, meetingId, kind, act }];
  for (const player of state.playerOrder) {
    const vote = state.players[player]?.sealedVote;
    if (vote) events.push({ type: "voteCast", visibility: ballotVisibility(state, player), meetingId, player, vote, sealed: true });
  }
  return events;
}

/**
 * design §11.2: quorum is at least half the crew voting (sealed votes count);
 * a shakedown needs more than half of the votes cast. Every ballot weighs 1
 * until the Smooth talker lands.
 */
export function meetingResult(crewSize: number, cast: number, skip: number, targets: ReadonlyMap<PlayerId, number>): MeetingResult {
  if (cast * 2 < crewSize) return { kind: "noQuorum" };
  for (const [target, votes] of targets) if (votes * 2 > cast) return { kind: "shakedown", target };
  if (skip * 2 > cast) return { kind: "skipped" };
  return { kind: "noMajority" };
}

/**
 * The window has ended. design §11.4: meeting → shakedown → checkpoint. After
 * an emergency meeting the game goes back to where it was. After the act's
 * regular meeting comes the checkpoint (+Heat if missed), then the next act —
 * or, after Act 3, the final check and the end of the game (ranking: task 7).
 */
export function closeMeeting(state: GameState, meetingId: unknown): Result {
  const meeting = state.meeting;
  if (!meeting || meeting.id !== meetingId) return `meeting ${String(meetingId)} is not open`;
  const job = jobById(state.config.job);
  const crewSize = state.playerOrder.length;
  const { act } = meeting;

  // Tally in seat order, so the event is the same however the votes arrived.
  const ballots: [PlayerId, VoteChoice][] = [];
  for (const id of state.playerOrder) if (Object.hasOwn(meeting.votes, id)) ballots.push([id, meeting.votes[id] as VoteChoice]);
  let skip = 0;
  const counts = new Map<PlayerId, number>();
  for (const [, vote] of ballots) {
    if (vote.kind === "skip") skip++;
    else counts.set(vote.target, (counts.get(vote.target) ?? 0) + 1);
  }
  const targets = new Map(state.playerOrder.filter((id) => counts.has(id)).map((id) => [id, counts.get(id) as number]));
  const result = meetingResult(crewSize, ballots.length, skip, targets);
  const events: GameEvent[] = [
    {
      type: "meetingClosed",
      visibility: PUBLIC,
      meetingId: meeting.id,
      tally: { skip, targets: Object.fromEntries(targets) },
      // design §11.2: in "secret" mode only the tally is ever shown.
      ballots: state.config.voteVisibility === "secret" ? null : Object.fromEntries(ballots),
      result,
    },
  ];

  // design §11.3: the stash (never the Fence safe) goes into the Haul; a clean target is compensated.
  let haul = state.haul;
  if (result.kind === "shakedown") {
    const stash = (state.players[result.target] as PlayerState).stash;
    const clean = stash < job.shakedown.cleanBelowPerAct * act;
    // Paid out of the Haul, so never more than it holds (provisional).
    const compensation = clean ? Math.min(job.shakedown.compensationPerAct * act, haul + stash) : 0;
    haul += stash - compensation;
    events.push({ type: "shakedownResolved", visibility: PUBLIC, meetingId: meeting.id, target: result.target, stashRevealed: stash, taken: stash, clean, compensation });
  }
  if (meeting.kind === "emergency") return events;

  // design §11.4, §11.5: the checkpoint, after the shakedown. Missing Act 1 or 2 adds Heat (clamped once).
  const target = checkpointTarget(job, act, crewSize);
  const met = haul >= target;
  const final = act === job.checkpoints.perPlayer.length;
  const heat = met || final ? state.heat : clampHeat(job, state.heat + job.heat.missedCheckpoint);
  events.push({ type: "checkpointChecked", visibility: PUBLIC, act, target, haul, met, heatPenalty: heat - state.heat });

  // Ranking, role scoring and winners are task 7 (design §3, §13); until then the outcome carries none.
  if (heat >= job.heat.max) {
    events.push({ type: "copsRaided", visibility: PUBLIC, round: state.round, heat });
    events.push({ type: "gameEnded", visibility: PUBLIC, outcome: { result: "failed", reason: "heat", ranking: [], winners: [] } });
  } else if (final) {
    // design §3: the heist succeeds if the Haul meets the final target after the final meeting.
    const outcome = met
      ? ({ result: "success", ranking: [], winners: [] } as const)
      : ({ result: "failed", reason: "target", ranking: [], winners: [] } as const);
    events.push({ type: "gameEnded", visibility: PUBLIC, outcome });
  } else {
    events.push({ type: "roundStarted", visibility: PUBLIC, round: state.round + 1, act: actOfRound(state.round + 1) });
  }
  return events;
}
