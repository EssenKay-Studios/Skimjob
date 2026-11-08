// The plan board over the game socket: anyone places any avatar on the proposed
// plan, only you set your own claims, live to every seat, checked against
// content, per round, with a compact edit history, rate-limited, nothing leaked.
// design §10 (the plan board), §17.2 (the seat comes from the session), §18
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import type { ServerMessage } from "./live";
import type { LobbyView } from "./lobby";
import type { PlanBoard } from "./plan";
import { buildServer } from "./server";
import { PLAN_RATE, type LobbySettings } from "./settings";
import { createPlan } from "./plan";
import { createGameStore } from "./store";
import { testDb } from "./testkit";

const quick = { interval: 1, timeout: 5000 };
const clock = fakeClock(Date.UTC(2026, 10, 1));
let db: Db;
let app: FastifyInstance;
beforeAll(async () => {
  db = await testDb();
  app = buildServer({ db, clock });
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

interface Human {
  readonly who: string;
  readonly player: string;
}
/** A started game: `people` guests (host first), then `bots` bots. */
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
  const state = (await createGameStore(db).load(game.id))!;
  return { id: game.id, humans, botIds, rooms: state.rooms };
}

class Client {
  readonly raw: string[] = [];
  private n = 0;
  ws!: WebSocket;
  static async open(gameId: string, h: Human) {
    const c = new Client();
    const onInit = (ws: WebSocket) => ws.on("message", (data) => c.raw.push(String(data)));
    c.ws = await app.injectWS(`/games/${gameId}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${h.who}` } }, { onInit });
    await vi.waitFor(() => expect(c.presenceSeen()).toBe(true), quick);
    return c;
  }
  get messages(): ServerMessage[] {
    return this.raw.map((t) => JSON.parse(t) as ServerMessage);
  }
  presenceSeen() {
    return this.messages.some((m) => "presence" in m);
  }
  /** Every plan board frame received, oldest first. */
  boards(): PlanBoard[] {
    return this.messages.flatMap((m) => ("plan" in m ? [m.plan] : []));
  }
  board(): PlanBoard {
    return this.boards().at(-1)!;
  }
  async sendRaw(msg: Record<string, unknown>): Promise<ServerMessage> {
    const id = `m${++this.n}`;
    this.ws.send(JSON.stringify({ ...msg, id }));
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
  /** Every message queued for this socket so far has arrived (the reply goes through the game's lock). */
  async barrier() {
    await this.sendRaw({});
    return this.raw.length;
  }
}
const closeAll = (...cs: Client[]) => cs.forEach((c) => c.ws.close());

/**
 * After a round's alibis: a meeting the round called (a raid's briefing or a third of the bank, design §9.1,
 * §9.2) passes with nobody voting, then the result window closes with no emergency (§9.3): the next round.
 */
async function toNextRound(app: FastifyInstance, id: string): Promise<void> {
  for (;;) {
    const s = (await createGameStore(db).load(id))!;
    const p = s.phase;
    if (p.kind === "result") await app.live.system(id, { type: "advance", deadline: { kind: "result", round: p.round } });
    else if (p.kind === "awaitingMeeting") {
      if (!s.scheduledMeeting) await app.live.system(id, { type: "scheduleMeeting", meetingId: p.meetingId, slot: p.meetingId });
      await app.live.system(id, { type: "advance", deadline: { kind: "openMeeting", meetingId: p.meetingId } });
    } else if (p.kind === "meeting") await app.live.system(id, { type: "advance", deadline: { kind: "closeMeeting", meetingId: p.meetingId } });
    else if (p.kind === "shakedownPending") await app.live.system(id, { type: "advance", deadline: { kind: "resolveShakedown", meetingId: p.meetingId } });
    else return;
  }
}

