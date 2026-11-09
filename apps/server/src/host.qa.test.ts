// QA for host controls and resilience (M2-13). design §15, §4.1;
// docs/m2-plan.md M2-13. Adversarial: who may use each control, out-of-order controls, exact
// remaining times across a pause (fake clock), a restart while paused,
// stand-in bots, lobby vs in-game kick, session expiry, independent game ticks.
import { createHash } from "node:crypto";
import { createBot, PERSONALITIES } from "@skimjob/bots";
import { REPLACE_AFTER_MISSED_ROUNDS } from "@skimjob/content";
import { handleCommand, viewFor, type GameState } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { fakeClock, type FakeClock } from "./clock";
import type { Db } from "./db";
import { botTrigger, CLOSE_SIGNED_OUT, SystemRefused, type Control, type ServerMessage } from "./live";
import type { LobbyView } from "./lobby";
import { createScheduler } from "./scheduler";
import { buildServer } from "./server";
import { SESSION_TTL_MS, type LobbySettings } from "./settings";
import { createGameStore, type GameStore } from "./store";
import { insertUser, testDb } from "./testkit";
import { TIMINGS } from "./timing";

const quick = { interval: 1, timeout: 5000 };
const H1 = TIMINGS["1h"];
/** A one-hour game with the Possible role list (design §11.3). */
const HOUR: Partial<LobbySettings> = { sessionLength: "1h", roleList: "possible" };

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
afterEach(async () => {
  await db.query("delete from deadlines");
  await db.query("update games set status = 'ended' where status = 'running'");
});
afterAll(async () => {
  await app.close();
  await db.close();
});

type Body = LobbyView & { error?: string; extendedMs?: number };
const req = async (method: "POST" | "DELETE" | "GET", url: string, who: string | null, payload?: Record<string, unknown>, on: FastifyInstance = app) => {
  const res = await on.inject({ method, url, ...(payload ? { payload } : {}), cookies: who ? { [SESSION_COOKIE]: who } : {} });
  return { status: res.statusCode, body: res.json() as Body, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};
const guestSession = async (nickname: string) => (await req("POST", "/auth/guest", null, { nickname })).session!;

interface Seat {
  readonly who: string;
  readonly player: string;
  readonly seat: number;
}
async function startGame(guests: number, settings: Partial<LobbySettings> = HOUR) {
  const host = await guestSession("Host");
  const game = (await req("POST", "/games", host, { settings })).body;
  const sessions = [host];
  for (let i = 0; i < guests; i++) sessions.push((await req("POST", `/invites/${game.inviteCode}/join`, null, { nickname: `Guest ${i}` })).session!);
  expect((await req("POST", `/games/${game.id}/start`, host)).status).toBe(200);
  const seats: Seat[] = [];
  for (const who of sessions) {
    const me = (await req("GET", `/games/${game.id}`, who)).body.seats.find((x) => x.you)!;
    seats.push({ who, player: me.playerId!, seat: me.seat });
  }
  return { id: game.id, seats, inviteCode: game.inviteCode };
}

interface Row {
  key: string;
  due: number;
  paused: boolean;
}
const deadlines = async (gameId: string): Promise<Row[]> =>
  (
    await db.query<Row>(
      "select key, (extract(epoch from due_at) * 1000)::float8 as due, paused_at is not null as paused from deadlines where game_id = $1 order by key",
      [gameId],
    )
  ).map((r) => ({ ...r, due: Math.round(Number(r.due)) }));
/** Each row's time left: from now if it runs, from when it stopped if paused. */
const remaining = async (gameId: string) =>
  new Map(
    (
      await db.query<{ key: string; left: number }>(
        "select key, (extract(epoch from due_at - coalesce(paused_at, to_timestamp($2::float8 / 1000))) * 1000)::float8 as left from deadlines where game_id = $1",
        [gameId, clock.now()],
      )
    ).map((r) => [r.key, Math.round(Number(r.left))]),
  );
const load = async (id: string): Promise<GameState> => (await store.load(id))!;
async function step(gameId: string, on: FastifyInstance = app) {
  const next = (await deadlines(gameId)).filter((d) => !d.paused).sort((a, b) => a.due - b.due)[0];
  if (!next) throw new Error("no deadline pending");
  clock.advance(Math.max(0, next.due - clock.now()));
  return on.scheduler.tick();
}

class Client {
  readonly raw: string[] = [];
  closed: number | null = null;
  private n = 0;
  ws!: WebSocket;
  static async open(gameId: string, who: string, on: FastifyInstance = app) {
    const c = new Client();
    const onInit = (ws: WebSocket) => {
      ws.on("message", (d) => c.raw.push(String(d)));
      ws.on("close", (code) => (c.closed = code));
    };
    c.ws = await on.injectWS(`/games/${gameId}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${who}` } }, { onInit });
    await vi.waitFor(() => expect(c.messages.some((m) => "presence" in m)).toBe(true), quick);
    return c;
  }
  get messages(): ServerMessage[] {
    return this.raw.map((t) => JSON.parse(t) as ServerMessage);
  }
  views() {
    return this.messages.flatMap((m) => ("view" in m ? [m] : []));
  }
  control(): Control {
    return this.views().at(-1)!.control;
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
  barrier() {
    return this.send({});
  }
}
const lobbyMove = { type: "submitMove", move: { room: "lobby", duffel: 1, pocket: 0 } };
const pausedAt = async (id: string) => (await db.query<{ p: boolean }>("select paused_at is not null as p from games where id = $1", [id]))[0]!.p;

