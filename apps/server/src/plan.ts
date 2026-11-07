// The plan board's live channel (design §10, S3b.4). Like chat it is
// server-side only: entries live in `plan_entries` and go out over the game
// socket (live.ts); only the per-round snapshot will enter the engine log (S3a.9).
// - Two things on the board (design §10), kept apart: the proposed plan
//   (`placed`: any seat may put any crew avatar, bots too, on a room) and each
//   seat's own claims (`room`, `power`, `agreed`: only that seat sets them).
//   The actor is always the socket's seat, never a field of the message.
// - One board per round (the latest round started). It takes edits from the
//   round's start until it resolves, which is exactly while the scheduler holds
//   that round's deadline (`round:<n>`; a meeting pausing it doesn't close the
//   board); after that it stays as it was, until the next round starts it empty.
// - Every effective edit is also recorded in `plan_edits`, compactly: one row per
//   actor, kind and subject (the latest), with the time and the time left to
//   the round's deadline, so it is bounded (players × (players + 3) a round).
//   Server-only: S3a.9 reads it for the round's snapshot; clients never get it.
// - A claim is not a commitment and can be a bluff, so it is checked only
//   against content: a room in play, a role with a claimable power, a target
//   of the kind that power takes. Nothing here is private: every seat sees the
//   whole board, and non-players have no socket.
import { POWER_CLAIM_TARGET, ROLES, type RoleId, type RoomId } from "@skimjob/content";
import type { GameState, PlayerId } from "@skimjob/engine";
import type { Clock } from "./clock";
import type { Db } from "./db";
import { rateLimiter } from "./notes";
import { PLAN_RATE } from "./settings";

/** "Hacker → Vault" or "Detective → Eli": `target` is a room or a player, by the role's power. */
export interface PowerClaim {
  readonly role: RoleId;
  readonly target: RoomId | PlayerId;
}

/** One seat's entry. Seats with nothing on the board are not listed. */
export interface PlanEntry {
  readonly player: PlayerId;
  /** Where the crew put this avatar on the proposed plan (anyone may move it); null: nowhere. */
  readonly placed: RoomId | null;
  /** The seat's own room claim (✋): only that seat sets it. */
  readonly room: RoomId | null;
  readonly power: PowerClaim | null;
  readonly agreed: boolean;
}

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
  const { role, target } = input;
  if (typeof role !== "string" || !Object.hasOwn(ROLES, role)) return { ok: false, reason: "no such role" };
  const kind = ROLES[role]!.power.kind;
  const aims = Object.hasOwn(POWER_CLAIM_TARGET, kind) ? POWER_CLAIM_TARGET[kind] : undefined;
  if (!aims) return { ok: false, reason: "that role's power can't be claimed" };
  if (typeof target !== "string") return { ok: false, reason: "target must be a room or a player" };
  if (aims === "room") return state.rooms.includes(target) ? { ok: true, value: { role, target } } : { ok: false, reason: "that power takes a room in play" };
  if (target === me) return { ok: false, reason: "you can't claim a power on yourself" };
  return state.config.players.some((p) => p.id === target) ? { ok: true, value: { role, target } } : { ok: false, reason: "that power takes a player in this game" };
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

/** One recorded edit (the latest of its actor, kind and subject). For the round's snapshot, S3a.9. */
export interface PlanEditRecord {
  readonly actor: PlayerId;
  /** "place" moves `subject`'s avatar; "room", "power" and "agree" are the actor's own claims (subject = actor). */
  readonly kind: "place" | "room" | "power" | "agree";
  readonly subject: PlayerId;
  /** The room, the claimed role, or "true" / "false" for agree; null: cleared. */
  readonly value: string | null;
  /** A power claim's target. */
  readonly target: string | null;
  /** ISO time the server took it. */
  readonly at: string;
  /** Ms left to the round's deadline when it was made (a paused round: when it paused); null if there was none. */
  readonly msBeforeDeadline: number | null;
}

export interface Plan {
  /** Checks, rate-limits and stores `actor`'s edit. The caller delivers the board. */
  edit(gameId: string, state: GameState, actor: PlayerId, edit: PlanEdit): Promise<Result<void>>;
  /** The board for the latest round started. */
  board(gameId: string, state: GameState): Promise<PlanBoard>;
  /** The compact edit history of `round`, oldest first. */
  history(gameId: string, round: number): Promise<readonly PlanEditRecord[]>;
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
  return {
    board,
    async edit(gameId, state, actor, edit) {
      // design §10: open from the round's start until it resolves, the span of its `round:<n>` deadline.
      if (state.phase.kind === "ended" || state.round <= state.resolvedRound) return { ok: false, reason: "the plan board is closed until the next round" };
      // ...but not past the deadline while the scheduler's tick is yet to come (unless the round is paused).
      const now = clock.now();
      const [left] = await db.query<{ ms: number | null; paused: boolean }>(
        `select (extract(epoch from (due_at - coalesce(paused_at, to_timestamp($3::float8 / 1000)))) * 1000)::float8 as ms, paused_at is not null as paused from deadlines where game_id = $1 and key = $2`,
        [gameId, `round:${state.round}`, now],
      );
      const ms = left?.ms == null ? null : Math.round(Number(left.ms));
      if (left && !left.paused && ms !== null && ms <= 0) return { ok: false, reason: "the plan board is closed: the round's time is up" };
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
    async history(gameId, round) {
      const rows = await db.query<{ actor: string; kind: PlanEditRecord["kind"]; subject: string; value: string | null; target: string | null; at: Date | string; ms: number | string | null }>(
        "select actor, kind, subject, value, target, at, ms_before_deadline as ms from plan_edits where game_id = $1 and round = $2 order by at, kind, subject, actor",
        [gameId, round],
      );
      return rows.map((r) => ({ actor: r.actor, kind: r.kind, subject: r.subject, value: r.value, target: r.target, at: new Date(r.at).toISOString(), msBeforeDeadline: r.ms === null ? null : Number(r.ms) }));
    },
  };
}
