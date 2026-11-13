// What players say: one public "said" event for every statement (design §19.2
// seam 5): the plan board's snapshot as a round resolves, role claims (§11.3) and
// alibis (§10), and each player's secret trust marks on alibis (§10). Talk changes no rule; it is put on the ledger so it is
// structured and lasting (the case board, the reveal, and bots, which don't
// read chat). Any role in the content may be claimed, whether or not it can be
// in this game: refusing a role outside the game's pool would tell players what
// the (hidden) pool holds.
import { POWER_CLAIM_TARGET } from "@skimjob/content";
import type { AlibiMark, GameEvent, GameState, PlanEditRecord, PlanEntry, PlayerId, PowerClaim, Statement } from "./types";
import { PUBLIC, secretTo } from "./types";
import { isObject, playerFor, show } from "./check";
import { rolesFor } from "./overrides";
import { applyEvent } from "./reduce";
import { afterResult } from "./meeting";
import type { Draw } from "./handle";

const said = (statement: Statement): GameEvent => ({ type: "said", visibility: PUBLIC, statement });

const statements = (state: GameState): Statement[] => state.log.flatMap((e) => (e.type === "said" ? [e.statement] : []));

/** design §11.3 Claims: once per player per stretch (between regular meetings, §9.1), any role id the game's content knows. */
export function claimRole(state: GameState, command: Record<string, unknown>): GameEvent[] | string {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const role = command.role;
  if (typeof role !== "string" || !Object.hasOwn(rolesFor(state.config), role)) return `unknown role ${show(role)}`;
  const { stretch } = state;
  if (statements(state).some((s) => s.kind === "role" && s.player === player.id && s.stretch === stretch)) return "you already claimed a role since the last meeting";
  return [said({ kind: "role", player: player.id, role, stretch })];
}

/**
 * design §10 Alibis: a room in play, posted in that round's alibi window (owner, 13 Nov); one per
 * player per round, never changed. No alibi for an older round, and none once the window closes.
 */
export function postAlibi(state: GameState, command: Record<string, unknown>): GameEvent[] | string {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const { round, room } = command;
  if (state.phase.kind !== "alibi" || round !== state.phase.round) return `the alibi window for round ${show(round)} is not open`;
  if (typeof room !== "string" || !state.rooms.includes(room)) return `room ${show(room)} is not open in this game`;
  if (statements(state).some((s) => s.kind === "alibi" && s.player === player.id && s.round === round)) return `you already posted an alibi for round ${round}`;
  return [said({ kind: "alibi", player: player.id, round, room })];
}

/**
 * design §4.1, §10: `round`'s alibi window closes. Everyone who played it and posted no alibi is
 * shown in their real room, as a fact; then the meeting the round called is awaited, else the
 * result window opens, or with the crew's pool empty the next round starts (§4.2 steps 9–10, §9.3).
 */
export function closeAlibi(state: GameState, round: unknown, draw: Draw): GameEvent[] | string {
  if (state.phase.kind !== "alibi" || round !== state.phase.round) return `the round ${show(round)} alibi window is not open`;
  const posted = new Set(statements(state).flatMap((s) => (s.kind === "alibi" && s.round === round ? [s.player] : [])));
  const real = new Map(state.log.flatMap((e) => (e.type === "coinsGrabbed" && e.round === round ? [[e.player, e.room] as const] : [])));
  // Seat order; a player who sat the round out (§3.3) was in no room, so has no fact.
  const noAlibi = state.playerOrder.flatMap((p) => (!posted.has(p) && real.has(p) ? [{ player: p, room: real.get(p) as string }] : []));
  const closed: GameEvent = { type: "alibiWindowClosed", visibility: PUBLIC, round, noAlibi };
  const settled = applyEvent(state, closed);
  return settled.meetingDue ? [closed] : [closed, ...afterResult(settled, draw)];
}

/** The marks `player` has made, by `round` and target (the latest of each). design §10 */
export function marksOf(log: readonly GameEvent[], player: PlayerId): Map<string, AlibiMark> {
  const marks = new Map<string, AlibiMark>();
  for (const e of log) {
    if (e.type !== "alibiMarked" || e.player !== player) continue;
    const key = `${e.round}/${e.target}`;
    if (e.mark === null) marks.delete(key);
    else marks.set(key, e.mark);
  }
  return marks;
}

/**
 * design §10 Trust marks: mark another player's alibi in a round whose card is out (its alibi window
 * has closed) Trusted or Liar, or clear the mark (null); changeable at any time, past rounds too.
 * Secret to the marker for good.
 */
export function markAlibi(state: GameState, command: Record<string, unknown>): GameEvent[] | string {
  const player = playerFor(state, command);
  if (typeof player === "string") return player;
  const { round, target, mark } = command;
  if (typeof round !== "number" || !Number.isInteger(round) || round < 1 || round > state.resolvedRound) return `round ${show(round)} has not been played`;
  if (state.phase.kind === "alibi" && state.phase.round === round) return `round ${round}'s card is not out yet`;
  if (!isSeat(state, target)) return `unknown player ${show(target)}`;
  if (target === player.id) return "you can't mark your own alibi";
  if (mark !== null && mark !== "trusted" && mark !== "liar") return "mark must be trusted, liar or null";
  if ((marksOf(state.log, player.id).get(`${round}/${target}`) ?? null) === mark) return "that is already your mark";
  return [{ type: "alibiMarked", visibility: secretTo(player.id), player: player.id, round, target, mark }];
}

