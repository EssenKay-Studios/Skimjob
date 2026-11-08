// QA (S3b.4): adversarial checks of the plan board's live channel. design §10
// (the plan board, "The channel"), §17.2 (the seat comes from the session), §18 (nothing private).
import { readFile } from "node:fs/promises";
import type { Command, GameState } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import { MAX_MESSAGE_BYTES, type ServerMessage } from "./live";
import type { LobbyView } from "./lobby";
import { createPlan, type PlanBoard } from "./plan";
import { buildServer } from "./server";
import { PLAN_RATE, type LobbySettings } from "./settings";
import { createGameStore } from "./store";
import { testDb } from "./testkit";

const quick = { interval: 1, timeout: 10_000 };
const clock = fakeClock(Date.UTC(2026, 10, 1));
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
  return { status: res.statusCode, body: res.json() as LobbyView, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};

interface Human {
  readonly who: string;
  readonly player: string;
}
async function startGame(people: number, bots = 0, settings: Partial<LobbySettings> = {}) {
  const host = (await call("/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await call("/games", host, { settings })).body;
  const sessions = [host];
  for (let i = 1; i < people; i++) sessions.push((await call(`/invites/${game.inviteCode}/join`, null, { nickname: `Guest ${i}` })).session!);
  for (let i = 0; i < bots; i++) await call(`/games/${game.id}/bots`, host, {});
  const started = (await call(`/games/${game.id}/start`, host)).body;
  const humans: Human[] = [];
  for (const who of sessions) {
    const res = await app.inject({ method: "GET", url: `/games/${game.id}`, cookies: { [SESSION_COOKIE]: who } });
    humans.push({ who, player: (res.json() as LobbyView).seats.find((s) => s.you)!.playerId! });
  }
  const botIds = started.seats.filter((s) => s.bot !== null).map((s) => s.playerId!);
  const state = (await load(game.id))!;
  return { id: game.id, inviteCode: game.inviteCode, humans, botIds, rooms: state.rooms };
}
const load = (id: string) => createGameStore(db).load(id) as Promise<GameState>;

class Client {
  readonly raw: string[] = [];
  closed: number | null = null;
  private n = 0;
  ws!: WebSocket;
  static async open(gameId: string, h: Human, url = `/games/${gameId}/ws`) {
    const c = new Client();
    const onInit = (ws: WebSocket) => {
      ws.on("message", (data) => c.raw.push(String(data)));
      ws.on("close", (code) => (c.closed = code));
    };
    c.ws = await app.injectWS(url, { headers: { cookie: `${SESSION_COOKIE}=${h.who}` } }, { onInit });
    await vi.waitFor(() => expect(c.messages.some((m) => "presence" in m)).toBe(true), quick);
    return c;
  }
  get messages(): ServerMessage[] {
    return this.raw.map((t) => JSON.parse(t) as ServerMessage);
  }
  boards(): PlanBoard[] {
    return this.messages.flatMap((m) => ("plan" in m ? [m.plan] : []));
  }
  board(): PlanBoard {
    return this.boards().at(-1)!;
  }
  async sendRaw(msg: Record<string, unknown>): Promise<ServerMessage> {
    const id = `q${++this.n}`;
    this.ws.send(JSON.stringify({ ...msg, id }));
    return this.reply(id);
  }
  async reply(id: string): Promise<ServerMessage> {
    let reply: ServerMessage | undefined;
    await vi.waitFor(() => {
      reply = this.messages.find((m) => "id" in m && m.id === id);
      expect(reply).toBeDefined();
    }, quick);
    return reply!;
  }
  plan(plan: unknown) {
    return this.sendRaw({ plan });
  }
  async barrier() {
    await this.sendRaw({});
  }
}
const closeAll = (...cs: Client[]) => cs.forEach((c) => c.ws.close());
const closed = { rejected: true, reason: "the plan board is closed until the next round" };

function nextDeadline(state: GameState): Command[] {
  const phase = state.phase;
  if (phase.kind === "meeting") return [{ type: "advance", deadline: { kind: "closeMeeting", meetingId: phase.meetingId } }];
  if (phase.kind === "shakedownPending") return [{ type: "advance", deadline: { kind: "resolveShakedown", meetingId: phase.meetingId } }];
  if (state.pendingEmergency) {
    return [{ type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency.meetingId } }];
  }
  if (phase.kind === "planning") return [{ type: "advance", deadline: { kind: "round", round: phase.round } }];
  if (phase.kind === "alibis") return [{ type: "advance", deadline: { kind: "alibis", round: phase.round } }];
  // design §9.3: the result window closes when nobody called an emergency.
  if (phase.kind === "result") return [{ type: "advance", deadline: { kind: "result", round: phase.round } }];
  if (phase.kind === "awaitingMeeting") {
    const schedule: Command[] = state.scheduledMeeting ? [] : [{ type: "scheduleMeeting", meetingId: phase.meetingId, slot: `server-${phase.meetingId}` }];
    return [...schedule, { type: "advance", deadline: { kind: "openMeeting", meetingId: phase.meetingId } }];
  }
  return [];
}
const step = async (id: string) => {
  for (const cmd of nextDeadline(await load(id))) await app.live.system(id, cmd as Parameters<typeof app.live.system>[1]);
};
const roundDeadline = async (id: string, round: number) => {
  const [row] = await db.query<{ due: number; paused: number | null }>(
    "select (extract(epoch from due_at) * 1000)::float8 as due, (extract(epoch from paused_at) * 1000)::float8 as paused from deadlines where game_id = $1 and key = $2",
    [id, `round:${round}`],
  );
  return row ? { due: Number(row.due), paused: row.paused === null ? null : Number(row.paused) } : null;
};

describe("QA: nobody sets another seat's claims or agreement (design §10, §17.2)", () => {
  it("forged ids at the top level, inside place, in the socket query or in a __proto__ never move another seat's claims", async () => {
    const { id, humans, rooms } = await startGame(3);
    const victim = humans[1]!;
    const a = await Client.open(id, humans[0]!, `/games/${id}/ws?player=${victim.player}&as=${victim.player}`);
    const b = await Client.open(id, victim);
    // Top-level forged fields are ignored: the edit is A's own.
    expect(await a.sendRaw({ plan: { room: rooms[0], agree: true }, player: victim.player, from: victim.player, actor: victim.player })).toMatchObject({ ok: true });
    // Inside the plan or inside place they are refused.
    for (const bad of [
      { room: rooms[1], actor: victim.player },
      { agree: true, as: victim.player },
      { place: { player: victim.player, room: rooms[1], agree: true } },
      { place: { player: victim.player, room: rooms[1], claim: rooms[1] } },
      { place: { player: victim.player, room: rooms[1], power: { role: "hacker", target: rooms[0] } } },
      { power: { role: "hacker", target: rooms[0], player: victim.player } },
    ]) {
      expect(await a.plan(bad), JSON.stringify(bad)).toMatchObject({ rejected: true, reason: expect.stringMatching(/^unknown (plan|place|power) field/) });
    }
    a.ws.send(`{"id":"proto","plan":{"room":"${rooms[1]}","__proto__":{"player":"${victim.player}"}}}`);
    expect(await a.reply("proto")).toMatchObject({ rejected: true });
    a.ws.send(`{"id":"proto2","plan":{"place":{"player":"${victim.player}","room":"${rooms[1]}","__proto__":{"agree":true}}}}`);
    expect(await a.reply("proto2")).toMatchObject({ rejected: true });
    await b.barrier();
    // The query said victim: the socket is still A's seat, and the victim's entry is untouched.
    expect(b.board().entries).toEqual([{ player: humans[0]!.player, placed: null, room: rooms[0], power: null, agreed: true }]);
    // Placing the victim's avatar is allowed (§10), but never touches their claims or agreement.
    expect(await b.plan({ room: rooms[2] ?? rooms[0], agree: true, power: { role: "detective", target: humans[0]!.player } })).toMatchObject({ ok: true });
    expect(await a.plan({ place: { player: victim.player, room: null } })).toMatchObject({ ok: true });
    expect(await a.plan({ place: { player: victim.player, room: rooms[1] } })).toMatchObject({ ok: true });
    await b.barrier();
    expect(b.board().entries.find((e) => e.player === victim.player)).toEqual({
      player: victim.player,
      placed: rooms[1],
      room: rooms[2] ?? rooms[0],
      power: { role: "detective", target: humans[0]!.player },
      agreed: true,
    });
    // A clearing "its own" claims clears only A's.
    expect(await a.plan({ room: null, power: null, agree: false })).toMatchObject({ ok: true });
    await b.barrier();
    expect(b.board().entries.find((e) => e.player === victim.player)).toMatchObject({ room: rooms[2] ?? rooms[0], agreed: true });
    // The history names A as the actor of every A edit, and the victim's own claims only as the victim's.
    const history = await createPlan(db, clock).history(id, 1);
    for (const h of history) if (h.kind !== "place") expect(h.subject).toBe(h.actor);
    expect(history.filter((h) => h.actor === humans[0]!.player && h.kind !== "place").every((h) => h.subject === humans[0]!.player)).toBe(true);
    closeAll(a, b);
  });

  it("there is no HTTP route to the board: nothing outside the socket can write it", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    for (const url of [`/games/${id}/plan`, `/games/${id}/plan?player=${humans[1]!.player}`, `/games/${id}/board/plan`]) {
      const res = await app.inject({ method: "POST", url, payload: { plan: { room: rooms[0] } }, cookies: { [SESSION_COOKIE]: humans[0]!.who } });
      expect(res.statusCode, url).toBe(404);
    }
    expect(await db.query("select 1 from plan_entries where game_id = $1", [id])).toEqual([]);
  });
});

