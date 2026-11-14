// Lobby API: create a game, invite by code, seats (people and bots), start.
// design §15 (setup), §16; docs/m2-plan.md M2-2
//
// Who you are always comes from the session cookie, never the request body.
// Lobby changes for one game run one at a time (store.withGameLock).
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { PERSONALITIES, type PersonalityId } from "@skimjob/bots";
import { LEARN_SEATS, MAX_PLAYERS, MIN_PLAYERS, type RulesetId } from "@skimjob/content";
import { validateConfig, type GameConfig } from "@skimjob/engine";
import { createGuestUser, type Sessions, type User } from "./auth";
import type { Db, Queryable } from "./db";
import type { GameStatus, GameStore } from "./store";
import { TIMINGS } from "./timing";
import { BOT_NAMES, checkNickname, DEFAULT_SETTINGS, isSettingKey, isBotName, botName, MY_GAMES_LIMIT, nicknameKey, parseSettings, storedSettings, type LobbySettings } from "./settings";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i
const CODE_LENGTH = 10;
export const DEFAULT_BOT: PersonalityId = "opportunist";

/** An invite code: 10 characters from an unambiguous alphabet (~49 bits). */
export function inviteCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Seat number n plays as `p<n+1>`: always a safe engine id (STATUS "Player ids"). The seat number also fixes the avatar colour. */
export const playerIdFor = (seatNo: number) => `p${seatNo + 1}`;

/**
 * The engine player a signed-in user plays as in a started game, or null.
 * The only source of `command.player` (M2-3): never take it from the client.
 */
export async function playerIdOf(db: Queryable, gameId: string, userId: string): Promise<string | null> {
  if (!UUID.test(gameId)) return null;
  const [row] = await db.query<{ player_id: string | null }>("select player_id from seats where game_id = $1 and user_id = $2", [gameId, userId]);
  return row?.player_id ?? null;
}

/** What a seated player sees of the lobby. No user ids, no config (it has the seed). */
export interface LobbyView {
  readonly id: string;
  readonly status: GameStatus;
  readonly inviteCode: string;
  readonly settings: LobbySettings;
  readonly youAreHost: boolean;
  /**
   * Meetings open as soon as they are due (the 15 min, 1 h and 3 h presets),
   * so the game screen offers no slot proposals. design §9.4, M2-7
   */
  readonly autoMeetings: boolean;
  /** Seats needed to start, and the most a game can have (bots included). */
  readonly minSeats: number;
  readonly maxSeats: number;
  /** Bot personalities the host can pick from (`POST /games/:id/bots`). */
  readonly personalities: readonly { readonly id: PersonalityId; readonly name: string }[];
  readonly seats: readonly {
    readonly seat: number;
    readonly nickname: string;
    /** The bot's personality; null for a person. */
    readonly bot: PersonalityId | null;
    readonly host: boolean;
    readonly you: boolean;
    /** Engine player id, once the game has started. */
    readonly playerId: string | null;
    /** The bot playing this person's seat for now (host controls, M2-13); null if none. */
    readonly standIn: PersonalityId | null;
  }[];
}

interface GameRow {
  id: string;
  status: GameStatus;
  host_user_id: string;
  invite_code: string;
  settings: LobbySettings;
}
interface SeatRow {
  seat_no: number;
  player_id: string | null;
  user_id: string | null;
  nickname: string;
  bot_personality: PersonalityId | null;
  stand_in: PersonalityId | null;
}

const gameById = async (db: Queryable, id: string) =>
  UUID.test(id)
    ? (await db.query<GameRow>("select id, status, host_user_id, invite_code, settings from games where id = $1", [id]))[0]
    : undefined;
