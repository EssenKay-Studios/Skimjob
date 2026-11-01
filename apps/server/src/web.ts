// Serving the built web app (apps/web/dist) from the game server, so the
// deployment is one origin: the page, the API and the game sockets.
// docs/deploy.md
//
// - The client calls `/api/...` (decisions.md "API prefix"); `stripApiPrefix`
//   is the server's `rewriteUrl`, so the same unprefixed routes answer both
//   (Vite's dev proxy strips the prefix itself; stripping again is a no-op).
// - Files under WEB_DIR are served as they are; hashed `/assets/*` are cached
//   for a year, everything else (index.html, favicon) is revalidated.
// - Any other GET for a page (no file extension, not `/api/...`) gets
//   index.html, so client routes like /join/:code survive a reload.
import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export const API_PREFIX = "/api";

/** `/api/games/1?x` → `/games/1?x`, `/api` → `/`; anything else unchanged (`/apix` too). */
export function stripApiPrefix(url: string): string {
  if (!url.startsWith(API_PREFIX)) return url;
  const rest = url.slice(API_PREFIX.length);
  if (rest === "") return "/";
  if (rest.startsWith("/")) return rest;
  if (rest.startsWith("?")) return `/${rest}`;
  return url;
}

const pathOf = (url: string) => url.split(/[?#]/, 1)[0] ?? "/";

/** Was this asked for under `/api` (before stripApiPrefix)? Those are never files or pages. */
const isApiRequest = (originalUrl: string) => {
  const path = pathOf(originalUrl);
  return path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);
};

/** Should a miss get the app's index.html (a client route) rather than a 404? */
export function isPageRequest(method: string, originalUrl: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (isApiRequest(originalUrl)) return false;
  const path = pathOf(originalUrl);
  const last = path.slice(path.lastIndexOf("/") + 1);
  return !/\.[A-Za-z0-9]+$/.test(last); // /join/abc yes; /assets/missing.js, /robots.txt no
}

const LONG_CACHE = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache";

/** Throws if `dir` has no index.html (the web app wasn't built). */
export function checkWebDir(dir: string): void {
  if (!existsSync(join(dir, "index.html"))) {
    throw new Error(`WEB_DIR (${dir}) has no index.html; build the web app first (pnpm --filter @skimjob/web build)`);
  }
}

/** Static files from `dir` plus the SPA fallback. Call once, before the server is ready. */
export function webRoutes(app: FastifyInstance, dir: string): void {
  void app.register(fastifyStatic, {
    root: dir,
    cacheControl: false,
    allowedPath: (_path, _root, req) => !isApiRequest(req.originalUrl),
    setHeaders: (res, file) => {
      res.setHeader("cache-control", /[\\/]assets[\\/]/.test(file.slice(dir.length)) ? LONG_CACHE : REVALIDATE);
    },
  });
  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    if (isPageRequest(req.method, req.originalUrl)) {
      return reply.header("cache-control", REVALIDATE).type("text/html; charset=utf-8").sendFile("index.html");
    }
    return reply.code(404).send({ error: "not found" });
  });
}