describe("QA: placements and power claims against content (design §10)", () => {
  it("any seat places any crew avatar, its own and bots' too; never a non-player, an unknown or prototype room", async () => {
    const { id, humans, botIds, rooms } = await startGame(2, 2);
    const a = await Client.open(id, humans[0]!);
    expect(await a.plan({ place: { player: humans[0]!.player, room: rooms[0] } })).toMatchObject({ ok: true });
    for (const bot of botIds) expect(await a.plan({ place: { player: bot, room: rooms[1] } })).toMatchObject({ ok: true });
    for (const [player, room, reason] of [
      ["p99", rooms[0], "no such player"], // a seat id this game doesn't have
      ["", rooms[0], "no such player"],
      ["toString", rooms[0], "no such player"],
      [humans[1]!.player, "__proto__", "no such room"],
      [humans[1]!.player, "toString", "no such room"],
      [humans[1]!.player, "", "no such room"],
      [humans[1]!.player, rooms[0]!.toUpperCase(), "no such room"],
      [humans[1]!.player, ` ${rooms[0]}`, "no such room"],
      [humans[1]!.player, 0, "no such room"],
      [humans[1]!.player, [rooms[0]], "no such room"],
      [7, rooms[0], "no such player"],
      [null, rooms[0], "no such player"],
    ] as const) {
      expect(await a.plan({ place: { player, room } }), `${String(player)} ${String(room)}`).toMatchObject({ rejected: true, reason });
    }
    // A wholesale rejection stores nothing, even with a valid claim alongside an invalid placement.
    expect(await a.plan({ room: rooms[0], place: { player: "nobody", room: rooms[0] } })).toMatchObject({ rejected: true, reason: "no such player" });
    await a.barrier();
    expect(a.board().entries.map((e) => [e.player, e.placed, e.room])).toEqual([[humans[0]!.player, rooms[0], null], ...botIds.map((b) => [b, rooms[1], null])]);
    closeAll(a);
  });

  it("a power claim is a pledge, so a role you don't hold or that isn't in the deck is fine; its target must still fit the power", async () => {
    // A deck without the Priest or the Auditor: claiming them is a (detectable) bluff, which §10 allows.
    const { id, humans, rooms } = await startGame(3, 0, { roles: ["rookie", "hacker", "detective", "mole"] });
    const state = await load(id);
    const mine = state.players[humans[0]!.player]!.role;
    const a = await Client.open(id, humans[0]!);
    for (const role of ["priest", "detective"]) {
      if (role === mine) continue;
      expect(await a.plan({ power: { role, target: humans[1]!.player } })).toMatchObject({ ok: true });
    }
    for (const role of ["auditor", "lookout", "hacker"]) expect(await a.plan({ power: { role, target: rooms[0] } })).toMatchObject({ ok: true });
    expect(await a.plan({ power: { role: "priest", target: humans[0]!.player } })).toMatchObject({ rejected: true, reason: "you can't claim a power on yourself" });
    expect(await a.plan({ power: { role: "auditor", target: humans[1]!.player } })).toMatchObject({ rejected: true, reason: "that power takes a room in play" });
    expect(await a.plan({ power: { role: "lookout", target: "__proto__" } })).toMatchObject({ rejected: true, reason: "that power takes a room in play" });
    expect(await a.plan({ power: { role: "priest", target: "hasOwnProperty" } })).toMatchObject({ rejected: true, reason: "that power takes a player in this game" });
    for (const role of ["fixer", "mole", "smoothTalker", "rookie", "hasOwnProperty", "valueOf", ""]) {
      expect(await a.plan({ power: { role, target: rooms[0] } }), role).toMatchObject({ rejected: true });
    }
    await a.barrier();
    expect(a.board().entries).toEqual([{ player: humans[0]!.player, placed: null, room: null, power: { role: "hacker", target: rooms[0] }, agreed: false }]);
    closeAll(a);
  });
});

