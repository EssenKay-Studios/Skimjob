// The plan board's live channel (design §10, S3b.4). Like chat it is
// server-side only: entries live in `plan_entries` and go out over the game
// socket (live.ts); only the per-round snapshot will enter the engine log (S3a.9).
// - The author is always the socket's seat, never a field of the message, and
//   a seat edits only its own entry.
// - One board per round (the latest round started). It takes edits only while
//   the round is being planned; after that it stays as it was, until the next
//   round starts and the board begins empty.
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

/** What a client asked: `{ plan: { room?, power?, agree? } }`. A field left out stays as it is; null clears a claim. */
export interface PlanEdit {
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
  if (!isObject(plan)) return { ok: false, reason: "expected { plan: { room?, power?, agree? } }" };
  for (const k of Object.keys(plan)) if (k !== "room" && k !== "power" && k !== "agree") return { ok: false, reason: `unknown plan field ${JSON.stringify(k)}` };
  if (Object.keys(plan).length === 0) return { ok: false, reason: "nothing to change" };
  const edit: { room?: RoomId | null; power?: PowerClaim | null; agree?: boolean } = {};
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
  room: string | null;
  power_role: string | null;
  power_target: string | null;
  agreed: boolean;
}
const toEntry = (r: Row): PlanEntry => ({
  player: r.player_id,
  room: r.room,
  power: r.power_role === null ? null : { role: r.power_role, target: r.power_target! },
  agreed: r.agreed,
});

export interface Plan {
  /** Checks, rate-limits and stores `player`'s edit to their own entry. The caller delivers the board. */
  edit(gameId: string, state: GameState, player: PlayerId, edit: PlanEdit): Promise<Result<void>>;
  /** The board for the latest round started. */
  board(gameId: string, state: GameState): Promise<PlanBoard>;
}

export function createPlan(db: Db, clock: Clock): Plan {
  const rate = rateLimiter(clock, PLAN_RATE);
  const board: Plan["board"] = async (gameId, state) => {
    const rows = await db.query<Row>(
      "select player_id, room, power_role, power_target, agreed from plan_entries where game_id = $1 and round = $2 and (room is not null or power_role is not null or agreed)",
      [gameId, state.round],
    );
    const bySeat = new Map(rows.map((r) => [r.player_id, r] as const));
    return { round: state.round, entries: state.playerOrder.flatMap((p) => (bySeat.has(p) ? [toEntry(bySeat.get(p)!)] : [])) };
  };
  return {
    board,
    async edit(gameId, state, player, edit) {
      // design §10: open for the round being planned, then as it was left.
      if (state.phase.kind !== "planning") return { ok: false, reason: "the plan board is closed until the next round" };
      if (!rate.allow(`${gameId}\0${player}`)) return { ok: false, reason: "slow down: too many plan changes" };
      const [row] = await db.query<Row>("select player_id, room, power_role, power_target, agreed from plan_entries where game_id = $1 and round = $2 and player_id = $3", [
        gameId,
        state.round,
        player,
      ]);
      const now = row ? toEntry(row) : { player, room: null, power: null, agreed: false };
      const room = edit.room === undefined ? now.room : edit.room;
      const power = edit.power === undefined ? now.power : edit.power;
      const agreed = edit.agree ?? now.agreed;
      await db.query(
        `insert into plan_entries (game_id, round, player_id, room, power_role, power_target, agreed) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (game_id, round, player_id) do update set room = excluded.room, power_role = excluded.power_role, power_target = excluded.power_target, agreed = excluded.agreed`,
        [gameId, state.round, player, room, power?.role ?? null, power?.target ?? null, agreed],
      );
      return { ok: true, value: undefined };
    },
  };
}
