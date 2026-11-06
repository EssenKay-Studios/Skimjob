// Perks: buying them from the game's shop with tokens, spending them with
// `useAbility` (one small function per perk), and the Shield, which is spent
// by itself. design §8.3; extension.md "Tokens and the perk shop"
//
// Roles earn tokens (the private `tokenEarned`, crew.ts). `buyPerk` spends
// tokens on one of the three perks dealt at setup (private `perkBought`); the
// bought perk lives in `roleState.perks`. Every use is a private `perkUsed`
// (folded in reduce.ts), plus `alibiVerified` (public) for the Alibi and
// `rigPicked` for the Rig's choice. At most one perk use per round; refusals
// keep the perk. Unspent tokens are worth nothing at the end.
import { EVENT_DECK, PERKS, PERK_RULES, type PerkId } from "@skimjob/content";
import type { GameEvent, GameState, PlayerId, PlayerState, ResolvedPerk } from "./types";
import { PUBLIC, privateTo } from "./types";
import type { Draw } from "./handle";
import { cardRound } from "./deck";
import { perkCost, powerOf } from "./overrides";
import { isObject, playerFor, show } from "./check";

type Result = GameEvent[] | string;
type Raw = Record<string, unknown>;

/** How many `perk` tokens `player` holds. */
export const perkCount = (player: PlayerState, perk: PerkId): number => player.roleState.perks.filter((p) => p === perk).length;

const spent = (state: GameState, player: PlayerState, perk: ResolvedPerk): GameEvent => ({
  type: "perkUsed",
  visibility: privateTo(player.id),
  player: player.id,
  round: state.round,
  perk,
});

/** Why `target` isn't another player in the game, or null if it is. */
function notOther(state: GameState, player: PlayerState, target: unknown): string | null {
  if (typeof target !== "string" || !Object.hasOwn(state.players, target)) return `unknown player ${show(target)}`;
  return target === player.id ? "pick another player" : null;
}

/** Peek: learn one player's role (as it is now). */
function peek(state: GameState, player: PlayerState, raw: Raw): Result {
  const bad = notOther(state, player, raw.target);
  if (bad) return bad;
  const target = raw.target as PlayerId;
  return [spent(state, player, { kind: "peek", target, role: (state.players[target] as PlayerState).role })];
}

/** +Vote: your ballot in the open meeting weighs `PERK_RULES.extraVoteWeight` more (once per meeting). */
function extraVote(state: GameState, player: PlayerState): Result {
  const meeting = state.meeting;
  if (!meeting) return "a +Vote is spent while a meeting is open";
  if (meeting.extraVotes.includes(player.id)) return "you already spent a +Vote in this meeting";
  return [spent(state, player, { kind: "extraVote", meetingId: meeting.id })];
}

/**
 * Ballot: see one player's ballot in the open meeting, live, in your view
 * (`seenBallots`). Also in Secret mode: the one owner-approved exception to
 * secret ballots, seen by the holder only and never in an event. Pointless in
 * Open mode, where every ballot is public, so it is refused there.
 */
function ballot(state: GameState, player: PlayerState, raw: Raw): Result {
  const meeting = state.meeting;
  if (!meeting) return "a Ballot is spent while a meeting is open";
  if (state.config.voteVisibility === "open") return "ballots are already public in this game";
  const bad = notOther(state, player, raw.target);
  if (bad) return bad;
  const target = raw.target as PlayerId;
  if (Object.hasOwn(meeting.ballotGrants, player.id) && meeting.ballotGrants[player.id]?.includes(target)) return "you already see that player's ballot";
  return [spent(state, player, { kind: "ballot", meetingId: meeting.id, target })];
}

/** Tail: while planning, also see who is in one room when this round resolves (like the Lookout; a Power cut blinds it). */
function tail(state: GameState, player: PlayerState, raw: Raw): Result {
  if (state.phase.kind !== "planning") return "a Tail is spent while a round is being planned";
  if (player.roleState.tail !== null) return "you are already tailing a room this round";
  if (typeof raw.room !== "string" || !state.rooms.includes(raw.room)) return "tail a room in play";
  return [spent(state, player, { kind: "tail", room: raw.room })];
}

/**
 * Alibi: your alibi for the latest resolved round is stamped Verified, in
 * public. Only a true alibi can be stamped (the stamp shows your real room).
 */
function alibi(state: GameState, player: PlayerState): Result {
  const round = state.resolvedRound;
  if (round === 0) return "no round has resolved yet";
  if (state.alibisVerified.includes(player.id)) return `your alibi for round ${round} is already verified`;
  const posted = state.log.find((e) => e.type === "alibiPosted" && e.player === player.id && e.round === round);
  if (posted?.type !== "alibiPosted") return `post your alibi for round ${round} first`;
  const real = state.log.find((e) => e.type === "lootSplit" && e.player === player.id && e.round === round);
  if (real?.type !== "lootSplit" || real.room !== posted.room) return `your alibi for round ${round} isn't where you were`;
  return [
    spent(state, player, { kind: "alibi", round, room: real.room }),
    { type: "alibiVerified", visibility: PUBLIC, player: player.id, round, room: real.room },
  ];
}

/** Recharge: a use of your power since the last meeting, or a once-per-game use, comes back. */
function recharge(state: GameState, player: PlayerState): Result {
  const { usedThisAct, usedThisGame } = player.roleState;
  if (usedThisAct === 0 && usedThisGame === 0) return "your power has nothing to recharge";
  return [spent(state, player, { kind: "recharge" })];
}

