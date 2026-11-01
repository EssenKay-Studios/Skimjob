// Migration runner: applies apps/server/migrations/NNN_*.sql in order, each at
// most once, recorded in `schema_migrations`. Safe to run on every start.
import { readdir, readFile } from "node:fs/promises";
import type { Db } from "./db";

export const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);

/**
 * Migrations that were renumbered after a database may have applied them under
 * the old name (the scheduler's, after chat took 003): old → new, applied in
 * this order. Their SQL is idempotent too (`if not exists`).
 */
const RENAMED: readonly (readonly [string, string])[] = [
  ["004_bot_seen.sql", "005_bot_seen.sql"],
  ["003_deadline_pause.sql", "004_deadline_pause.sql"],
];

/** Any fixed number: only one migrator at a time per database. */
const LOCK_KEY = 7_270_001;

/** Applies the migrations not yet applied, all in one transaction. Returns their file names. */
export async function migrate(db: Db, dir: URL = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
  const numbers = files.map((f) => f.slice(0, 3));
  const dup = numbers.find((n, i) => numbers.indexOf(n) !== i);
  if (dup) throw new Error(`two migrations numbered ${dup}`);

  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
    await tx.exec("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())");
    for (const [from, to] of RENAMED) await tx.query("update schema_migrations set version = $2 where version = $1", [from, to]);
    const done = new Set((await tx.query<{ version: string }>("select version from schema_migrations")).map((r) => r.version));
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.exec(await readFile(new URL(file, dir), "utf8"));
      await tx.query("insert into schema_migrations (version) values ($1)", [file]);
      applied.push(file);
    }
    return applied;
  });
}