describe("QA: when the board takes edits (design §10: the round's span)", () => {
  it("no meeting can interrupt planning: an emergency call is refused and the board keeps taking edits (design §9.3, §10)", async () => {
    const { id, humans, rooms } = await startGame(3);
    const [a, b] = await Promise.all(humans.slice(0, 2).map((h) => Client.open(id, h)));
    expect(await a!.sendRaw({ cmd: { type: "callEmergency" } })).toMatchObject({ rejected: true });
    expect((await load(id)).phase.kind).toBe("planning");
    expect(await b!.plan({ room: rooms[0], agree: true })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(a!.board().entries).toHaveLength(1), quick);
    closeAll(a!, b!);
  });

  it("a meeting after the round resolved (the result window) is closed to edits; the next round opens it again", async () => {
    const { id, humans, rooms } = await startGame(3);
    const a = await Client.open(id, humans[0]!);
    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
    expect((await load(id)).phase.kind).toBe("alibis");
    // design §9.3: not during the alibis; in the result window (after any meeting the round called).
    expect(await a.sendRaw({ cmd: { type: "callEmergency" } })).toMatchObject({ rejected: true });
    await app.live.system(id, { type: "advance", deadline: { kind: "alibis", round: 1 } });
    while ((await load(id)).phase.kind !== "result") await step(id);
    expect(await a.sendRaw({ cmd: { type: "callEmergency" } })).toMatchObject({ ok: true });
    while ((await load(id)).phase.kind !== "meeting") await step(id);
    const s = await load(id);
    expect(s.round).toBe(s.resolvedRound);
    expect(await a.plan({ room: rooms[0] })).toMatchObject(closed);
    expect(await a.plan({ place: { player: humans[1]!.player, room: rooms[0] } })).toMatchObject(closed);
    while ((await load(id)).phase.kind !== "planning") await step(id);
    expect(await a.plan({ room: rooms[0] })).toMatchObject({ ok: true });
    await a.barrier();
    expect(a.board().round).toBe((await load(id)).round);
    closeAll(a);
  });

  it("after the game ends nothing is accepted; bots never wrote the board over a whole game", async () => {
    const { id, humans, rooms } = await startGame(2, 2);
    const a = await Client.open(id, humans[0]!);
    for (let i = 0; i < 400 && (await load(id)).phase.kind !== "ended"; i++) await step(id);
    expect((await load(id)).phase.kind).toBe("ended");
    expect(await db.query("select 1 from plan_entries where game_id = $1", [id])).toEqual([]);
    expect(await db.query("select 1 from plan_edits where game_id = $1", [id])).toEqual([]);
    for (const plan of [{ room: rooms[0] }, { agree: true }, { place: { player: humans[1]!.player, room: rooms[0] } }, { power: { role: "hacker", target: rooms[0] } }]) {
      expect(await a.plan(plan)).toMatchObject(closed);
    }
    expect(await db.query("select 1 from plan_entries where game_id = $1", [id])).toEqual([]);
    closeAll(a);
  });

  it("a host pause doesn't close the board, and the history's time left is the remainder at the pause", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    clock.advance(7_000);
    expect((await app.inject({ method: "POST", url: `/games/${id}/pause`, cookies: { [SESSION_COOKIE]: humans[0]!.who } })).statusCode).toBe(200);
    const dl = (await roundDeadline(id, 1))!;
    expect(dl.paused).not.toBeNull();
    clock.advance(30_000);
    expect(await a.plan({ room: rooms[0] })).toMatchObject({ ok: true });
    const [rec] = await createPlan(db, clock).history(id, 1);
    expect(rec!.msBeforeDeadline).toBe(dl.due - dl.paused!);
    closeAll(a);
  });

  it("the time left is exactly due − now while the round runs", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    clock.advance(12_345);
    expect(await a.plan({ agree: true })).toMatchObject({ ok: true });
    const dl = (await roundDeadline(id, 1))!;
    const now = clock.now();
    clock.advance(1_000);
    expect(await a.plan({ room: rooms[0] })).toMatchObject({ ok: true });
    const history = await createPlan(db, clock).history(id, 1);
    expect(history.find((h) => h.kind === "agree")!.msBeforeDeadline).toBe(dl.due - now);
    expect(history.find((h) => h.kind === "room")!.msBeforeDeadline).toBe(dl.due - now - 1_000);
    expect(new Date(history.find((h) => h.kind === "room")!.at).getTime()).toBe(now + 1_000);
    closeAll(a);
  });
});

