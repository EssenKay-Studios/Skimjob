// `pnpm dev` / `pnpm --filter @skimjob/server start`: open the database,
// migrate, listen. A bad setting ends with one line on stderr, not a stack.
import { devAuthProvider } from "./auth";
import { systemClock } from "./clock";
import { loadConfig, StartupError } from "./config";
import { openDatabase } from "./startup";
import { buildServer } from "./server";
import { TICK_MS } from "./timing";

try {
  const config = loadConfig();
  const { db, applied } = await openDatabase(config);
  const app = buildServer({ db, clock: systemClock, logger: true, auth: config.devLogin ? [devAuthProvider()] : [], allowedOrigins: config.allowedOrigins, tickMs: TICK_MS, timeScale: config.timeScale });
  if (config.timeScale !== 1) app.log.warn({ timeScale: config.timeScale }, "TIME_SCALE is set: every deadline runs faster (dev and E2E only)");
  if (applied.length > 0) app.log.info({ applied }, "migrations applied");
  app.log.info(config.databaseUrl ? "database: Postgres (DATABASE_URL)" : `database: PGlite (${config.pgliteDir ?? "in memory"})`);

  const stop = async () => {
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  // Config and database errors are ours and self-explanatory; anything else keeps its stack.
  const text = err instanceof StartupError ? err.message : err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`skimjob server: ${text}`);
  process.exit(1);
}
