// QA (PR #130, R7 C2c; S3a.6): lobby requests and stored lobbies naming the dropped R6 role settings (per-role toggles,
// deck, deal style, unique roles, `mole`): every player gets a role by the standard deal. design §11.3, §16
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

const DROPPED = { roles: ["lookout", "muscle"], deck: "everything", deal: "random", uniqueRoles: false, mole: "off" } as const;
const addBots = async (who: string, id: string, n: number) => {
  for (let i = 0; i < n; i++) expect((await call("POST", `/games/${id}/bots`, who, { personality: "greedy" })).status).toBeLessThan(300);
};
const setStored = (id: string, settings: object) => db.query("update games set settings = $2::jsonb where id = $1", [id, JSON.stringify(settings)]);

describe("lobby requests naming a dropped role setting are refused cleanly", () => {
  it.each(Object.entries(DROPPED))("creating a lobby with %s: 400 unknown setting, no lobby", async (key, value) => {
    const who = await guest("Host");
    const res = await call("POST", "/games", who, { settings: { [key]: value } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`unknown setting "${key}"`);
  });
  it("a settings change naming one is refused and leaves the stored settings as they were", async () => {
    const { who, game } = await host();
    for (const [key, value] of Object.entries(DROPPED)) expect((await call("PATCH", `/games/${game.id}/settings`, who, { settings: { [key]: value } })).status).toBe(400);
    expect((await call("GET", `/games/${game.id}`, who)).body.settings).toEqual(DEFAULT_SETTINGS);
  });
  it("a lobby stored before the deploy with them (a cut role toggled on too) is read without them and starts (status 200)", async () => {
    const { who, game } = await host();
    await addBots(who, game.id, 4);
    await setStored(game.id, { ...DEFAULT_SETTINGS, ...DROPPED });
    expect((await call("GET", `/games/${game.id}`, who)).body.settings).toEqual(DEFAULT_SETTINGS);
    const started = await call("POST", `/games/${game.id}/start`, who);
    expect(started.status).toBe(200);
    expect(started.body.status).toBe("running");
  });
});
