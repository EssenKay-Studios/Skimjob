// App factory, /health and env config. docs/m2-plan.md M2-1
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeClock } from "./clock";
import { DEV_ORIGINS, loadConfig, StartupError } from "./config";
import type { Db } from "./db";
import { buildServer } from "./server";
import { testDb } from "./testkit";

let db: Db;
beforeAll(async () => {
  db = await testDb();
}, 30_000);
afterAll(() => db.close());

describe("buildServer", () => {
  it("answers /health when the database does", async () => {
    const app = buildServer({ db, clock: fakeClock() });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("answers 503 when the database doesn't", async () => {
    const broken: Db = { ...db, query: async () => Promise.reject(new Error("down")) };
    const app = buildServer({ db: broken, clock: fakeClock() });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false });
    await app.close();
  });

  it("404s unknown routes", async () => {
    const app = buildServer({ db, clock: fakeClock() });
    expect((await app.inject({ method: "GET", url: "/nope" })).statusCode).toBe(404);
    await app.close();
  });
});

describe("loadConfig", () => {
  it("has zero-setup defaults: loopback, port 3000, PGlite on disk, no dev login", () => {
    expect(loadConfig({})).toEqual({ port: 3000, host: "127.0.0.1", databaseUrl: null, pgliteDir: ".pglite", devLogin: false, allowedOrigins: DEV_ORIGINS, production: false, publicOrigin: null, webDir: null, timeScale: 1, google: null });
  });

  it("reads the environment", () => {
    expect(
      loadConfig({ PORT: "8080", HOST: "0.0.0.0", DATABASE_URL: "postgres://x@localhost/y", PGLITE_DIR: "memory", DEV_LOGIN: "1" }),
    ).toEqual({ port: 8080, host: "0.0.0.0", databaseUrl: "postgres://x@localhost/y", pgliteDir: null, devLogin: true, allowedOrigins: DEV_ORIGINS, production: false, publicOrigin: null, webDir: null, timeScale: 1, google: null });
    // M2-12: Google sign-in from GOOGLE_* (more cases in auth.test.ts).
    expect(loadConfig({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_REDIRECT_URL: "http://localhost:5173/api/auth/google/callback" }).google).toEqual({
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "http://localhost:5173/api/auth/google/callback",
    });
    expect(loadConfig({ ALLOWED_ORIGINS: " https://skimjob.example , http://lan:5173," }).allowedOrigins).toEqual(["https://skimjob.example", "http://lan:5173"]);
    expect(loadConfig({ DEV_LOGIN: "true" }).devLogin).toBe(false);
  });

  it.each(["abc", "-1", "70000", "1.5", "0", "0x50", "1e3"])("refuses PORT=%s", (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(StartupError);
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT must be a whole number from 1 to 65535/);
  });

  it.each(["", " ", undefined])("treats a blank or unset PORT (%j) as the default 3000, like HOST", (port) => {
    expect(loadConfig(port === undefined ? {} : { PORT: port }).port).toBe(3000);
  });

  it("treats a blank PGLITE_DIR as the default directory", () => {
    expect(loadConfig({ PGLITE_DIR: "" }).pgliteDir).toBe(".pglite");
  });
});

describe("fakeClock", () => {
  it("moves only when told to, and only forward", () => {
    const clock = fakeClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
    expect(() => clock.advance(-1)).toThrow();
  });
});