describe("every control refuses anyone but the host (design §15)", () => {
  it("guest 403, outsider 404, signed out 401, nothing changes; bad ids 404; lobby and ended games 409", async () => {
    const { id, seats } = await startGame(2);
    const [host, guest, other] = seats as [Seat, Seat, Seat];
    const outsider = await guestSession("Outsider");
    const controls: ["POST" | "DELETE", string][] = [
      ["POST", `/games/${id}/pause`],
      ["POST", `/games/${id}/resume`],
      ["POST", `/games/${id}/extend`],
      ["POST", `/games/${id}/seats/${other.seat}/stand-in`],
    ];
    const before = await deadlines(id);
    for (const [method, url] of controls) {
      expect((await req(method, url, guest.who)).status, url).toBe(403);
      expect((await req(method, url, outsider)).status, url).toBe(404);
      expect((await req(method, url, null)).status, url).toBe(401);
    }
    // Handing back someone else's seat: only the host or that player.
    expect((await req("DELETE", `/games/${id}/seats/${other.seat}/stand-in`, guest.who)).status).toBe(403);
    expect((await req("DELETE", `/games/${id}/seats/${other.seat}/stand-in`, outsider)).status).toBe(404);
    expect(await pausedAt(id)).toBe(false);
    expect(await deadlines(id)).toEqual(before);
    // A guest can't kick, and nobody kicks once the game runs.
    expect((await req("DELETE", `/games/${id}/seats/${other.seat}`, guest.who)).status).toBe(403);
    expect((await req("DELETE", `/games/${id}/seats/${other.seat}`, host.who)).status).toBe(409);
    expect((await req("GET", `/games/${id}`, host.who)).body.seats).toHaveLength(3);
    // Junk ids and seats.
    expect((await req("POST", `/games/not-a-uuid/pause`, host.who)).status).toBe(404);
    for (const seat of ["99", "abc", "-1", ""]) {
      expect([404]).toContain((await req("POST", `/games/${id}/seats/${seat}/stand-in`, host.who)).status);
    }
    // Not running: a lobby game and an ended one.
    const lobbyHost = await guestSession("Lobby host");
    const lobby = (await req("POST", "/games", lobbyHost, { settings: {} })).body;
    expect((await req("POST", `/games/${lobby.id}/pause`, lobbyHost)).status).toBe(409);
    expect((await req("POST", `/games/${lobby.id}/extend`, lobbyHost)).status).toBe(409);
    await db.query("update games set status = 'ended' where id = $1", [id]);
    expect((await req("POST", `/games/${id}/pause`, host.who)).status).toBe(409);
  });

  it("a bot seat can't get a stand-in and can't be handed back (no person in it)", async () => {
    const host = await guestSession("Host");
    const game = (await req("POST", "/games", host, { settings: HOUR })).body;
    await req("POST", `/games/${game.id}/bots`, host, { personality: "greedy" });
    await req("POST", `/games/${game.id}/bots`, host, { personality: "greedy" });
    await req("POST", `/games/${game.id}/start`, host);
    const bot = (await req("GET", `/games/${game.id}`, host)).body.seats.find((x) => x.bot !== null)!;
    expect((await req("POST", `/games/${game.id}/seats/${bot.seat}/stand-in`, host)).status).toBe(404);
    expect((await req("DELETE", `/games/${game.id}/seats/${bot.seat}/stand-in`, host)).status).toBe(404);
  });
});

