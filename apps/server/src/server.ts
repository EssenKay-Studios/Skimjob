// Fastify app factory. Everything the app needs comes in as a dependency, so
// tests build it on PGlite with a fake clock and call it through inject().
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { authRoutes, sessions, type AuthProvider } from "./auth";
import type { Clock } from "./clock";
import type { Db } from "./db";
import { liveRoutes, type Live } from "./live";
import { HttpError, lobbyRoutes } from "./lobby";
import { createGameStore, type GameStore } from "./store";

declare module "fastify" {
  interface FastifyInstance {
    /** The live game channel: system commands (scheduler, M2-4) and bot runs. */
    readonly live: Live;
  }
}

export interface ServerDeps {
  readonly db: Db;
  /** Session expiry now; the scheduler (M2-4) later. */
  readonly clock: Clock;
  /** Redirect sign-in providers (`dev` with DEV_LOGIN=1; Google in M2-12). Guests need none. */
  readonly auth?: readonly AuthProvider[];
  /** Defaults to a fresh store on `db`. */
  readonly store?: GameStore;
  /** Fastify's request logging; off by default (tests). */
  readonly logger?: boolean;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { db } = deps;
  const app = Fastify({ logger: deps.logger ?? false });
  const store = deps.store ?? createGameStore(db);
  const s = sessions(db, deps.clock);
  void app.register(cookie);

  // Every refusal is `{ error }`. Our own (HttpError) and Fastify's (bad JSON,
  // wrong content type) say what was wrong; anything else is a bug, logged.
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: "internal error" });
  });

  app.get("/health", async (_req, reply) => {
    try {
      await db.query("select 1");
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  authRoutes(app, db, s, deps.auth ?? []);
  const live = liveRoutes(app, db, store, s);
  app.decorate("live", live);
  lobbyRoutes(app, db, store, s, (gameId) => live.settle(gameId));
  return app;
}
