// The server's whole view of the database: parameterised SQL, nothing more.
// Two adapters: `pg` (real Postgres) and PGlite (Postgres in WASM, in-process;
// tests and zero-setup dev). docs/m2-plan.md §1
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

/** Real Postgres through a `pg` pool. */
export function pgDb(connection: string | pg.PoolConfig): Db {
  const pool = new pg.Pool(typeof connection === "string" ? { connectionString: connection } : connection);
  const on = (c: pg.Pool | pg.PoolClient): Queryable => ({
    query: async <R>(sql: string, params: readonly unknown[] = []) => (await c.query(sql, [...params])).rows as R[],
    // Without params `pg` uses the simple query protocol, which allows several statements.
    exec: async (sql) => void (await c.query(sql)),
  });
  return {
    ...on(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(on(client));
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
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
 * Opens PGlite (a devDependency, loaded only when used): in memory without a
 * directory, else persisted there.
 */
export async function openPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const lite = dataDir ? new PGlite(dataDir) : new PGlite();
  await lite.waitReady;
  return pgliteDb(lite);
}
