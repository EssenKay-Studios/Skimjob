// `pnpm dev` / `pnpm --filter @skimjob/server start`: open the database,
// migrate, listen. A bad setting ends with one line on stderr, not a stack.
import { systemClock } from "./clock";
import { loadConfig, StartupError } from "./config";
import { openDatabase, serverDeps } from "./startup";
import { buildServer } from "./server";
import { tickFor } from "./timing";
import { checkWebDir } from "./web";

try {
  const config = loadConfig();
  if (config.webDir) {
    try {
      checkWebDir(config.webDir);
    } catch (err) {
      throw new StartupError((err as Error).message);
    }
  }
  const { db, applied } = await openDatabase(config);
  const app = buildServer({ db, clock: systemClock, logger: true, tickMs: tickFor(config.timeScale), ...serverDeps(config) });
  if (config.production && process.env.DEV_LOGIN === "1") app.log.warn("DEV_LOGIN=1 ignored: the dev sign-in stub is never on in production");
  const rawScale = process.env.TIME_SCALE?.trim();
  if (config.production && rawScale && rawScale !== "1") app.log.warn(`TIME_SCALE=${rawScale} ignored: deadlines always run at real speed in production`);
  if (config.timeScale !== 1) app.log.warn({ timeScale: config.timeScale }, "TIME_SCALE is set: every deadline runs faster (dev and E2E only)");
  if (applied.length > 0) app.log.info({ applied }, "migrations applied");
  if (config.webDir) app.log.info(`web app: ${config.webDir}`);
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
