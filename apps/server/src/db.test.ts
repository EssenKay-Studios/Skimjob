// Db adapters: PGlite in every run, real Postgres too when DATABASE_URL is set
// (see testkit). docs/m2-plan.md §1
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import { freshDb } from "./testkit";

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
