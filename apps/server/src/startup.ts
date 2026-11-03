// Opening the database at server start, with one-line errors instead of a
// driver stack trace (bad DATABASE_URL, Postgres not running).
import { devAuthProvider } from "./auth";
import { googleAuthProvider } from "./google";
import { StartupError, type ServerConfig } from "./config";
import { openPglite, pgDb, type Db } from "./db";
import { migrate } from "./migrate";
import type { ServerDeps } from "./server";

/** Where DATABASE_URL points, without user or password. */
export function databaseLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname || "localhost"}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "an unreadable URL";
  }
}

const reason = (err: unknown) => (err instanceof Error ? err.message || err.constructor.name : String(err));

/** Opens Postgres (DATABASE_URL) or PGlite, checks it answers, migrates it. Returns the migrations applied. */
export async function openDatabase(config: ServerConfig): Promise<{ db: Db; applied: string[] }> {
  const url = config.databaseUrl;
  let db: Db;
  try {
    db = url ? pgDb({ connectionString: url, connectionTimeoutMillis: 5000 }) : await openPglite(config.pgliteDir ?? undefined);
    await db.query("select 1");
  } catch (err) {
    throw new StartupError(
      url
        ? `could not reach the database at DATABASE_URL (${databaseLabel(url)}): ${reason(err)}`
        : `could not open PGlite (${config.pgliteDir ?? "in memory"}): ${reason(err)}`,
    );
  }
  try {
    return { db, applied: await migrate(db) };
  } catch (err) {
    await db.close().catch(() => {});
    throw new StartupError(`database migration failed: ${reason(err)}`);
  }
}

/** The parts of buildServer's deps that come from the environment (main.ts). */
export function serverDeps(config: ServerConfig): Pick<ServerDeps, "auth" | "allowedOrigins" | "webDir" | "secureCookies" | "trustProxy" | "timeScale"> {
  return {
    // loadConfig already turns DEV_LOGIN off in production; this is the only place providers are chosen.
    auth: [
      ...(config.google ? [googleAuthProvider(config.google)] : []),
      ...(config.devLogin && !config.production ? [devAuthProvider()] : []),
    ],
    allowedOrigins: config.allowedOrigins,
    webDir: config.webDir,
    secureCookies: config.production,
    trustProxy: config.production,
    timeScale: config.timeScale,
  };
}
