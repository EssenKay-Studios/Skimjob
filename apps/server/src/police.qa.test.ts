// Hidden police moments on the server: no client can see or time them.
// extension.md "Police activity" and Build notes "Police activity" (no leak: never in
// timers, views or deadline payloads; scheduling never counts as a view change; game time).
import type { GameState } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "./auth";
import { fakeClock, type FakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import { gameTimeFrozen, isHiddenDeadline } from "./scheduler";
import { buildServer } from "./server";
import { createGameStore, type GameStore } from "./store";
import { testDb } from "./testkit";

let db: Db;
let clock: FakeClock;
let store: GameStore;
let app: FastifyInstance;

beforeAll(async () => {
  db = await testDb();
  clock = fakeClock(Date.UTC(2026, 10, 3, 9));
  store = createGameStore(db);
  app = buildServer({ db, clock, store });
  await app.ready();
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

const post = async (url: string, who: string | null, payload: Record<string, unknown> = {}) => {
  const res = await app.inject({ method: "POST", url, payload, cookies: who ? { [SESSION_COOKIE]: who } : {} });
  return { body: res.json() as LobbyView, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};
const deadlines = async (gameId: string) =>
  (
    await db.query<{ key: string; due: number; paused: boolean; command: unknown }>(
      "select key, (extract(epoch from due_at) * 1000)::float8 as due, paused_at is not null as paused, command from deadlines where game_id = $1 order by due_at, key",
      [gameId],
    )
  ).map((r) => ({ ...r, due: Math.round(r.due) }));

/** Anything that would let a client find or time a police moment. */
const LEAK = /police:\d|policeMoment|policeScheduled|gapPermille|patrol/;

describe("hidden police moments never reach a client (extension.md \"Police activity\")", () => {
  it("are stored deadlines, but never in timers or socket messages; a quiet moment sends nothing; they stop on game time", async () => {
    const host = (await post("/auth/guest", null, { nickname: "Host" })).session!;
    // A Mole is in the deck and the role list is "Possible", so the game has police moments whoever is dealt.
    const game = (await post("/games", host, { settings: { sessionLength: "1h", deck: "everything", roleList: "possible" } })).body;
    for (let i = 0; i < 5; i++) await post(`/games/${game.id}/bots`, host, { personality: i % 2 ? "greedy" : "opportunist" });
    await post(`/games/${game.id}/start`, host);
    const id = game.id;
    expect((await store.load(id))!.police).not.toBeNull();

    const ws = await app.injectWS(`/games/${id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${host}` } });
    const messages: string[] = [];
    ws.on("message", (d) => messages.push(String(d)));
    let barrier = 0;
    /** Waits until everything the server sent so far has arrived (a no-op queues behind it on the game lock). */
    const settle = async () => {
      const tag = `barrier-${++barrier}`;
      ws.send(JSON.stringify({ id: tag }));
      await vi.waitFor(() => expect(messages.some((m) => m.includes(`"id":"${tag}"`))).toBe(true), { interval: 1, timeout: 10_000 });
    };
    const views = () => messages.filter((m) => !m.includes('"id":"barrier-'));
    await settle();

    let policeFired = 0;
    let quietMoments = 0;
    let frozenWithPolice = 0;
    for (let i = 0; i < 600; i++) {
      const s: GameState = (await store.load(id))!;
      if (s.phase.kind === "ended") break;
      const rows = await deadlines(id);
      const police = rows.filter((r) => isHiddenDeadline(r.key));
      expect(police.length).toBeLessThanOrEqual(1);
      // Game time: a police moment stops while a meeting is open or waits to open.
      if (police.length > 0) {
        expect(police[0]!.paused).toBe(gameTimeFrozen(s));
        if (gameTimeFrozen(s)) frozenWithPolice++;
      }
      expect((await app.scheduler.timers(id)).some((t) => isHiddenDeadline(t.key))).toBe(false);

      const open = rows.filter((r) => !r.paused);
      expect(open.length).toBeGreaterThan(0);
      clock.advance(Math.max(0, open[0]!.due - clock.now()));
      const due = open.filter((r) => r.due <= clock.now());
      const onlyPolice = due.length === 1 && isHiddenDeadline(due[0]!.key);
      const before = views().length;
      const logBefore = s.log.length;
      expect(await app.scheduler.tick()).toBeGreaterThan(0);
      await settle();
      if (!onlyPolice) continue;
      policeFired++;
      const added = (await store.load(id))!.log.slice(logBefore).map((e) => e.type);
      if (added.every((t) => t === "policeScheduled" || t === "rngAdvanced")) {
        // Nothing happened: the scheduling alone is no view change, so nothing goes out.
        quietMoments++;
        expect(views().length).toBe(before);
      }
    }
    ws.close();
    const end = (await store.load(id))!;
    expect(end.phase.kind).toBe("ended");
    expect(policeFired).toBeGreaterThan(0);
    expect(quietMoments).toBeGreaterThan(0);
    expect(frozenWithPolice).toBeGreaterThan(0);
    // Only the end-of-game reveal may show the draws (reveal visibility).
    const live = views().filter((m) => (JSON.parse(m) as { view: { phase: { kind: string } } }).view.phase.kind !== "ended");
    expect(live.length).toBeGreaterThan(10);
    for (const m of live) expect(m).not.toMatch(LEAK);
  }, 120_000);
});