describe("the plan board is live for everyone (design §10)", () => {
  it("an entry reaches every seat; the author is the session's seat, never a field", async () => {
    const { id, humans, rooms } = await startGame(3);
    const [a, b, c] = await Promise.all(humans.map((h) => Client.open(id, h)));
    expect(a!.board()).toEqual({ round: 1, entries: [] });
    expect(await a!.plan({ room: rooms[0] })).toMatchObject({ ok: true });
    for (const cl of [a!, b!, c!]) {
      await vi.waitFor(() => expect(cl.board().entries).toEqual([{ player: humans[0]!.player, placed: null, room: rooms[0], power: null, agreed: false }]), quick);
    }
    // A forged author (or any unknown field) is refused, not believed.
    expect(await b!.plan({ room: rooms[1], player: humans[0]!.player })).toMatchObject({ rejected: true, reason: 'unknown plan field "player"' });
    expect(await b!.plan({ room: rooms[1] })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(a!.board().entries.map((e) => [e.player, e.room])).toEqual([[humans[0]!.player, rooms[0]], [humans[1]!.player, rooms[1]]]), quick);
    closeAll(a!, b!, c!);
  });

  it("edits merge into the seat's own entry: a claim, a pledge, agree; null clears; seat order", async () => {
    const { id, humans, rooms } = await startGame(3);
    const [a, b] = await Promise.all(humans.slice(0, 2).map((h) => Client.open(id, h)));
    expect(await b!.plan({ agree: true })).toMatchObject({ ok: true });
    expect(await a!.plan({ room: rooms[0] })).toMatchObject({ ok: true });
    expect(await a!.plan({ power: { role: "hacker", target: rooms[1] } })).toMatchObject({ ok: true });
    expect(await a!.plan({ agree: true })).toMatchObject({ ok: true });
    await vi.waitFor(
      () =>
        expect(b!.board().entries).toEqual([
          { player: humans[0]!.player, placed: null, room: rooms[0], power: { role: "hacker", target: rooms[1] }, agreed: true },
          { player: humans[1]!.player, placed: null, room: null, power: null, agreed: true },
        ]),
      quick,
    );
    // A player power takes a player: bots are fine to name.
    expect(await a!.plan({ power: { role: "detective", target: humans[2]!.player } })).toMatchObject({ ok: true });
    expect(await a!.plan({ room: null, power: null, agree: false })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(b!.board().entries).toEqual([{ player: humans[1]!.player, placed: null, room: null, power: null, agreed: true }]), quick);
    closeAll(a!, b!);
  });

  it("a change that leaves the board as it was sends nobody a frame", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const [a, b] = await Promise.all(humans.map((h) => Client.open(id, h)));
    expect(await a!.plan({ room: rooms[0] })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(b!.boards()).toHaveLength(2), quick);
    const before = await b!.barrier();
    expect(await a!.plan({ room: rooms[0] })).toMatchObject({ ok: true });
    expect(await b!.barrier()).toBe(before + 1); // only its own barrier reply
    expect(b!.boards()).toHaveLength(2);
    closeAll(a!, b!);
  });

  it("is stored: a seat that connects later gets the board after its chat history, before presence", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    expect(await a.plan({ room: rooms[2] ?? rooms[0], agree: true })).toMatchObject({ ok: true });
    a.ws.close();
    const b = await Client.open(id, humans[1]!);
    expect(b.board().entries).toEqual([{ player: humans[0]!.player, placed: null, room: rooms[2] ?? rooms[0], power: null, agreed: true }]);
    const kinds = b.messages.map((m) => Object.keys(m)[0]);
    expect(kinds.indexOf("view")).toBeLessThan(kinds.indexOf("chatHistory"));
    expect(kinds.indexOf("chatHistory")).toBeLessThan(kinds.indexOf("plan"));
    expect(kinds.indexOf("plan")).toBeLessThan(kinds.indexOf("presence"));
    closeAll(b);
  });

  it("stays inside its game, and non-players get nothing", async () => {
    const g1 = await startGame(2, 1);
    const g2 = await startGame(2, 1);
    const [a, other] = await Promise.all([Client.open(g1.id, g1.humans[0]!), Client.open(g2.id, g2.humans[0]!)]);
    expect(await a.plan({ room: g1.rooms[0], agree: true })).toMatchObject({ ok: true });
    await a.barrier();
    expect(await other.barrier()).toBeGreaterThan(0);
    expect(other.board().entries).toEqual([]);
    // Seated in another game, signed out or a stranger: the socket is refused before it opens.
    await expect(app.injectWS(`/games/${g1.id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${g2.humans[0]!.who}` } })).rejects.toThrow();
    await expect(app.injectWS(`/games/${g1.id}/ws`)).rejects.toThrow();
    closeAll(a, other);
  });
});

