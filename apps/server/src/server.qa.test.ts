// QA (PR #16, M2-1): /health edges and bad env config. docs/m2-plan.md M2-1
import { describe, expect, it } from "vitest";
import { fakeClock } from "./clock";
import { loadConfig } from "./config";
import { pgDb } from "./db";
import { migrate } from "./migrate";
import { buildServer } from "./server";

describe("QA: /health", () => {
  it("is 503 once the database pool has been closed", async () => {
    const db = pgDb("postgres://nobody@127.0.0.1:1/none");
    await db.close();
    const app = buildServer({ db, clock: fakeClock() });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false });
    await app.close();
  });

  it("is 503 (not a hang or a 500) when the database is unreachable", async () => {
    const db = pgDb({ connectionString: "postgres://nobody@127.0.0.1:1/none", connectionTimeoutMillis: 2000 });
    const app = buildServer({ db, clock: fakeClock() });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false });
    await app.close();
    await db.close();
  });

  it("only answers GET", async () => {
    const db = pgDb("postgres://nobody@127.0.0.1:1/none");
    const app = buildServer({ db, clock: fakeClock() });
    expect((await app.inject({ method: "POST", url: "/health" })).statusCode).toBe(404);
    await app.close();
    await db.close();
  });
});

describe("QA: bad env config", () => {
  it.each([
    ["1", 1],
    ["65535", 65535],
  ])("accepts the boundary PORT=%s", (port, want) => {
    expect(loadConfig({ PORT: port }).port).toBe(want);
  });

  it.each(["0", "65536", "-0.5", "NaN", "Infinity", "8080abc", "0x50", "1e3", "+80", "80 80"])("refuses PORT=%s with a message naming PORT", (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT/);
  });

  it("an unreachable or malformed DATABASE_URL makes migrate reject promptly (no hang)", { timeout: 20_000 }, async () => {
    for (const url of ["postgres://nobody@127.0.0.1:1/none", "garbage"]) {
      const db = pgDb({ connectionString: url, connectionTimeoutMillis: 2000 });
      await expect(migrate(db)).rejects.toThrow();
      await db.close();
    }
  });
});
