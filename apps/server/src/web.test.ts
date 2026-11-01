// Serving the built web app from the game server, and the production config.
// docs/deploy.md
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeClock } from "./clock";
import { DEV_ORIGINS, loadConfig, StartupError } from "./config";
import type { Db } from "./db";
import { buildServer } from "./server";
import { serverDeps } from "./startup";
import { testDb } from "./testkit";
import { checkWebDir, isPageRequest, stripApiPrefix } from "./web";

const INDEX = "<!doctype html><title>Skimjob</title><div id=root></div>";

let db: Db;
let dir: string;
let app: FastifyInstance;
beforeAll(async () => {
  db = await testDb();
  dir = mkdtempSync(join(tmpdir(), "skimjob-web-"));
  writeFileSync(join(dir, "index.html"), INDEX);
  writeFileSync(join(dir, "favicon.svg"), "<svg/>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log(1)");
  writeFileSync(join(tmpdir(), "skimjob-secret.txt"), "nope");
  app = buildServer({ db, clock: fakeClock(), webDir: dir });
  await app.ready();
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("static web app", () => {
  it("serves index.html at / and revalidates it", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.body).toBe(INDEX);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("serves hashed assets with a year-long immutable cache", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    const icon = await app.inject({ method: "GET", url: "/favicon.svg" });
    expect(icon.statusCode).toBe(200);
    expect(icon.headers["cache-control"]).toBe("no-cache");
  });

  it.each(["/join/abc", "/join/ABCD-1234", "/lobby/42", "/game/42", "/dev/gallery", "/some/unknown/page", "/join/abc?x=1"])(
    "falls back to index.html for the client route %s",
    async (url) => {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^text\/html/);
      expect(res.headers["cache-control"]).toBe("no-cache");
      expect(res.body).toBe(INDEX);
    },
  );

  it("404s a missing file instead of sending the page for it", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/missing-123.js" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not found" });
  });

  it("never serves files outside WEB_DIR", async () => {
    for (const url of ["/../skimjob-secret.txt", "/%2e%2e/skimjob-secret.txt", "/assets/..%2f..%2fskimjob-secret.txt"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.body).not.toContain("nope");
    }
  });

  it("keeps the API answering beside the app, bare and under /api", async () => {
    for (const url of ["/health", "/api/health"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    }
    expect((await app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
  });

  it("answers an unknown /api route with JSON 404, not the page", async () => {
    for (const url of ["/api/nope", "/api", "/api/", "/api/join/abc", "/api/favicon.svg"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not found" });
    }
  });

  it("doesn't send the page for other methods", async () => {
    const res = await app.inject({ method: "POST", url: "/join/abc", payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

describe("without WEB_DIR (dev: Vite serves the app)", () => {
  it("serves no pages, but /api still maps to the routes", async () => {
    const bare = buildServer({ db, clock: fakeClock() });
    expect((await bare.inject({ method: "GET", url: "/join/abc" })).statusCode).toBe(404);
    expect((await bare.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ ok: true });
    await bare.close();
  });
});

describe("stripApiPrefix", () => {
  it.each([
    ["/api/games/1?x=2", "/games/1?x=2"],
    ["/api/games/1/ws", "/games/1/ws"],
    ["/api", "/"],
    ["/api?x", "/?x"],
    ["/apix", "/apix"],
    ["/health", "/health"],
    ["/", "/"],
  ])("%s → %s", (from, to) => expect(stripApiPrefix(from)).toBe(to));
});

describe("isPageRequest", () => {
  it("is a GET or HEAD for a path without a file extension, outside /api", () => {
    expect(isPageRequest("GET", "/join/abc")).toBe(true);
    expect(isPageRequest("HEAD", "/lobby/1?x=a.b")).toBe(true);
    expect(isPageRequest("GET", "/robots.txt")).toBe(false);
    expect(isPageRequest("GET", "/api/whatever")).toBe(false);
    expect(isPageRequest("POST", "/join/abc")).toBe(false);
  });
});

describe("checkWebDir", () => {
  it("refuses a directory without index.html", () => {
    expect(() => checkWebDir(tmpdir() + "/skimjob-no-such-dir")).toThrow(/no index.html/);
    expect(() => checkWebDir(dir)).not.toThrow();
  });
});

describe("production config (NODE_ENV=production)", () => {
  const prod = { NODE_ENV: "production", PUBLIC_ORIGIN: "https://skimjob.fly.dev" };

  it("turns the dev sign-in stub off even with DEV_LOGIN=1", async () => {
    const config = loadConfig({ ...prod, DEV_LOGIN: "1" });
    expect(config.devLogin).toBe(false);
    const prodApp = buildServer({ db, clock: fakeClock(), ...serverDeps(config) });
    expect((await prodApp.inject({ method: "GET", url: "/auth/providers" })).json()).toEqual({ providers: [] });
    expect((await prodApp.inject({ method: "GET", url: "/auth/dev/start?hint=Riya" })).statusCode).toBe(404);
    await prodApp.close();
    // Outside production it still works.
    expect(serverDeps(loadConfig({ DEV_LOGIN: "1" })).auth?.map((p) => p.name)).toEqual(["dev"]);
  });

  it("listens on 0.0.0.0, allows only the public origin, and marks cookies Secure behind the proxy", async () => {
    const config = loadConfig(prod);
    expect(config).toMatchObject({ production: true, host: "0.0.0.0", publicOrigin: "https://skimjob.fly.dev", allowedOrigins: ["https://skimjob.fly.dev"] });
    expect(loadConfig({ ...prod, HOST: "127.0.0.1" }).host).toBe("127.0.0.1");
    const prodApp = buildServer({ db, clock: fakeClock(), ...serverDeps(config) });
    const res = await prodApp.inject({ method: "POST", url: "/api/auth/guest", payload: { nickname: "Riya" } });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/sj_session=/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/HttpOnly/);
    await prodApp.close();
  });

  it("keeps dev cookies plain (http://localhost)", async () => {
    const devApp = buildServer({ db, clock: fakeClock(), ...serverDeps(loadConfig({})) });
    const res = await devApp.inject({ method: "POST", url: "/auth/guest", payload: { nickname: "Riya" } });
    expect(String(res.headers["set-cookie"])).not.toMatch(/Secure/);
    await devApp.close();
  });

  it("trusts the proxy's X-Forwarded-Proto in production only", async () => {
    for (const [env, want] of [[prod, "https"], [{}, "http"]] as const) {
      const a = buildServer({ db, clock: fakeClock(), ...serverDeps(loadConfig(env)) });
      a.get("/proto", async (req) => ({ protocol: req.protocol }));
      const res = await a.inject({ method: "GET", url: "/proto", headers: { "x-forwarded-proto": "https" } });
      expect(res.json()).toEqual({ protocol: want });
      await a.close();
    }
  });

  it("adds PUBLIC_ORIGIN to the dev origins outside production, and to ALLOWED_ORIGINS", () => {
    expect(loadConfig({ PUBLIC_ORIGIN: "https://skimjob.fly.dev" }).allowedOrigins).toEqual([...DEV_ORIGINS, "https://skimjob.fly.dev"]);
    expect(loadConfig({ ...prod, ALLOWED_ORIGINS: "https://a.example" }).allowedOrigins).toEqual(["https://a.example", "https://skimjob.fly.dev"]);
    expect(loadConfig({ NODE_ENV: "production" }).allowedOrigins).toEqual([]);
  });

  it.each(["skimjob.fly.dev", "https://skimjob.fly.dev/game", "ftp://x.example", "https://"])("refuses PUBLIC_ORIGIN=%s", (origin) => {
    expect(() => loadConfig({ PUBLIC_ORIGIN: origin })).toThrow(StartupError);
  });

  it("accepts a trailing slash on PUBLIC_ORIGIN", () => {
    expect(loadConfig({ PUBLIC_ORIGIN: "https://skimjob.fly.dev/" }).publicOrigin).toBe("https://skimjob.fly.dev");
  });

  it("reads WEB_DIR", () => {
    expect(loadConfig({ WEB_DIR: "/app/web" }).webDir).toBe("/app/web");
    expect(loadConfig({}).webDir).toBeNull();
  });
});
