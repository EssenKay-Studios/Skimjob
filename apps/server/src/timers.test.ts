// The countdown's deadlines on the live channel, and TIME_SCALE. docs/m2-plan.md M2-6
// (the game screen's HUD); design §4.1, §5.4, §11.1
import type { PlayerView } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import { loadConfig, StartupError } from "./config";
import type { Db } from "./db";
import type { ServerMessage } from "./live";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import { serverDeps } from "./startup";
import { testDb } from "./testkit";
import { scaleTiming, TIMINGS } from "./timing";

const quick = { interval: 1, timeout: 5000 };
const T0 = Date.UTC(2026, 10, 1);

let db: Db;
beforeAll(async () => {
  db = await testDb();
}, 30_000);
afterAll(() => db.close());

async function setup(timeScale = 1) {
  const clock = fakeClock(T0);
  const app = buildServer({ db, clock, timeScale });
  await app.ready();
  const call = async (url: string, who: string | null, payload: Record<string, unknown> = {}) => {
    const res = await app.inject({ method: "POST", url, payload, cookies: who ? { [SESSION_COOKIE]: who } : {} });
    return { body: res.json() as LobbyView, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
  };
  const host = (await call("/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await call("/games", host, { settings: { sessionLength: "15m" } })).body;
  const guest = (await call(`/invites/${game.inviteCode}/join`, null, { nickname: "Guest" })).session!;
  await call(`/invites/${game.inviteCode}/join`, null, { nickname: "Guest 2" });
  await call(`/games/${game.id}/start`, host);
  return { app, clock, id: game.id, host, guest };
}

type ViewMessage = Extract<ServerMessage, { view: unknown }>;
async function open(app: FastifyInstance, id: string, who: string) {
  const raw: string[] = [];
  const ws: WebSocket = await app.injectWS(`/games/${id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${who}` } }, { onInit: (w) => w.on("message", (d) => raw.push(String(d))) });
  const messages = () => raw.map((t) => JSON.parse(t) as ServerMessage);
  const views = () => messages().filter((m): m is ViewMessage => "view" in m);
  await vi.waitFor(() => expect(messages().some((m) => "chatHistory" in m)).toBe(true), quick);
  let n = 0;
  const send = async (cmd: unknown) => {
    const msgId = `t${++n}`;
    ws.send(JSON.stringify({ cmd, id: msgId }));
    await vi.waitFor(() => expect(messages().some((m) => "id" in m && m.id === msgId)).toBe(true), quick);
  };
  return { ws, raw, views, send, view: (): PlayerView => views().at(-1)!.view };
}

describe("timers on the live channel", () => {
  it("each view carries the game's deadlines and the server clock; a hidden move sends nothing", async () => {
    const { app, clock, id, host, guest } = await setup();
    const a = await open(app, id, host);
    const b = await open(app, id, guest);
    const first = b.views().at(-1)!;
    expect(first.now).toBe(T0);
    expect(first.timers).toEqual([{ key: "round:1", dueAt: T0 + TIMINGS["15m"].roundMs, pausedAt: null }]);

    // A's lock-in is public (owner decision, 2 Nov); a change after it is hidden: B gets nothing new,
    // not even a fresh `now`. design §5.1
    await a.send({ type: "submitMove", move: { room: "lobby", duffel: 1, pocket: 0 } });
    await b.send({});
    expect(b.view().lockedIn).toEqual([a.view().me.id]);
    clock.advance(1000);
    const before = b.raw.length;
    await a.send({ type: "submitMove", move: { room: "office", duffel: 2, pocket: 0 } });
    await b.send({}); // a barrier through the game's lock
    expect(b.raw.slice(before).some((t) => "view" in JSON.parse(t))).toBe(false);

    // The round's deadline passes: the alibi window's timer replaces it. design §5.4
    clock.advance(TIMINGS["15m"].roundMs);
    await app.scheduler.tick();
    await vi.waitFor(() => expect(b.view().phase.kind).toBe("alibis"), quick);
    const alibis = b.views().at(-1)!;
    expect(alibis.timers).toEqual([{ key: "alibis:1", dueAt: clock.now() + TIMINGS["15m"].alibiMs, pausedAt: null }]);
    expect(alibis.now).toBe(clock.now());
    a.ws.close();
    b.ws.close();
    await app.close();
  });

  it("the result window's timer, then the emergency's notice in its place, then the meeting's close timer. design §9.3", async () => {
    const { app, clock, id, host, guest } = await setup();
    const a = await open(app, id, host);
    await open(app, id, guest);
    const t = TIMINGS["15m"];
    clock.advance(t.roundMs);
    await app.scheduler.tick();
    clock.advance(t.alibiMs);
    await app.scheduler.tick();
    await vi.waitFor(() => expect(a.view().phase.kind).toBe("result"), quick);
    expect(a.views().at(-1)!.timers).toEqual([{ key: "result:1", dueAt: clock.now() + t.resultMs, pausedAt: null }]);
    await a.send({ type: "callEmergency" });
    await a.send({}); // a barrier through the game's lock: the reply goes out before the view
    const meetingId = a.view().pendingEmergency!.meetingId;
    expect(a.views().at(-1)!.timers).toEqual([{ key: `openMeeting:${meetingId}`, dueAt: clock.now() + t.emergencyNoticeMs, pausedAt: null }]);
    clock.advance(t.emergencyNoticeMs);
    await app.scheduler.tick();
    await vi.waitFor(() => expect(a.view().phase.kind).toBe("meeting"), quick);
    expect(a.views().at(-1)!.timers).toEqual([{ key: `closeMeeting:${meetingId}`, dueAt: clock.now() + t.meetingMs, pausedAt: null }]);
    await app.close();
  });

  it("TIME_SCALE shortens every preset's deadlines", async () => {
    const { app, id, host } = await setup(0.1);
    const a = await open(app, id, host);
    expect(a.views().at(-1)!.timers).toEqual([{ key: "round:1", dueAt: T0 + TIMINGS["15m"].roundMs / 10, pausedAt: null }]);
    await app.close();
  });
});

describe("TIME_SCALE", () => {
  it("defaults to 1 and reads a fraction", () => {
    expect(loadConfig({}).timeScale).toBe(1);
    expect(loadConfig({ TIME_SCALE: "0.1" }).timeScale).toBe(0.1);
    expect(loadConfig({ TIME_SCALE: " " }).timeScale).toBe(1);
  });

  it.each(["0", "2", "-0.5", "abc", "1e-2", "0x1"])("refuses TIME_SCALE=%s", (v) => {
    expect(() => loadConfig({ TIME_SCALE: v })).toThrow(StartupError);
  });

  it.each(["0.1", "0.5", "abc", "0"])("is forced to 1 in production, ignoring TIME_SCALE=%s", (v) => {
    const config = loadConfig({ NODE_ENV: "production", TIME_SCALE: v });
    expect(config.timeScale).toBe(1);
    expect(serverDeps(config).timeScale).toBe(1);
  });

  it("scales every wall time but keeps a zero lead at zero", () => {
    const t = scaleTiming(TIMINGS["15m"], 0.1);
    expect(t).toMatchObject({ roundMs: 7500, alibiMs: 1500, meetingMs: 12000, emergencyNoticeMs: 2000, shakedownWindowMs: 1500, meetingLeadMs: 0, autoMeetings: true });
    expect(scaleTiming(TIMINGS["1d"], 0.5).meetingLeadMs).toBe(TIMINGS["1d"].meetingLeadMs / 2);
    expect(scaleTiming(TIMINGS["15m"], 1)).toBe(TIMINGS["15m"]);
  });
});