describe("what an entry may say (checked against content)", () => {
  it("refuses rooms, roles and targets that aren't in the game", async () => {
    const { id, humans, rooms } = await startGame(3);
    const a = await Client.open(id, humans[0]!);
    const bad = async (plan: unknown, reason: RegExp | string) =>
      expect(await a.plan(plan), JSON.stringify(plan)).toMatchObject({ rejected: true, reason: typeof reason === "string" ? reason : expect.stringMatching(reason) });
    await bad({ room: "armory" }, "no such room");
    await bad({ room: 5 }, "no such room");
    await bad({ room: "__proto__" }, "no such room");
    await bad({ room: "constructor" }, "no such room");
    await bad({ power: { role: "wizard", target: rooms[0] } }, "no such role");
    await bad({ power: { role: "__proto__", target: rooms[0] } }, "no such role");
    await bad({ power: { role: "constructor", target: rooms[0] } }, "no such role");
    await bad({ power: { role: "toString", target: rooms[0] } }, "no such role");
    await bad({ power: { role: 7, target: rooms[0] } }, "no such role");
    // Powers with nothing to point at can't be claimed: passive, no power, hidden tip-off.
    await bad({ power: { role: "rookie", target: rooms[0] } }, "that role's power can't be claimed");
    await bad({ power: { role: "mole", target: rooms[0] } }, "that role's power can't be claimed");
    await bad({ power: { role: "smoothTalker", target: rooms[0] } }, "that role's power can't be claimed");
    // A room power takes a room in play; a player power a player of this game, not yourself.
    await bad({ power: { role: "hacker", target: humans[1]!.player } }, "that power takes a room in play");
    await bad({ power: { role: "hacker", target: "armory" } }, "that power takes a room in play");
    await bad({ power: { role: "detective", target: rooms[0] } }, "that power takes a player in this game");
    await bad({ power: { role: "detective", target: "nobody" } }, "that power takes a player in this game");
    await bad({ power: { role: "detective", target: humans[0]!.player } }, "you can't claim a power on yourself");
    await bad({ power: { role: "detective", target: { x: 1 } } }, "target must be a room or a player");
    await bad({ power: { role: "hacker" } }, "target must be a room or a player");
    await bad({ power: { role: "hacker", target: rooms[0], extra: 1 } }, 'unknown power field "extra"');
    await bad({ power: "hacker" }, "power must be { role, target } or null");
    await bad({ power: [] }, "power must be { role, target } or null");
    // Shape.
    await bad({}, "nothing to change");
    await bad({ agree: "yes" }, "agree must be true or false");
    await bad({ agree: 1 }, "agree must be true or false");
    await bad({ text: "hi" }, 'unknown plan field "text"');
    await bad("room", /expected/);
    await bad(null, /expected/);
    await bad([{ room: rooms[0] }], /expected/);
    expect(await a.barrier()).toBeGreaterThan(0);
    expect(a.board().entries).toEqual([]); // nothing was stored
    expect(await db.query("select 1 from plan_entries where game_id = $1", [id])).toEqual([]);
    closeAll(a);
  });

  it("a __proto__ key in the JSON is just an unknown field", async () => {
    const { id, humans } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    const reply = await new Promise<ServerMessage>((resolve) => {
      a.ws.on("message", (d) => {
        const m = JSON.parse(String(d)) as ServerMessage;
        if ("id" in m && m.id === "p") resolve(m);
      });
      a.ws.send('{"id":"p","plan":{"__proto__":{"room":"office"}}}');
    });
    expect(reply).toMatchObject({ rejected: true, reason: 'unknown plan field "__proto__"' });
    closeAll(a);
  });

  it("a name that needs no escaping is the only name: markup is refused as a room, never stored", async () => {
    const { id, humans } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    expect(await a.plan({ room: "<img src=x onerror=alert(1)>" })).toMatchObject({ rejected: true, reason: "no such room" });
    closeAll(a);
  });
});