describe("QA: past the deadline, before the scheduler's tick (design §10: until the deadline)", () => {
  it("an edit at due − 1 ms is taken; at due + 1 ms refused and stored nowhere; a round paused before its deadline still takes edits long after it", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    const dl = (await roundDeadline(id, 1))!;
    clock.advance(dl.due - 1 - clock.now());
    expect(await a.plan({ room: rooms[0] })).toMatchObject({ ok: true });
    expect((await createPlan(db, clock).history(id, 1))[0]!.msBeforeDeadline).toBe(1);
    clock.advance(2);
    for (const plan of [{ room: rooms[1] }, { agree: true }, { place: { player: humans[1]!.player, room: rooms[0] } }]) {
      expect(await a.plan(plan)).toMatchObject({ rejected: true, reason: "the plan board is closed: the round's time is up" });
    }
    expect(await db.query("select room, agreed, placed from plan_entries where game_id = $1", [id])).toEqual([{ room: rooms[0], agreed: false, placed: null }]);
    expect((await createPlan(db, clock).history(id, 1)).every((h) => h.msBeforeDeadline! > 0)).toBe(true);

    const g = await startGame(2, 1);
    const b = await Client.open(g.id, g.humans[0]!);
    const gdl = (await roundDeadline(g.id, 1))!;
    clock.advance(gdl.due - 5_000 - clock.now());
    expect((await app.inject({ method: "POST", url: `/games/${g.id}/pause`, cookies: { [SESSION_COOKIE]: g.humans[0]!.who } })).statusCode).toBe(200);
    clock.advance(60_000); // well past the original due time, but paused
    expect(await b.plan({ room: g.rooms[0] })).toMatchObject({ ok: true });
    expect((await createPlan(db, clock).history(g.id, 1))[0]!.msBeforeDeadline).toBe(5_000);
    closeAll(a, b);
  });

  it("a host pause after the deadline has passed (before the tick) doesn't reopen the board", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    const dl = (await roundDeadline(id, 1))!;
    clock.advance(dl.due + 3_000 - clock.now());
    expect((await app.inject({ method: "POST", url: `/games/${id}/pause`, cookies: { [SESSION_COOKIE]: humans[0]!.who } })).statusCode).toBe(200);
    expect((await roundDeadline(id, 1))!.paused).not.toBeNull();
    for (const plan of [{ room: rooms[0] }, { agree: true }]) {
      expect(await a.plan(plan)).toMatchObject({ rejected: true, reason: "the plan board is closed: the round's time is up" });
    }
    expect(await createPlan(db, clock).history(id, 1)).toEqual([]);
    closeAll(a);
  });
});

