// QA (PR #128): the Quick/starter mode is gone; the 15-min ("15m") timing preset stays and plays a normal game.
// extension.md "Host settings", design §8.1, §17.2
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERSONALITIES, createBots, runBotGame } from "@skimjob/bots";
import { createGame, validateConfig, type GameConfig, type GameEvent } from "@skimjob/engine";
import { devAuthProvider, SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import { gameConfig } from "./lobby";
import { buildServer } from "./server";
import { DEFAULT_SETTINGS, parseSettings, storedSettings } from "./settings";
import { testDb } from "./testkit";

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ nickname: `S${i}`, bot_personality: i === 0 ? null : ("honest" as const) }));
const quick = (over: Record<string, unknown> = {}) => {
  const p = parseSettings({ sessionLength: "15m", ...over });
  if (!p.ok) throw new Error(p.error);
  return p.settings;
};
const types = (log: readonly GameEvent[]) => log.map((e) => e.type);

describe("QA: the old starter/Quick mode is refused or dropped, never half-applied", () => {
  it("lobby settings refuse starterMode (true or false) with a clear error", () => {
    for (const v of [true, false, "yes"]) {
      const p = parseSettings({ sessionLength: "15m", starterMode: v });
      expect(p).toEqual({ ok: false, error: 'unknown setting "starterMode"' });
    }
  });

  it("a stored Quick lobby row with starterMode is read without it: no throw, a normal 15-min game", () => {
    const s = storedSettings({ ...DEFAULT_SETTINGS, sessionLength: "15m", starterMode: true, eventsEnabled: false });
    expect(s).not.toHaveProperty("starterMode");
    expect(s.sessionLength).toBe("15m");
    const cfg = gameConfig(s, seats(5), "qa-stored");
    expect(cfg).not.toHaveProperty("starterMode");
    expect(validateConfig(cfg)).toEqual([]);
    expect(() => createGame(cfg)).not.toThrow();
  });

  it("the engine never reads a hand-built starterMode: the game is the same as without it (shop dealt)", () => {
    const base = gameConfig(quick(), seats(6), "qa-engine");
    const forged = { ...base, starterMode: true, eventsEnabled: true } as unknown as GameConfig;
    expect(() => createGame(forged)).not.toThrow();
    const a = createGame(forged);
    const b = createGame({ ...base, eventsEnabled: true });
    expect(a.log).toEqual(b.log);
    const shop = a.log.find((e) => e.type === "shopDealt") as { perks?: unknown[]; value?: unknown[] } | undefined;
    expect(shop).toBeDefined();
    expect(JSON.stringify(shop)).not.toBe("[]");
    expect(a.log.find((e) => e.type === "gameCreated")).not.toHaveProperty("starterMode");
  });
});

describe("QA: the 15-min preset is a normal game (shop and events), 3/8/12 players", () => {
  for (const n of [3, 8, 12]) {
    it(`${n} players: runs to gameEnded with a 3-perk shop and event cards flipped`, () => {
      const cfg = gameConfig(quick(), seats(n), `qa-quick-${n}-3`);
      expect(cfg.eventsEnabled).toBe(true);
      expect(validateConfig(cfg)).toEqual([]);
      const agents = createBots(cfg.players, (_s, i) => Object.values(PERSONALITIES)[i % Object.values(PERSONALITIES).length]!, cfg.seed);
      const { state, rejections } = runBotGame(cfg, agents, { maxSteps: 2000 });
      expect(rejections).toEqual([]);
      const t = types(state.log);
      // A bust ends the game mid-resolution, so the round's reveal-only `rngAdvanced` can follow it (design §5.5).
      expect(t.filter((x) => x !== "rngAdvanced").at(-1)).toBe("gameEnded");
      expect(t).toContain("shopDealt");
      expect(t).toContain("eventFlipped");
      const shop = state.log.find((e) => e.type === "shopDealt")!;
      expect(Object.values(shop).find(Array.isArray)).toHaveLength(3);
    });
  }

  it("determinism at the 15-min preset: same seed + same bots = identical log", () => {
    const play = () => {
      const cfg = gameConfig(quick(), seats(7), "qa-quick-det");
      return runBotGame(cfg, createBots(cfg.players, () => PERSONALITIES.honest, cfg.seed), { maxSteps: 2000 }).state.log;
    };
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });
});

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
const call = async (method: "POST" | "PATCH", url: string, who: string | null, payload: object) => {
  const res = await app.inject({ method, url, cookies: who ? { [SESSION_COOKIE]: who } : {}, payload });
  return { status: res.statusCode, body: res.json() as Record<string, unknown>, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};

describe("QA: the lobby API has no way back to Quick/starter mode", () => {
  it("create and settings PATCH refuse starterMode with 400, the lobby is untouched", async () => {
    const who = (await call("POST", "/auth/guest", null, { nickname: "Host" })).session!;
    const bad = await call("POST", "/games", who, { settings: { sessionLength: "15m", starterMode: true } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain("starterMode");
    const ok = await call("POST", "/games", who, { settings: { sessionLength: "15m" } });
    expect(ok.status).toBe(201);
    const id = ok.body.id as string;
    for (const patch of [{ starterMode: true }, { starterMode: true, eventsEnabled: false }, { sessionLength: "15m", starterMode: false }]) {
      const r = await call("PATCH", `/games/${id}/settings`, who, { settings: patch });
      expect(r.status, JSON.stringify(patch)).toBe(400);
    }
    // There is no "no shop" setting at all; the host can only turn events off, and the shop still deals.
    expect(Object.keys(DEFAULT_SETTINGS).some((k) => /shop/i.test(k))).toBe(false);
    const off = await call("PATCH", `/games/${id}/settings`, who, { settings: { eventsEnabled: false } });
    expect(off.status).toBe(200);
    const cfg = gameConfig(quick({ eventsEnabled: false }), seats(4), "qa-off");
    expect(types(createGame(cfg).log)).toContain("shopDealt");
  });
});
