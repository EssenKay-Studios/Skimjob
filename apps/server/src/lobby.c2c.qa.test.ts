// QA (PR #130, R7 C2c): lobby requests and stored lobbies naming a cut R6 role or the dropped `mole` setting. extension.md "Host settings"
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devAuthProvider, SESSION_COOKIE } from "./auth";
import { fakeClock, type FakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import { DEFAULT_SETTINGS } from "./settings";
import { createGameStore, type GameStore } from "./store";
import { testDb } from "./testkit";

let db: Db;
let app: FastifyInstance;
let clock: FakeClock;
let store: GameStore;
beforeAll(async () => {
  db = await testDb();
  clock = fakeClock(Date.UTC(2026, 10, 1));
  store = createGameStore(db);
  app = buildServer({ db, clock, store, auth: [devAuthProvider()] });
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

type Who = string | null; // a session token
const call = async (method: "GET" | "POST" | "DELETE" | "PATCH", url: string, who: Who = null, payload?: Record<string, unknown>) => {
  const cookies: Record<string, string> = who ? { [SESSION_COOKIE]: who } : {};
  const res = await app.inject(payload ? { method, url, payload, cookies } : { method, url, cookies });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
  return { status: res.statusCode, body: res.json() as Record<string, unknown> & Partial<LobbyView>, session: set ?? null, res };
};
const guest = async (nickname: string) => (await call("POST", "/auth/guest", null, { nickname })).session!;
const host = async (settings?: object) => {
  const who = await guest("Karthik");
  const res = await call("POST", "/games", who, settings ? { settings } : {});
  expect(res.status).toBe(201);
  return { who, game: res.body as unknown as LobbyView };
};
const join = async (code: string, nickname: string, who: Who = null) => call("POST", `/invites/${code}/join`, who, { nickname });

const CUT = ["insideMan", "getawayDriver", "fence", "blackmailer", "forger", "muscle", "snitch", "bagman", "cleaner", "mastermind", "embezzler"];
const addBots = async (who: string, id: string, n: number) => {
  for (let i = 0; i < n; i++) expect((await call("POST", `/games/${id}/bots`, who, { personality: "greedy" })).status).toBeLessThan(300);
};
const setStored = (id: string, settings: object) => db.query("update games set settings = $2::jsonb where id = $1", [id, JSON.stringify(settings)]);

describe("lobby requests naming a cut role or the dropped mole setting are refused cleanly", () => {
  it.each(CUT)("creating a lobby with %s toggled on: 400, no lobby", async (cut) => {
    const who = await guest("Host");
    const res = await call("POST", "/games", who, { settings: { roles: ["lookout", cut] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/roles must be a list of distinct role ids/);
  });
  it.each(["off", "maybe", "on"])("creating a lobby with mole: %s: 400 unknown setting", async (mole) => {
    const who = await guest("Host");
    const res = await call("POST", "/games", who, { settings: { mole } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown setting "mole"');
  });
  it("a settings change naming a cut role or mole is refused and leaves the stored settings as they were", async () => {
    const { who, game } = await host();
    for (const cut of CUT) expect((await call("PATCH", `/games/${game.id}/settings`, who, { settings: { roles: [cut] } })).status).toBe(400);
    expect((await call("PATCH", `/games/${game.id}/settings`, who, { settings: { mole: "off" } })).status).toBe(400);
    expect((await call("GET", `/games/${game.id}`, who)).body.settings).toEqual(DEFAULT_SETTINGS);
  });
  it("a lobby stored before the deploy with mole: off is read without it and starts (status 200)", async () => {
    const { who, game } = await host();
    await addBots(who, game.id, 4);
    await setStored(game.id, { ...DEFAULT_SETTINGS, mole: "off" });
    expect((await call("GET", `/games/${game.id}`, who)).body.settings).toEqual(DEFAULT_SETTINGS);
    const started = await call("POST", `/games/${game.id}/start`, who);
    expect(started.status).toBe(200);
    expect(started.body.status).toBe("running");
  });
  it("a lobby stored before the deploy with a cut role toggled on: /start is a clean 409 naming it; re-picking the roles starts it", async () => {
    const { who, game } = await host();
    await addBots(who, game.id, 4);
    await setStored(game.id, { ...DEFAULT_SETTINGS, roles: ["lookout", "muscle", "hacker"] });
    const refused = await call("POST", `/games/${game.id}/start`, who);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("these roles are no longer in the game: muscle; pick the roles again");
    expect((await call("PATCH", `/games/${game.id}/settings`, who, { settings: { roles: ["lookout", "hacker"] } })).status).toBe(200);
    expect((await call("POST", `/games/${game.id}/start`, who)).status).toBe(200);
  });
});
