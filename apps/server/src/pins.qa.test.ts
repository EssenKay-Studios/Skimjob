// QA (S3b.5, PR #165): hostile calls to the case board pins route (design §15.3,
// §15.4: pins are private to the seat, kept across rounds) and its rate limit (#114).
import type { FastifyInstance } from "fastify";
import { handleCommand, type GameState, type SystemCommand } from "@skimjob/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import type { SeatNotes } from "./notes";
import { buildServer } from "./server";
import { BOARD_RATE, PINS_MAX } from "./settings";
import { createGameStore, type GameStore } from "./store";
import { testDb } from "./testkit";

const clock = fakeClock(Date.UTC(2026, 10, 2));
let db: Db;
let app: FastifyInstance;
let store: GameStore;
beforeAll(async () => {
  db = await testDb();
  store = createGameStore(db);
  app = buildServer({ db, clock, store });
  await app.ready();
}, 30_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

type Method = "GET" | "POST" | "PATCH" | "PUT";
const call = async (method: Method, url: string, who: string | null, payload?: unknown) => {
  const res = await app.inject({ method, url, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}), cookies: who ? { [SESSION_COOKIE]: who } : {} });
  return { status: res.statusCode, body: res.json() as Record<string, unknown>, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null, type: res.headers["content-type"] };
};
/** A raw body with a chosen content type. */
const raw = async (method: Method, url: string, who: string, body: string, contentType: string | null) => {
  const res = await app.inject({ method, url, payload: body, headers: contentType ? { "content-type": contentType } : {}, cookies: { [SESSION_COOKIE]: who } });
  return res.statusCode;
};