describe("out-of-order controls (design §15)", () => {
  it("pause twice and resume when not paused are 409 and change nothing; extend while paused adds exactly extendMs on top of the pause", async () => {
    const { id, seats } = await startGame(2, HOUR);
    const host = seats[0]!.who;
    expect((await req("POST", `/games/${id}/resume`, host)).status).toBe(409);
    clock.advance(7_000);
    const left = await remaining(id);
    expect((await req("POST", `/games/${id}/pause`, host)).status).toBe(200);
    const pausedRows = await deadlines(id);
    clock.advance(3_000);
    expect((await req("POST", `/games/${id}/pause`, host)).status).toBe(409);
    expect(await deadlines(id)).toEqual(pausedRows); // the second pause didn't restamp anything
    expect((await req("POST", `/games/${id}/extend`, host)).status).toBe(200);
    expect((await req("POST", `/games/${id}/extend`, host)).status).toBe(200);
    clock.advance(H1.roundMs * 5);
    expect(await app.scheduler.tick()).toBe(0);
    expect((await req("POST", `/games/${id}/resume`, host)).status).toBe(200);
    expect((await req("POST", `/games/${id}/resume`, host)).status).toBe(409);
    const after = await remaining(id);
    expect(after.get("round:1")).toBe(left.get("round:1")! + 2 * H1.extendMs);
    // Fires exactly then, not a millisecond before.
    clock.advance(after.get("round:1")! - 1);
    expect(await app.scheduler.tick()).toBe(0);
    clock.advance(1);
    expect(await app.scheduler.tick()).toBeGreaterThan(0);
    expect((await load(id)).resolvedRound).toBe(1);
  });
});

/** Pauses for a long while, resumes, and checks every row has exactly the time it had left. */
async function pauseAcross(id: string, host: string, on: FastifyInstance = app) {
  const left = await remaining(id);
  expect((await req("POST", `/games/${id}/pause`, host, undefined, on)).status).toBe(200);
  for (let i = 0; i < 3; i++) {
    clock.advance(H1.roundMs + H1.resultMs + H1.meetingMs);
    expect(await on.scheduler.tick()).toBe(0);
  }
  expect((await req("POST", `/games/${id}/resume`, host, undefined, on)).status).toBe(200);
  expect(await remaining(id)).toEqual(left);
  return left;
}

