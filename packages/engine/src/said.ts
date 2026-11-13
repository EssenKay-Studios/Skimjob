// What players say: one public "said" event for every statement (design §19.2
// seam 5): role claims (§11.3) and alibis (§10), and each player's secret trust marks on alibis (§10). Talk changes no rule; it is put on the ledger so it is
// structured and lasting (the case board, the reveal, and bots, which don't
// read chat). Any role in the content may be claimed, whether or not it can be
// in this game: refusing a role outside the game's pool would tell players what
// the (hidden) pool holds.
import type { AlibiMark, GameEvent, GameState, PlayerId, Statement } from "./types";
import { PUBLIC, secretTo } from "./types";
import { playerFor, show } from "./check";
import { rolesFor } from "./overrides";

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