describe("QA: limits and hostile payloads", () => {
  it("the rate limit is per seat across its tabs, per game, and refused or invalid edits don't spend it", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const [a1, a2] = [await Client.open(id, humans[0]!), await Client.open(id, humans[0]!)];
    // Invalid edits cost nothing.
    for (let i = 0; i < PLAN_RATE.writes + 5; i++) expect(await a1.plan({ room: "armory" })).toMatchObject({ rejected: true, reason: "no such room" });
    for (let i = 0; i < PLAN_RATE.writes; i++) expect(await (i % 2 ? a1 : a2).plan({ room: rooms[i % 2] })).toMatchObject({ ok: true });
    // Both tabs of the seat are now held back.
    expect(await a1.plan({ agree: true })).toMatchObject({ rejected: true, reason: "slow down: too many plan changes" });
    expect(await a2.plan({ place: { player: humans[1]!.player, room: rooms[0] } })).toMatchObject({ rejected: true, reason: "slow down: too many plan changes" });
    // The same person in another game is not.
    const g2 = await startGame(2, 1);
    const g2a = await Client.open(g2.id, g2.humans[0]!);
    expect(await g2a.plan({ agree: true })).toMatchObject({ ok: true });
    await a1.barrier();
    expect(a1.board().entries[0]).toMatchObject({ agreed: false, placed: null });
    closeAll(a1, a2, g2a);
  });

  it("a frame over the size limit closes the socket and stores nothing; long or deep values within it are refused", async () => {
    const { id, humans } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    expect(await a.plan({ room: "x".repeat(MAX_MESSAGE_BYTES - 100) })).toMatchObject({ rejected: true, reason: "no such room" });
    expect(await a.plan({ place: { player: "p".repeat(10_000), room: null } })).toMatchObject({ rejected: true, reason: "no such player" });
    let deep: unknown = "office";
    for (let i = 0; i < 1000; i++) deep = [deep];
    expect(await a.plan({ room: deep })).toMatchObject({ rejected: true, reason: "no such room" });
    expect(await a.plan({ power: { role: "hacker", target: deep } })).toMatchObject({ rejected: true, reason: "target must be a room or a player" });
    a.ws.send("{\"plan\":{\"room\":");
    a.ws.send(Buffer.from(JSON.stringify({ plan: { agree: true } })), { binary: true });
    const b = await Client.open(id, humans[1]!);
    b.ws.send(JSON.stringify({ id: "big", plan: { room: "x".repeat(MAX_MESSAGE_BYTES) } }));
    await vi.waitFor(() => expect(b.closed).toBe(1009), quick);
    await a.barrier();
    expect(await db.query("select 1 from plan_entries where game_id = $1", [id])).toEqual([]);
    expect(a.closed).toBeNull();
    closeAll(a);
  });

  it("a frame with both a plan and a command runs only the plan edit", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    const before = (await load(id)).log.length;
    expect(await a.sendRaw({ plan: { room: rooms[0] }, cmd: { type: "submitMove", move: { room: rooms[0], duffel: 1, pocket: 0 } } })).toMatchObject({ ok: true });
    expect((await load(id)).log.length).toBe(before);
    await a.barrier();
    expect(a.board().entries).toHaveLength(1);
    closeAll(a);
  });
});

