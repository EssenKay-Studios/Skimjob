// QA for End game early (#239). design §6.2, §16. Adversarial: the engine's abortGame
// sent over the socket, ending a paused game and one with a stand-in bot, two ends at
// once, commands and controls after the end, and a server restart over an aborted game.
import { REPLACE_AFTER_MISSED_ROUNDS } from "@skimjob/content";
import type { GameState } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { fakeClock, type FakeClock } from "./clock";
import type { Db } from "./db";
import type { ServerMessage } from "./live";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import type { LobbySettings } from "./settings";
import { createGameStore, type GameStore } from "./store";
import { testDb } from "./testkit";

const quick = { interval: 1, timeout: 5000 };
const HOUR: Partial<LobbySettings> = { sessionLength: "1h", roleList: "possible" };

let db: Db;
let clock: FakeClock;
let store: GameStore;
let app: FastifyInstance;

beforeAll(async () => {
  db = await testDb();
  clock = fakeClock(Date.UTC(2026, 10, 13, 9));
  store = createGameStore(db);
  app = buildServer({ db, clock, store });
  await app.ready();
}, 30_000);
afterEach(async () => {
  await db.query("delete from deadlines");
  await db.query("update games set status = 'ended' where status = 'running'");
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const req = async (method: "POST" | "DELETE" | "GET", url: string, who: string | null, on: FastifyInstance = app) => {
  const res = await on.inject({ method, url, cookies: who ? { [SESSION_COOKIE]: who } : {} });
  return { status: res.statusCode, body: res.json() as LobbyView & { error?: string } };
};
const guest = async (nickname: string) => {
  const res = await app.inject({ method: "POST", url: "/auth/guest", payload: { nickname } });
  return res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
};

interface Seat {
  readonly who: string;
  readonly player: string;
  readonly seat: number;
}
async function startGame(guests: number) {
  const host = await guest("Host");
  const game = (await app.inject({ method: "POST", url: "/games", payload: { settings: HOUR }, cookies: { [SESSION_COOKIE]: host } })).json() as LobbyView;
  const sessions = [host];
  for (let i = 0; i < guests; i++) {
    const res = await app.inject({ method: "POST", url: `/invites/${game.inviteCode}/join`, payload: { nickname: `Guest ${i}` } });
    sessions.push(res.cookies.find((c) => c.name === SESSION_COOKIE)!.value);
  }
  expect((await req("POST", `/games/${game.id}/start`, host)).status).toBe(200);
  const seats: Seat[] = [];
  for (const who of sessions) {
    const me = (await req("GET", `/games/${game.id}`, who)).body.seats.find((x) => x.you)!;
    seats.push({ who, player: me.playerId!, seat: me.seat });
  }
  return { id: game.id, seats };
}
const load = async (id: string): Promise<GameState> => (await store.load(id))!;
const deadlineCount = async (id: string) => (await db.query<{ n: number }>("select count(*)::int as n from deadlines where game_id = $1", [id]))[0]!.n;
const aborts = (s: GameState) => s.log.filter((e) => e.type === "gameAborted").length;

class Client {
  readonly raw: string[] = [];
  private n = 0;
  ws!: WebSocket;
  static async open(gameId: string, who: string, on: FastifyInstance = app) {
    const c = new Client();
    c.ws = await on.injectWS(`/games/${gameId}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${who}` } }, { onInit: (ws) => ws.on("message", (d) => c.raw.push(String(d))) });
    await vi.waitFor(() => expect(c.messages.some((m) => "presence" in m)).toBe(true), quick);
    return c;
  }
  get messages(): ServerMessage[] {
    return this.raw.map((t) => JSON.parse(t) as ServerMessage);
  }
  lastView() {
    return this.messages.flatMap((m) => ("view" in m ? [m.view] : [])).at(-1)!;
  }
  async send(msg: Record<string, unknown>): Promise<ServerMessage> {
    const id = `m${++this.n}`;
    this.ws.send(JSON.stringify({ ...msg, id }));
    let reply: ServerMessage | undefined;
    await vi.waitFor(() => {
      reply = this.messages.find((m) => "id" in m && m.id === id);
      expect(reply).toBeDefined();
    }, quick);
    return reply!;
  }
}
const lobbyMove = { type: "submitMove", move: { room: "lobby", duffel: 1, pocket: 0 } };