describe("one board per round (design §10)", () => {
  it("is closed once the round resolves, kept as it was, and starts empty with the next round", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const [a, b] = await Promise.all(humans.map((h) => Client.open(id, h)));
    expect(await a!.plan({ room: rooms[0], agree: true })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(b!.board().entries).toHaveLength(1), quick);

    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
    // The round resolved: no more edits, and the board stays on show as it was left.
    expect(await a!.plan({ room: rooms[1] })).toMatchObject({ rejected: true, reason: "the plan board is closed until the next round" });
    expect(await b!.plan({ agree: true })).toMatchObject({ rejected: true, reason: "the plan board is closed until the next round" });
    expect(b!.board()).toEqual({ round: 1, entries: [{ player: humans[0]!.player, placed: null, room: rooms[0], power: null, agreed: true }] });
    const late = await Client.open(id, humans[1]!);
    expect(late.board().round).toBe(1);
    expect(late.board().entries).toHaveLength(1);

    await app.live.system(id, { type: "advance", deadline: { kind: "alibis", round: 1 } });
    await toNextRound(app, id);
    // Round 2: everyone connected is sent the empty board, and edits work again.
    for (const cl of [a!, b!, late]) await vi.waitFor(() => expect(cl.board()).toEqual({ round: 2, entries: [] }), quick);
    expect(await b!.plan({ room: rooms[1] })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(a!.board()).toEqual({ round: 2, entries: [{ player: humans[1]!.player, placed: null, room: rooms[1], power: null, agreed: false }] }), quick);
    // Round 1's entries are still stored, for the round's snapshot (S3a.9).
    expect(await db.query("select round from plan_entries order by round")).toEqual(expect.arrayContaining([{ round: 1 }, { round: 2 }]));
    closeAll(a!, b!, late);
  });
});

describe("limits and hostile input", () => {
  it("rate-limits a seat's edits, per seat, and lets it back in after the window", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const [a, b] = await Promise.all(humans.map((h) => Client.open(id, h)));
    for (let i = 0; i < PLAN_RATE.writes; i++) expect(await a!.plan({ room: rooms[i % 2] })).toMatchObject({ ok: true });
    expect(await a!.plan({ agree: true })).toMatchObject({ rejected: true, reason: "slow down: too many plan changes" });
    expect(await b!.plan({ agree: true })).toMatchObject({ ok: true }); // another seat is not held back
    // A refused edit is stored nowhere.
    await vi.waitFor(() => expect(b!.board().entries.find((e) => e.player === humans[0]!.player)?.agreed).toBe(false), quick);
    clock.advance(PLAN_RATE.windowMs + 1);
    expect(await a!.plan({ agree: true })).toMatchObject({ ok: true });
    closeAll(a!, b!);
  });

  it("a message with both chat and plan is a chat message: the plan part is ignored", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const [a, b] = await Promise.all(humans.map((h) => Client.open(id, h)));
    expect(await a!.sendRaw({ chat: { text: "hi" }, plan: { room: rooms[0] } })).toMatchObject({ ok: true });
    await a!.barrier();
    expect(b!.board().entries).toEqual([]);
    closeAll(a!, b!);
  });

  it("a seat a bot plays for can still plan (it is talk, like chat); bot seats have no socket to plan from", async () => {
    const { id, humans, botIds, rooms } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    expect(await a.plan({ room: rooms[0], power: { role: "detective", target: botIds[0] } })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(a.board().entries[0]?.power).toEqual({ role: "detective", target: botIds[0] }), quick);
    closeAll(a);
  });
});

describe("nothing private rides on the board (design §18)", () => {
  it("frames carry only seat ids, claims and agreement, and the view has no plan", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const [a, b] = await Promise.all(humans.map((h) => Client.open(id, h)));
    expect(await a!.plan({ room: rooms[0], power: { role: "hacker", target: rooms[1] }, agree: true })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(b!.board().entries).toHaveLength(1), quick);
    for (const cl of [a!, b!]) {
      const frames = cl.messages.flatMap((m) => ("plan" in m ? [m.plan] : []));
      for (const f of frames) {
        expect(Object.keys(f).sort()).toEqual(["entries", "round"]);
        for (const e of f.entries) expect(Object.keys(e).sort()).toEqual(["agreed", "placed", "player", "power", "room"]);
      }
      const view = cl.messages.flatMap((m) => ("view" in m ? [m.view] : [])).at(-1)!;
      expect(JSON.stringify(view)).not.toContain("plan_entries");
      expect(Object.keys(view)).not.toContain("plan");
    }
    closeAll(a!, b!);
  });
});

