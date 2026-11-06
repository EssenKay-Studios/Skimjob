// QA (PR #132, R7 C2d): lobby requests and stored lobbies naming a dropped event card or the
// Server room's old pocket count. The server has no per-card settings: such keys are refused
// on create / change and dropped from a stored row, and the lobby still starts. design §10, §15
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
  clock = fakeClock(Date.UTC(2026, 10, 6));
  store = createGameStore(db);
  app = buildServer({ db, clock, store, auth: [devAuthProvider()] });
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

type Who = string | null;
const call = async (method: "GET" | "POST" | "PATCH", url: string, who: Who = null, payload?: Record<string, unknown>) => {
  const cookies: Record<string, string> = who ? { [SESSION_COOKIE]: who } : {};
  const res = await app.inject(payload ? { method, url, payload, cookies } : { method, url, cookies });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
  return { status: res.statusCode, body: res.json() as Record<string, unknown> & Partial<LobbyView>, session: set ?? null };
};
const guest = async (nickname: string) => (await call("POST", "/auth/guest", null, { nickname })).session!;
const host = async () => {
  const who = await guest("Karthik");
  const res = await call("POST", "/games", who, {});
  expect(res.status).toBe(201);
  return { who, game: res.body as unknown as LobbyView };
};
const addBots = async (who: string, id: string, n: number) => {
  for (let i = 0; i < n; i++) expect((await call("POST", `/games/${id}/bots`, who, { personality: "greedy" })).status).toBeLessThan(300);
};
const setStored = (id: string, settings: object) => db.query("update games set settings = $2::jsonb where id = $1", [id, JSON.stringify(settings)]);

const BAD: Array<Record<string, unknown>> = [
  { events: { powerCut: {} } },
  { eventCards: ["quietNight", "payday"] },
  { contentOverrides: { events: { doubleCross: {} } } },
  { serverRoom: "pocketCount" },
];

describe("QA: lobby settings naming a dropped card or the Server room's pocket count", () => {
  it.each(BAD)("creating a lobby with %j: 400 unknown setting, no crash", async (settings) => {
    const who = await guest("Host");
    const res = await call("POST", "/games", who, { settings: { eventsEnabled: true, ...settings } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`unknown setting ${JSON.stringify(Object.keys(settings)[0])}`);
  });
  it("a settings change naming them is refused and leaves the stored settings as they were", async () => {
    const { who, game } = await host();
    for (const settings of BAD) expect((await call("PATCH", `/games/${game.id}/settings`, who, { settings })).status).toBe(400);
    expect((await call("GET", `/games/${game.id}`, who)).body.settings).toEqual(DEFAULT_SETTINGS);
  });
  it("a lobby stored with those keys is read without them and starts with events on (status 200)", async () => {
    const { who, game } = await host();
    await addBots(who, game.id, 5);
    await setStored(game.id, Object.assign({ ...DEFAULT_SETTINGS, eventsEnabled: true }, ...BAD));
    expect((await call("GET", `/games/${game.id}`, who)).body.settings).toEqual({ ...DEFAULT_SETTINGS, eventsEnabled: true });
    const started = await call("POST", `/games/${game.id}/start`, who);
    expect(started.status).toBe(200);
    expect(started.body.status).toBe("running");
    const state = await store.load(game.id);
    expect(state?.config.contentOverrides ?? null).toBeNull();
    expect(state?.config.eventsEnabled).toBe(true);
    // 6 seats: the Server room is in play and a plain room.
    expect(state?.rooms).toContain("serverRoom");
  });
});
