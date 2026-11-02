// QA for PR #43: server bots get a crewSeed for the shared hunch derived from
// the game's secret seed (sha256("crew\0" + seed)): one per game, the same for
// every bot in it, different between games, and in no player's view.
// design §17.2, §17.3; PR #37 review
import { createHash } from "node:crypto";
import { viewFor } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BotOptions } from "@skimjob/bots";
import { SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import { createGameStore } from "./store";
import { testDb } from "./testkit";

const made = vi.hoisted(() => [] as BotOptions[]);
vi.mock("@skimjob/bots", async (importOriginal) => {
  const real = await importOriginal<typeof import("@skimjob/bots")>();
  return {
    ...real,
    createBot: (o: BotOptions) => {
      made.push(o);
      return real.createBot(o);
    },
  };
});

const clock = fakeClock(Date.UTC(2026, 10, 2));
let db: Db;
let app: FastifyInstance;
beforeAll(async () => {
  db = await testDb();
  app = buildServer({ db, clock, store: createGameStore(db) });
  await app.ready();
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

const call = async (url: string, who: string | null, payload: Record<string, unknown> = {}) => {
  const res = await app.inject({ method: "POST", url, payload, cookies: who ? { [SESSION_COOKIE]: who } : {} });
  return { body: res.json() as LobbyView, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};

async function startGame(bots: number): Promise<string> {
  const host = (await call("/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await call("/games", host, {})).body;
  for (let i = 0; i < bots; i++) await call(`/games/${game.id}/bots`, host, { personality: (["opportunist", "greedy", "honest", "cautious"] as const)[i % 4] });
  await call(`/games/${game.id}/start`, host);
  await app.live.settle(game.id);
  return game.id;
}

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

describe("QA PR #43: server crewSeed", () => {
  it("every server bot gets crewSeed = sha256('crew\\0' + secret seed): shared in a game, different between games, never in a view", async () => {
    const seeds: string[] = [];
    for (let g = 0; g < 2; g++) {
      made.length = 0;
      const id = await startGame(4);
      const state = (await createGameStore(db).load(id))!;
      expect(made.length).toBeGreaterThan(0);
      const expected = sha256(`crew\0${state.config.seed}`);
      for (const o of made) {
        expect(o.crewSeed).toBe(expected);
        expect(o.crewSeed).not.toBe(o.seed);
      }
      expect(new Set(made.map((o) => o.player)).size).toBe(4);
      for (const p of state.playerOrder) {
        const text = JSON.stringify(viewFor(state, p));
        expect(text).not.toContain(expected);
        expect(text).not.toContain(state.config.seed);
      }
      expect(app.live.botRefusals.filter((r) => r.gameId === id)).toEqual([]);
      seeds.push(expected);
    }
    expect(seeds[0]).not.toBe(seeds[1]);
  }, 60_000);
});