describe("QA: concurrent edits", () => {
  it("two players moving the same avatar at once: one wins, every seat converges on the stored board, both moves are in the history", async () => {
    const { id, humans, botIds, rooms } = await startGame(3, 1);
    const cs = await Promise.all(humans.map((h) => Client.open(id, h)));
    const [a, b, c] = cs as [Client, Client, Client];
    const bot = botIds[0]!;
    for (let k = 0; k < 5; k++) {
      a.ws.send(JSON.stringify({ id: `a${k}`, plan: { place: { player: bot, room: rooms[0] }, agree: k % 2 === 0 } }));
      b.ws.send(JSON.stringify({ id: `b${k}`, plan: { place: { player: bot, room: rooms[1] }, room: rooms[k % 2] } }));
      c.ws.send(JSON.stringify({ id: `c${k}`, plan: { place: { player: humans[0]!.player, room: rooms[k % 2] } } }));
    }
    for (let k = 0; k < 5; k++) for (const [cl, p] of [[a, "a"], [b, "b"], [c, "c"]] as const) expect(await cl.reply(`${p}${k}`)).toMatchObject({ ok: true });
    for (const cl of cs) await cl.barrier();
    const stored = await createPlan(db, clock).board(id, await load(id));
    for (const cl of cs) expect(cl.board()).toEqual(stored);
    expect([rooms[0], rooms[1]]).toContain(stored.entries.find((e) => e.player === bot)!.placed);
    const placeBot = (await createPlan(db, clock).history(id, 1)).filter((h) => h.kind === "place" && h.subject === bot);
    expect(placeBot.map((h) => h.actor).sort()).toEqual([humans[0]!.player, humans[1]!.player].sort());
    closeAll(...cs);
  });
});