describe("the proposed plan and the claims are separate (design §10)", () => {
  it("anyone places any avatar, bots included; claims stay each seat's own", async () => {
    const { id, humans, botIds, rooms } = await startGame(2, 1);
    const [a, b] = await Promise.all(humans.map((h) => Client.open(id, h)));
    // A puts B and the bot on rooms; B moves A and takes the bot's spot back off.
    expect(await a!.plan({ place: { player: humans[1]!.player, room: rooms[0] } })).toMatchObject({ ok: true });
    expect(await a!.plan({ place: { player: botIds[0], room: rooms[1] } })).toMatchObject({ ok: true });
    expect(await b!.plan({ place: { player: humans[0]!.player, room: rooms[1] } })).toMatchObject({ ok: true });
    expect(await b!.plan({ place: { player: botIds[0], room: null } })).toMatchObject({ ok: true });
    await vi.waitFor(
      () =>
        expect(a!.board().entries).toEqual([
          { player: humans[0]!.player, placed: rooms[1], room: null, power: null, agreed: false },
          { player: humans[1]!.player, placed: rooms[0], room: null, power: null, agreed: false },
        ]),
      quick,
    );
    // B's own claim is B's alone; placing does not touch claims, nor claiming the placement.
    expect(await b!.plan({ room: rooms[1], agree: true })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(a!.board().entries[1]).toEqual({ player: humans[1]!.player, placed: rooms[0], room: rooms[1], power: null, agreed: true }), quick);
    expect(a!.board().entries[0]).toMatchObject({ placed: rooms[1], room: null, agreed: false });
    closeAll(a!, b!);
  });

  it("refuses placing someone who isn't in the game, or on a room that isn't", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    const bad = async (plan: unknown, reason: string) => expect(await a.plan(plan), JSON.stringify(plan)).toMatchObject({ rejected: true, reason });
    await bad({ place: { player: "nobody", room: rooms[0] } }, "no such player");
    await bad({ place: { player: "__proto__", room: rooms[0] } }, "no such player");
    await bad({ place: { player: humans[1]!.player, room: "armory" } }, "no such room");
    await bad({ place: { player: humans[1]!.player } }, "no such room");
    await bad({ place: { player: humans[1]!.player, room: rooms[0], by: "x" } }, 'unknown place field "by"');
    await bad({ place: humans[1]!.player }, "place must be { player, room }");
    await bad({ place: null }, "place must be { player, room }");
    expect(await a.barrier()).toBeGreaterThan(0);
    expect(a.board().entries).toEqual([]);
    closeAll(a);
  });
});

describe("the compact edit history (design §10)", () => {
  it("records who moved whom or what, when, and how long before the deadline; one row per actor, kind and subject", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const plan = createPlan(db, clock);
    const [a, b] = await Promise.all(humans.map((h) => Client.open(id, h)));
    expect(await a!.plan({ place: { player: humans[1]!.player, room: rooms[0] }, room: rooms[1], power: { role: "hacker", target: rooms[0] }, agree: true })).toMatchObject({ ok: true });
    clock.advance(5000);
    expect(await b!.plan({ place: { player: humans[1]!.player, room: rooms[1] } })).toMatchObject({ ok: true });
    clock.advance(5000);
    // A moves B again and again: still one row, the latest. A change that changes nothing records nothing.
    for (const r of [rooms[1], rooms[0], rooms[1]]) expect(await a!.plan({ place: { player: humans[1]!.player, room: r } })).toMatchObject({ ok: true });
    expect(await a!.plan({ room: rooms[1] })).toMatchObject({ ok: true });
    const history = await plan.history(id, 1);
    const [first] = history;
    expect(first!.msBeforeDeadline).toBeGreaterThan(10_000);
    const left = (kind: string, actor: string) => history.find((h) => h.kind === kind && h.actor === actor)!;
    const base = first!.msBeforeDeadline!; // the first edit's time left; the rest are measured from it
    expect(history.map((h) => [h.actor, h.kind, h.subject, h.value, h.target])).toEqual(
      expect.arrayContaining([
        [humans[0]!.player, "place", humans[1]!.player, rooms[1], null],
        [humans[1]!.player, "place", humans[1]!.player, rooms[1], null],
        [humans[0]!.player, "room", humans[0]!.player, rooms[1], null],
        [humans[0]!.player, "power", humans[0]!.player, "hacker", rooms[0]],
        [humans[0]!.player, "agree", humans[0]!.player, "true", null],
      ]),
    );
    expect(history).toHaveLength(5);
    // Time left falls with the clock: B's move was 5 s after the first edit, A's last 10 s after.
    expect(left("agree", humans[0]!.player).msBeforeDeadline).toBe(base);
    expect(history.filter((h) => h.kind === "place" && h.actor === humans[0]!.player)[0]!.msBeforeDeadline).toBe(base - 10_000);
    expect(history.find((h) => h.actor === humans[1]!.player)!.msBeforeDeadline).toBe(base - 5000);
    expect(history.every((h) => /^\d{4}-/.test(h.at))).toBe(true);
    // Nothing of it reaches a client.
    expect(JSON.stringify([...a!.messages, ...b!.messages])).not.toContain("msBeforeDeadline");
    closeAll(a!, b!);
  });

  it("clearing is an edit too; a no-op records nothing", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const plan = createPlan(db, clock);
    const a = await Client.open(id, humans[0]!);
    expect(await a.plan({ room: null, agree: false })).toMatchObject({ ok: true });
    expect(await plan.history(id, 1)).toEqual([]);
    expect(await a.plan({ room: rooms[0] })).toMatchObject({ ok: true });
    expect(await a.plan({ room: null })).toMatchObject({ ok: true });
    expect(await plan.history(id, 1)).toMatchObject([{ kind: "room", value: null, target: null }]);
    closeAll(a);
  });
});