describe("a pause keeps every clock's time left exactly (design §15)", () => {
  it("across roundEarly, the result window and an open meeting", async () => {
    const { id, seats } = await startGame(3);
    const host = seats[0]!.who;
    const clients = await Promise.all(seats.map((s) => Client.open(id, s.who)));
    for (const c of clients) expect(await c.send({ cmd: lobbyMove })).toMatchObject({ ok: true });
    await clients[0]!.barrier();
    clock.advance(1234);
    // Planning: round and roundEarly.
    const planning = await pauseAcross(id, host);
    expect([...planning.keys()].sort()).toEqual(["round:1", "roundEarly:1"]);
    // To the result window (design §9.3), then an open meeting (an emergency called in it).
    while ((await load(id)).phase.kind === "planning") await step(id);
    expect((await load(id)).phase.kind).toBe("result");
    clock.advance(250);
    const result = await pauseAcross(id, host);
    expect(result.has("result:1")).toBe(true);
    expect(await clients[0]!.send({ cmd: { type: "callEmergency" } })).toMatchObject({ ok: true });
    await clients[0]!.barrier();
    while ((await load(id)).phase.kind !== "meeting") await step(id);
    clock.advance(321);
    const meeting = await pauseAcross(id, host);
    const close = [...meeting.keys()].find((k) => k.startsWith("closeMeeting:"))!;
    expect(close).toBeDefined();
    clock.advance(meeting.get(close)! - 1);
    expect((await load(id)).phase.kind).toBe("meeting");
  });

  it("a server restart while paused: nothing fires, the new server shows the pause, resume moves each on by the pause", async () => {
    const { id, seats } = await startGame(3);
    const host = seats[0]!.who;
    clock.advance(4_000);
    const left = await remaining(id);
    expect((await req("POST", `/games/${id}/pause`, host)).status).toBe(200);
    const app2 = buildServer({ db, clock, store: createGameStore(db) });
    await app2.ready();
    try {
      clock.advance(H1.roundMs * 4);
      expect(await app2.scheduler.tick()).toBe(0);
      const c = await Client.open(id, seats[1]!.who, app2);
      expect(c.control().pausedAt).not.toBeNull();
      expect((await req("POST", `/games/${id}/pause`, host, undefined, app2)).status).toBe(409);
      expect((await req("POST", `/games/${id}/resume`, host, undefined, app2)).status).toBe(200);
      expect(await remaining(id)).toEqual(left);
      await c.barrier();
      expect(c.control().pausedAt).toBeNull();
      expect(c.views().at(-1)!.timers.find((t) => t.key === "round:1")!.dueAt - clock.now()).toBe(left.get("round:1"));
    } finally {
      await app2.close();
    }
  });
});

describe("replace with a bot, then hand back (design §15)", () => {
  it("the bot plays the seat deterministically from its view, nobody else learns the seat's secrets, and the player's seat comes back", async () => {
    const { id, seats } = await startGame(2, HOUR);
    const [host, guest, third] = seats as [Seat, Seat, Seat];
    const hc = await Client.open(id, host.who);
    const tc = await Client.open(id, third.who);
    for (let round = 1; round <= REPLACE_AFTER_MISSED_ROUNDS; round++) {
      await hc.send({ cmd: lobbyMove });
      await tc.send({ cmd: lobbyMove });
      while ((await load(id)).phase.kind !== "planning" || (await load(id)).round === round) await step(id);
    }
    await hc.barrier();
    expect(hc.control().idle).toEqual([guest.player]);
    const before = await load(id);
    expect(before.moves[guest.player]).toBeUndefined();
    const fromHost = hc.raw.length;
    const fromThird = tc.raw.length;

    expect((await req("POST", `/games/${id}/seats/${guest.seat}/stand-in`, host.who, { personality: "greedy" })).status).toBe(200);
    // Deterministic: the move is what that personality picks from the seat's own view (seeded from the hidden game seed and the view).
    const view = viewFor(before, guest.player);
    const sha = (t: string) => createHash("sha256").update(t).digest("hex");
    const hash = sha(JSON.stringify(botTrigger(view)));
    const agent = createBot({ player: guest.player, personality: PERSONALITIES.greedy, seed: sha(`bot\0${before.config.seed}\0${guest.player}\0${hash}`), crewSeed: sha(`crew\0${before.config.seed}`) });
    let expected = before;
    for (const command of agent.act(view)) {
      const r = handleCommand(expected, { ...command, player: guest.player });
      if (r.ok) expected = r.state;
    }
    const after = await load(id);
    expect(after.moves[guest.player]).toBeDefined();
    expect(after.moves[guest.player]).toEqual(expected.moves[guest.player]);

    // Others see only public state: their own view, and control lists the seat id.
    await hc.barrier();
    await tc.barrier();
    const guestRole = after.players[guest.player]!.role;
    for (const [c, from, me] of [[hc, fromHost, host], [tc, fromThird, third]] as const) {
      const latest = c.views().at(-1)!;
      expect(latest.view).toEqual(viewFor(after, me.player));
      expect(latest.control.standIns).toEqual([guest.player]);
      for (const text of c.raw.slice(from)) {
        // None of the seat's private events (its role, the move the bot made for it, its loot).
        expect(text).not.toContain(`"kind":"private","player":"${guest.player}"`);
        if (!JSON.stringify(viewFor(after, me.player)).includes(`"${guestRole}"`)) expect(text).not.toContain(`"${guestRole}"`);
      }
      expect(c.messages.slice(from === fromHost ? fromHost : fromThird).some((m) => "chat" in m)).toBe(false);
    }
    // (The pattern is real: the seat's own view has those events, the bot's move among them.)
    expect(JSON.stringify(viewFor(after, guest.player))).toContain(`"kind":"private","player":"${guest.player}"`);
    // A third player's lobby view says only that a bot plays the seat.
    const lobbySeat = (await req("GET", `/games/${id}`, third.who)).body.seats.find((x) => x.seat === guest.seat)!;
    expect(lobbySeat.standIn).toBe("greedy");
    expect(JSON.stringify(lobbySeat)).not.toContain(`"${guestRole}"`);

    // The player is back: commands refused while the bot plays, then their view and seat are theirs again.
    const gc = await Client.open(id, guest.who);
    expect(gc.views().at(-1)!.view).toEqual(viewFor(after, guest.player));
    const otherMove = { type: "submitMove", move: { room: "lobby", duffel: 1, pocket: 0 } };
    expect(await gc.send({ cmd: otherMove })).toMatchObject({ rejected: true });
    expect((await req("DELETE", `/games/${id}/seats/${guest.seat}/stand-in`, host.who)).status).toBe(200);
    await gc.barrier();
    expect(gc.control().standIns).toEqual([]);
    expect(gc.views().at(-1)!.view).toEqual(viewFor(await load(id), guest.player));
    expect(await gc.send({ cmd: otherMove })).toMatchObject({ ok: true });
    // The bot is gone for good: the next round, the guest's seat waits for the guest.
    await hc.send({ cmd: lobbyMove });
    await tc.send({ cmd: lobbyMove });
    const round = (await load(id)).round;
    while ((await load(id)).phase.kind !== "planning" || (await load(id)).round === round) await step(id);
    await hc.barrier();
    expect((await load(id)).moves[guest.player]).toBeUndefined();
    expect((await db.query<{ s: string | null }>("select stand_in as s from seats where game_id = $1 and seat_no = $2", [id, guest.seat]))[0]!.s).toBeNull();
  });
});

