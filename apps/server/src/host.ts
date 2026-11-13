// Host controls during the game (M2-13). design §15; docs/m2-plan.md M2-13
//
// - `POST /games/:id/pause` / `resume`: stops every deadline, `roundEarly`
//   included (scheduler.ts), until the host resumes; each
//   then moves on by its pause. Players can still plan, vote and chat.
// - `POST /games/:id/extend`: adds the preset's `extendMs` to the current
//   round's planning (and its early end), result window or vote window.
// - `POST /games/:id/end`: the host ends the game early (design §16): no winner,
//   no reveal. Idempotent.
// - `POST /games/:id/seats/:seat/stand-in` `{ personality? }`: a bot plays a
//   person's seat, offered once they missed `REPLACE_AFTER_MISSED_ROUNDS`
//   rounds in a row. `DELETE` the same hands the seat back (the host, or the
//   seat's own player). The engine never knows: the seat stays theirs.
//
// Host-only (403) on a running game (409 otherwise); a seat that isn't yours
// reads as not found (404). Each runs in the game's lock (live.hostAction), and
// the change reaches every socket as a fresh `control` and `timers`.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { PERSONALITIES, type PersonalityId } from "@skimjob/bots";
import { REPLACE_AFTER_MISSED_ROUNDS } from "@skimjob/content";
import { isOver, type GameState } from "@skimjob/engine";
import type { Sessions, User } from "./auth";
import type { Clock } from "./clock";
import type { Db } from "./db";
import type { Live } from "./live";
import { HttpError } from "./lobby";
import type { Scheduler } from "./scheduler";

/** The personality a stand-in bot plays with unless the host picks one. */
const DEFAULT_STAND_IN: PersonalityId = "opportunist";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refuse = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

interface GameRow {
  status: string;
  host_user_id: string;
  paused: boolean;
}
interface SeatRow {
  seat_no: number;
  player_id: string | null;
  user_id: string | null;
  stand_in: string | null;
}

export function hostRoutes(app: FastifyInstance, db: Db, s: Sessions, live: Live, scheduler: Scheduler, clock: Clock): void {
  /**
   * Runs `fn` in the game's lock once the user is checked: seated (else 404),
   * the host if `hostOnly` (else 403), and the game running (else 409).
   */
  const control = async <T>(
    req: FastifyRequest<{ Params: { id: string } }>,
    hostOnly: boolean,
    fn: (ctx: { game: GameRow; seats: SeatRow[]; user: User; state: GameState }) => Promise<T>,
  ): Promise<T> => {
    const user = (await s.user(req)) ?? refuse(401, "not signed in");
    const gameId = req.params.id;
    if (!UUID.test(gameId)) refuse(404, "game not found");
    const [seated] = await db.query<{ status: string }>(
      "select g.status from seats s join games g on g.id = s.game_id where s.game_id = $1 and s.user_id = $2",
      [gameId, user.id],
    );
    if (!seated) return refuse(404, "game not found");
    if (seated.status !== "running") refuse(409, "the game isn't running");
    return live.hostAction(gameId, async (state) => {
      const [game] = await db.query<GameRow>("select status, host_user_id, paused_at is not null as paused from games where id = $1", [gameId]);
      if (!game) return refuse(404, "game not found");
      if (hostOnly && game.host_user_id !== user.id) refuse(403, "only the host can do that");
      if (game.status !== "running" || isOver(state.phase)) refuse(409, "the game isn't running");
      const seats = await db.query<SeatRow>("select seat_no, player_id, user_id, stand_in from seats where game_id = $1 order by seat_no", [gameId]);
      return fn({ game, seats, user, state });
    });
  };

  const seatOf = (seats: readonly SeatRow[], raw: string) =>
    seats.find((x) => String(x.seat_no) === raw && x.user_id !== null && x.player_id !== null) ?? refuse(404, "no player in that seat");

  // End the game early: host-only, and ending twice is fine (the game just stays ended).
  app.post<{ Params: { id: string } }>("/games/:id/end", async (req) => {
    const user = (await s.user(req)) ?? refuse(401, "not signed in");
    const gameId = req.params.id;
    if (!UUID.test(gameId)) refuse(404, "game not found");
    const [game] = await db.query<{ host_user_id: string; status: string }>(
      "select g.host_user_id, g.status from games g join seats s on s.game_id = g.id where g.id = $1 and s.user_id = $2",
      [gameId, user.id],
    );
    if (!game) return refuse(404, "game not found");
    if (game.host_user_id !== user.id) refuse(403, "only the host can do that");
    if (game.status === "lobby") refuse(409, "the game isn't running");
    await live.abort(gameId);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/games/:id/pause", (req) =>
    control(req, true, async ({ game }) => {
      if (game.paused) refuse(409, "the game is already paused");
      await db.query("update games set paused_at = to_timestamp($2::float8 / 1000) where id = $1", [req.params.id, clock.now()]);
      return { ok: true };
    }),
  );

  app.post<{ Params: { id: string } }>("/games/:id/resume", (req) =>
    control(req, true, async ({ game }) => {
      if (!game.paused) refuse(409, "the game isn't paused");
      await db.query("update games set paused_at = null where id = $1", [req.params.id]);
      return { ok: true };
    }),
  );

  app.post<{ Params: { id: string } }>("/games/:id/extend", (req) =>
    control(req, true, async ({ state }) => {
      const ms = await scheduler.extend(req.params.id, state);
      if (ms === null) refuse(409, "nothing to extend right now");
      return { ok: true, extendedMs: ms };
    }),
  );

  app.post<{ Params: { id: string; seat: string } }>("/games/:id/seats/:seat/stand-in", (req) =>
    control(req, true, async ({ game, seats, state }) => {
      const seat = seatOf(seats, req.params.seat);
      if (seat.user_id === game.host_user_id) refuse(409, "the host's seat can't be handed to a bot");
      if (seat.stand_in !== null) refuse(409, "a bot is already playing that seat");
      const missed = state.players[seat.player_id!]?.consecutiveMissedMoves ?? 0;
      if (missed < REPLACE_AFTER_MISSED_ROUNDS) refuse(409, `a bot can take over after ${REPLACE_AFTER_MISSED_ROUNDS} missed rounds in a row`);
      const personality = (req.body as { personality?: unknown } | null)?.personality ?? DEFAULT_STAND_IN;
      if (typeof personality !== "string" || !Object.hasOwn(PERSONALITIES, personality)) {
        refuse(400, `personality must be one of ${Object.keys(PERSONALITIES).join(", ")}`);
      }
      // A fresh bot: it acts on the view as it is now (no `bot_seen` from an earlier stand-in).
      await db.query("update seats set stand_in = $3, bot_seen = null where game_id = $1 and seat_no = $2", [req.params.id, seat.seat_no, personality]);
      return { ok: true };
    }),
  );

  app.delete<{ Params: { id: string; seat: string } }>("/games/:id/seats/:seat/stand-in", (req) =>
    control(req, false, async ({ game, seats, user }) => {
      const seat = seatOf(seats, req.params.seat);
      if (game.host_user_id !== user.id && seat.user_id !== user.id) refuse(403, "only the host or that player can do that");
      if (seat.stand_in === null) refuse(409, "no bot is playing that seat");
      await db.query("update seats set stand_in = null, bot_seen = null where game_id = $1 and seat_no = $2", [req.params.id, seat.seat_no]);
      return { ok: true };
    }),
  );
}