/** A started game: `people` humans (host first) and `bots` bots. */
async function startGame(people: number, bots = 0) {
  const host = (await call("POST", "/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await call("POST", "/games", host, { settings: {} })).body as unknown as LobbyView;
  const sessions = [host];
  for (let i = 1; i < people; i++) sessions.push((await call("POST", `/invites/${game.inviteCode}/join`, null, { nickname: `Guest ${i}` })).session!);
  for (let i = 0; i < bots; i++) expect((await call("POST", `/games/${game.id}/bots`, host, {})).status).toBeLessThan(300);
  const started = await call("POST", `/games/${game.id}/start`, host);
  expect(started.status).toBeLessThan(300);
  const humans = [];
  for (const who of sessions) {
    const view = (await call("GET", `/games/${game.id}`, who)).body as unknown as LobbyView;
    humans.push({ who, player: view.seats.find((s) => s.you)!.playerId! });
  }
  const botIds = (started.body as unknown as LobbyView).seats.filter((s) => s.bot !== null).map((s) => s.playerId!);
  return { id: game.id, humans, bots: botIds };
}
const notes = async (id: string, who: string) => (await call("GET", `/games/${id}/notes`, who)).body as unknown as SeatNotes;
const board = (id: string, who: string, payload: unknown) => call("PATCH", `/games/${id}/notes/board`, who, payload);
const seen = (id: string, who: string, payload: unknown) => call("PATCH", `/games/${id}/notes/seen`, who, payload);

/** Plays the game on the server with system commands only (default moves, skipped meetings) until `stop` or the end. */
async function playOn(id: string, stop: (s: GameState) => boolean = () => false): Promise<GameState> {
  let s = (await store.load(id))!;
  for (let guard = 0; guard < 400 && s.phase.kind !== "ended" && !stop(s); guard++) {
    const p = s.phase;
    let cmd: SystemCommand;
    if (p.kind === "planning") cmd = { type: "advance", deadline: { kind: "round", round: p.round } };
    else if (p.kind === "alibi") cmd = { type: "advance", deadline: { kind: "alibi", round: p.round } }; // design §10
    else if (p.kind === "result") cmd = { type: "advance", deadline: { kind: "result", round: p.round } };
    else if (p.kind === "awaitingMeeting" && !s.scheduledMeeting) cmd = { type: "scheduleMeeting", meetingId: p.meetingId, slot: `qa-${p.meetingId}` };
    else if (p.kind === "awaitingMeeting") cmd = { type: "advance", deadline: { kind: "openMeeting", meetingId: s.scheduledMeeting!.meetingId } };
    else if (p.kind === "meeting") cmd = { type: "advance", deadline: { kind: "closeMeeting", meetingId: p.meetingId } };
    else if (p.kind === "shakedownPending") cmd = { type: "advance", deadline: { kind: "resolveShakedown", meetingId: p.meetingId } };
    else throw new Error(`unexpected phase ${p.kind}`);
    const r = handleCommand(s, cmd);
    if (!r.ok) throw new Error(`${cmd.type}: ${r.reason}`);
    s = await store.append(id, r.events);
  }
  return s;
}

const pin = (id: string, who: string | null, payload: unknown) => call("PUT", `/games/${id}/notes/pins`, who, payload);
const pinsIn = async (id: string, who: string) => (await notes(id, who)).pins;
const rows = async (id: string) => (await db.query<{ player_id: string; pins: string[] }>("select player_id, pins from seats where game_id = $1 and player_id is not null order by seat_no", [id])).map((r) => [r.player_id, r.pins]);

describe("QA: pins are private to the seat (design §15.3, §15.4)", () => {
  it("3 seats: each reads and writes only its own pins; the owner comes from the session", async () => {
    const g = await startGame(3);
    const [a, b, c] = g.humans;
    expect((await pin(g.id, a!.who, { pins: ["lead:r1.vault", "fact:r1.vault.saw"] })).status).toBe(200);
    expect((await pin(g.id, b!.who, { pins: ["lead:r1.lobby"] })).status).toBe(200);
    // A forged owner is refused, never honoured.
    for (const forged of [{ player: a!.player }, { owner: a!.player }, { playerId: a!.player }, { seat: 0 }, { gameId: g.id }]) {
      expect((await pin(g.id, b!.who, { pins: [], ...forged })).status, JSON.stringify(forged)).toBe(400);
    }
    expect(await pinsIn(g.id, a!.who)).toEqual(["lead:r1.vault", "fact:r1.vault.saw"]);
    expect(await pinsIn(g.id, b!.who)).toEqual(["lead:r1.lobby"]);
    expect(await pinsIn(g.id, c!.who)).toEqual([]);
    // b's reply and b's notes never carry a's pins.
    expect(JSON.stringify(await notes(g.id, b!.who))).not.toContain("r1.vault");
    expect(await rows(g.id)).toEqual([[a!.player, ["lead:r1.vault", "fact:r1.vault.saw"]], [b!.player, ["lead:r1.lobby"]], [c!.player, []]]);
  });

  it("strangers, other games, lobbies, forged or missing sessions and bad game ids write nothing", async () => {
    const g = await startGame(2, 1);
    const other = await startGame(2, 1);
    const [a] = g.humans;
    expect((await pin(g.id, a!.who, { pins: ["lead:keep"] })).status).toBe(200);
    const stranger = (await call("POST", "/auth/guest", null, { nickname: "Nosy" })).session!;
    expect((await pin(g.id, null, { pins: [] })).status).toBe(401);
    expect((await pin(g.id, "not-a-real-session", { pins: [] })).status).toBe(401);
    expect((await pin(g.id, stranger, { pins: [] })).status).toBe(404);
    // Same player ids (p1, p2) in another game: still not this game's seat.
    for (const h of other.humans) expect((await pin(g.id, h.who, { pins: [] })).status).toBe(404);
    for (const id of ["00000000-0000-0000-0000-000000000000", "nope", "'; drop table seats; --", "%00"]) {
      expect((await pin(id, a!.who, { pins: [] })).status).toBe(404);
    }
    const host = (await call("POST", "/auth/guest", null, { nickname: "Host" })).session!;
    const lobby = (await call("POST", "/games", host, { settings: {} })).body as unknown as LobbyView;
    expect((await pin(lobby.id, host, { pins: ["lead:x"] })).status).toBe(404);
    expect(await pinsIn(g.id, a!.who)).toEqual(["lead:keep"]);
    for (const h of other.humans) expect(await pinsIn(other.id, h.who)).toEqual([]);
  });

  it("bad bodies are 4xx, never a 500 or a write; the id boundaries hold", async () => {
    const g = await startGame(1, 2);
    const who = g.humans[0]!.who;
    const longest = "a".repeat(80);
    expect((await pin(g.id, who, { pins: [longest, "Az09_.:-"] })).status).toBe(200);
    for (const pins of [null, {}, "lead:x", [null], [["lead:x"]], [{ id: "lead:x" }], ["a\n"], ["<b>"], ["léad"], ["a b"], ["a/b"], ["a".repeat(81)]]) {
      const r = await pin(g.id, who, { pins });
      expect(r.status, JSON.stringify(pins)).toBe(400);
    }
    for (const body of [null, [], "pins"]) expect((await pin(g.id, who, body)).status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
    const res = await app.inject({ method: "PUT", url: `/games/${g.id}/notes/pins`, payload: "{not json", headers: { "content-type": "application/json" }, cookies: { [SESSION_COOKIE]: who } });
    expect(res.statusCode).toBe(400);
    expect(await pinsIn(g.id, who)).toEqual([longest, "Az09_.:-"]);
  });
});

describe("QA: pins are kept across rounds and to the end (design §15.4)", () => {
  it("survives every round, the meetings and the end; reading again gives the same list", async () => {
    const g = await startGame(2, 1);
    const [a] = g.humans;
    const list = Array.from({ length: PINS_MAX }, (_, i) => `fact:r${i}.x`);
    expect((await pin(g.id, a!.who, { pins: list })).status).toBe(200);
    const mid = await playOn(g.id, (s) => s.round >= 4);
    expect(mid.round).toBeGreaterThanOrEqual(4);
    expect(await pinsIn(g.id, a!.who)).toEqual(list);
    const end = await playOn(g.id);
    expect(end.phase.kind).toBe("ended");
    expect(await pinsIn(g.id, a!.who)).toEqual(list);
    // A new server over the same database (a restart) reads the same pins.
    const again = buildServer({ db, clock, store: createGameStore(db) });
    await again.ready();
    try {
      const res = await again.inject({ method: "GET", url: `/games/${g.id}/notes`, cookies: { [SESSION_COOKIE]: a!.who } });
      expect((res.json() as SeatNotes).pins).toEqual(list);
    } finally {
      await again.close();
    }
  });
});

describe("QA: pin races and the write limit (#114)", () => {
  it("concurrent PUTs from one seat leave exactly one of the sent lists, never a mix", async () => {
    const g = await startGame(2, 1);
    const [a, b] = g.humans;
    const lists = Array.from({ length: 8 }, (_, i) => Array.from({ length: i + 1 }, (_, j) => `lead:r${i}.${j}`));
    const replies = await Promise.all([...lists.map((pins) => pin(g.id, a!.who, { pins })), pin(g.id, b!.who, { pins: ["lead:b"] })]);
    expect(replies.map((r) => r.status)).toEqual(Array(9).fill(200));
    const final = await pinsIn(g.id, a!.who);
    expect(lists).toContainEqual(final);
    expect(await pinsIn(g.id, b!.who)).toEqual(["lead:b"]);
  });

  it("a burst over the limit: exactly BOARD_RATE.writes go through; per seat and per game; the board limit is separate", async () => {
    const g = await startGame(2, 1);
    const g2 = await startGame(1, 2);
    const [a, b] = g.humans;
    const burst = await Promise.all(Array.from({ length: BOARD_RATE.writes + 5 }, (_, i) => pin(g.id, a!.who, { pins: [`lead:r${i}`] })));
    expect(burst.filter((r) => r.status === 200)).toHaveLength(BOARD_RATE.writes);
    expect(burst.filter((r) => r.status === 429)).toHaveLength(5);
    // The 429s wrote nothing: the stored list is one of the accepted ones.
    const accepted = burst.flatMap((r) => (r.status === 200 ? [r.body.pins] : []));
    expect(accepted).toContainEqual(await pinsIn(g.id, a!.who));
    // Other seats and the same seat's board edits are not slowed down.
    expect((await pin(g.id, b!.who, { pins: [] })).status).toBe(200);
    expect((await call("PATCH", `/games/${g.id}/notes/board`, a!.who, { subject: b!.player, tag: "unsure" })).status).toBe(200);
    expect((await pin(g2.id, g2.humans[0]!.who, { pins: [] })).status).toBe(200);
    // Bad bodies count too (the limit runs first), and the window is exact.
    clock.advance(BOARD_RATE.windowMs - 1);
    expect((await pin(g.id, a!.who, { pins: [] })).status).toBe(429);
    clock.advance(2);
    for (let i = 0; i < BOARD_RATE.writes; i++) expect((await pin(g.id, a!.who, { pins: "bad" })).status).toBe(400);
    expect((await pin(g.id, a!.who, { pins: [] })).status).toBe(429);
  });
});
