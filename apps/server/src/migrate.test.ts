// Migration runner and the v1 schema. docs/m2-plan.md M2-1
// Two databases only (each fresh PGlite costs seconds): one migrated with the
// real files, one driven by throwaway migration directories.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import { migrate, MIGRATIONS_DIR } from "./migrate";
import { freshDb, insertUser } from "./testkit";

const dirs: URL[] = [];
async function tempMigrations(files: Record<string, string>): Promise<URL> {
  const dir = await mkdtemp(join(tmpdir(), "skimjob-migrations-"));
  for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql);
  const url = pathToFileURL(dir + "/");
  dirs.push(url);
  return url;
}

const tables = async (db: Db) =>
  (await db.query<{ t: string }>("select table_name as t from information_schema.tables where table_schema = current_schema() order by 1")).map((r) => r.t);
const versions = async (db: Db) => (await db.query<{ version: string }>("select version from schema_migrations order by 1")).map((r) => r.version);

const ALL = ["001_init.sql", "002_identity.sql", "003_chat.sql", "004_deadline_pause.sql", "005_bot_seen.sql", "006_seat_last_seen.sql", "007_suspicion_board.sql", "008_host_controls.sql", "009_tips.sql", "010_plan_board.sql"];
let real: Db;
let scratch: Db;
beforeAll(async () => {
  [real, scratch] = await Promise.all([freshDb(), freshDb()]);
}, 60_000);
afterAll(async () => {
  await Promise.all([real.close(), scratch.close(), ...dirs.map((d) => rm(d, { recursive: true }))]);
});

describe("migrate (the real migrations)", () => {
  it("creates every table", async () => {
    expect(await migrate(real)).toEqual(ALL);
    expect(await tables(real)).toEqual(["chat_messages", "deadlines", "game_events", "games", "plan_edits", "plan_entries", "schema_migrations", "seats", "sessions", "suspicion_marks", "users"]);
  });

  it("is idempotent: a second run applies nothing and changes nothing", async () => {
    await insertUser(real, "kept");
    expect(await migrate(real)).toEqual([]);
    expect(await migrate(real)).toEqual([]);
    expect(await versions(real)).toEqual(ALL);
    expect(await real.query("select display_name from users")).toEqual([{ display_name: "kept" }]);
  });
});

describe("migrate (renumbered migrations)", () => {
  it("a database that applied the scheduler's migrations as 003/004 (before chat took 003) migrates cleanly", { timeout: 60_000 }, async () => {
    const old = await freshDb();
    try {
      const sql = (f: string) => readFile(new URL(f, MIGRATIONS_DIR), "utf8");
      const before = await tempMigrations({
        "001_init.sql": await sql("001_init.sql"),
        "002_identity.sql": await sql("002_identity.sql"),
        "003_deadline_pause.sql": await sql("004_deadline_pause.sql"),
        "004_bot_seen.sql": await sql("005_bot_seen.sql"),
      });
      await migrate(old, before);
      expect(await migrate(old)).toEqual(["003_chat.sql", "006_seat_last_seen.sql", "007_suspicion_board.sql", "008_host_controls.sql", "009_tips.sql", "010_plan_board.sql"]);
      expect(await versions(old)).toEqual(ALL);
    } finally {
      await old.close();
    }
  });
});

