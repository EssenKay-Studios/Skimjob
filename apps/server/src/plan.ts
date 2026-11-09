// The plan board's live channel (design §10, S3b.4). Like chat it is
// server-side only: entries live in `plan_entries` and go out over the game
// socket (live.ts); only the per-round snapshot enters the engine log, with the
// round's deadline (`snapshot`, live.ts), as a public said event.
// - Two things on the board (design §10), kept apart: the proposed plan
//   (`placed`: any seat may put any crew avatar, bots too, on a room) and each
//   seat's own claims (`room`, `power`, `agreed`: only that seat sets them).
//   The actor is always the socket's seat, never a field of the message.
// - One board per round (the latest round started). It takes edits from the
//   round's start until it resolves, in the planning phase (a host pause keeps
//   it open) and no later than the round's deadline (`round:<n>`); after that it
//   stays as it was, until the next round starts it empty. There is no meeting
//   during planning (design §4, §9.3), so a meeting closes it.
// - Every effective edit is also recorded in `plan_edits`, compactly: one row per
//   actor, kind and subject (the latest), with the time and the time left to
//   the round's deadline, so it is bounded (players × (players + 3) a round).
//   Server-only: it goes into the round's snapshot; clients never get it live.
// - A claim is not a commitment and can be a bluff, so it is checked only
//   against content (the engine's `checkPowerClaim`): a room in play, a role
//   with a claimable power, a target of the kind that power takes. Nothing
//   here is private: every seat sees the whole board, and non-players have no socket.
import type { RoomId } from "@skimjob/content";
import { checkPowerClaim, type GameState, type PlanEditRecord as SnapshotEdit, type PlanEntry, type PlanSnapshot, type PlayerId, type PowerClaim } from "@skimjob/engine";
import type { Clock } from "./clock";
import type { Db } from "./db";
import { rateLimiter } from "./notes";
import { PLAN_RATE } from "./settings";

export interface PlanBoard {
  /** The round it belongs to. */
  readonly round: number;
  /** In seat order. */
  readonly entries: readonly PlanEntry[];
}

/** What a client asked: `{ plan: { place?, room?, power?, agree? } }`. A field left out stays as it is; null clears. */
export interface PlanEdit {
  /** Put `player`'s avatar (anyone's) on `room` on the proposed plan, or take it off with null. */
  readonly place?: { readonly player: PlayerId; readonly room: RoomId | null };
  readonly room?: RoomId | null;
  readonly power?: PowerClaim | null;
  readonly agree?: boolean;
}

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * The `plan` field of a client message checked against this game, or why not.
 * Unknown fields (a forged `player`) are refused.
 */
export function parsePlanEdit(plan: unknown, state: GameState, me: PlayerId): Result<PlanEdit> {
  if (!isObject(plan)) return { ok: false, reason: "expected { plan: { place?, room?, power?, agree? } }" };
  for (const k of Object.keys(plan)) if (k !== "place" && k !== "room" && k !== "power" && k !== "agree") return { ok: false, reason: `unknown plan field ${JSON.stringify(k)}` };
  if (Object.keys(plan).length === 0) return { ok: false, reason: "nothing to change" };
  const edit: { place?: { player: PlayerId; room: RoomId | null }; room?: RoomId | null; power?: PowerClaim | null; agree?: boolean } = {};
  if (Object.hasOwn(plan, "place")) {
    const place = checkPlace(plan.place, state);
    if (!place.ok) return place;
    edit.place = place.value;
  }
  if (Object.hasOwn(plan, "room")) {
    const { room } = plan;
    if (room !== null && (typeof room !== "string" || !state.rooms.includes(room))) return { ok: false, reason: "no such room" };
    edit.room = room;
  }
  if (Object.hasOwn(plan, "power")) {
    const power = checkPower(plan.power, state, me);
    if (!power.ok) return power;
    edit.power = power.value;
  }
  if (Object.hasOwn(plan, "agree")) {
    if (typeof plan.agree !== "boolean") return { ok: false, reason: "agree must be true or false" };
    edit.agree = plan.agree;
  }
  return { ok: true, value: edit };
}

