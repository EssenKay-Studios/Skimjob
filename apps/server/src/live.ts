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
// - Bot seats act after each change through the same command path, until
//   none of them has anything left to do.
// - Commands for a game run one at a time (store.withGameLock), in arrival order.
import { createHash } from "node:crypto";
import websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { createBot, PERSONALITIES, type Agent, type PersonalityId, type Rejection } from "@skimjob/bots";
import {
  handleCommand,
  viewFor,
  type Command,
  type GameState,
  type PlayerCommand,
  type PlayerId,
  type SystemCommand,
} from "@skimjob/engine";
import type { Sessions } from "./auth";
import type { Db } from "./db";
import { HttpError, playerIdOf } from "./lobby";
import type { GameStore } from "./store";

/** Biggest client message accepted (a command is well under 1 KiB). */
export const MAX_MESSAGE_BYTES = 16 * 1024;
/** Bot rounds per change before giving up (each round, every bot sees a fresh view). A settled game needs 2–3. */
const MAX_BOT_PASSES = 20;
/** Bot refusals kept for inspection (tests, logs). */
const MAX_REFUSALS_KEPT = 100;

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
   * then pushes views. Throws if the engine refuses it.
   */
  system(gameId: string, command: SystemCommand): Promise<GameState>;
  /** Lets the bots act and pushes views (after the game starts, or a restart). */
  settle(gameId: string): Promise<void>;
  /** The latest bot commands the engine refused. A correct bot makes none. */
  readonly botRefusals: readonly (Rejection & { readonly gameId: string })[];
}

interface Conn {
  readonly player: PlayerId;
  readonly socket: WebSocket;
  /** The last view text sent, so an unchanged view isn't sent again. */
  last: string | null;
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

/** A bot's own seed: derived from the hidden game seed, so it can't be guessed but survives a restart. */
const botSeed = (gameSeed: string, player: PlayerId) => createHash("sha256").update(`bot\0${gameSeed}\0${player}`).digest("hex");

export function liveRoutes(app: FastifyInstance, db: Db, store: GameStore, s: Sessions): Live {
  const conns = new Map<string, Set<Conn>>();
  const bots = new Map<string, readonly Agent[]>();
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

  const botsFor = async (gameId: string, state: GameState): Promise<readonly Agent[]> => {
    const known = bots.get(gameId);
    if (known) return known;
    const rows = await db.query<{ player_id: string; bot_personality: PersonalityId }>(
      "select player_id, bot_personality from seats where game_id = $1 and bot_personality is not null and player_id is not null order by seat_no",
      [gameId],
    );
    const agents = rows.map((r) =>
      createBot({ player: r.player_id, personality: PERSONALITIES[r.bot_personality], seed: botSeed(state.config.seed, r.player_id) }),
    );
    bots.set(gameId, agents);
    return agents;
  };

  /** Every bot, in seat order, acts on its fresh view; again while anything changed. design §17.3 */
  const runBots = async (gameId: string, start: GameState): Promise<GameState> => {
    let state = start;
    const agents = await botsFor(gameId, state);
    for (let pass = 0; pass < MAX_BOT_PASSES; pass++) {
      let changed = false;
      for (const agent of agents) {
        for (const command of state.phase.kind === "ended" ? [] : agent.act(viewFor(state, agent.player))) {
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

  /** After a change: bots, then every seat's fresh view. */
  const afterChange = async (gameId: string, state: GameState) => {
    const settled = await runBots(gameId, state);
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
        if (!r.ok) throw new Error(`system command refused: ${JSON.stringify(command)}: ${r.reason}`);
        return afterChange(gameId, r.state);
      }),
    settle: (gameId) =>
      store.withGameLock(gameId, async () => {
        const state = await store.load(gameId);
        if (state) await afterChange(gameId, state);
      }),
  };

  void app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });
  void app.register(async (scope) => {
    scope.get<{ Params: { id: string } }>(
      "/games/:id/ws",
      {
        websocket: true,
        // Refused before the upgrade, as plain HTTP: 401 signed out, 404 not seated in a started game.
        preValidation: async (req) => {
          const user = await s.user(req);
          if (!user) throw new HttpError(401, "not signed in");
          const player = await playerIdOf(db, req.params.id, user.id);
          if (!player || !(await store.load(req.params.id))) throw new HttpError(404, "game not found or not started");
          seatOf.set(req, player);
        },
      },
      (socket, req) => {
        const gameId = req.params.id;
        const conn: Conn = { player: seatOf.get(req)!, socket, last: null };
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
            });
        });
      },
    );
  });
  return live;
}
