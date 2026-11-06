// Crew meetings and votes: scheduling the act's regular meeting, emergency
// meetings, ballots, the tally, shakedowns, and the checkpoint after the act's
// meeting. design §11 (and §4, §3 for the final meeting before the final check)
//
// Every function is pure: it reads state and returns events, or the reason the
// command is refused. `handleCommand` (handle.ts) folds the events. Nothing
// here draws randomness except the next act's event card (deck.ts, design §10):
// meeting and proposal ids are names and log positions.
import { MAX_SLOT_LENGTH, PERK_RULES, ROUNDS_PER_ACT, type PerkId } from "@skimjob/content";
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
import { checkpointTarget, clampHeat } from "./job";
import { jobFor, powerOf } from "./overrides";
import { emergencySpent, isPerkSpend, perkCount, shieldFor, usePerk } from "./perks";
import { blessingEvents, checkpointRewards, dirtyShakedownRewards, holdsDirty, stopRaid, useCrewPower } from "./crew";
import { actOfRound } from "./acts";
import { gameEnded } from "./end";
import { applyEvent } from "./reduce";
import { isObject, playerFor, show } from "./check";
import type { Draw } from "./handle";
import { startRound } from "./deck";

type Result = GameEvent[] | string;
type Raw = Record<string, unknown>;

/** The act's regular meeting. Ids are names, never RNG draws (STATUS.md). */
const regularMeetingId = (act: ActNumber): string => `act-${act}`;
/**
 * The `n`th emergency meeting `player` calls (a Smooth Talker may earn more
 * than one, v2 §2). Unique: the prefix tells them apart for any player id. design §11.1
 */
const emergencyMeetingId = (player: PlayerId, n = 1): string => (n === 1 ? `emergency-${player}` : `emergency${n}-${player}`);

/** The act being played: the act of the latest round started. */
const currentAct = (state: GameState): ActNumber => actOfRound(state.round);

/** The current act's regular meeting slot is locked in (scheduled, already open, or its shakedown pending). */
const slotLocked = (state: GameState): boolean =>
  state.scheduledMeeting !== null || state.meeting?.kind === "regular" || state.pendingShakedown?.kind === "regular";

const lockedReason = (state: GameState): string => `the act ${currentAct(state)} meeting is already scheduled`;