describe("migrate (runner rules)", () => {
  it("refuses two migrations with the same number, before touching the database", async () => {
    const dir = await tempMigrations({ "001_a.sql": "create table a (x int);", "001_b.sql": "select 1;" });
    await expect(migrate(scratch, dir)).rejects.toThrow(/two migrations numbered 001/);
    expect(await tables(scratch)).toEqual([]);
  });

  it("applies only the new files, in number order, ignoring other files", async () => {
    expect(await migrate(scratch, await tempMigrations({ "001_a.sql": "create table a (x int);" }))).toEqual(["001_a.sql"]);
    const more = await tempMigrations({
      "001_a.sql": "create table a (x int);",
      "003_c.sql": "insert into b (y) values (1);",
      "002_b.sql": "create table b (y int); create table b2 (z int);",
      "notes.txt": "ignored",
      "4_bad_name.sql": "ignored",
    });
    expect(await migrate(scratch, more)).toEqual(["002_b.sql", "003_c.sql"]);
    expect(await scratch.query("select y from b")).toEqual([{ y: 1 }]);
    expect(await migrate(scratch, more)).toEqual([]);
  });

  it("applies nothing if one migration of the run fails", async () => {
    const before = await tables(scratch);
    const dir = await tempMigrations({
      "001_a.sql": "create table a (x int);",
      "004_ok.sql": "create table ok (x int);",
      "005_bad.sql": "create table nope (;",
    });
    await expect(migrate(scratch, dir)).rejects.toThrow();
    expect(await tables(scratch)).toEqual(before);
    expect(await versions(scratch)).toEqual(["001_a.sql", "002_b.sql", "003_c.sql"]);
  });
});

describe("schema v1", () => {
  it("keeps the rules the server relies on", async () => {
    const host = await insertUser(real);
    const [game] = await real.query<{ id: string; status: string; settings: unknown; config: unknown }>(
      "insert into games (host_user_id, invite_code) values ($1, 'CODE1') returning id, status, settings, config",
      [host],
    );
    expect(game).toMatchObject({ status: "lobby", settings: {}, config: null });
    const id = game!.id;
    // invite codes are unique
    await expect(real.query("insert into games (host_user_id, invite_code) values ($1, 'CODE1')", [host])).rejects.toThrow();
    // a running game has a config, a lobby game doesn't; no other statuses
    await expect(real.query("update games set status = 'running' where id = $1", [id])).rejects.toThrow();
    await expect(real.query("update games set status = 'paused' where id = $1", [id])).rejects.toThrow();
    // a seat is a human (user) or a bot (personality), never both or neither
    await real.query("insert into seats (game_id, seat_no, user_id, nickname) values ($1, 0, $2, 'Host')", [id, host]);
    await real.query("insert into seats (game_id, seat_no, nickname, bot_personality) values ($1, 1, 'Bot · Riya', 'honest')", [id]);
    await expect(real.query("insert into seats (game_id, seat_no, nickname) values ($1, 2, 'nobody')", [id])).rejects.toThrow();
    const other = await insertUser(real, "u2");
    await expect(
      real.query("insert into seats (game_id, seat_no, user_id, nickname, bot_personality) values ($1, 3, $2, 'both', 'greedy')", [id, other]),
    ).rejects.toThrow();
    // one seat per user per game; last seen starts at "nothing"
    await expect(real.query("insert into seats (game_id, seat_no, user_id, nickname) values ($1, 4, $2, 'again')", [id, host])).rejects.toThrow();
    expect(await real.query("select last_seen_seq from seats where game_id = $1 order by seat_no", [id])).toEqual([
      { last_seen_seq: -1 },
      { last_seen_seq: -1 },
    ]);
    // one deadline per key
    await real.query("insert into deadlines (game_id, key, due_at, command) values ($1, 'round:1', now(), '{}')", [id]);
    await expect(real.query("insert into deadlines (game_id, key, due_at, command) values ($1, 'round:1', now(), '{}')", [id])).rejects.toThrow();
    // a session is keyed by the token's hash
    const hash = Buffer.alloc(32, 7);
    await real.query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 day')", [hash, host]);
    expect(await real.query("select count(*)::int as n from sessions where token_hash = $1", [hash])).toEqual([{ n: 1 }]);
    // deleting a game takes its seats and deadlines with it
    await real.query("delete from games where id = $1", [id]);
    expect(await real.query("select (select count(*) from seats)::int + (select count(*) from deadlines)::int as n")).toEqual([{ n: 0 }]);
  });
});