describe("QA: the edit history is compact and bounded (design §10)", () => {
  it("3 seats editing everything over and over: exactly players × (players + 3) rows, never more", async () => {
    const { id, rooms } = await startGame(3);
    const state = await load(id);
    const plan = createPlan(db, clock);
    const seats = state.playerOrder;
    for (let pass = 0; pass < 3; pass++) {
      for (const actor of seats) {
        for (const subject of seats) {
          for (const room of [rooms[0]!, rooms[1]!, null]) {
            expect(await plan.edit(id, state, actor, { place: { player: subject, room } })).toEqual({ ok: true, value: undefined });
            clock.advance(PLAN_RATE.windowMs / PLAN_RATE.writes + 1);
          }
        }
        const target = seats.find((p) => p !== actor)!;
        for (const edit of [{ room: rooms[pass % 2]! }, { power: { role: "detective", target } }, { agree: pass % 2 === 0 }, { room: null }, { power: null }]) {
          expect(await plan.edit(id, state, actor, edit)).toEqual({ ok: true, value: undefined });
          clock.advance(PLAN_RATE.windowMs / PLAN_RATE.writes + 1);
        }
      }
    }
    const history = await plan.history(id, 1);
    expect(history).toHaveLength(seats.length * (seats.length + 3));
    // Each row is the latest of its kind: rooms and powers end cleared; the last agree was pass 2's (true).
    expect(history.filter((h) => h.kind === "room" || h.kind === "power").every((h) => h.value === null && h.target === null)).toBe(true);
    expect(history.filter((h) => h.kind === "agree").every((h) => h.value === "true")).toBe(true);
    expect(history.filter((h) => h.kind === "place").every((h) => h.value === null)).toBe(true);
    // Oldest first.
    const times = history.map((h) => h.at);
    expect([...times].sort()).toEqual(times);
    expect((await plan.board(id, state)).entries.every((e) => e.agreed && e.room === null && e.placed === null && e.power === null)).toBe(true);
  });
});

