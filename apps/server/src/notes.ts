// Per-seat notes the server keeps outside the engine log (M2-10):
//
// - "Last seen" (design §13, "while you were away"): the highest view `seq`
//   the seat has seen, in `seats.last_seen_seq` (-1: never). The client reads
//   it on return to build its recap from `eventsSince(view, lastSeen)`, and
//   moves it forward as the player looks. It only ever moves forward, and never
//   past the seat's own view (a view's seq counts only what that player can
//   see, so it says nothing about others' hidden events).
// - The suspicion board (design §12.3): the seat's own trusted / unsure /
//   suspicious tag and optional note on each other player. Only the seat that
//   wrote it can read it; it is never sent over the live channel, never in the
//   engine log and never in the end-of-game reveal.
//
// Routes (signed in, seated in a started game, else 401 / 404):
//   GET   /games/:id/notes        → { lastSeen, board }
//   PATCH /games/:id/notes/seen   { seq } → { lastSeen }
//   PATCH /games/:id/notes/board  { subject, tag, note } → { board }
//   PUT   /games/:id/notes/pins   { pins } → { pins }   (case board pins, design §15.4: lead and fact ids)
import type { FastifyInstance, FastifyRequest } from "fastify";
import { viewFor, type GameState, type PlayerId } from "@skimjob/engine";
import type { Sessions } from "./auth";
import { checkChatText } from "./chat";
import type { Db } from "./db";
import { HttpError, playerIdOf } from "./lobby";
import type { Clock } from "./clock";
import { BOARD_NOTE_MAX_CHARS, BOARD_RATE, PIN_ID_PATTERN, PINS_MAX, SEEN_RATE } from "./settings";
import type { GameStore } from "./store";

export const SUSPICION_TAGS = ["trusted", "unsure", "suspicious"] as const;
export type SuspicionTag = (typeof SUSPICION_TAGS)[number];

export interface BoardMark {
  readonly tag: SuspicionTag | null;
  readonly note: string;
}
export type Board = Readonly<Record<PlayerId, BoardMark>>;

export interface SeatNotes {
  /** The highest view seq this seat has seen; -1 if it never opened the game. */
  readonly lastSeen: number;
  readonly board: Board;
  /** Ids of the leads and facts this seat pinned (design §15.4). */
  readonly pins: readonly string[];
}

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

/** A board edit from the client, or why not. design §12.3 */
function parseBoardEdit(body: unknown, state: GameState, owner: PlayerId): Result<{ subject: PlayerId; mark: BoardMark }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, reason: "expected { subject, tag, note }" };
  const raw = body as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (k !== "subject" && k !== "tag" && k !== "note") return { ok: false, reason: `unknown field ${JSON.stringify(k)}` };
  const { subject } = raw;
  if (typeof subject !== "string" || !state.config.players.some((p) => p.id === subject)) return { ok: false, reason: "subject must be a player in this game" };
  if (subject === owner) return { ok: false, reason: "you can't tag yourself" };
  const tag = raw.tag ?? null;
  if (tag !== null && !(SUSPICION_TAGS as readonly unknown[]).includes(tag)) return { ok: false, reason: "tag must be trusted, unsure or suspicious" };
  const note = checkNote(raw.note ?? "");
  if (!note.ok) return note;
  return { ok: true, value: { subject, mark: { tag: tag as SuspicionTag | null, note: note.value } } };
}

/** A pin list from the client: at most PINS_MAX distinct ids, each PIN_ID_PATTERN. design §15.4 */
function parsePins(body: unknown): Result<string[]> {
  const raw = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!raw || Object.keys(raw).some((k) => k !== "pins") || !Array.isArray(raw.pins)) return { ok: false, reason: "expected { pins: [ids] }" };
  const pins = raw.pins as unknown[];
  if (pins.length > PINS_MAX) return { ok: false, reason: `at most ${PINS_MAX} pins` };
  if (!pins.every((p): p is string => typeof p === "string" && PIN_ID_PATTERN.test(p))) return { ok: false, reason: "pins must be lead or fact ids" };
  if (new Set(pins).size !== pins.length) return { ok: false, reason: "pins must be distinct" };
  return { ok: true, value: pins };
}

/** A note: may be empty; otherwise the chat's text rules, at most BOARD_NOTE_MAX_CHARS. */
function checkNote(input: unknown): Result<string> {
  if (typeof input !== "string") return { ok: false, reason: "note must be a string" };
  if (input.trim() === "") return { ok: true, value: "" };
  const text = checkChatText(input);
  if (!text.ok) return { ok: false, reason: text.reason.replace(/^message/, "note").replace(/messages are/, "notes are") };
  if ([...text.value].length > BOARD_NOTE_MAX_CHARS) return { ok: false, reason: `notes are at most ${BOARD_NOTE_MAX_CHARS} characters` };
  return text;
}

/** The highest seq in `player`'s view (-1 for an empty one). The ledger and case file share one gap-free seq. */
export const topSeq = (state: GameState, player: PlayerId): number => {
  const view = viewFor(state, player);
  return view.ledger.length + view.caseFile.length - 1;
};

/**
 * A per-key sliding-window limit (memory only): `allow(key)` is false once `limit.writes`
 * were allowed for that key within `limit.windowMs`. Keys with nothing in the window are swept.
 */