function checkPlace(input: unknown, state: GameState): Result<{ player: PlayerId; room: RoomId | null }> {
  if (!isObject(input)) return { ok: false, reason: "place must be { player, room }" };
  for (const k of Object.keys(input)) if (k !== "player" && k !== "room") return { ok: false, reason: `unknown place field ${JSON.stringify(k)}` };
  const { player, room } = input;
  if (typeof player !== "string" || !state.config.players.some((p) => p.id === player)) return { ok: false, reason: "no such player" };
  if (!Object.hasOwn(input, "room") || (room !== null && (typeof room !== "string" || !state.rooms.includes(room)))) return { ok: false, reason: "no such room" };
  return { ok: true, value: { player, room: room as RoomId | null } };
}

function checkPower(input: unknown, state: GameState, me: PlayerId): Result<PowerClaim | null> {
  if (input === null) return { ok: true, value: null };
  if (!isObject(input)) return { ok: false, reason: "power must be { role, target } or null" };
  for (const k of Object.keys(input)) if (k !== "role" && k !== "target") return { ok: false, reason: `unknown power field ${JSON.stringify(k)}` };
  const claim = checkPowerClaim(state, me, input);
  return typeof claim === "string" ? { ok: false, reason: claim } : { ok: true, value: claim };
}

interface Row {
  player_id: string;
  placed: string | null;
  room: string | null;
  power_role: string | null;
  power_target: string | null;
  agreed: boolean;
}
const COLUMNS = "player_id, placed, room, power_role, power_target, agreed";
const toEntry = (r: Row): PlanEntry => ({
  player: r.player_id,
  placed: r.placed,
  room: r.room,
  power: r.power_role === null ? null : { role: r.power_role, target: r.power_target! },
  agreed: r.agreed,
});
const sameClaim = (a: PowerClaim | null, b: PowerClaim | null) => a?.role === b?.role && a?.target === b?.target;

/**
 * One recorded edit (the latest of its actor, kind and subject), as the
 * snapshot keeps it, plus the time the server took it. `msBeforeDeadline` is
 * measured to the pause in a paused round.
 */
export interface PlanEditRecord extends SnapshotEdit {
  /** ISO time the server took it. */
  readonly at: string;
}

export interface Plan {
  /** Checks, rate-limits and stores `actor`'s edit. The caller delivers the board. */
  edit(gameId: string, state: GameState, actor: PlayerId, edit: PlanEdit): Promise<Result<void>>;
  /** The board for the latest round started. */
  board(gameId: string, state: GameState): Promise<PlanBoard>;
  /** The compact edit history of `round`, oldest first: most time left before the deadline first (edits with none first), so a retried deadline logs the same order. */
  history(gameId: string, round: number): Promise<readonly PlanEditRecord[]>;
  /** design §10: the board of the round being planned as it resolves (its final plan and edit history), for the round's deadline. */
  snapshot(gameId: string, state: GameState): Promise<PlanSnapshot>;
}

