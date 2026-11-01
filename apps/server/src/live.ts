// Live game channel: one WebSocket per open game screen, plus the server's bot
// seats. design §17.2, §17.3; docs/m2-plan.md M2-3
//
// - `GET /games/:id/ws`, signed in by the session cookie. The session decides
//   the seat: any `player` a client puts in a command is overwritten.
// - Client → `{ cmd, id? }`. The reply, `{ ok: true }` or `{ rejected: true,
//   reason }` (with the same `id`), goes to that socket only: rejection reasons
//   can be role-specific.
// - After each change every connected seat gets `{ view }`, its fresh
//   `viewFor()`, but only if that view changed. A hidden action (a move, a
//   sealed vote) therefore sends nothing to anyone else, not even a ping.
// - Bot seats act through the same command path, but only when their own
//   view changed (like the pushes), so another player's hidden action never
//   makes a bot roll its dice, and so never shows up as a public bot act.
// - Commands for a game run one at a time (store.withGameLock), in arrival order.
import { createHash } from "node:crypto";
import websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { createBot, PERSONALITIES, type PersonalityId, type Rejection } from "@skimjob/bots";
import {
  handleCommand,
  viewFor,
  type Command,
  type GameState,
  type PlayerCommand,
  type PlayerId,
  type SystemCommand,
} from "@skimjob/engine";
import { SESSION_COOKIE, type Sessions } from "./auth";
import type { Db } from "./db";
import { HttpError, playerIdOf } from "./lobby";
import type { GameStore } from "./store";

/** Biggest client message accepted (a command is well under 1 KiB). */
export const MAX_MESSAGE_BYTES = 16 * 1024;
/** Bot rounds per change before giving up (each round, every bot sees a fresh view). A settled game needs 2–3. */
const MAX_BOT_PASSES = 20;
/** Bot refusals kept for inspection (tests, logs). */
const MAX_REFUSALS_KEPT = 100;
/**
 * Messages a socket may have waiting for the game's lock. A client that waits
 * for its replies has one or two; a socket that floods past this is closed
 * (1008), so one client can't queue unbounded work on a game.
 */
export const MAX_QUEUED_MESSAGES = 64;
/** Close codes: the session was signed out; the socket sent too much. */
export const CLOSE_SIGNED_OUT = 4401;
export const CLOSE_TOO_MANY = 1008;

/** Commands a client may send. Typed so a new player command fails typecheck until listed. */
const PLAYER_COMMANDS: { readonly [T in PlayerCommand["type"]]: true } = {
  submitMove: true,
  postAlibi: true,
  proposeMeeting: true,
  acceptMeeting: true,
  callEmergency: true,
  castVote: true,
  sealVote: true,
  useAbility: true,
  answerDoubleCross: true,
  callOut: true,
};

export type ServerMessage =
  | { readonly view: ReturnType<typeof viewFor> }
  | { readonly ok: true; readonly id?: string | number }
  | { readonly rejected: true; readonly reason: string; readonly id?: string | number };

export interface Live {
  /**
   * Runs a system command (the scheduler's deadlines, M2-4), then the bots,
   * then pushes views. Throws `SystemRefused` if the engine refuses it
   * (any other error is a server failure: worth a retry).
   */
  system(gameId: string, command: SystemCommand): Promise<GameState>;
  /** Lets the bots act and pushes views (after the game starts, or a restart). */
  settle(gameId: string): Promise<void>;
  /** Lets the bots of every running game act (on boot: a crash may have cut a settle short). */
  settleRunning(): Promise<void>;
  /** Closes every socket opened with this session token (sign-out). */
  closeSession(token: string): void;
  /** The latest bot commands the engine refused. A correct bot makes none. */
  readonly botRefusals: readonly (Rejection & { readonly gameId: string })[];
}

