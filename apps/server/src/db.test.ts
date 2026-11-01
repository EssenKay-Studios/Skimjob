// Db adapters: PGlite in every run, real Postgres too when DATABASE_URL is set
// (see testkit). docs/m2-plan.md §1
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openPglite, pgDb, type Db } from "./db";
import { freshDb, usingRealPostgres } from "./testkit";

let db: Db;
beforeAll(async () => {
  db = await freshDb();
  await db.exec("create table t (n int primary key, s text); create table u (x int)");
}, 30_000);
afterAll(() => db.close());

describe("Db", () => {
  it("runs parameterised queries and returns rows", async () => {
    await db.query("insert into t (n, s) values ($1, $2), ($3, $4)", [1, "one", 2, "two"]);
    expect(await db.query("select n, s from t where n > $1 order by n", [0])).toEqual([
      { n: 1, s: "one" },
      { n: 2, s: "two" },
    ]);
  });

  it("passes parameters as values, never as SQL", async () => {
    const evil = "x'); drop table t; --";
    await db.query("insert into t (n, s) values ($1, $2)", [3, evil]);
    expect(await db.query("select s from t where n = 3")).toEqual([{ s: evil }]);
  });

  it("commits a transaction that resolves", async () => {
    const out = await db.transaction(async (tx) => {
      await tx.query("insert into t (n, s) values (10, 'ten')");
      return "done";
    });
    expect(out).toBe("done");
    expect(await db.query("select s from t where n = 10")).toEqual([{ s: "ten" }]);
  });

  it("rolls back every statement of a transaction that throws", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query("insert into t (n, s) values (20, 'twenty')");
        await tx.exec("insert into u (x) values (1)");
        await tx.query("insert into t (n, s) values (20, 'again')"); // duplicate key
      }),
    ).rejects.toThrow();
    expect(await db.query("select * from t where n = 20")).toEqual([]);
    expect(await db.query("select * from u")).toEqual([]);
    // and the connection is usable afterwards
    expect(await db.query<{ one: number }>("select 1 as one")).toEqual([{ one: 1 }]);
  });
});

describe.skipIf(!usingRealPostgres)("pgDb on real Postgres (PR #16 review)", () => {
  it("survives an idle connection being killed: reports it, then carries on", { timeout: 20_000 }, async () => {
    const lost: Error[] = [];
    const victim = pgDb(process.env.DATABASE_URL!, (err) => lost.push(err));
    const [me] = await victim.query<{ pid: number }>("select pg_backend_pid() as pid");
    const killer = pgDb(process.env.DATABASE_URL!);
    await killer.query("select pg_terminate_backend($1)", [me!.pid]);
    await killer.close();
    await vi.waitFor(() => expect(lost.length).toBe(1));
    expect(await victim.query<{ one: number }>("select 1 as one")).toEqual([{ one: 1 }]);
    await victim.close();
  });
});

describe("openPglite", () => {
  it("makes a missing data directory (a fresh Fly volume, docs/deploy.md) and keeps data across reopen", { timeout: 60_000 }, async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "skimjob-pglite-"));
    const dir = join(root, "nested", "pglite");
    try {
      const first = await openPglite(dir);
      await first.exec("create table kept (n int); insert into kept values (7)");
      await first.close();
      const again = await openPglite(dir);
      expect(await again.query("select n from kept")).toEqual([{ n: 7 }]);
      // PGLITE_CONF: small buffers and WAL for one small machine, initdb's other settings kept.
      expect(await again.query("select current_setting('shared_buffers') sb, current_setting('max_wal_size') wal, current_setting('TimeZone') tz, current_setting('DateStyle') ds")).toEqual([
        { sb: "16MB", wal: "64MB", tz: "UTC", ds: "ISO, MDY" },
      ]);
      await again.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