const CODE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
/** Anything that can't be an invite code (wrong length, NUL, …) is simply unknown. */
const gameByCode = async (db: Queryable, raw: string) => {
  const code = raw.toLowerCase();
  if (!CODE.test(code)) return undefined;
  return (await db.query<GameRow>("select id, status, host_user_id, invite_code, settings from games where invite_code = $1", [code]))[0];
};
const seatsOf = (db: Queryable, id: string) =>
  db.query<SeatRow>("select seat_no, player_id, user_id, nickname, bot_personality, stand_in from seats where game_id = $1 order by seat_no", [id]);
/** The lowest seat number nobody holds: a leaver's seat (and avatar colour) is freed, nobody else's moves. */
const nextSeat = (seats: readonly SeatRow[]) => {
  const taken = new Set(seats.map((s) => s.seat_no));
  let n = 0;
  while (taken.has(n)) n++;
  return n;
};

const PERSONALITY_LIST = (Object.keys(PERSONALITIES) as PersonalityId[]).map((id) => ({ id, name: PERSONALITIES[id].name }));

function view(game: GameRow, seats: readonly SeatRow[], user: User): LobbyView {
  return {
    id: game.id,
    status: game.status,
    inviteCode: game.invite_code,
    // Games made before a setting existed get its default; settings no longer read are dropped.
    settings: storedSettings(game.settings),
    youAreHost: game.host_user_id === user.id,
    autoMeetings: (TIMINGS[game.settings.sessionLength] ?? TIMINGS[DEFAULT_SETTINGS.sessionLength]).autoMeetings,
    minSeats: MIN_PLAYERS,
    maxSeats: MAX_PLAYERS,
    personalities: PERSONALITY_LIST,
    seats: seats.map((s) => ({
      seat: s.seat_no,
      nickname: s.nickname,
      bot: s.bot_personality,
      host: s.user_id === game.host_user_id,
      you: s.user_id === user.id,
      playerId: s.player_id,
      standIn: s.stand_in,
    })),
  };
}

/** A refusal: the error handler (server.ts) sends `{ error: message }` with `status`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const refuse = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;

/**
 * `onStart` runs once a game has started, outside its lock (the live channel lets the bots move).
 * With `seedFromRequest` (never in production) the start request may name the game's seed, so an E2E game replays.
 */