/** The round whose card flips next, if it has one (events on, round 2 onwards, not past the last round). */
function nextCardRound(state: GameState): number | null {
  const next = state.round + 1;
  return cardRound(state.config, next) ? next : null;
}

/**
 * Rig: draw `PERK_RULES.rigOptions` different cards for the next round; the
 * first flips unless you pick another (`rigPick`). Someone else's Rig of the
 * same round never refuses yours (a refusal would tell you who holds what,
 * e.g. after a Double-cross; PR #25 review): if several players rig a round,
 * the oldest Rig's pick flips. One Rig of a round per player.
 */
function rig(state: GameState, player: PlayerState, draw: Draw): Result {
  const round = nextCardRound(state);
  if (round === null) return "there is no next event card to rig";
  if (state.rigs.some((r) => r.player === player.id && r.round === round)) return "you already rigged the next event card";
  const cards = draw.shuffle(EVENT_DECK).slice(0, PERK_RULES.rigOptions);
  return [spent(state, player, { kind: "rig", round, cards })];
}

/** Choose which of your Rig's cards flips next; changeable until that round starts. */
function rigPick(state: GameState, player: PlayerState, raw: Raw): Result {
  const rigged = state.rigs.find((r) => r.player === player.id && r.round === nextCardRound(state));
  if (!rigged) return "you have no rigged card to pick";
  if (typeof raw.card !== "string" || !rigged.cards.includes(raw.card)) return `pick one of ${rigged.cards.join(", ")}`;
  return [{ type: "rigPicked", visibility: privateTo(player.id), player: player.id, round: rigged.round, card: raw.card }];
}

type Spend = (state: GameState, player: PlayerState, raw: Raw, draw: Draw) => Result;

/** Perks the engine spends by itself (design §8.3): the Shield, and the Emergency when you call one more meeting. */
type AutoPerk = "shield" | "emergency";

const SPENDS: { readonly [K in Exclude<PerkId, AutoPerk>]: Spend } = {
  peek,
  extraVote: (state, player) => extraVote(state, player),
  ballot,
  tail,
  alibi: (state, player) => alibi(state, player),
  recharge: (state, player) => recharge(state, player),
  rig: (state, player, _raw, draw) => rig(state, player, draw),
};

/** Whether `kind` names a perk spend (or the Rig's pick) for `useAbility`. */
export const isPerkSpend = (kind: string): boolean => kind === "rigPick" || kind === "shield" || kind === "emergency" || Object.hasOwn(SPENDS, kind);

/**
 * `buyPerk`: spend tokens on one of this game's shop perks, any time
 * (several of a kind allowed). Private until the perk is used.
 * extension.md "Tokens and the perk shop"
 */
export function buyPerk(state: GameState, command: Raw): Result {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const perk = command.perk;
  if (typeof perk !== "string" || !state.shop.includes(perk as PerkId)) return `perk ${show(perk)} is not in this game's shop`;
  const cost = perkCost(state.config, perk as PerkId);
  if (player.roleState.tokens < cost) return `${PERKS[perk as PerkId].name} costs ${cost} tokens; you have ${player.roleState.tokens}`;
  return [{ type: "perkBought", visibility: privateTo(player.id), player: player.id, perk: perk as PerkId, cost }];
}

/** Whether `player` already used a perk by choice this round (the Shield and Emergency, spent by themselves, don't count). extension.md "Tokens and the perk shop" */
const usedPerkThisRound = (state: GameState, player: PlayerId): boolean =>
  state.log.some((e) => e.type === "perkUsed" && e.player === player && e.round === state.round && e.perk.kind !== "shield" && e.perk.kind !== "emergency");

/** `useAbility` with a perk: needs one of that kind (except the Rig's pick), and at most one use per round. design §8.3 */
export function usePerk(state: GameState, player: PlayerState, raw: unknown, draw: Draw): Result {
  if (!isObject(raw) || typeof raw.kind !== "string") return "ability must be an object with a kind";
  if (raw.kind === "rigPick") return rigPick(state, player, raw);
  if (raw.kind === "shield") return "a Shield is spent by itself when a shakedown of you passes";
  if (raw.kind === "emergency") return "an Emergency is spent by calling an emergency meeting";
  const spend = Object.hasOwn(SPENDS, raw.kind) ? SPENDS[raw.kind as Exclude<PerkId, AutoPerk>] : undefined;
  if (!spend) return `unknown perk ${raw.kind}`;
  if (perkCount(player, raw.kind as PerkId) === 0) return `you have no ${PERKS[raw.kind as PerkId].name} perk`;
  if (usedPerkThisRound(state, player.id)) return "you have already used a perk this round";
  return spend(state, player, raw, draw);
}

/** Emergency (Smooth Talker's reward): spent as `player` calls `meetingId` beyond their one per game. */
export const emergencySpent = (state: GameState, player: PlayerState, meetingId: string): GameEvent => spent(state, player, { kind: "emergency", meetingId });

/** Shield: whether a passed shakedown of `target` is cancelled by their Shield (spent by itself). */
export function shieldFor(state: GameState, target: PlayerId, meetingId: string): GameEvent[] {
  const player = state.players[target] as PlayerState;
  return perkCount(player, "shield") > 0 ? [spent(state, player, { kind: "shield", meetingId })] : [];
}