export interface LiveOptions {
  /**
   * Browser origins allowed to open a socket besides the server's own host
   * (e.g. the Vite dev server, whose proxy keeps the browser's Origin).
   * Requests without an Origin (not a browser) are allowed: the cookie is the check.
   */
  readonly allowedOrigins?: readonly string[];
  /**
   * Runs inside the game's lock after every change once the bots have settled
   * (also on `settle`): the scheduler's `reconcile` (M2-4). Errors are logged.
   */
  readonly onChange?: (gameId: string, state: GameState) => Promise<void>;
}

interface Conn {
  readonly player: PlayerId;
  readonly socket: WebSocket;
  /** The session token it was opened with (closed on sign-out). Memory only. */
  readonly token: string;
  /** The last view text sent, so an unchanged view isn't sent again. */
  last: string | null;
  /** Messages waiting for the game's lock. */
  queued: number;
}

/**
 * The client's `{ cmd, id? }` as an engine command for `player`, or why not.
 * Only player commands, never system ones (`advance`, `scheduleMeeting`);
 * the rest of the command is the engine's to check.
 */
export function parseClientMessage(
  text: string,
  player: PlayerId,
): { ok: true; command: PlayerCommand; id?: string | number } | { ok: false; reason: string; id?: string | number } {
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return { ok: false, reason: "messages must be JSON" };
  }
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return { ok: false, reason: "expected { cmd }" };
  const { cmd, id: rawId } = msg as { cmd?: unknown; id?: unknown };
  const id =
    (typeof rawId === "string" && rawId.length <= 64) || (typeof rawId === "number" && Number.isFinite(rawId)) ? rawId : undefined;
  const withId = <T extends object>(r: T) => (id === undefined ? r : { ...r, id });
  if (typeof cmd !== "object" || cmd === null || Array.isArray(cmd)) return withId({ ok: false as const, reason: "expected { cmd }" });
  const type = (cmd as { type?: unknown }).type;
  if (typeof type !== "string" || !Object.hasOwn(PLAYER_COMMANDS, type)) {
    return withId({ ok: false as const, reason: "unknown command" });
  }
  // design §17.2 / STATUS "M2 (server)": the seat comes from the session, never the client.
  return withId({ ok: true as const, command: { ...cmd, player } as PlayerCommand });
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
/**
 * A bot decision's seed: from the hidden game seed (so it can't be guessed),
 * the seat and the view it acts on, so the same view always gets the same
 * decision, with or without a restart in between (no long-lived RNG stream).
 */
const botSeed = (gameSeed: string, player: PlayerId, viewHash: string) => sha256(`bot\0${gameSeed}\0${player}\0${viewHash}`);

/** The engine refused a system command (a stale or duplicate deadline), as opposed to a server failure. */
export class SystemRefused extends Error {}