describe("kick in the lobby vs in the game (design §15)", () => {
  it("lobby: bots and people can go, not the host, unknown seats are 404; the kicked person can't act on the game", async () => {
    const host = await guestSession("Host");
    const game = (await req("POST", "/games", host, { settings: {} })).body;
    const guest = (await req("POST", `/invites/${game.inviteCode}/join`, null, { nickname: "Guest" })).session!;
    await req("POST", `/games/${game.id}/bots`, host, { personality: "greedy" });
    const seats = (await req("GET", `/games/${game.id}`, host)).body.seats;
    const bot = seats.find((x) => x.bot !== null)!;
    const person = seats.find((x) => x.nickname === "Guest")!;
    expect((await req("DELETE", `/games/${game.id}/seats/999`, host)).status).toBe(404);
    expect((await req("DELETE", `/games/${game.id}/seats/${bot.seat}`, guest)).status).toBe(403);
    expect((await req("DELETE", `/games/${game.id}/seats/${bot.seat}`, host)).status).toBe(200);
    expect((await req("DELETE", `/games/${game.id}/seats/${bot.seat}`, host)).status).toBe(404);
    expect((await req("DELETE", `/games/${game.id}/seats/${person.seat}`, host)).status).toBe(200);
    expect((await req("DELETE", `/games/${game.id}/seats/${person.seat}`, guest)).status).toBe(404);
    expect((await req("GET", `/games/${game.id}`, host)).body.seats.map((x) => x.nickname)).toEqual(["Host"]);
  });
});