const isSeat = (state: GameState, id: unknown): id is PlayerId => typeof id === "string" && Object.hasOwn(state.players, id);
const roomOrNull = (state: GameState, room: unknown): boolean => room === null || (typeof room === "string" && state.rooms.includes(room));

/**
 * design §10: a power claim names a role with a targeted power and, by that
 * power, a room in play or another player (any role: it may be a bluff). The
 * claim, or why not. The server checks each board edit with it too.
 */
export function checkPowerClaim(state: GameState, me: PlayerId, input: unknown): PowerClaim | string {
  if (!isObject(input)) return "power must be { role, target } or null";
  const { role, target } = input;
  const roles = rolesFor(state.config);
  if (typeof role !== "string" || !Object.hasOwn(roles, role)) return "no such role";
  const kind = roles[role]!.power.kind;
  const aims = Object.hasOwn(POWER_CLAIM_TARGET, kind) ? POWER_CLAIM_TARGET[kind] : undefined;
  if (!aims) return "that role's power can't be claimed";
  if (typeof target !== "string") return "target must be a room or a player";
  if (aims === "room") return state.rooms.includes(target) ? { role, target } : "that power takes a room in play";
  if (target === me) return "you can't claim a power on yourself";
  return isSeat(state, target) ? { role, target } : "that power takes a player in this game";
}

function checkEntry(state: GameState, e: unknown): PlanEntry | string {
  if (!isObject(e) || !isSeat(state, e.player)) return "a plan entry needs a player in this game";
  if (!roomOrNull(state, e.placed) || !roomOrNull(state, e.room)) return "a plan entry names a room not in play";
  if (typeof e.agreed !== "boolean") return "a plan entry's agreed must be true or false";
  const power = e.power === null ? null : checkPowerClaim(state, e.player, e.power);
  if (typeof power === "string") return power;
  return { player: e.player, placed: e.placed as PlanEntry["placed"], room: e.room as PlanEntry["room"], power, agreed: e.agreed };
}

/** What an edit of each kind may say: a room, a claimed role, or "true" / "false"; null clears it. */
function editValue(state: GameState, kind: unknown, value: unknown): boolean {
  if (value === null) return kind !== "agree";
  if (kind === "place" || kind === "room") return roomOrNull(state, value);
  if (kind === "power") return typeof value === "string" && Object.hasOwn(rolesFor(state.config), value);
  return kind === "agree" && (value === "true" || value === "false");
}

function checkEdit(state: GameState, e: unknown): PlanEditRecord | string {
  if (!isObject(e) || !isSeat(state, e.actor) || !isSeat(state, e.subject)) return "a plan edit needs an actor and a subject in this game";
  const { kind, value, target } = e;
  if (kind !== "place" && kind !== "room" && kind !== "power" && kind !== "agree") return `unknown plan edit kind ${show(kind)}`;
  if (kind !== "place" && e.subject !== e.actor) return "only a place edit moves someone else";
  if (!editValue(state, kind, value)) return `a ${kind} edit can't say ${show(value)}`;
  // A power claim's target, by its power (null when cleared); no other kind has one.
  const aimed = kind === "power" && value !== null ? checkPowerClaim(state, e.actor, { role: value, target }) : target === null ? null : "only a power edit has a target";
  if (typeof aimed === "string") return aimed;
  const ms = e.msBeforeDeadline;
  if (ms !== null && (typeof ms !== "number" || !Number.isFinite(ms))) return "a plan edit's msBeforeDeadline is a number or null";
  return { actor: e.actor, kind, subject: e.subject, value: value as string | null, target: target as string | null, msBeforeDeadline: ms };
}

/**
 * design §10: the plan board as `round` resolves, as one public said snapshot
 * (its final plan, pledges and edit history); none when nobody used the board.
 * The plan comes from the server's live board, so it is checked against the
 * game like any command, and only its known fields are kept, in seat order.
 */
export function planSaid(state: GameState, round: number, plan: unknown): GameEvent[] | string {
  if (plan === undefined) return [];
  if (!isObject(plan) || !Array.isArray(plan.entries) || !Array.isArray(plan.history)) return "a plan needs entries and history";
  const entries: PlanEntry[] = [];
  for (const raw of plan.entries as unknown[]) {
    const entry = checkEntry(state, raw);
    if (typeof entry === "string") return entry;
    if (entries.some((x) => x.player === entry.player)) return `player ${entry.player} is on the plan twice`;
    entries.push(entry);
  }
  const history: PlanEditRecord[] = [];
  for (const raw of plan.history as unknown[]) {
    const edit = checkEdit(state, raw);
    if (typeof edit === "string") return edit;
    history.push(edit);
  }
  if (entries.length === 0 && history.length === 0) return [];
  const seated = state.playerOrder.flatMap((p) => entries.filter((e) => e.player === p));
  return [said({ kind: "plan", round, plan: { entries: seated, history } })];
}
