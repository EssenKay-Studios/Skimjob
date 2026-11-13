// GameStore: games and their event logs in the database. The log is the
// truth; the state is `replay(config, log)` (design §17.2 "event-sourced"),
// cached in memory for running games (one server process).
import { applyEvent, createGame, isOver, replay, type GameConfig, type GameEvent, type GameState } from "@skimjob/engine";
import type { Db, Queryable } from "./db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GameStatus = "lobby" | "running" | "ended";

export interface NewGame {
  readonly hostUserId: string;
  readonly inviteCode: string;
  /** Host's lobby settings (stored as given). */
  readonly settings?: Readonly<Record<string, unknown>>;
}

export interface GameStore {
  /** A new game in the lobby. Returns its id. */
  create(game: NewGame): Promise<string>;
  /**
   * Starts a lobby game: stores the config (with its seed) and the setup
   * events of `createGame(config)`, in one transaction (with `inTx`, if
   * given, e.g. writing the seats' player ids). Throws if the game isn't in
   * the lobby or the config is invalid.
   */
  start(gameId: string, config: GameConfig, inTx?: (tx: Queryable) => Promise<void>): Promise<GameState>;
  /**
   * Folds `events` onto the game and stores them, all or none, in one
   * transaction (the status follows the new state). Throws if the game hasn't
   * started, an event can't be folded, or another append got there first.
   */
  append(gameId: string, events: readonly GameEvent[]): Promise<GameState>;
  /** The game's current state; null if it is unknown or still in the lobby. */
  load(gameId: string): Promise<GameState | null>;
  /** Runs `fn` after every earlier `fn` for this game has settled (one command at a time). */
  withGameLock<T>(gameId: string, fn: () => Promise<T>): Promise<T>;
}

export function createGameStore(db: Db): GameStore {
  const cache = new Map<string, GameState>();
  const tails = new Map<string, Promise<unknown>>();

  // One insert for the whole batch; idx continues the log. The (game_id, idx)
  // key refuses a second writer at the same position. Events go in as json
  // text, so they come back byte for byte.
  const insertEvents = (tx: Queryable, gameId: string, from: number, events: readonly GameEvent[]) =>
    tx.query(
      `insert into game_events (game_id, idx, event)
       select $1, $2::int + t.ord::int - 1, t.e
       from json_array_elements($3::json) with ordinality as t(e, ord)`,
      [gameId, from, JSON.stringify(events)],
    );

  const store: GameStore = {
    async create({ hostUserId, inviteCode, settings = {} }) {
      const [row] = await db.query<{ id: string }>(
        "insert into games (host_user_id, invite_code, settings) values ($1, $2, $3::jsonb) returning id",
        [hostUserId, inviteCode, JSON.stringify(settings)],
      );
      if (!row) throw new Error("game not created");
      return row.id;
    },

    async start(gameId, config, inTx) {
      const state = createGame(config);
      await db.transaction(async (tx) => {
        const started = await tx.query(
          "update games set status = 'running', config = $2::json, updated_at = now() where id = $1 and status = 'lobby' returning id",
          [gameId, JSON.stringify(config)],
        );
        if (started.length === 0) throw new Error(`game ${gameId} is not in the lobby`);
        await insertEvents(tx, gameId, 0, state.log);
        await inTx?.(tx);
      });
      cache.set(gameId, state);
      return state;
    },

    async append(gameId, events) {
      const state = await store.load(gameId);
      if (!state) throw new Error(`game ${gameId} has not started`);
      if (events.length === 0) return state;
      const next = events.reduce(applyEvent, state);
      const status: GameStatus = isOver(next.phase) ? "ended" : "running";
      try {
        await db.transaction(async (tx) => {
          await insertEvents(tx, gameId, state.log.length, events);
          await tx.query("update games set status = $2, updated_at = now() where id = $1", [gameId, status]);
        });
      } catch (err) {
        cache.delete(gameId); // the log may have moved on without us: re-read it next time
        throw err;
      }
      cache.set(gameId, next);
      return next;
    },

    async load(gameId) {
      const cached = cache.get(gameId);
      if (cached) return cached;
      if (!UUID.test(gameId)) return null; // ids come from URLs: not an error, just not a game
      const [game] = await db.query<{ config: GameConfig | null }>("select config from games where id = $1", [gameId]);
      if (!game?.config) return null;
      const rows = await db.query<{ event: GameEvent }>("select event from game_events where game_id = $1 order by idx", [gameId]);
      const state = replay(game.config, rows.map((r) => r.event));
      cache.set(gameId, state);
      return state;
    },

    withGameLock(gameId, fn) {
      const run = (tails.get(gameId) ?? Promise.resolve()).then(fn);
      const tail = run.catch(() => {});
      tails.set(gameId, tail);
      void tail.then(() => {
        if (tails.get(gameId) === tail) tails.delete(gameId);
      });
      return run;
    },
  };
  return store;
}