export function lobbyRoutes(
  app: FastifyInstance,
  db: Db,
  store: GameStore,
  s: Sessions,
  onStart: (gameId: string) => Promise<void> = async () => {},
  gameSeed: () => string = () => randomBytes(16).toString("hex"),
  seedFromRequest = false,
): void {
  const signedIn = async (req: FastifyRequest) => (await s.user(req)) ?? refuse(401, "not signed in");

  /** Runs `fn` on a game the user is seated in, under the game's lock. Not seated reads as not found. */
  const inGame = async <T>(req: FastifyRequest<{ Params: { id: string } }>, fn: (game: GameRow, seats: SeatRow[], user: User) => Promise<T>) => {
    const user = await signedIn(req);
    return store.withGameLock(req.params.id, async () => {
      const game = await gameById(db, req.params.id);
      const seats = game ? await seatsOf(db, game.id) : [];
      if (!game || !seats.some((x) => x.user_id === user.id)) return refuse(404, "game not found");
      return fn(game, seats, user);
    });
  };

  /** Like inGame, for host-only lobby actions. */
  const asHost = <T>(req: FastifyRequest<{ Params: { id: string } }>, fn: (game: GameRow, seats: SeatRow[], user: User) => Promise<T>) =>
    inGame(req, async (game, seats, user) => {
      if (game.host_user_id !== user.id) refuse(403, "only the host can do that");
      if (game.status !== "lobby") refuse(409, "the game has already started");
      return fn(game, seats, user);
    });

  /** A new lobby hosted by the signed-in user, seated under the body's nickname (default: their account name). Never changes the session. */
  const openLobby = async (req: FastifyRequest, settings: LobbySettings) => {
    const user = await signedIn(req);
    const rawName = body(req).nickname;
    const checked = rawName === undefined ? null : checkNickname(rawName);
    if (checked && !checked.ok) return refuse(400, checked.error);
    const seatName = checked?.ok ? checked.name : user.name;
    let id: string | null = null;
    for (let tries = 0; id === null; tries++) {
      try {
        id = await store.create({ hostUserId: user.id, inviteCode: inviteCode(), settings: { ...settings } });
      } catch (err) {
        if (tries >= 2) throw err; // an invite-code clash twice running isn't bad luck
      }
    }
    await db.query("insert into seats (game_id, seat_no, user_id, nickname) values ($1, 0, $2, $3)", [id, user.id, seatName]);
    return { id, user };
  };

  /** Starts a lobby's game: seats in seat order, the host's settings, the given ruleset. Under the game's lock. */
  const startLobby = async (req: FastifyRequest, game: GameRow, seats: readonly SeatRow[], ruleset?: RulesetId) => {
    const asked = body(req).seed;
    const seed = seedFromRequest && typeof asked === "string" && asked !== "" ? asked : gameSeed();
    const config: GameConfig = { ...gameConfig(storedSettings(game.settings), seats, seed), ...(ruleset && { ruleset }) };
    const errors = validateConfig(config);
    if (errors.length > 0) throw new Error(`lobby made a bad config: ${errors.join("; ")}`);
    await store.start(game.id, config, async (tx) => {
      for (const seat of seats) {
        await tx.query("update seats set player_id = $3 where game_id = $1 and seat_no = $2", [game.id, seat.seat_no, playerIdFor(seat.seat_no)]);
      }
    });
  };

  app.post("/games", async (req, reply) => {
    const parsed = parseSettings(body(req).settings);
    if (!parsed.ok) return refuse(400, parsed.error);
    const { id, user } = await openLobby(req, parsed.settings);
    reply.code(201);
    return view((await gameById(db, id))!, await seatsOf(db, id), user);
  });

  // Learn the game (design §14): a single-player game under the Learn ruleset, started at once:
  // you plus a bot for every other seat, on the shortest session preset.
  app.post("/games/learn", async (req, reply) => {
    const { id, user } = await openLobby(req, { ...DEFAULT_SETTINGS, sessionLength: "15m" });
    await store.withGameLock(id, async () => {
      for (let seat = 1; seat < LEARN_SEATS; seat++) {
        await db.query("insert into seats (game_id, seat_no, nickname, bot_personality) values ($1, $2, $3, $4)", [id, seat, botName(BOT_NAMES[seat - 1]!), DEFAULT_BOT]);
      }
      await startLobby(req, (await gameById(db, id))!, await seatsOf(db, id), "learn");
    });
    await onStart(id).catch((err: unknown) => req.log.error({ err, gameId: id }, "settling bots after start failed"));
    reply.code(201);
    return view((await gameById(db, id))!, await seatsOf(db, id), user);
  });

  app.get<{ Params: { id: string } }>("/games/:id", (req) => inGame(req, async (game, seats, user) => view(game, seats, user)));

  // "My games" (m2-plan M2-12): every game the user has a seat in, live ones first, newest first.
  app.get("/me/games", async (req) => {
    const user = await signedIn(req);
    const rows = await db.query<{ id: string; status: GameRow["status"]; nickname: string; you_host: boolean; host: string | null; seats: number; session_length: string | null }>(
      `select g.id, g.status, s.nickname, g.host_user_id = $1 as you_host,
         (select h.nickname from seats h where h.game_id = g.id and h.user_id = g.host_user_id) as host,
         (select count(*) from seats x where x.game_id = g.id)::int as seats,
         g.settings->>'sessionLength' as session_length
       from seats s join games g on g.id = s.game_id
       where s.user_id = $1
       order by g.status = 'ended', g.updated_at desc, g.created_at desc
       limit ${MY_GAMES_LIMIT}`,
      [user.id],
    );
    return {
      games: rows.map((r) => ({
        id: r.id,
        status: r.status,
        nickname: r.nickname,
        youAreHost: r.you_host,
        host: r.host,
        seats: Number(r.seats),
        sessionLength: r.session_length ?? DEFAULT_SETTINGS.sessionLength,
      })),
    };
  });

  // Invite page preview: no sign-in needed, says only whose game it is and how full.
  app.get<{ Params: { code: string } }>("/invites/:code", async (req) => {
    const game = (await gameByCode(db, req.params.code)) ?? refuse(404, "unknown invite code");
    if (game.status !== "lobby") refuse(410, "this game has already started");
    const seats = await seatsOf(db, game.id);
    const host = seats.find((x) => x.user_id === game.host_user_id);
    return { host: host?.nickname ?? null, seats: seats.length, maxSeats: MAX_PLAYERS };
  });

  // Join by invite. Without a session this is the guest sign-in: the nickname makes a guest user.
  app.post<{ Params: { code: string } }>("/invites/:code/join", async (req, reply) => {
    const found = (await gameByCode(db, req.params.code)) ?? refuse(404, "unknown invite code");
    const rawName = body(req).nickname;
    const checked = rawName === undefined ? undefined : checkNickname(rawName);
    if (checked && !checked.ok) refuse(400, checked.error);
    const nickname = checked?.ok ? checked.name : undefined;
    const current = await s.user(req);
    if (!current && !nickname) refuse(400, "pick a nickname to join");
    return store.withGameLock(found.id, async () => {
      const game = (await gameById(db, found.id))!;
      const seats = await seatsOf(db, game.id);
      if (current && seats.some((x) => x.user_id === current.id)) return view(game, seats, current); // already in
      if (game.status !== "lobby") refuse(410, "this game has already started");
      if (seats.length >= MAX_PLAYERS) refuse(409, `the game is full (${MAX_PLAYERS} seats)`);
      const name = nickname ?? current!.name;
      if (isBotName(name)) refuse(400, "that nickname is reserved for bots");
      if (seats.some((x) => nicknameKey(x.nickname) === nicknameKey(name))) refuse(409, "that nickname is taken in this game; pick another");
      const user = current ?? (await createGuestUser(db, name));
      await db.query("insert into seats (game_id, seat_no, user_id, nickname) values ($1, $2, $3, $4)", [
        game.id,
        nextSeat(seats),
        user.id,
        name,
      ]);
      if (!current) await s.start(reply, user);
      return view(game, await seatsOf(db, game.id), user);
    });
  });

  app.post<{ Params: { id: string } }>("/games/:id/leave", (req) =>
    inGame(req, async (game, _seats, user) => {
      if (game.status !== "lobby") refuse(409, "the game has already started");
      if (game.host_user_id === user.id) refuse(409, "hand the host role to another player before you leave");
      await db.query("delete from seats where game_id = $1 and user_id = $2", [game.id, user.id]);
      return { ok: true };
    }),
  );

  // The host changes settings in the lobby: the body's fields replace the current ones.
  app.patch<{ Params: { id: string } }>("/games/:id/settings", (req) =>
    asHost(req, async (game, seats, user) => {
      const patch = body(req).settings;
      if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return refuse(400, "settings must be an object");
      for (const k of Object.keys(patch)) if (!isSettingKey(k)) refuse(400, `unknown setting ${JSON.stringify(k)}`);
      const parsed = parseSettings({ ...storedSettings(game.settings), ...patch });
      if (!parsed.ok) return refuse(400, parsed.error);
      await db.query("update games set settings = $2::jsonb where id = $1", [game.id, JSON.stringify(parsed.settings)]);
      return view({ ...game, settings: parsed.settings }, seats, user);
    }),
  );

  // Host hand-over (before the start): the host role moves to another person in the lobby, never a bot.
  app.post<{ Params: { id: string } }>("/games/:id/host", (req) =>
    asHost(req, async (game, seats, user) => {
      const seatNo = body(req).seat;
      const to = seats.find((x) => x.seat_no === seatNo) ?? refuse(404, "no player in that seat");
      if (to.user_id === null) refuse(409, "a bot can't be the host");
      if (to.user_id === user.id) refuse(409, "you're already the host");
      await db.query("update games set host_user_id = $2 where id = $1", [game.id, to.user_id]);
      return view({ ...game, host_user_id: to.user_id! }, seats, user);
    }),
  );

  app.post<{ Params: { id: string } }>("/games/:id/bots", (req, reply) =>
    asHost(req, async (game, seats, user) => {
      const personality = body(req).personality ?? DEFAULT_BOT;
      if (typeof personality !== "string" || !Object.hasOwn(PERSONALITIES, personality)) {
        refuse(400, `personality must be one of ${Object.keys(PERSONALITIES).join(", ")}`);
      }
      if (seats.length >= MAX_PLAYERS) refuse(409, `the game is full (${MAX_PLAYERS} seats)`);
      const taken = new Set(seats.map((x) => nicknameKey(x.nickname)));
      const name = [...BOT_NAMES, String(nextSeat(seats))].map(botName).find((n) => !taken.has(nicknameKey(n)))!;
      await db.query("insert into seats (game_id, seat_no, nickname, bot_personality) values ($1, $2, $3, $4)", [
        game.id,
        nextSeat(seats),
        name,
        personality,
      ]);
      reply.code(201);
      return view(game, await seatsOf(db, game.id), user);
    }),
  );

  app.delete<{ Params: { id: string; seat: string } }>("/games/:id/bots/:seat", (req) =>
    asHost(req, async (game, seats, user) => {
      const seat = seats.find((x) => String(x.seat_no) === req.params.seat && x.bot_personality !== null) ?? refuse(404, "no bot in that seat");
      await db.query("delete from seats where game_id = $1 and seat_no = $2", [game.id, seat.seat_no]);
      return view(game, await seatsOf(db, game.id), user);
    }),
  );

  // Kick (before the start, M2-13): the host removes anyone else's seat, a person or a bot. design §15
  app.delete<{ Params: { id: string; seat: string } }>("/games/:id/seats/:seat", (req) =>
    asHost(req, async (game, seats, user) => {
      const seat = seats.find((x) => String(x.seat_no) === req.params.seat) ?? refuse(404, "no player in that seat");
      if (seat.user_id === game.host_user_id) refuse(409, "the host can't remove their own seat");
      await db.query("delete from seats where game_id = $1 and seat_no = $2", [game.id, seat.seat_no]);
      return view(game, await seatsOf(db, game.id), user);
    }),
  );

  app.post<{ Params: { id: string } }>("/games/:id/start", async (req) => {
    const started = await asHost(req, async (game, seats, user) => {
      if (seats.length < MIN_PLAYERS) refuse(409, `a game needs at least ${MIN_PLAYERS} seats`);
      await startLobby(req, game, seats);
      return view((await gameById(db, game.id))!, await seatsOf(db, game.id), user);
    });
    // The game has started either way; the bots also act at the next change or boot.
    await onStart(started.id).catch((err: unknown) => req.log.error({ err, gameId: started.id }, "settling bots after start failed"));
    return started;
  });
}

/** The engine config for a lobby: seats in seat order, bank job, the host's role list, events and vote setting. design §16 */
export function gameConfig(settings: LobbySettings, seats: readonly Pick<SeatRow, "seat_no" | "nickname" | "bot_personality">[], seed: string): GameConfig {
  return {
    seed,
    players: seats.map((x) => ({ id: playerIdFor(x.seat_no), name: x.nickname, isBot: x.bot_personality !== null })),
    job: "bank",
    roleList: settings.roleList,
    eventsEnabled: settings.eventsEnabled,
    voteVisibility: settings.voteVisibility,
  };
}
