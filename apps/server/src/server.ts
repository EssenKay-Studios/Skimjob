// Fastify app factory. Everything the app needs comes in as a dependency, so
// tests build it on PGlite with a fake clock and call it through inject().
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { authRoutes, sessions, type AuthProvider } from "./auth";
import type { Clock } from "./clock";
import type { Db } from "./db";
import { liveRoutes, type Live } from "./live";
import { HttpError, lobbyRoutes } from "./lobby";
import { createScheduler, type Scheduler } from "./scheduler";
import { createGameStore, type GameStore } from "./store";
import { stripApiPrefix, webRoutes } from "./web";

declare module "fastify" {
  interface FastifyInstance {
    /** The live game channel: system commands (scheduler, M2-4) and bot runs. */
    readonly live: Live;
    /** Round and meeting deadlines (M2-4). */
    readonly scheduler: Scheduler;
  }
}

export interface ServerDeps {
  readonly db: Db;
  /** Session expiry and the scheduler's deadlines. */
  readonly clock: Clock;
  /** Redirect sign-in providers (`dev` with DEV_LOGIN=1; Google in M2-12). Guests need none. */
  readonly auth?: readonly AuthProvider[];
  /** Defaults to a fresh store on `db`. */
  readonly store?: GameStore;
  /** Browser origins, besides the server's own, that may open a game socket (the Vite dev server). */
  readonly allowedOrigins?: readonly string[];
  /** How often the scheduler sends due deadlines (TICK_MS in main.ts). Unset: never on its own; tests call `app.scheduler.tick()`. */
  readonly tickMs?: number;
  /** TIME_SCALE (config.ts): multiplies every preset's wall times (fast E2E games). Default 1. */
  readonly timeScale?: number;
  /** Fastify's request logging; off by default (tests). */
  readonly logger?: boolean;
  /** The built web app to serve with SPA fallback (WEB_DIR, docs/deploy.md); unset serves none. */
  readonly webDir?: string | null;
  /** Mark every cookie `Secure` (production: the site is HTTPS only). */
  readonly secureCookies?: boolean;
  /** Believe X-Forwarded-* from the TLS-terminating proxy in front (production on Fly). */
  readonly trustProxy?: boolean;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { db } = deps;
  // `/api/...` and the bare route are the same route (web.ts).
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: deps.trustProxy ?? false, rewriteUrl: (req) => stripApiPrefix(req.url ?? "/") });
  const store = deps.store ?? createGameStore(db);
  const s = sessions(db, deps.clock);
  // `parseOptions` are also @fastify/cookie's defaults for setCookie/clearCookie.
  void app.register(cookie, deps.secureCookies ? { parseOptions: { secure: true } } : {});
  if (deps.webDir) webRoutes(app, deps.webDir);

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

  const scheduler = createScheduler({ db, clock: deps.clock, log: app.log, system: (gameId, command) => live.system(gameId, command), resync: (gameId) => live.settle(gameId), timeScale: deps.timeScale ?? 1 });
  const live = liveRoutes(app, db, store, s, {
    clock: deps.clock,
    allowedOrigins: deps.allowedOrigins ?? [],
    onChange: scheduler.reconcile,
    timers: scheduler.timers,
  });
  app.decorate("live", live);
  app.decorate("scheduler", scheduler);
  // After live's own onReady (bots settle and every running game's deadlines are reconciled), start ticking.
  app.addHook("onReady", async () => scheduler.start(deps.tickMs ?? 0));
  app.addHook("onClose", async () => scheduler.stop());
  authRoutes(app, db, s, deps.auth ?? [], (token) => live.closeSession(token));
  lobbyRoutes(app, db, store, s, (gameId) => live.settle(gameId));
  return app;
}
