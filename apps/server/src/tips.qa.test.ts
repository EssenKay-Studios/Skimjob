// QA for S3b.3 (design §15.6, simplified.md Part B7): the per-user Tips
// setting. Tries to break the migration, the ownership of PATCH /me and its
// payload checks, and persistence across sign-out and sign-in.
import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devAuthProvider, SESSION_COOKIE } from "./auth";
import { fakeClock, type FakeClock } from "./clock";
import type { Db } from "./db";
import { migrate, MIGRATIONS_DIR } from "./migrate";
import { buildServer } from "./server";
import { SESSION_TTL_MS } from "./settings";
import { insertUser, testDb } from "./testkit";

let db: Db;
let clock: FakeClock;
let app: FastifyInstance;
beforeAll(async () => {
  db = await testDb();
  clock = fakeClock(Date.UTC(2026, 10, 7));
  app = buildServer({ db, clock, auth: [devAuthProvider()] });
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

const cookie = (session: string | null) => (session ? { [SESSION_COOKIE]: session } : {});
const sessionOf = (res: { cookies: { name: string; value: string }[] }) => res.cookies.find((c) => c.name === SESSION_COOKIE && c.value)?.value ?? null;
const me = async (session: string | null) => {
  const res = await app.inject({ method: "GET", url: "/me", cookies: cookie(session) });
  return res.statusCode === 200 ? (res.json().user as { id: string; name: string; guest: boolean; tips: boolean }) : null;
};
const guest = async (nickname: string) => sessionOf(await app.inject({ method: "POST", url: "/auth/guest", payload: { nickname } }))!;
const patch = (session: string | null, payload: unknown, extra: { url?: string; headers?: Record<string, string> } = {}) =>
  app.inject({ method: "PATCH", url: extra.url ?? "/me", cookies: cookie(session), headers: { "content-type": "application/json", ...extra.headers }, payload: typeof payload === "string" ? payload : JSON.stringify(payload) });
const tipsIn = async (id: string) => (await db.query<{ tips: boolean }>("select tips from users where id = $1", [id]))[0]!.tips;
/** A dev-provider account sign-in (optionally from a guest session): the new session. */
async function account(name: string, from?: string) {
  const s = await app.inject({ method: "GET", url: `/auth/dev/start?hint=${name}`, cookies: cookie(from ?? null) });
  const u = new URL(s.headers.location as string);
  const signin = s.cookies.find((c) => c.name === "sj_signin")!.value;
  const cb = await app.inject({ method: "GET", url: `${u.pathname}${u.search}`, cookies: { sj_signin: signin, ...cookie(from ?? null) } });
  return sessionOf(cb)!;
}

describe("QA: 009_tips migration (design §15.6; STATUS: migrations are add-only)", () => {
  it("adds tips = true to users that existed before it, and re-running it keeps a saved Off", async () => {
    // Put this database back to just before 009, with users already in it.
    await db.exec("alter table users drop column tips");
    await db.query("delete from schema_migrations where version = '009_tips.sql'");
    const old = [await insertUser(db, "Oldtimer"), await insertUser(db, "Veteran")];
    expect(await migrate(db)).toEqual(["009_tips.sql"]);
    for (const id of old) expect(await tipsIn(id)).toBe(true);
    await db.query("update users set tips = false where id = $1", [old[0]]);
    await db.exec(await readFile(new URL("009_tips.sql", MIGRATIONS_DIR), "utf8"));
    expect(await migrate(db)).toEqual([]);
    expect([await tipsIn(old[0]!), await tipsIn(old[1]!)]).toEqual([false, true]);
    const [col] = await db.query<{ is_nullable: string; column_default: string }>(
      "select is_nullable, column_default from information_schema.columns where table_schema = current_schema() and table_name = 'users' and column_name = 'tips'",
    );
    expect(col).toEqual({ is_nullable: "NO", column_default: "true" });
  });

  it("is add-only: no drop, rename, update or delete", async () => {
    const sql = (await readFile(new URL("009_tips.sql", MIGRATIONS_DIR), "utf8")).replace(/--.*$/gm, "").toLowerCase();
    expect(sql).not.toMatch(/\b(drop|rename|update|delete|truncate)\b/);
  });
});

describe("QA: PATCH /me only ever touches the session's own user (design §15.6)", () => {
  it("refuses a forged id, user id or name in the body (400, no write) and ignores one in the query", async () => {
    const a = await guest("Alice");
    const b = await guest("Bobby");
    const alice = (await me(a))!;
    const bob = (await me(b))!;
    for (const body of [{ tips: false, id: bob.id }, { tips: false, userId: bob.id, user: { id: bob.id } }, { tips: false, name: "Hacked", guest: false }, { tips: false, __proto__x: 1 }]) {
      expect((await patch(a, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await me(a)).toEqual(alice); // nothing written: still on, same name
    expect((await patch(a, { tips: false }, { url: `/me?id=${bob.id}` })).statusCode).toBe(200);
    expect(await me(b)).toEqual(bob); // Bob untouched: still on, same name
    expect(await me(a)).toMatchObject({ name: "Alice", guest: true, tips: false });
  });

  it("refuses a missing, forged, signed-out or expired session with 401 and changes nothing", async () => {
    const g = await guest("Sleepy");
    const id = (await me(g))!.id;
    expect((await patch(null, { tips: false })).statusCode).toBe(401);
    expect((await patch("forged-token", { tips: false })).statusCode).toBe(401);
    expect((await patch(id, { tips: false })).statusCode).toBe(401); // a user id is not a session
    expect((await patch(g.slice(0, -1), { tips: false })).statusCode).toBe(401);
    expect(await tipsIn(id)).toBe(true);
    const later = await guest("Napper");
    const laterId = (await me(later))!.id;
    expect((await app.inject({ method: "POST", url: "/auth/logout", cookies: cookie(later) })).statusCode).toBe(200);
    expect((await patch(later, { tips: false })).statusCode).toBe(401);
    expect(await tipsIn(laterId)).toBe(true);
    clock.advance(SESSION_TTL_MS + 1);
    expect((await patch(g, { tips: false })).statusCode).toBe(401);
    expect(await tipsIn(id)).toBe(true);
  });
});

describe("QA: PATCH /me refuses bad payloads", () => {
  it("non-booleans, arrays, strings and broken JSON get 400; the value stays", async () => {
    const g = await guest("Picky");
    const id = (await me(g))!.id;
    for (const bad of [[false], { tips: "false" }, { tips: 1 }, { tips: [] }, { tips: {} }, { Tips: false }, "false", "true", "{\"tips\": fal", "[]"]) {
      expect((await patch(g, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(await tipsIn(id)).toBe(true);
  });

  it("a form body is refused (415), a text body (400) and a huge body is refused (413) without a write", async () => {
    const g = await guest("Bulky");
    const id = (await me(g))!.id;
    expect((await patch(g, "tips=false", { headers: { "content-type": "application/x-www-form-urlencoded" } })).statusCode).toBe(415);
    expect((await patch(g, "false", { headers: { "content-type": "text/plain" } })).statusCode).toBe(400);
    const huge = JSON.stringify({ tips: false, pad: "x".repeat(2 * 1024 * 1024) });
    expect((await patch(g, huge)).statusCode).toBe(413);
    expect(await tipsIn(id)).toBe(true);
  });

  it("saving the value it already has is fine and idempotent", async () => {
    const g = await guest("Steady");
    for (const v of [true, true, false, false]) expect((await patch(g, { tips: v })).json().user.tips).toBe(v);
    expect((await me(g))!.tips).toBe(false);
  });
});

describe("QA: the setting follows the user (simplified.md Part B7)", () => {
  it("a brand-new account starts on, an Off survives sign-out and sign-in, and shows in every live session", async () => {
    const first = await account("Freshacct");
    expect((await me(first))!.tips).toBe(true);
    const second = await account("Freshacct");
    expect((await patch(first, { tips: false })).statusCode).toBe(200);
    expect((await me(second))!.tips).toBe(false); // read from the user, not cached in the session
    await app.inject({ method: "POST", url: "/auth/logout", cookies: cookie(first) });
    await app.inject({ method: "POST", url: "/auth/logout", cookies: cookie(second) });
    expect((await me(await account("Freshacct")))!.tips).toBe(false);
  });

  it("a guest signing in to an account that already exists takes the account's value, not the guest's", async () => {
    const acct = await account("Keeper");
    expect((await patch(acct, { tips: false })).statusCode).toBe(200);
    const g = await guest("Visitor");
    expect((await me(g))!.tips).toBe(true);
    const merged = await account("Keeper", g);
    expect(await me(merged)).toMatchObject({ name: "Keeper", guest: false, tips: false });
  });
});
