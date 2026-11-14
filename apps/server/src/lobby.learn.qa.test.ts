// QA for POST /games/learn (design §14): the default seat name, what the body
// can't change (timings, ruleset, crew), a running game nobody can join or
// reshape, the host's pause, and that an ordinary lobby can't pick the ruleset.
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devAuthProvider, SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import { createGameStore, type GameStore } from "./store";
import { testDb } from "./testkit";

let db: Db;
let app: FastifyInstance;
let store: GameStore;
beforeAll(async () => {
  db = await testDb();
  store = createGameStore(db);
  app = buildServer({ db, clock: fakeClock(Date.UTC(2026, 10, 14)), store, auth: [devAuthProvider()] });
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

const call = async (method: "GET" | "POST" | "DELETE" | "PATCH", url: string, who: string | null = null, payload?: Record<string, unknown>) => {
  const cookies: Record<string, string> = who ? { [SESSION_COOKIE]: who } : {};
  const res = await app.inject(payload ? { method, url, payload, cookies } : { method, url, cookies });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> & Partial<LobbyView> };
};
const guest = async (nickname: string) => {
  const res = await app.inject({ method: "POST", url: "/auth/guest", payload: { nickname } });
  return res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
};

describe("POST /games/learn — design §14", () => {
  it("without a nickname seats you under your account name", async () => {
    const who = await guest("Juno");
    const res = await call("POST", "/games/learn", who, {});
    expect(res.status).toBe(201);
    expect(res.body.seats![0]!.nickname).toBe("Juno");
    expect(res.body.seats).toHaveLength(4);
  });

  it("ignores settings, a ruleset and a seed in the body: always Learn on the 15 min timings", async () => {
    const who = await guest("Kit");
    const res = await call("POST", "/games/learn", who, { nickname: "Kit", settings: { sessionLength: "7d", eventsEnabled: true }, ruleset: "simplified", seed: "mine" });
    expect(res.status).toBe(201);
    expect(res.body.settings).toMatchObject({ sessionLength: "15m" });
    const state = (await store.load(res.body.id!))!;
    expect(state.config.ruleset).toBe("learn");
    expect(state.config.seed).not.toBe("mine");
    expect(state.shop).toEqual([]);
  });

  it("each call is its own game, and a second one doesn't touch the first", async () => {
    const who = await guest("Lior");
    const a = await call("POST", "/games/learn", who, {});
    const b = await call("POST", "/games/learn", who, {});
    expect(a.body.id).not.toBe(b.body.id);
    expect((await store.load(a.body.id!))!.phase.kind).toBe("planning");
    expect((await store.load(b.body.id!))!.phase.kind).toBe("planning");
  });

  it("the running game can't be joined, restarted or reshaped", async () => {
    const who = await guest("Moss");
    const game = (await call("POST", "/games/learn", who, {})).body as LobbyView;
    expect((await call("POST", `/invites/${game.inviteCode}/join`, await guest("Nell"), { nickname: "Nell" })).status).toBe(410);
    expect((await call("POST", `/games/${game.id}/start`, who, {})).status).toBe(409);
    expect((await call("POST", `/games/${game.id}/bots`, who, {})).status).toBe(409);
    expect((await call("DELETE", `/games/${game.id}/bots/1`, who)).status).toBe(409);
    expect((await call("PATCH", `/games/${game.id}/settings`, who, { sessionLength: "7d" })).status).toBe(409);
  });

  it("you host it: you can pause it; another player can't see it", async () => {
    const who = await guest("Oak");
    const game = (await call("POST", "/games/learn", who, {})).body as LobbyView;
    expect((await call("POST", `/games/${game.id}/pause`, who, {})).status).toBe(200);
    const other = await guest("Pim");
    expect((await call("GET", `/games/${game.id}`, other)).status).toBeGreaterThanOrEqual(400);
    expect((await call("POST", `/games/${game.id}/pause`, other, {})).status).toBeGreaterThanOrEqual(400);
  });
});

describe("an ordinary lobby can't pick the Learn ruleset — design §14 (no lobby setting)", () => {
  it("refuses a ruleset among the lobby settings", async () => {
    const made = await call("POST", "/games", await guest("Quin"), { settings: { ruleset: "learn" } });
    expect(made.status).toBe(400);
  });

  it("ignores a ruleset in the start body: the game plays the default", async () => {
    const who = await guest("Rho");
    const id = (await call("POST", "/games", who, {})).body.id!;
    for (let i = 0; i < 3; i++) expect((await call("POST", `/games/${id}/bots`, who, {})).status).toBeLessThan(300);
    expect((await call("POST", `/games/${id}/start`, who, { ruleset: "learn" })).status).toBe(200);
    const state = (await store.load(id))!;
    expect(state.config.ruleset).toBeUndefined();
    expect(state.shop.length).toBeGreaterThan(0);
  });
});
