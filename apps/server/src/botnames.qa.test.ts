// QA (PR #307, #260): bot seats are "<Name>B" (RiyaB), a human can't take a generated bot name,
// and a full lobby of bots gets unique names in that style with no "Bot" word. design §15
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "@skimjob/content";
import { devAuthProvider, SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import { BOT_NAMES, botName, checkNickname, isBotName } from "./settings";
import { createGameStore } from "./store";
import { testDb } from "./testkit";

let db: Db;
let app: FastifyInstance;
beforeAll(async () => {
  db = await testDb();
  app = buildServer({ db, clock: fakeClock(Date.UTC(2026, 10, 14)), store: createGameStore(db), auth: [devAuthProvider()] });
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

const call = async (method: "GET" | "POST" | "DELETE", url: string, who: string | null = null, payload?: Record<string, unknown>) => {
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

describe("QA: isBotName / checkNickname boundaries", () => {
  it.each([...BOT_NAMES.map(botName), "0B", "12B", "13b", "007B", "ＺＥＤＢ", "zed b", "Wren​B"])("reserves %j", (name) => {
    expect(isBotName(name)).toBe(true);
    expect(checkNickname(name).ok).toBe(false);
  });

  it.each(["B", "Bob", "Caleb", "Rob", "RiyaBB", "BRiya", "Riya", "Max B.", "7", "B7", "7Bx", "Bot · Riya", "Bot"])("allows %j", (name) => {
    expect(isBotName(name)).toBe(false);
    expect(checkNickname(name).ok).toBe(true);
  });
});

describe("QA: bot seat names in a lobby", () => {
  it("a lobby filled to the cap with bots: every bot is <Name>B from the list, in order, unique, no 'Bot' word", async () => {
    const { who, game } = await host();
    for (let i = 1; i < MAX_PLAYERS; i++) expect((await call("POST", `/games/${game.id}/bots`, who, {})).status).toBe(201);
    expect((await call("POST", `/games/${game.id}/bots`, who, {})).status).toBe(409); // full
    const names = (await call("GET", `/games/${game.id}`, who)).body.seats!.filter((s) => s.bot).map((s) => s.nickname);
    expect(names).toEqual(BOT_NAMES.slice(0, MAX_PLAYERS - 1).map(botName));
    expect(names.every((n) => !/bot|·/i.test(n))).toBe(true);
  });

  it("a seat already holding a bot name (a stored pre-ruling human) is skipped: the next bot gets the next name", async () => {
    const { who, game } = await host();
    expect((await call("POST", `/invites/${game.inviteCode}/join`, null, { nickname: "Ana" })).status).toBe(200);
    await db.query("update seats set nickname = 'riyab' where game_id = $1 and seat_no = 1", [game.id]);
    const res = await call("POST", `/games/${game.id}/bots`, who, {});
    expect(res.status).toBe(201);
    expect(res.body.seats!.at(-1)).toMatchObject({ seat: 2, nickname: "MaxB" });
  });

  it("a signed-in user whose saved name is a bot name can't join under it, but can with another nickname", async () => {
    const { game } = await host();
    const who = await guest("Ana");
    await db.query("update users set display_name = 'NicoB' where display_name = 'Ana'");
    expect((await call("POST", `/invites/${game.inviteCode}/join`, who, {})).status).toBe(400);
    expect((await call("POST", `/invites/${game.inviteCode}/join`, who, { nickname: "nicob" })).status).toBe(400);
    const ok = await call("POST", `/invites/${game.inviteCode}/join`, who, { nickname: "Nico" });
    expect(ok.status).toBe(200);
    expect(ok.body.seats!.map((s) => s.nickname)).toContain("Nico");
  });

  it("a human Riya and bot RiyaB sit in the same game as two different names", async () => {
    const { who, game } = await host();
    expect((await call("POST", `/invites/${game.inviteCode}/join`, null, { nickname: "Riya" })).status).toBe(200);
    const res = await call("POST", `/games/${game.id}/bots`, who, {});
    expect(res.body.seats!.map((s) => s.nickname)).toEqual(["Karthik", "Riya", "RiyaB"]);
  });
});