describe("session expiry (M2-13 resilience)", () => {
  it("a socket closes 4401 on its own at expiry, and a message after expiry is never delivered", async () => {
    const { id, seats } = await startGame(2, HOUR);
    const host = await Client.open(id, seats[0]!.who);
    // The guest's session ends one second (of game clock) from now.
    const [row] = await db.query<{ e: number }>("select (extract(epoch from expires_at) * 1000)::float8 as e from sessions order by expires_at desc limit 1");
    expect(Number(row!.e)).toBeGreaterThan(clock.now() + SESSION_TTL_MS - 60_000);
    await db.query("update sessions set expires_at = to_timestamp($1::float8 / 1000) where token_hash = $2", [
      clock.now() + 1000,
      createHash("sha256").update(seats[1]!.who).digest(),
    ]);
    const guest = await Client.open(id, seats[1]!.who);
    clock.advance(1000);
    // Idle: the expiry timer closes it within its 1 s minimum wait.
    await vi.waitFor(() => expect(guest.closed).toBe(CLOSE_SIGNED_OUT), { interval: 20, timeout: 4000 });
    expect(host.closed).toBeNull();
    expect((await req("GET", `/games/${id}`, seats[1]!.who)).status).toBe(401);
    // Another socket of an expired session: its message is dropped and it closes.
    await db.query("update sessions set expires_at = to_timestamp($1::float8 / 1000) where token_hash = $2", [
      clock.now() + 5 * 60_000,
      createHash("sha256").update(seats[1]!.who).digest(),
    ]);
    const again = await Client.open(id, seats[1]!.who);
    clock.advance(5 * 60_000);
    again.ws.send(JSON.stringify({ chat: { text: "ghost message" } }));
    await vi.waitFor(() => expect(again.closed).toBe(CLOSE_SIGNED_OUT), quick);
    await host.barrier();
    expect(host.raw.some((t) => t.includes("ghost message"))).toBe(false);
  });
});

describe("games tick independently (M2-13 resilience)", () => {
  it("a failing game and a hanging game never hold up a third; the hung one isn't sent twice", async () => {
    const user = await insertUser(db);
    const [hang, fail, ok] = (await Promise.all(["hangqaaa", "failqaaa", "okqaaaaa"].map((code) => store.create({ hostUserId: user, inviteCode: code, settings: {} })))) as [string, string, string];
    const at = new Date(clock.now() - 1000).toISOString();
    const round = (n: number) => JSON.stringify({ type: "advance", deadline: { kind: "round", round: n } });
    for (const g of [hang, fail, ok]) await db.query("insert into deadlines (game_id, key, due_at, command) values ($1, 'round:1', $2, $3::json)", [g, at, round(1)]);
    let release!: () => void;
    const hung = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    const sched = createScheduler({
      db,
      clock,
      log: app.log,
      system: async (gameId, command) => {
        calls.push(gameId);
        if (gameId === hang) await hung;
        if (gameId === fail) throw new Error("database hiccup");
        await db.query("delete from deadlines where game_id = $1 and command::text = $2", [gameId, JSON.stringify(command)]);
        return null;
      },
      resync: async () => {},
    });
    const first = sched.tick();
    await vi.waitFor(() => expect(calls.filter((g) => g === ok)).toHaveLength(1), quick);
    expect(calls.filter((g) => g === fail)).toHaveLength(1);
    // Next tick, at once: the hung game is skipped, the failed one waits its backoff, the fine one has nothing due.
    await db.query("insert into deadlines (game_id, key, due_at, command) values ($1, 'round:2', $2, $3::json)", [ok, at, round(2)]);
    expect(await sched.tick()).toBe(1);
    expect(calls.filter((g) => g === hang)).toHaveLength(1);
    expect(calls.filter((g) => g === fail)).toHaveLength(1);
    release();
    await first;
    expect(calls.filter((g) => g === hang)).toHaveLength(1);
    // A refused deadline in one game is dropped without touching the others.
    const refuse = createScheduler({
      db,
      clock,
      log: app.log,
      system: async (gameId) => {
        if (gameId === fail) throw new SystemRefused("stale");
        return null;
      },
      resync: async () => {},
    });
    await refuse.tick();
    expect((await deadlines(fail)).map((r) => r.key)).toEqual([]);
    await db.query("delete from deadlines where game_id = any($1::uuid[])", [[hang, fail, ok]]);
  });
});
