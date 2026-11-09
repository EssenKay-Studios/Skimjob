// Host controls and resilience (M2-13). design §15, §4.1
import { REPLACE_AFTER_MISSED_ROUNDS } from "@skimjob/content";
import type { GameState } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { fakeClock, type FakeClock } from "./clock";
import type { Db } from "./db";
import { CLOSE_SIGNED_OUT, type Control, type ServerMessage } from "./live";
import type { LobbyView } from "./lobby";
import { createScheduler, DEADLINE_SKIPPED } from "./scheduler";
import { buildServer } from "./server";
import { SESSION_TTL_MS, type LobbySettings } from "./settings";
import { createGameStore, type GameStore } from "./store";
import { insertUser, testDb } from "./testkit";
import { TIMINGS } from "./timing";

const quick = { interval: 1, timeout: 5000 };
const H1 = TIMINGS["1h"];
/** Every role can be dealt. */
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
// Each test's game stops here, so another test's ticks only see its own.
afterEach(async () => {
  await db.query("delete from deadlines");
  await db.query("update games set status = 'ended' where status = 'running'");
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const req = async (method: "POST" | "DELETE" | "GET", url: string, who: string | null, payload?: Record<string, unknown>) => {
  const res = await app.inject({ method, url, ...(payload ? { payload } : {}), cookies: who ? { [SESSION_COOKIE]: who } : {} });
  return { status: res.statusCode, body: res.json() as LobbyView & { error?: string; extendedMs?: number }, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};

interface Seat {
  readonly who: string;
  readonly player: string;
  readonly seat: number;
}
/** The host and `guests` absent people (no bots: nobody calls an emergency at random), started. */
async function startGame(guests: number, settings: Partial<LobbySettings> = HOUR) {
  const host = (await req("POST", "/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await req("POST", "/games", host, { settings })).body;
  const sessions = [host];
  for (let i = 0; i < guests; i++) sessions.push((await req("POST", `/invites/${game.inviteCode}/join`, null, { nickname: `Guest ${i}` })).session!);
  await req("POST", `/games/${game.id}/start`, host);
  const seats: Seat[] = [];
  for (const who of sessions) {
    const me = (await req("GET", `/games/${game.id}`, who)).body.seats.find((x) => x.you)!;
    seats.push({ who, player: me.playerId!, seat: me.seat });
  }
  return { id: game.id, seats };
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
const byKey = (rows: readonly Row[]) => new Map(rows.map((r) => [r.key, r]));
const load = async (id: string): Promise<GameState> => (await store.load(id))!;
/** Jumps the clock to the next unpaused deadline and ticks. */
async function step(gameId: string) {
  const next = (await deadlines(gameId)).filter((d) => !d.paused).sort((a, b) => a.due - b.due)[0];
  if (!next) throw new Error("no deadline pending");
  clock.advance(Math.max(0, next.due - clock.now()));
  return app.scheduler.tick();
}

/** A test socket that keeps every message. */
class Client {
  readonly raw: string[] = [];
  closed: number | null = null;
  private n = 0;
  ws!: WebSocket;
  static async open(gameId: string, who: string) {
    const c = new Client();
    const onInit = (ws: WebSocket) => {
      ws.on("message", (d) => c.raw.push(String(d)));
      ws.on("close", (code) => (c.closed = code));
    };
    c.ws = await app.injectWS(`/games/${gameId}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${who}` } }, { onInit });
    await vi.waitFor(() => expect(c.messages.some((m) => "presence" in m)).toBe(true), quick);
    return c;
  }
  get messages(): ServerMessage[] {
    return this.raw.map((t) => JSON.parse(t) as ServerMessage);
  }
  control(): Control {
    return this.messages.flatMap((m) => ("control" in m ? [m.control] : [])).at(-1)!;
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
  /** Every message queued for this socket so far has arrived (a no-op goes through the game's lock). */
  barrier() {
    return this.send({});
  }
}
const lobbyMove = { type: "submitMove", move: { room: "lobby", duffel: 1, pocket: 0 } };

describe("pause and resume (design §15, §4.1)", () => {
  it("a pause stops every deadline, roundEarly included; nothing fires across it; resume moves each on by the pause", async () => {
    const { id, seats } = await startGame(4);
    // Everyone locks in: `roundEarly:1` exists next to the round (owner decision, 2 Nov).
    const clients = await Promise.all(seats.map((s) => Client.open(id, s.who)));
    for (const c of clients) expect(await c.send({ cmd: lobbyMove })).toMatchObject({ ok: true });
    await clients[0]!.barrier();
    const before = byKey(await deadlines(id));
    expect([...before.keys()].sort()).toEqual(["round:1", "roundEarly:1"]);
    expect([...before.values()].every((r) => !r.paused)).toBe(true);

    clock.advance(1000);
    expect((await req("POST", `/games/${id}/pause`, seats[0]!.who)).status).toBe(200);
    expect((await req("POST", `/games/${id}/pause`, seats[0]!.who)).status).toBe(409);
    const paused = await deadlines(id);
    expect(paused.every((r) => r.paused)).toBe(true);
    // Far past every due time: nothing fires while paused.
    const pausedFor = 2 * (H1.roundMs + H1.resultMs) * 3;
    clock.advance(pausedFor);
    expect(await app.scheduler.tick()).toBe(0);
    expect((await load(id)).phase).toEqual({ kind: "planning", round: 1 });

    expect((await req("POST", `/games/${id}/resume`, seats[0]!.who)).status).toBe(200);
    expect((await req("POST", `/games/${id}/resume`, seats[0]!.who)).status).toBe(409);
    for (const r of await deadlines(id)) {
      expect(r.paused).toBe(false);
      expect(r.due).toBe(before.get(r.key)!.due + pausedFor);
    }
    // And the round still ends early, by the grace after the lock-ins, shifted by the pause.
    await step(id);
    expect((await load(id)).resolvedRound).toBe(1);
  });

  it("a deadline already due when the host pauses never fires after the pause is acknowledged (the tick re-checks under the lock)", async () => {
    const { id, seats } = await startGame(2, { sessionLength: "1h" });
    clock.advance(H1.roundMs + 1000); // round:1 is due
    const acked: number[] = [];
    // The host's pause lands between the tick's select (outside the lock) and the apply.
    const sched = createScheduler({
      db,
      clock,
      log: app.log,
      system: async (gameId, command, key) => {
        acked.push((await req("POST", `/games/${id}/pause`, seats[0]!.who)).status);
        return app.live.deadline(gameId, key, command);
      },
      resync: (gameId) => app.live.settle(gameId),
    });
    expect(await sched.tick()).toBe(0);
    expect(acked).toEqual([200]);
    expect((await load(id)).phase).toEqual({ kind: "planning", round: 1 });
    expect((await deadlines(id)).find((r) => r.key === "round:1")).toMatchObject({ paused: true });
    // After resume the round is due again (it was due when paused) and fires.
    await req("POST", `/games/${id}/resume`, seats[0]!.who);
    expect(await app.scheduler.tick()).toBeGreaterThan(0);
    expect((await load(id)).resolvedRound).toBe(1);
  });

  it("the guarded send skips a row that was extended or removed since the select", async () => {
    const { id } = await startGame(2, { sessionLength: "1h" });
    clock.advance(H1.roundMs + 1000);
    const cmd = { type: "advance", deadline: { kind: "round", round: 1 } } as const;
    await db.query("update deadlines set due_at = due_at + interval '1 hour' where game_id = $1 and key = 'round:1'", [id]);
    expect(await app.live.deadline(id, "round:1", cmd)).toBe(DEADLINE_SKIPPED);
    expect(await app.live.deadline(id, "round:9", cmd)).toBe(DEADLINE_SKIPPED);
    expect((await load(id)).phase).toEqual({ kind: "planning", round: 1 });
  });
});

describe("extend (design §15)", () => {
  it("adds extendMs to the round and its early end; host only; refused when there's nothing to extend", async () => {
    const { id, seats } = await startGame(4);
    const clients = await Promise.all(seats.map((s) => Client.open(id, s.who)));
    for (const c of clients) await c.send({ cmd: lobbyMove });
    await clients[0]!.barrier();
    const before = byKey(await deadlines(id));
    expect((await req("POST", `/games/${id}/extend`, seats[1]!.who)).status).toBe(403);
    const r = await req("POST", `/games/${id}/extend`, seats[0]!.who);
    expect(r.status).toBe(200);
    expect(r.body.extendedMs).toBe(H1.extendMs);
    const after = byKey(await deadlines(id));
    expect(after.get("round:1")!.due).toBe(before.get("round:1")!.due + H1.extendMs);
    expect(after.get("roundEarly:1")!.due).toBe(before.get("roundEarly:1")!.due + H1.extendMs);
    // Every socket hears the new round deadline.
    await clients[1]!.barrier();
    const timers = clients[1]!.messages.flatMap((m) => ("timers" in m ? [m.timers] : [])).at(-1)!;
    expect(timers.find((t) => t.key === "round:1")!.dueAt).toBe(after.get("round:1")!.due);
    // After the game: nothing to extend.
    await db.query("update games set status = 'ended' where id = $1", [id]);
    expect((await req("POST", `/games/${id}/extend`, seats[0]!.who)).status).toBe(409);
  });
});

describe("replace an inactive player with a bot, and hand the seat back (design §15)", () => {
  it(`offered after ${REPLACE_AFTER_MISSED_ROUNDS} missed rounds in a row; the bot plays the seat; the player or host takes it back`, async () => {
    const { id, seats } = await startGame(2, { sessionLength: "1h" });
    const [host, guest] = seats as [Seat, Seat];
    const standIn = `/games/${id}/seats/${guest.seat}/stand-in`;
    expect((await req("POST", standIn, host.who)).status).toBe(409); // not idle yet
    // The host locks in each round; the guest misses two.
    const hc = await Client.open(id, host.who);
    for (let round = 1; round <= REPLACE_AFTER_MISSED_ROUNDS; round++) {
      await hc.send({ cmd: lobbyMove });
      while ((await load(id)).phase.kind !== "planning" || (await load(id)).round === round) await step(id);
    }
    await hc.barrier();
    expect(hc.control().idle).toEqual([guest.player, seats[2]!.player]);
    expect((await req("POST", standIn, guest.who)).status).toBe(403);
    expect((await req("POST", `/games/${id}/seats/${host.seat}/stand-in`, host.who)).status).toBe(409);
    expect((await req("POST", standIn, host.who, { personality: "nope" })).status).toBe(400);
    expect((await req("POST", standIn, host.who)).status).toBe(200);
    expect((await req("POST", standIn, host.who)).status).toBe(409);
    await hc.barrier();
    expect(hc.control().standIns).toEqual([guest.player]);
    // The bot has played the guest's move for this round (a public lock-in mark), so the guest is no longer idle.
    const s = await load(id);
    expect(s.moves[guest.player]).toBeDefined();
    expect(hc.control().idle).toEqual([seats[2]!.player]);
    expect((await req("GET", `/games/${id}`, host.who)).body.seats.find((x) => x.seat === guest.seat)!.standIn).toBe("opportunist");
    // The guest is back: their own commands wait until they take the seat back.
    const gc = await Client.open(id, guest.who);
    expect(await gc.send({ cmd: lobbyMove })).toMatchObject({ rejected: true });
    expect(await gc.send({ chat: { text: "back!" } })).toMatchObject({ ok: true });
    expect((await req("DELETE", standIn, guest.who)).status).toBe(200);
    expect((await req("DELETE", standIn, guest.who)).status).toBe(409);
    await gc.barrier();
    expect(gc.control().standIns).toEqual([]);
    expect(await gc.send({ cmd: lobbyMove })).toMatchObject({ ok: true });
  });
});

describe("kick in the lobby (design §15)", () => {
  it("the host removes another person's seat before the start; never their own; nobody else can", async () => {
    const host = (await req("POST", "/auth/guest", null, { nickname: "Host" })).session!;
    const game = (await req("POST", "/games", host, { settings: {} })).body;
    const guest = (await req("POST", `/invites/${game.inviteCode}/join`, null, { nickname: "Guest" })).session!;
    const seats = (await req("GET", `/games/${game.id}`, host)).body.seats;
    const guestSeat = seats.find((x) => x.nickname === "Guest")!.seat;
    expect((await req("DELETE", `/games/${game.id}/seats/${seats[0]!.seat}`, guest)).status).toBe(403);
    expect((await req("DELETE", `/games/${game.id}/seats/${seats[0]!.seat}`, host)).status).toBe(409);
    const r = await req("DELETE", `/games/${game.id}/seats/${guestSeat}`, host);
    expect(r.status).toBe(200);
    expect(r.body.seats.map((x) => x.nickname)).toEqual(["Host"]);
    expect((await req("GET", `/games/${game.id}`, guest)).status).toBe(404);
  });
});

describe("resilience", () => {
  it("an open socket is closed (4401) once its session expires", async () => {
    const { id, seats } = await startGame(2, { sessionLength: "1h" });
    const c = await Client.open(id, seats[1]!.who);
    expect(await c.send({ chat: { text: "hi" } })).toMatchObject({ ok: true });
    clock.advance(SESSION_TTL_MS + 1000);
    c.ws.send(JSON.stringify({ chat: { text: "still here?" } }));
    await vi.waitFor(() => expect(c.closed).toBe(CLOSE_SIGNED_OUT), quick);
  });

  it("the tick runs games side by side: one game's slow deadline never holds up another's", async () => {
    const user = await insertUser(db);
    const a = await store.create({ hostUserId: user, inviteCode: "slowaaaa", settings: {} });
    const b = await store.create({ hostUserId: user, inviteCode: "fastbbbb", settings: {} });
    const at = new Date(clock.now() - 1000).toISOString();
    for (const [g, key] of [[a, "round:1"], [b, "round:1"]] as const) {
      await db.query("insert into deadlines (game_id, key, due_at, command) values ($1, $2, $3, $4::json)", [g, key, at, JSON.stringify({ type: "advance", deadline: { kind: "round", round: 1 } })]);
    }
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const sent: string[] = [];
    const sched = createScheduler({
      db,
      clock,
      log: app.log,
      system: async (gameId, command) => {
        if (gameId === a) await slow;
        sent.push(gameId);
        await db.query("delete from deadlines where game_id = $1 and command::text = $2", [gameId, JSON.stringify(command)]);
        return true;
      },
      resync: async () => {},
    });
    const first = sched.tick();
    await vi.waitFor(() => expect(sent).toEqual([b]), quick);
    // A later tick, while game A's send still hangs, sends B's next deadline and leaves A alone.
    await db.query("insert into deadlines (game_id, key, due_at, command) values ($1, 'round:2', $2, $3::json)", [b, at, JSON.stringify({ type: "advance", deadline: { kind: "round", round: 2 } })]);
    expect(await sched.tick()).toBe(1);
    expect(sent).toEqual([b, b]);
    release();
    expect(await first).toBe(2);
    expect(sent).toEqual([b, b, a]);
  });
});