/** Same host as the request, or listed. No Origin header: not a browser, allowed. */
export function originAllowed(origin: string | undefined, host: string | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined) return true;
  if (allowed.includes(origin)) return true;
  try {
    return host !== undefined && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function liveRoutes(app: FastifyInstance, db: Db, store: GameStore, s: Sessions, options: LiveOptions = {}): Live {
  const allowedOrigins = options.allowedOrigins ?? [];
  const conns = new Map<string, Set<Conn>>();
  const bots = new Map<string, readonly { readonly player: PlayerId; readonly personality: PersonalityId }[]>();
  /** Per game, the view text each bot last acted on. */
  const botSeen = new Map<string, Map<PlayerId, string>>();
  const botRefusals: (Rejection & { gameId: string })[] = [];
  const seatOf = new WeakMap<FastifyRequest, PlayerId>();

  /** The engine never throws for bad input; if it ever does, that's a refusal (and a bug to log). */
  const run = (state: GameState, command: Command) => {
    try {
      return handleCommand(state, command);
    } catch (err) {
      app.log.error({ err, type: command.type }, "engine threw on a command");
      return { ok: false as const, reason: "command could not be handled" };
    }
  };

  /** Runs `command` and stores its events. */
  const apply = async (gameId: string, state: GameState, command: Command) => {
    const r = run(state, command);
    if (!r.ok) return { ok: false as const, reason: r.reason, state };
    return { ok: true as const, state: r.events.length > 0 ? await store.append(gameId, r.events) : state, changed: r.events.length > 0 };
  };

  /** The game's bot seats; their last-acted view hashes (stored in `seats.bot_seen`) go into `botSeen`. */
  const botsFor = async (gameId: string): Promise<readonly { readonly player: PlayerId; readonly personality: PersonalityId }[]> => {
    const known = bots.get(gameId);
    if (known) return known;
    const rows = await db.query<{ player_id: string; bot_personality: PersonalityId; bot_seen: string | null }>(
      "select player_id, bot_personality, bot_seen from seats where game_id = $1 and bot_personality is not null and player_id is not null order by seat_no",
      [gameId],
    );
    const seen = new Map<PlayerId, string>();
    for (const r of rows) if (r.bot_seen) seen.set(r.player_id, r.bot_seen);
    botSeen.set(gameId, seen);
    const seats = rows.map((r) => ({ player: r.player_id, personality: r.bot_personality }));
    bots.set(gameId, seats);
    return seats;
  };

  /**
   * Every bot whose view changed since it last acted, in seat order, acts on
   * it; again while anything changed. A bot never acts on an unchanged view,
   * so what others do out of its sight can't trigger it. design §17.3
   */
  const runBots = async (gameId: string, start: GameState): Promise<GameState> => {
    let state = start;
    if (state.phase.kind === "ended") return state;
    const seats = await botsFor(gameId);
    const seen = botSeen.get(gameId)!;
    for (let pass = 0; pass < MAX_BOT_PASSES; pass++) {
      let changed = false;
      for (const seat of seats) {
        if (state.phase.kind === "ended") break;
        const view = viewFor(state, seat.player);
        const hash = sha256(JSON.stringify(view));
        if (seen.get(seat.player) === hash) continue;
        seen.set(seat.player, hash);
        const agent = createBot({ player: seat.player, personality: PERSONALITIES[seat.personality], seed: botSeed(state.config.seed, seat.player, hash) });
        for (const command of agent.act(view)) {
          if (state.phase.kind === "ended") break;
          const r = await apply(gameId, state, { ...command, player: agent.player });
          if (!r.ok) {
            app.log.warn({ gameId, player: agent.player, type: command.type, reason: r.reason }, "bot command refused");
            botRefusals.push({ gameId, player: agent.player, command, reason: r.reason });
            if (botRefusals.length > MAX_REFUSALS_KEPT) botRefusals.shift();
            continue;
          }
          state = r.state;
          changed ||= r.changed;
        }
        // Kept across restarts (after its commands), so a rebuilt server doesn't act again on a view this bot already acted on.
        await db.query("update seats set bot_seen = $3 where game_id = $1 and player_id = $2", [gameId, seat.player, hash]);
      }
      if (!changed) return state;
    }
    app.log.warn({ gameId }, "bots still acting after the pass limit");
    return state;
  };

  const send = (conn: Conn, msg: ServerMessage) => {
    if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(JSON.stringify(msg));
  };
  /** Sends `conn` its view if it changed since the last one sent. */
  const sendView = (conn: Conn, state: GameState) => {
    const text = JSON.stringify({ view: viewFor(state, conn.player) });
    if (text === conn.last || conn.socket.readyState !== conn.socket.OPEN) return;
    conn.last = text;
    conn.socket.send(text);
  };
  const push = (gameId: string, state: GameState) => {
    for (const conn of conns.get(gameId) ?? []) sendView(conn, state);
  };

  /** After a change: bots, then every seat's fresh view. An ended game's bots are dropped. */
  const afterChange = async (gameId: string, state: GameState) => {
    const settled = await runBots(gameId, state);
    if (settled.phase.kind === "ended") {
      bots.delete(gameId);
      botSeen.delete(gameId);
    }
    await options.onChange?.(gameId, settled).catch((err: unknown) => app.log.error({ err, gameId }, "after-change hook failed"));
    push(gameId, settled);
    return settled;
  };

  const live: Live = {
    botRefusals,
    system: (gameId, command) =>
      store.withGameLock(gameId, async () => {
        const state = await store.load(gameId);
        if (!state) throw new Error(`game ${gameId} has not started`);
        const r = await apply(gameId, state, command);
        if (!r.ok) throw new SystemRefused(`system command refused: ${JSON.stringify(command)}: ${r.reason}`);
        return afterChange(gameId, r.state);
      }),
    settle: (gameId) =>
      store.withGameLock(gameId, async () => {
        const state = await store.load(gameId);
        if (state) await afterChange(gameId, state);
      }),
    async settleRunning() {
      // Never stops the server from starting: the bots also act at the next change.
      const rows = await db.query<{ id: string }>("select id from games where status = 'running'").catch((err: unknown) => {
        app.log.error({ err }, "listing running games on boot failed");
        return [];
      });
      for (const { id } of rows) {
        await live.settle(id).catch((err: unknown) => app.log.error({ err, gameId: id }, "settling bots on boot failed"));
      }
    },
    closeSession(token) {
      for (const set of conns.values()) {
        for (const conn of set) if (conn.token === token) conn.socket.close(CLOSE_SIGNED_OUT, "signed out");
      }
    },
  };
  app.addHook("onReady", () => live.settleRunning());

  void app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });
  void app.register(async (scope) => {
    scope.get<{ Params: { id: string } }>(
      "/games/:id/ws",
      {
        websocket: true,
        // Refused before the upgrade, as plain HTTP: 401 signed out, 404 not seated in a started game.
        preValidation: async (req) => {
          if (!originAllowed(req.headers.origin, req.headers.host, allowedOrigins)) throw new HttpError(403, "origin not allowed");
          const user = await s.user(req);
          if (!user) throw new HttpError(401, "not signed in");
          const player = await playerIdOf(db, req.params.id, user.id);
          if (!player || !(await store.load(req.params.id))) throw new HttpError(404, "game not found or not started");
          seatOf.set(req, player);
        },
      },
      (socket, req) => {
        const gameId = req.params.id;
        const conn: Conn = { player: seatOf.get(req)!, socket, token: req.cookies[SESSION_COOKIE] ?? "", last: null, queued: 0 };
        const set = conns.get(gameId) ?? new Set<Conn>();
        conns.set(gameId, set.add(conn));
        socket.on("close", () => {
          set.delete(conn);
          if (set.size === 0 && conns.get(gameId) === set) conns.delete(gameId);
        });
        // The first view, in line with any change being made right now.
        void store.withGameLock(gameId, async () => {
          const state = await store.load(gameId);
          if (state) sendView(conn, state);
        });
        socket.on("message", (data, isBinary) => {
          if (conn.queued >= MAX_QUEUED_MESSAGES) {
            socket.close(CLOSE_TOO_MANY, "too many messages; wait for replies");
            return;
          }
          conn.queued++;
          const parsed = isBinary ? { ok: false as const, reason: "messages must be text" } : parseClientMessage(String(data), conn.player);
          const id = parsed.id === undefined ? {} : { id: parsed.id };
          let replied = false;
          const reply = (msg: ServerMessage) => {
            replied = true;
            send(conn, msg);
          };
          void store
            .withGameLock(gameId, async () => {
              if (!parsed.ok) return reply({ rejected: true, reason: parsed.reason, ...id });
              const state = await store.load(gameId);
              if (!state) return reply({ rejected: true, reason: "game not found", ...id });
              const r = await apply(gameId, state, parsed.command);
              if (!r.ok) return reply({ rejected: true, reason: r.reason, ...id });
              reply({ ok: true, ...id });
              if (r.changed) await afterChange(gameId, r.state);
            })
            .catch((err: unknown) => {
              app.log.error({ err, gameId }, "live command failed");
              if (!replied) reply({ rejected: true, reason: "server error; try again", ...id });
            })
            .finally(() => conn.queued--);
        });
      },
    );
  });
  return live;
}
