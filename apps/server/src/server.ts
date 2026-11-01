// Fastify app factory. Everything the app needs comes in as a dependency, so
// tests build it on PGlite with a fake clock and call it through inject().
import Fastify, { type FastifyInstance } from "fastify";
import type { Clock } from "./clock";
import type { Db } from "./db";
import { createGameStore, type GameStore } from "./store";

export interface ServerDeps {
  readonly db: Db;
  readonly clock: Clock;
  /** Defaults to a store over `db`. */
  readonly store?: GameStore;
  /** Fastify's request logging; off by default (tests). */
  readonly logger?: boolean;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { db } = deps;
  const app = Fastify({ logger: deps.logger ?? false });

  app.get("/health", async (_req, reply) => {
    try {
      await db.query("select 1");
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  return app;
}