describe("open for the round's span, as the scheduler's deadline is (design §10)", () => {
  it("edits work exactly while the round's `round:<n>` deadline row exists", async () => {
    const { id, humans } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    const hasDeadline = async (n: number) => (await db.query("select 1 from deadlines where game_id = $1 and key = $2", [id, `round:${n}`])).length > 0;
    const open = async () => "ok" in (await a.plan({ agree: true }));
    expect(await hasDeadline(1)).toBe(true);
    expect(await open()).toBe(true);
    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
    expect(await hasDeadline(1)).toBe(false);
    expect(await open()).toBe(false);
    await app.live.system(id, { type: "advance", deadline: { kind: "alibis", round: 1 } });
    expect(await open()).toBe(false); // the result window, or a meeting the round called (design §9.3)
    await toNextRound(app, id);
    expect(await hasDeadline(2)).toBe(true);
    expect(await open()).toBe(true);
    closeAll(a);
  });

  it("an edit after the deadline but before the scheduler's tick is refused (design §10: until the deadline)", async () => {
    const { id, humans } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    const [left] = await db.query<{ ms: number }>("select (extract(epoch from due_at - to_timestamp($2::float8 / 1000)) * 1000)::float8 as ms from deadlines where game_id = $1 and key = 'round:1'", [id, clock.now()]);
    clock.advance(Math.round(Number(left!.ms)) - 1000);
    expect(await a.plan({ agree: true })).toMatchObject({ ok: true });
    clock.advance(2000);
    expect(await a.plan({ agree: false })).toMatchObject({ rejected: true });
    expect((await createPlan(db, clock).history(id, 1)).map((h) => h.value)).toEqual(["true"]);
    closeAll(a);
  });

  it("no meeting can open during planning, so none closes the board mid-round; an emergency in the result window keeps it closed (design §9.3, §10)", async () => {
    const { id, humans, rooms } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    clock.advance(1000);
    expect(await a.sendRaw({ cmd: { type: "callEmergency" } })).toMatchObject({ rejected: true });
    expect(await a.plan({ room: rooms[0] })).toMatchObject({ ok: true });
    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
    await app.live.system(id, { type: "advance", deadline: { kind: "alibis", round: 1 } });
    if ((await createGameStore(db).load(id))!.phase.kind !== "result") return; // a raid's briefing came first
    expect(await a.sendRaw({ cmd: { type: "callEmergency" } })).toMatchObject({ ok: true });
    const pending = (await createGameStore(db).load(id))!.pendingEmergency!;
    await app.live.system(id, { type: "advance", deadline: { kind: "openMeeting", meetingId: pending.meetingId } });
    expect((await createGameStore(db).load(id))!.phase.kind).toBe("meeting");
    expect(await a.plan({ room: rooms[1] })).toMatchObject({ rejected: true });
    expect((await createPlan(db, clock).history(id, 1)).map((h) => h.value)).toEqual([rooms[0]]);
    closeAll(a);
  });
});