export function createPlan(db: Db, clock: Clock): Plan {
  const rate = rateLimiter(clock, PLAN_RATE);
  const board: Plan["board"] = async (gameId, state) => {
    const rows = await db.query<Row>(
      `select ${COLUMNS} from plan_entries where game_id = $1 and round = $2 and (placed is not null or room is not null or power_role is not null or agreed)`,
      [gameId, state.round],
    );
    const bySeat = new Map(rows.map((r) => [r.player_id, r] as const));
    return { round: state.round, entries: state.playerOrder.flatMap((p) => (bySeat.has(p) ? [toEntry(bySeat.get(p)!)] : [])) };
  };
  const history: Plan["history"] = async (gameId, round) => {
    const rows = await db.query<{ actor: string; kind: PlanEditRecord["kind"]; subject: string; value: string | null; target: string | null; at: Date | string; ms: number | string | null }>(
      "select actor, kind, subject, value, target, at, ms_before_deadline as ms from plan_edits where game_id = $1 and round = $2 order by ms_before_deadline desc nulls first, kind, subject, actor",
      [gameId, round],
    );
    return rows.map((r) => ({ actor: r.actor, kind: r.kind, subject: r.subject, value: r.value, target: r.target, at: new Date(r.at).toISOString(), msBeforeDeadline: r.ms === null ? null : Number(r.ms) }));
  };
  return {
    board,
    async edit(gameId, state, actor, edit) {
      // design §10: open from the round's start until it resolves, the span of its `round:<n>` deadline.
      if (state.phase.kind !== "planning" || state.round <= state.resolvedRound) return { ok: false, reason: "the plan board is closed until the next round" };
      // ...but not once its time is up, even in the scheduler's gap before the tick: time left is measured to `paused_at` while
      // paused, so a pause can't reopen an expired round.
      const now = clock.now();
      const [left] = await db.query<{ ms: number | null }>(
        `select (extract(epoch from (due_at - coalesce(paused_at, to_timestamp($3::float8 / 1000)))) * 1000)::float8 as ms from deadlines where game_id = $1 and key = $2`,
        [gameId, `round:${state.round}`, now],
      );
      const ms = left?.ms == null ? null : Math.round(Number(left.ms));
      if (ms !== null && ms <= 0) return { ok: false, reason: "the plan board is closed: the round's time is up" };
      if (!rate.allow(`${gameId}\0${actor}`)) return { ok: false, reason: "slow down: too many plan changes" };
      const round = state.round;
      const entries = new Map<PlayerId, PlanEntry>();
      const read = async (player: PlayerId): Promise<PlanEntry> => {
        const known = entries.get(player);
        if (known) return known;
        const [row] = await db.query<Row>(`select ${COLUMNS} from plan_entries where game_id = $1 and round = $2 and player_id = $3`, [gameId, round, player]);
        const entry = row ? toEntry(row) : { player, placed: null, room: null, power: null, agreed: false };
        entries.set(player, entry);
        return entry;
      };
      const changes: Pick<PlanEditRecord, "kind" | "subject" | "value" | "target">[] = [];
      const set = async (player: PlayerId, change: Partial<PlanEntry>, record: Pick<PlanEditRecord, "kind" | "value" | "target">) => {
        entries.set(player, { ...(await read(player)), ...change });
        changes.push({ subject: player, ...record });
      };
      if (edit.place) {
        const { player, room } = edit.place;
        if ((await read(player)).placed !== room) await set(player, { placed: room }, { kind: "place", value: room, target: null });
      }
      const mine = await read(actor);
      if (edit.room !== undefined && mine.room !== edit.room) await set(actor, { room: edit.room }, { kind: "room", value: edit.room, target: null });
      if (edit.power !== undefined && !sameClaim((await read(actor)).power, edit.power)) {
        await set(actor, { power: edit.power }, { kind: "power", value: edit.power?.role ?? null, target: edit.power?.target ?? null });
      }
      if (edit.agree !== undefined && (await read(actor)).agreed !== edit.agree) await set(actor, { agreed: edit.agree }, { kind: "agree", value: String(edit.agree), target: null });
      if (changes.length === 0) return { ok: true, value: undefined };

      for (const e of entries.values()) {
        await db.query(
          `insert into plan_entries (game_id, round, player_id, placed, room, power_role, power_target, agreed) values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (game_id, round, player_id) do update set placed = excluded.placed, room = excluded.room, power_role = excluded.power_role, power_target = excluded.power_target, agreed = excluded.agreed`,
          [gameId, round, e.player, e.placed, e.room, e.power?.role ?? null, e.power?.target ?? null, e.agreed],
        );
      }
      for (const c of changes) {
        await db.query(
          `insert into plan_edits (game_id, round, actor, kind, subject, value, target, at, ms_before_deadline) values ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8::float8 / 1000), $9)
           on conflict (game_id, round, actor, kind, subject) do update set value = excluded.value, target = excluded.target, at = excluded.at, ms_before_deadline = excluded.ms_before_deadline`,
          [gameId, round, actor, c.kind, c.subject, c.value, c.target, now, ms],
        );
      }
      return { ok: true, value: undefined };
    },
    history,
    async snapshot(gameId, state) {
      const edits = await history(gameId, state.round);
      // The log keeps no wall time (design §19.1): how long before the deadline says when.
      return { entries: (await board(gameId, state)).entries, history: edits.map(({ at: _at, ...edit }) => edit) };
    },
  };
}