describe("End game early, adversarial (design §6.2, §16)", () => {
  it("abortGame over the socket is refused for the host and a guest alike; the game runs on", async () => {
    const { id, seats } = await startGame(2);
    for (const s of seats) {
      const c = await Client.open(id, s.who);
      expect(await c.send({ cmd: { type: "abortGame" } })).toMatchObject({ rejected: true });
      expect(await c.send({ cmd: { type: "abortGame", player: s.player } })).toMatchObject({ rejected: true });
      c.ws.close();
    }
    expect((await load(id)).phase.kind).toBe("planning");
    expect(await deadlineCount(id)).toBeGreaterThan(0);
  });

  it("two ends at once: both succeed, exactly one gameAborted event", async () => {
    const { id, seats } = await startGame(2);
    const host = seats[0]!.who;
    const rs = await Promise.all([req("POST", `/games/${id}/end`, host), req("POST", `/games/${id}/end`, host), req("POST", `/games/${id}/end`, host)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(aborts(await load(id))).toBe(1);
  });

  it("a paused game can be ended: its paused deadlines go, resume and extend are refused after", async () => {
    const { id, seats } = await startGame(2);
    const host = seats[0]!.who;
    expect((await req("POST", `/games/${id}/pause`, host)).status).toBe(200);
    expect(await deadlineCount(id)).toBeGreaterThan(0);
    expect((await req("POST", `/games/${id}/end`, host)).status).toBe(200);
    expect((await load(id)).phase).toEqual({ kind: "aborted" });
    expect(await deadlineCount(id)).toBe(0);
    for (const path of ["resume", "extend", "pause"]) expect((await req("POST", `/games/${id}/${path}`, host)).status).toBe(409);
    clock.advance(24 * 3_600_000);
    expect(await app.scheduler.tick()).toBe(0);
    expect(aborts(await load(id))).toBe(1);
  });

  it("player commands after the end are refused; the end reaches a socket that joins later", async () => {
    const { id, seats } = await startGame(2);
    const c = await Client.open(id, seats[1]!.who);
    expect((await req("POST", `/games/${id}/end`, seats[0]!.who)).status).toBe(200);
    expect(await c.send({ cmd: lobbyMove })).toMatchObject({ rejected: true });
    await vi.waitFor(() => expect(c.lastView().phase).toEqual({ kind: "aborted" }), quick);
    const late = await Client.open(id, seats[2]!.who);
    await vi.waitFor(() => expect(late.lastView().phase).toEqual({ kind: "aborted" }), quick);
    expect(late.lastView().reveal).toBeNull();
    c.ws.close();
    late.ws.close();
  });

  it(`a seat a stand-in bot plays: after the end the bot never acts and the seat can't be handed back`, async () => {
    const { id, seats } = await startGame(2);
    const [host, g] = seats as [Seat, Seat];
    const hc = await Client.open(id, host.who);
    for (let round = 1; round <= REPLACE_AFTER_MISSED_ROUNDS; round++) {
      await hc.send({ cmd: lobbyMove });
      while ((await load(id)).phase.kind !== "planning" || (await load(id)).round === round) {
        const [next] = (await db.query<{ due: string }>("select (extract(epoch from due_at) * 1000)::float8 as due from deadlines where game_id = $1 and paused_at is null order by due_at limit 1", [id]));
        clock.advance(Math.max(0, Math.round(Number(next!.due)) - clock.now()));
        await app.scheduler.tick();
      }
    }
    expect((await req("POST", `/games/${id}/seats/${g.seat}/stand-in`, host.who)).status).toBe(200);
    expect((await req("POST", `/games/${id}/end`, host.who)).status).toBe(200);
    const events = (await load(id)).log.length;
    await app.live.settle(id);
    expect((await load(id)).log.length).toBe(events);
    expect((await req("DELETE", `/games/${id}/seats/${g.seat}/stand-in`, host.who)).status).toBe(409);
    expect((await req("DELETE", `/games/${id}/seats/${g.seat}/stand-in`, g.who)).status).toBe(409);
    expect(app.live.botRefusals.filter((r) => r.gameId === id)).toEqual([]);
    hc.ws.close();
  });

  it("a restart over an aborted game: still ended, no deadlines planned, the view is the abort", async () => {
    const { id, seats } = await startGame(2);
    expect((await req("POST", `/games/${id}/end`, seats[0]!.who)).status).toBe(200);
    const again = buildServer({ db, clock, store: createGameStore(db) });
    await again.ready();
    try {
      await again.scheduler.tick();
      expect(await deadlineCount(id)).toBe(0);
      expect((await req("GET", `/games/${id}`, seats[1]!.who, again)).body.status).toBe("ended");
      const c = await Client.open(id, seats[1]!.who, again);
      await vi.waitFor(() => expect(c.lastView().phase).toEqual({ kind: "aborted" }), quick);
      expect((await req("POST", `/games/${id}/end`, seats[0]!.who, again)).status).toBe(200);
      expect(aborts((await createGameStore(db).load(id))!)).toBe(1);
      c.ws.close();
    } finally {
      await again.close();
    }
  });
});
