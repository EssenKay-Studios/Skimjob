// The server's whole view of the database: parameterised SQL, nothing more.
// Two adapters: `pg` (real Postgres) and PGlite (Postgres in WASM, in-process;
// tests and zero-setup dev). docs/m2-plan.md §1
import { mkdir } from "node:fs/promises";
import pg from "pg";
import type { PGlite } from "@electric-sql/pglite";

/** What a transaction gets: queries only (no nesting, no close). */
export interface Queryable {
  /** One statement, `$1`-style params. Returns the rows. */
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
  /** Several statements, no params (migration files). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Runs `fn` in one transaction: commits if it resolves, rolls back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Real Postgres through a `pg` pool. `onIdleError` hears about idle pooled
 * connections that fail (Postgres restarted, network dropped): `pg` emits
 * those on the pool, and an unheard `error` event would kill the process.
 * The pool replaces the connection by itself.
 */
export function pgDb(
  connection: string | pg.PoolConfig,
  onIdleError: (err: Error) => void = (err) => console.error(`postgres: idle connection lost: ${err.message}`),
): Db {
  const pool = new pg.Pool(typeof connection === "string" ? { connectionString: connection } : connection);
  pool.on("error", onIdleError);
  const on = (c: pg.Pool | pg.PoolClient): Queryable => ({
    query: async <R>(sql: string, params: readonly unknown[] = []) => (await c.query(sql, [...params])).rows as R[],
    // Without params `pg` uses the simple query protocol, which allows several statements.
    exec: async (sql) => void (await c.query(sql)),
  });
  return {
    ...on(pool),
    async transaction(fn) {
      const client = await pool.connect();
      let broken: Error | undefined;
      try {
        await client.query("begin");
        const result = await fn(on(client));
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback").catch((e: Error) => (broken = e));
        throw err;
      } finally {
        client.release(broken); // a client that can't roll back is discarded, not reused
      }
    },
    close: () => pool.end(),
  };
}

/** Wraps an open PGlite instance. */
export function pgliteDb(lite: PGlite): Db {
  type Lite = Pick<PGlite, "query" | "exec">;
  const on = (c: Lite): Queryable => ({
    query: async <R>(sql: string, params: readonly unknown[] = []) => (await c.query<R>(sql, [...params])).rows,
    exec: async (sql) => void (await c.exec(sql)),
  });
  return {
    ...on(lite),
    transaction: (fn) => lite.transaction((tx) => fn(on(tx))),
    close: () => lite.close(),
  };
}

/**
 * postgresql.conf for an on-disk PGlite. PGlite writes this over the file
 * initdb made, so it repeats initdb's settings and changes only these, for one
 * 512 MB machine with a 1 GB volume (docs/deploy.md): shared_buffers 128MB →
 * 16MB (steady memory ~350 → ~175 MB) and max/min_wal_size 1GB/80MB →
 * 64MB/32MB (WAL can't fill the volume). Plenty for playtest-sized data.
 */
export const PGLITE_CONF = [
  "max_connections = 100",
  "shared_buffers = 16MB",
  "dynamic_shared_memory_type = posix",
  "max_wal_size = 64MB",
  "min_wal_size = 32MB",
  "log_file_mode = 0640",
  "log_timezone = UTC",
  "autovacuum_worker_slots = 16",
  "datestyle = 'iso, mdy'",
  "timezone = UTC",
  "lc_messages = C",
  "lc_monetary = C",
  "lc_numeric = C",
  "lc_time = C",
  "default_text_search_config = 'pg_catalog.english'",
  "",
].join("\n");

/**
 * Opens PGlite (loaded only when used): in memory without a directory, else
 * persisted there, making the directory if needed (a fresh data directory).
 */
export async function openPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const lite = dataDir ? new PGlite(dataDir, { postgresqlconf: PGLITE_CONF }) : new PGlite();
  await lite.waitReady;
  return pgliteDb(lite);
}