export function rateLimiter(clock: Clock, limit: { readonly writes: number; readonly windowMs: number }) {
  const recent = new Map<string, number[]>();
  let lastSweep = clock.now();
  return {
    allow(key: string): boolean {
      const now = clock.now();
      if (now - lastSweep >= limit.windowMs) {
        lastSweep = now;
        for (const [k, times] of recent) if (times.every((t) => t <= now - limit.windowMs)) recent.delete(k);
      }
      const times = (recent.get(key) ?? []).filter((t) => t > now - limit.windowMs);
      if (times.length >= limit.writes) return false;
      recent.set(key, [...times, now]);
      return true;
    },
    tracked: () => recent.size,
  };
}

export function notesRoutes(app: FastifyInstance, db: Db, store: GameStore, s: Sessions, clock: Clock): void {
  const boardRate = rateLimiter(clock, BOARD_RATE);
  const seenRate = rateLimiter(clock, SEEN_RATE);
  const pinRate = rateLimiter(clock, BOARD_RATE);
  /** The caller's seat in a started game, and its state; 401 / 404 otherwise. */
  const seat = async (req: FastifyRequest<{ Params: { id: string } }>): Promise<{ gameId: string; player: PlayerId; state: GameState }> => {
    const user = await s.user(req);
    if (!user) throw new HttpError(401, "not signed in");
    const gameId = req.params.id;
    const player = await playerIdOf(db, gameId, user.id);
    const state = player ? await store.load(gameId) : null;
    if (!player || !state) throw new HttpError(404, "game not found or not started");
    return { gameId, player, state };
  };

  const boardOf = async (gameId: string, player: PlayerId): Promise<Board> => {
    const rows = await db.query<{ subject: string; tag: SuspicionTag | null; note: string }>(
      "select subject, tag, note from suspicion_marks where game_id = $1 and player_id = $2 order by subject",
      [gameId, player],
    );
    return Object.fromEntries(rows.map((r) => [r.subject, { tag: r.tag, note: r.note }]));
  };
  const lastSeenOf = async (gameId: string, player: PlayerId): Promise<number> => {
    const [row] = await db.query<{ last_seen_seq: number }>("select last_seen_seq from seats where game_id = $1 and player_id = $2", [gameId, player]);
    return row?.last_seen_seq ?? -1;
  };

  const pinsOf = async (gameId: string, player: PlayerId): Promise<string[]> => {
    const [row] = await db.query<{ pins: string[] }>("select pins from seats where game_id = $1 and player_id = $2", [gameId, player]);
    return row?.pins ?? [];
  };

  app.get<{ Params: { id: string } }>("/games/:id/notes", async (req): Promise<SeatNotes> => {
    const { gameId, player } = await seat(req);
    return { lastSeen: await lastSeenOf(gameId, player), board: await boardOf(gameId, player), pins: await pinsOf(gameId, player) };
  });

  app.put<{ Params: { id: string } }>("/games/:id/notes/pins", async (req) => {
    const { gameId, player } = await seat(req);
    if (!pinRate.allow(`${gameId}\0${player}`)) throw new HttpError(429, "slow down: too many changes to your pins");
    const parsed = parsePins(req.body);
    if (!parsed.ok) throw new HttpError(400, parsed.reason);
    await db.query("update seats set pins = $3::jsonb where game_id = $1 and player_id = $2", [gameId, player, JSON.stringify(parsed.value)]);
    return { pins: parsed.value };
  });

  app.patch<{ Params: { id: string } }>("/games/:id/notes/seen", async (req) => {
    const { gameId, player, state } = await seat(req);
    if (!seenRate.allow(`${gameId}\0${player}`)) throw new HttpError(429, "slow down: too many updates");
    const seq = (req.body as { seq?: unknown } | null)?.seq;
    if (!Number.isSafeInteger(seq) || (seq as number) < -1) throw new HttpError(400, "seq must be a whole number");
    // Never past what this seat can see, and never backwards (two tabs may race).
    const capped = Math.min(seq as number, topSeq(state, player));
    const [row] = await db.query<{ last_seen_seq: number }>(
      "update seats set last_seen_seq = greatest(last_seen_seq, $3) where game_id = $1 and player_id = $2 returning last_seen_seq",
      [gameId, player, capped],
    );
    return { lastSeen: row?.last_seen_seq ?? capped };
  });

  app.patch<{ Params: { id: string } }>("/games/:id/notes/board", async (req) => {
    const { gameId, player, state } = await seat(req);
    if (!boardRate.allow(`${gameId}\0${player}`)) throw new HttpError(429, "slow down: too many changes to your board");
    const edit = parseBoardEdit(req.body, state, player);
    if (!edit.ok) throw new HttpError(400, edit.reason);
    const { subject, mark } = edit.value;
    if (mark.tag === null && mark.note === "") {
      await db.query("delete from suspicion_marks where game_id = $1 and player_id = $2 and subject = $3", [gameId, player, subject]);
    } else {
      await db.query(
        `insert into suspicion_marks (game_id, player_id, subject, tag, note) values ($1, $2, $3, $4, $5)
         on conflict (game_id, player_id, subject) do update set tag = excluded.tag, note = excluded.note, updated_at = now()`,
        [gameId, player, subject, mark.tag, mark.note],
      );
    }
    return { board: await boardOf(gameId, player) };
  });
}
