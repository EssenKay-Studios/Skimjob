// Test databases: real Postgres when DATABASE_URL is set (a fresh schema per
// call, dropped on close), else a fresh in-memory PGlite. Migrated either way.
import { randomBytes } from "node:crypto";
import { openPglite, pgDb, type Db } from "./db";
import { migrate } from "./migrate";

export const usingRealPostgres = Boolean(process.env.DATABASE_URL);

/** A fresh, unmigrated database. */
export async function freshDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) return openPglite();
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const admin = pgDb(url);
  await admin.exec(`create schema ${schema}`);
  const db = pgDb({ connectionString: url, options: `-c search_path=${schema}` });
  return {
    ...db,
    async close() {
      await db.close();
      await admin.exec(`drop schema ${schema} cascade`);
      await admin.close();
    },
  };
}

/** A fresh, migrated database. */
export async function testDb(): Promise<Db> {
  const db = await freshDb();
  await migrate(db);
  return db;
}

/** A user row to hang games on (users get real routes in M2-2). */
export async function insertUser(db: Db, name = "Host"): Promise<string> {
  const [row] = await db.query<{ id: string }>("insert into users (display_name) values ($1) returning id", [name]);
  if (!row) throw new Error("user not created");
  return row.id;
}
