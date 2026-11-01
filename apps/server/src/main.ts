// `pnpm dev` / `pnpm --filter @skimjob/server start`: open the database,
// migrate, listen.
import { systemClock } from "./clock";
import { loadConfig } from "./config";
import { openPglite, pgDb } from "./db";
import { migrate } from "./migrate";
import { buildServer } from "./server";

const config = loadConfig();
const db = config.databaseUrl ? pgDb(config.databaseUrl) : await openPglite(config.pgliteDir ?? undefined);
const applied = await migrate(db);
const app = buildServer({ db, clock: systemClock, logger: true });
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
