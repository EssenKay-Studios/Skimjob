// QA (PR #125, C2a): the lobby can't start a game below 3 seats, however the
// seats are made up, and starts at exactly 3 and at 12. design §15
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devAuthProvider, SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import { testDb } from "./testkit";

let db: Db;
let app: FastifyInstance;
beforeAll(async () => {
  db = await testDb();
  app = buildServer({ db, clock: fakeClock(Date.UTC(2026, 10, 6)), auth: [devAuthProvider()] });
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

type Res = { status: number; body: Record<string, unknown> & Partial<LobbyView>; session: string | null };
const call = async (method: "GET" | "POST" | "DELETE", url: string, who: string | null = null, payload?: unknown): Promise<Res> => {
  const res = await app.inject({ method, url, cookies: who !== null ? { [SESSION_COOKIE]: who } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: res.json(), session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};
const guest = async (nickname: string) => (await call("POST", "/auth/guest", null, { nickname })).session!;
const host = async () => {
  const who = await guest("Host");
  const res = await call("POST", "/games", who, {});
  expect(res.status).toBe(201);
  return { who, game: res.body as unknown as LobbyView };
};
const addBot = async (id: string, who: string) => expect((await call("POST", `/games/${id}/bots`, who, {})).status).toBe(201);
const start = (id: string, who: string) => call("POST", `/games/${id}/start`, who, {});

describe("QA #125: the lobby needs 3 seats to start", () => {
  it("a new lobby says minSeats 3, maxSeats 12", async () => {
    const { game } = await host();
    expect([game.minSeats, game.maxSeats]).toEqual([3, 12]);
  });

  it("the host alone, host + 1 bot, host + 1 guest are refused 409 and the game stays in the lobby", async () => {
    const { who, game } = await host();
    expect((await start(game.id, who)).status).toBe(409);
    await addBot(game.id, who);
    const two = await start(game.id, who);
    expect(two.status).toBe(409);
    expect(String(two.body.message ?? two.body.error ?? "")).toMatch(/3/);
    const g2 = await host();
    expect((await call("POST", `/invites/${g2.game.inviteCode}/join`, await guest("Ana"), { nickname: "Ana" })).status).toBeLessThan(300);
    expect((await start(g2.game.id, g2.who)).status).toBe(409);
    // Still joinable and startable once a third seat arrives.
    await addBot(game.id, who);
    const ok = await start(game.id, who);
    expect(ok.status).toBe(200);
    expect(ok.body.seats).toHaveLength(3);
  });

  it("3 seats, then one removed back to 2, is refused again", async () => {
    const { who, game } = await host();
    await addBot(game.id, who);
    await addBot(game.id, who);
    expect((await call("DELETE", `/games/${game.id}/bots/2`, who)).status).toBe(200);
    expect((await start(game.id, who)).status).toBe(409);
  });

  it("12 seats start", async () => {
    const { who, game } = await host();
    for (let i = 0; i < 11; i++) await addBot(game.id, who);
    const ok = await start(game.id, who);
    expect(ok.status).toBe(200);
    expect(ok.body.seats).toHaveLength(12);
  });
});