/** A slot is free text the engine only stores and compares, so its length is capped (content). design §11.1, §17.2 */
function checkSlot(slot: unknown): string | null {
  if (typeof slot !== "string" || slot === "") return "slot must be a non-empty string";
  return slot.length > MAX_SLOT_LENGTH ? `slot must be at most ${MAX_SLOT_LENGTH} characters` : null;
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
  if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${show(target)}`;
  if (target === voter.id) return "you can't vote to shake yourself down";
  return { kind: "shakedown", target };
}

// ---------------------------------------------------------------- scheduling (§11.1)

/**
 * design §11.1 (owner decision, 2 Nov): a slot locks once more than half of
 * the crew's people (human seats) back it; bots' backing doesn't count. With
 * no people at all (simulator, all-bot tests) more than half the crew does.
 */
export function slotLocks(state: GameState, backers: readonly PlayerId[]): boolean {
  const humans = new Set(state.config.players.filter((seat) => !seat.isBot).map((seat) => seat.id));
  if (humans.size === 0) return backers.length * 2 > state.playerOrder.length;
  return backers.filter((id) => humans.has(id)).length * 2 > humans.size;
}

/** Any player proposes a slot for the current act's meeting; the proposer counts as accepting (and may lock it alone). */
export function proposeMeeting(state: GameState, command: Raw): Result {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  if (slotLocked(state)) return lockedReason(state);
  const bad = checkSlot(command.slot);
  if (bad) return bad;
  const slot = command.slot as string;
  const same = state.proposals.find((p) => p.slot === slot);
  if (same) return `that slot is already proposed (${same.id})`;
  // Numbered from public data only (earlier proposals this game), never the log length,
  // which would let players count hidden events. Unique and deterministic.
  const proposalId = `proposal-${state.log.filter((e) => e.type === "meetingProposed").length + 1}`;
  const act = currentAct(state);
  const events: GameEvent[] = [{ type: "meetingProposed", visibility: PUBLIC, proposalId, by: player.id, act, slot }];
  if (slotLocks(state, [player.id])) events.push(scheduled(act, slot, proposalId));
  return events;
}

/** Locked in once a majority of the people (or, with none, of the crew) has accepted (`slotLocks`). */
export function acceptMeeting(state: GameState, command: Raw): Result {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  if (slotLocked(state)) return lockedReason(state);
  const proposal = state.proposals.find((p) => p.id === command.proposalId);
  if (!proposal) return `no open proposal ${show(command.proposalId)}`;
  if (proposal.acceptedBy.includes(player.id)) return "you already accepted this proposal";
  const events: GameEvent[] = [{ type: "meetingProposalAccepted", visibility: PUBLIC, proposalId: proposal.id, by: player.id }];
  if (slotLocks(state, [...proposal.acceptedBy, player.id])) events.push(scheduled(proposal.act, proposal.slot, proposal.id));
  return events;
}

/** System: nobody locked a slot in by the act deadline, so the server picks one. */
export function scheduleMeeting(state: GameState, command: Raw): Result {
  const act = currentAct(state);
  if (command.act !== act) return `act ${show(command.act)} is not being played (act ${act} is)`;
  if (slotLocked(state)) return lockedReason(state);
  const bad = checkSlot(command.slot);
  if (bad) return bad;
  return [scheduled(act, command.slot as string, null)];
}

/**
 * One per player per game, at any point outside a meeting, plus one per
 * Emergency perk held (the Smooth Talker's reward, v2 §2). The notice period is the server's.
 */
export function callEmergency(state: GameState, command: Raw): Result {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const extra = player.emergencyMeetingUsed;
  if (extra && perkCount(player, "emergency") === 0) return "you have already called your emergency meeting";
  if (state.meeting) return "a meeting is already open";
  if (state.pendingShakedown) return "a shakedown is pending";
  if (state.pendingEmergency) return "an emergency meeting has already been called";
  const n = state.log.filter((e) => e.type === "emergencyMeetingCalled" && e.by === player.id).length + 1;
  const meetingId = emergencyMeetingId(player.id, n);
  const called: GameEvent = { type: "emergencyMeetingCalled", visibility: PUBLIC, by: player.id, meetingId };
  return extra ? [emergencySpent(state, player, meetingId), called] : [called];
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
  if (state.pendingShakedown) return `the shakedown of meeting ${state.pendingShakedown.meetingId} is pending`;
  // Checked first: an absent id must not match an absent pending meeting.
  if (typeof meetingId !== "string") return `meeting ${show(meetingId)} is not waiting to open`;
  const act = currentAct(state);
  let kind: MeetingKind;
  if (state.scheduledMeeting?.meetingId === meetingId) {
    if (state.phase.kind !== "awaitingMeeting") return `the act ${act} meeting opens after round ${act * ROUNDS_PER_ACT} and its alibi deadline`;
    kind = "regular";
  } else if (state.pendingEmergency?.meetingId === meetingId) {
    kind = "emergency";
  } else {
    return `meeting ${show(meetingId)} is not waiting to open`;
  }
  const events: GameEvent[] = [{ type: "meetingOpened", visibility: PUBLIC, meetingId, kind, act }];
  for (const player of state.playerOrder) {
    const vote = state.players[player]?.sealedVote;
    if (vote) events.push({ type: "voteCast", visibility: ballotVisibility(state, player), meetingId, player, vote, sealed: true });
  }
  return events;
}

/**
 * design §11.2 (extension.md "Voting", one rule for every crew size): quorum
 * is at least half the crew voting (sealed votes count), counting voters; a
 * shakedown needs more than half of the votes cast, counting weight (the
 * Smooth talker's ballot counts double, §8). `weight` is the total weight
 * cast, and `skip` / `targets` are weights too. Without a Smooth talker,
 * weight = voters.
 */
export function meetingResult(crewSize: number, voters: number, skip: number, targets: ReadonlyMap<PlayerId, number>, weight: number = voters): MeetingResult {
  if (voters * 2 < crewSize) return { kind: "noQuorum" };
  for (const [target, votes] of targets) if (votes * 2 > weight) return { kind: "shakedown", target };
  if (skip * 2 > weight) return { kind: "skipped" };
  return { kind: "noMajority" };
}

/**
 * How much a player's ballot counts: the Smooth talker's `weight`, else 1,
 * plus a +Vote spent in this meeting. design §8, §8.3
 */
function baseWeight(state: GameState, player: PlayerId): number {
  const p = state.players[player] as PlayerState;
  const power = powerOf(state.config, p.role);
  const extra = state.meeting?.extraVotes.includes(player) ? PERK_RULES.extraVoteWeight : 0;
  return (power.kind === "voteWeight" ? power.weight : 1) + extra;
}

/**
 * Whether a passed shakedown waits for a cancel window (extension.md Build
 * notes "Tokens and the shop"): when a Shield is in the shop. design §8.3
 */
export const opensShakedownWindow = (shop: readonly PerkId[]): boolean => shop.includes("shield");

/** The tally of the open meeting's ballots: the public counts, the result by weight, in seat order. */
function tally(state: GameState) {
  const meeting = state.meeting as NonNullable<GameState["meeting"]>;
  // Tally in seat order, so the event is the same however the votes arrived.
  // The public tally counts ballots; the result counts weight (Smooth talker, design §8).
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
 * The window has ended. design §11.4: meeting → shakedown → checkpoint. After
 * an emergency meeting the game goes back to where it was. After the act's
 * regular meeting comes the checkpoint (+Heat if missed), then the next act —
 * or, after Act 3, the final check and the end of the game (end.ts).
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
      // design §11.2: in "secret" mode only the tally is ever shown.
      ballots: state.config.voteVisibility === "secret" ? null : Object.fromEntries(ballots),
      result,
    },
  ];
  const { kind, act } = meeting;
  if (result.kind === "shakedown" && opensShakedownWindow(state.shop)) {
    // design §8.3: a Shield may cancel it before it's applied (`advance { resolveShakedown }`).
    events.push({ type: "shakedownPending", visibility: PUBLIC, meetingId: meeting.id, kind, act, target: result.target });
    return events;
  }
  const shakedown = result.kind === "shakedown" ? { target: result.target } : null;
  return [...events, ...afterVote(state, events, { meetingId: meeting.id, kind, act }, shakedown, draw)];
}

/** The shakedown window has ended: apply the shakedown (or the Shield's cancel), then go on. design §8.3, §11.3 */
export function resolveShakedown(state: GameState, meetingId: unknown, draw: Draw): Result {
  const pending = state.pendingShakedown;
  if (!pending || pending.meetingId !== meetingId) return `no shakedown is pending for meeting ${show(meetingId)}`;
  return afterVote(state, [], pending, pending, draw);
}

/** `useAbility`: a perk spent (perks.ts, design §8.3), or a power used outside a move (crew.ts). design §8 */
export function useAbility(state: GameState, command: Raw, draw: Draw): Result {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const ability = command.ability;
  if (!isObject(ability) || typeof ability.kind !== "string") return "ability must be an object with a kind";
  if (isPerkSpend(ability.kind)) return usePerk(state, player, ability, draw);
  const power = powerOf(state.config, player.role);
  return useCrewPower(state, player, power, ability) ?? `your role has no ${ability.kind} ability to use now`;
}

/**
 * After the vote (and any shakedown window): the shakedown or its cancel,
 * then for the act's regular meeting the checkpoint and what
 * follows (`checkpoint`). design §11.3, §11.4. `prior` are this command's
 * events so far.
 */
function afterVote(
  state: GameState,
  prior: readonly GameEvent[],
  meeting: { readonly meetingId: string; readonly kind: MeetingKind; readonly act: ActNumber },
  shakedown: { readonly target: PlayerId } | null,
  draw: Draw,
): GameEvent[] {
  const job = jobFor(state.config);
  const { act } = meeting;
  const events: GameEvent[] = [];

  // design §11.3: the stash goes into the Haul; a clean target is compensated.
  const haul = state.haul;
  // design §8.3: a Shield cancels it by itself.
  const shield = shakedown ? shieldFor(state, shakedown.target, meeting.meetingId) : [];
  if (shakedown && shield.length > 0) {
    events.push(...shield, { type: "shakedownCancelled", visibility: PUBLIC, meetingId: meeting.meetingId, target: shakedown.target });
  } else if (shakedown) {
    const { target } = shakedown;
    const { stash } = state.players[target] as PlayerState;
    // extension.md "Shakedowns (fixed numbers)": clean under 6, paid 8.
    const clean = !holdsDirty(state, target, job.shakedown.cleanBelow);
    // Paid out of the Haul, so never more than it holds (provisional).
    const compensation = clean ? Math.min(job.shakedown.payout, haul + stash) : 0;
    events.push({
      type: "shakedownResolved",
      visibility: PUBLIC,
      meetingId: meeting.meetingId,
      target,
      stashRevealed: stash,
      taken: stash,
      clean,
      compensation,
    });
    // The roles whose token a caught cheater earns (Lookout, Auditor, Detective, Smooth Talker). extension.md "Roles"
    if (!clean) events.push(...dirtyShakedownRewards(state, target, meeting.meetingId));
    // Priest (v2 §2): a blessed target shaken down clean is compensated by the bank.
    else events.push(...blessingEvents(state, meeting.meetingId, target, act, compensation));
  }
  if (meeting.kind === "emergency") return events;
  return [...events, ...checkpoint(state, [...prior, ...events], act, draw)];
}

/**
 * design §11.4, §11.5: the act's checkpoint, after its meeting, then the
 * next act or the end of the game.
 * `prior` (this command's events so far) is folded into `state` first, so the
 * Haul and Heat are as they stand now.
 */
function checkpoint(state: GameState, prior: readonly GameEvent[], act: ActNumber, draw: Draw): GameEvent[] {
  const now = prior.reduce(applyEvent, state);
  const job = jobFor(state.config);
  const events: GameEvent[] = [];
  // Missing Act 1 or 2 adds Heat (clamped once).
  const target = checkpointTarget(job, act, now.playerOrder.length);
  const met = now.haul >= target;
  const final = act === job.checkpoints.perPlayer.length;
  const heat = met || final ? now.heat : clampHeat(job, now.heat + job.heat.missedCheckpoint);
  events.push({ type: "checkpointChecked", visibility: PUBLIC, act, target, haul: now.haul, met, heatPenalty: heat - now.heat });
  // extension.md gap-fills: a target met at meeting 1 or 2 earns the Rookie a token.
  if (met && !final) events.push(...checkpointRewards(now));
  // v2 §2: a Fixer stops the penalty's raid.
  const saved = heat >= job.heat.max ? stopRaid(events.reduce(applyEvent, now), now.round) : [];
  events.push(...saved);

  // The ranking is worked out after the shakedown (design §3, §11.4), in end.ts.
  if (heat >= job.heat.max && saved.length === 0) {
    events.push({ type: "copsRaided", visibility: PUBLIC, round: now.round, heat });
    events.push(gameEnded(state, [...prior, ...events], "heat"));
  } else if (final) {
    // design §3: the heist succeeds if the Haul meets the final target after the final meeting.
    events.push(gameEnded(state, [...prior, ...events], met ? null : "target"));
  } else {
    events.push(...startRound(now, now.round + 1, draw));
  }
  return events;
}