describe("QA: reconnects, per-round reset and leaks", () => {
  it("a seat that drops and reconnects gets the current board, edits made while away included; in a later round the fresh board", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const [a, b] = await Promise.all(humans.map((h) => Client.open(id, h)));
    expect(await a!.plan({ room: rooms[0] })).toMatchObject({ ok: true });
    b!.ws.close();
    expect(await a!.plan({ place: { player: humans[1]!.player, room: rooms[1] }, agree: true })).toMatchObject({ ok: true });
    const b2 = await Client.open(id, humans[1]!);
    expect(b2.boards()).toHaveLength(1);
    expect(b2.board()).toEqual({
      round: 1,
      entries: [
        { player: humans[0]!.player, placed: null, room: rooms[0], power: null, agreed: true },
        { player: humans[1]!.player, placed: rooms[1], room: null, power: null, agreed: false },
      ],
    });
    b2.ws.close();
    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
    await app.live.system(id, { type: "advance", deadline: { kind: "alibis", round: 1 } });
    while ((await load(id)).phase.kind !== "planning") await step(id); // design §9.3: the result window (and any meeting)
    const b3 = await Client.open(id, humans[1]!);
    expect(b3.board()).toEqual({ round: 2, entries: [] });
    // The new round's history starts empty too; round 1's is kept.
    const plan = createPlan(db, clock);
    expect(await plan.history(id, 2)).toEqual([]);
    expect((await plan.history(id, 1)).length).toBeGreaterThan(0);
    // An edit now lands in round 2 only.
    expect(await b3.plan({ room: rooms[0] })).toMatchObject({ ok: true });
    expect(await db.query("select round, player_id, room from plan_entries where game_id = $1 and round = 2", [id])).toEqual([{ round: 2, player_id: humans[1]!.player, room: rooms[0] }]);
    closeAll(a!, b3);
  });

  it("every seat gets the same board text; a seat's real role, move or stash never rides on it; the history never reaches a socket", async () => {
    const { id, humans, rooms } = await startGame(3);
    const cs = await Promise.all(humans.map((h) => Client.open(id, h)));
    const state = await load(id);
    const realRole = state.players[humans[0]!.player]!.role;
    expect(await cs[0]!.sendRaw({ cmd: { type: "submitMove", move: { room: rooms[1], duffel: 1, pocket: 1 } } })).toMatchObject({ ok: true });
    expect(await cs[0]!.plan({ room: rooms[0], power: { role: "detective", target: humans[1]!.player }, agree: true })).toMatchObject({ ok: true });
    expect(await cs[1]!.plan({ place: { player: humans[0]!.player, room: rooms[2] ?? rooms[0] } })).toMatchObject({ ok: true });
    for (const c of cs) await c.barrier();
    const frames = cs.map((c) => c.raw.filter((t) => t.startsWith('{"plan"')));
    for (const f of frames) expect(f).toEqual(frames[0]);
    const all = frames.flat().join("\n");
    if (realRole !== "detective") expect(all).not.toContain(realRole);
    for (const leak of ["role\":\"" + realRole, "duffel", "pocket", "stash", "msBeforeDeadline", "ms_before_deadline", "actor", "subject", "seed"]) {
      if (leak.includes("detective")) continue;
      expect(all).not.toContain(leak);
    }
    expect(cs.flatMap((c) => c.raw).join("\n")).not.toContain("msBeforeDeadline");
    closeAll(...cs);
  });
});

describe("QA: the migration is add-only (design §10 build)", () => {
  it("010 only creates new tables, both cascading from games; no drop, alter, update, delete or truncate", async () => {
    const sql = await readFile(new URL("../migrations/010_plan_board.sql", import.meta.url), "utf8");
    const code = sql.replace(/--.*$/gm, "").toLowerCase();
    expect(code).not.toMatch(/\b(drop|alter|update|delete\s+from|truncate|rename|insert)\b/);
    const creates = [...code.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
    expect(creates).toEqual(["plan_entries", "plan_edits"]);
    expect(code.match(/references games \(id\) on delete cascade/g)).toHaveLength(2);
  });
});
