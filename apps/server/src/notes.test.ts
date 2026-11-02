// Per-seat notes (M2-10): the "last seen" seq for "while you were away" (design
// §13) and the private suspicion board (design §12.3).
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import type { LobbyView } from "./lobby";
import { topSeq, type SeatNotes } from "./notes";
import { buildServer } from "./server";
import { BOARD_NOTE_MAX_CHARS } from "./settings";
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

const call = async (method: "GET" | "POST" | "PATCH", url: string, who: string | null, payload?: Record<string, unknown>) => {
  const res = await app.inject({ method, url, ...(payload ? { payload } : {}), cookies: who ? { [SESSION_COOKIE]: who } : {} });
  return { status: res.statusCode, body: res.json() as Record<string, unknown>, session: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? null };
};

/** A started game: `people` humans (host first) and two bots. */
async function startGame(people: number) {
  const host = (await call("POST", "/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await call("POST", "/games", host, { settings: {} })).body as unknown as LobbyView;
  const sessions = [host];
  for (let i = 1; i < people; i++) sessions.push((await call("POST", `/invites/${game.inviteCode}/join`, null, { nickname: `Guest ${i}` })).session!);
  await call("POST", `/games/${game.id}/bots`, host, {});
  await call("POST", `/games/${game.id}/bots`, host, {});
  const started = (await call("POST", `/games/${game.id}/start`, host)).body as unknown as LobbyView;
  const humans = [];
  for (const who of sessions) {
    const view = (await call("GET", `/games/${game.id}`, who)).body as unknown as LobbyView;
    humans.push({ who, player: view.seats.find((s) => s.you)!.playerId! });
  }
  const bots = started.seats.filter((s) => s.bot !== null).map((s) => s.playerId!);
  return { id: game.id, humans, bots, lobbyCode: game.inviteCode };
}

const notes = async (id: string, who: string) => (await call("GET", `/games/${id}/notes`, who)).body as unknown as SeatNotes;

describe("last seen seq (design §13, while you were away)", () => {
  it("starts at -1, only moves forward, and never past the seat's own view", async () => {
    const { id, humans } = await startGame(2);
    const [a, b] = humans;
    expect(await notes(id, a!.who)).toEqual({ lastSeen: -1, board: {} });
    const top = topSeq((await store.load(id))!, a!.player);
    expect(top).toBeGreaterThan(0);

    expect((await call("PATCH", `/games/${id}/notes/seen`, a!.who, { seq: 2 })).body).toEqual({ lastSeen: 2 });
    // Backwards (another tab, a stale page) is ignored.
    expect((await call("PATCH", `/games/${id}/notes/seen`, a!.who, { seq: 1 })).body).toEqual({ lastSeen: 2 });
    // Past the view: capped, so the mark never counts events this seat can't see.
    expect((await call("PATCH", `/games/${id}/notes/seen`, a!.who, { seq: 10_000 })).body).toEqual({ lastSeen: top });
    expect((await notes(id, a!.who)).lastSeen).toBe(top);
    // Per seat.
    expect((await notes(id, b!.who)).lastSeen).toBe(-1);
  });

  it("refuses bad seqs, strangers and lobby games", async () => {
    const { id, humans } = await startGame(1);
    for (const seq of ["3", 1.5, -2, null]) expect((await call("PATCH", `/games/${id}/notes/seen`, humans[0]!.who, { seq })).status).toBe(400);
    expect((await call("GET", `/games/${id}/notes`, null)).status).toBe(401);
    const stranger = (await call("POST", "/auth/guest", null, { nickname: "Nosy" })).session!;
    expect((await call("GET", `/games/${id}/notes`, stranger)).status).toBe(404);
    expect((await call("PATCH", `/games/${id}/notes/seen`, stranger, { seq: 0 })).status).toBe(404);

    const host = (await call("POST", "/auth/guest", null, { nickname: "Host" })).session!;
    const lobby = (await call("POST", "/games", host, { settings: {} })).body as unknown as LobbyView;
    expect((await call("GET", `/games/${lobby.id}/notes`, host)).status).toBe(404);
  });
});

describe("suspicion board (design §12.3)", () => {
  it("tags and notes other players, private to the seat that wrote them", async () => {
    const { id, humans, bots } = await startGame(3);
    const [a, b, c] = humans;
    const board = (who: string, payload: Record<string, unknown>) => call("PATCH", `/games/${id}/notes/board`, who, payload);

    expect((await board(a!.who, { subject: b!.player, tag: "suspicious", note: "Said Vault, saw them in the Office" })).body).toEqual({
      board: { [b!.player]: { tag: "suspicious", note: "Said Vault, saw them in the Office" } },
    });
    await board(a!.who, { subject: bots[0], tag: "trusted" });
    await board(a!.who, { subject: c!.player, tag: null, note: "quiet so far" });
    expect((await notes(id, a!.who)).board).toEqual({
      [b!.player]: { tag: "suspicious", note: "Said Vault, saw them in the Office" },
      [bots[0]!]: { tag: "trusted", note: "" },
      [c!.player]: { tag: null, note: "quiet so far" },
    });
    // Only they can see it: b and c have empty boards, whoever they ask about.
    expect((await notes(id, b!.who)).board).toEqual({});
    expect((await notes(id, c!.who)).board).toEqual({});
    // A change replaces; clearing both tag and note removes the mark.
    await board(a!.who, { subject: b!.player, tag: "unsure", note: "" });
    await board(a!.who, { subject: c!.player, tag: null, note: "  " });
    expect((await notes(id, a!.who)).board).toEqual({ [b!.player]: { tag: "unsure", note: "" }, [bots[0]!]: { tag: "trusted", note: "" } });
  });

  it("refuses yourself, strangers to the game, bad tags, long notes and extra fields", async () => {
    const { id, humans } = await startGame(2);
    const [a, b] = humans;
    const board = (payload: Record<string, unknown>) => call("PATCH", `/games/${id}/notes/board`, a!.who, payload);
    expect((await board({ subject: a!.player, tag: "trusted" })).status).toBe(400);
    expect((await board({ subject: "p99", tag: "trusted" })).status).toBe(400);
    expect((await board({ subject: b!.player, tag: "liar" })).status).toBe(400);
    expect((await board({ subject: b!.player, tag: "unsure", note: "x".repeat(BOARD_NOTE_MAX_CHARS + 1) })).status).toBe(400);
    expect((await board({ subject: b!.player, tag: "unsure", note: "bad\u0007bell" })).status).toBe(400);
    expect((await board({ subject: b!.player, tag: "unsure", player: b!.player })).status).toBe(400);
    expect((await board({ subject: b!.player, tag: "unsure", note: "x".repeat(BOARD_NOTE_MAX_CHARS) })).status).toBe(200);
    expect((await call("PATCH", `/games/${id}/notes/board`, null, { subject: b!.player, tag: "unsure" })).status).toBe(401);
  });

  it("never reaches the engine log, anyone's view or the live channel", async () => {
    const { id, humans } = await startGame(2);
    const [a, b] = humans;
    const secret = "ZEBRA-7 thinks b skims";
    const raw: string[] = [];
    const ws: WebSocket = await app.injectWS(`/games/${id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${b!.who}` } }, { onInit: (s) => s.on("message", (d) => raw.push(String(d))) });
    const mine: string[] = [];
    const wsA: WebSocket = await app.injectWS(`/games/${id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${a!.who}` } }, { onInit: (s) => s.on("message", (d) => mine.push(String(d))) });
    await vi.waitFor(() => expect(raw.some((t) => t.includes('"presence"')) && mine.some((t) => t.includes('"presence"'))).toBe(true), { interval: 1, timeout: 5000 });
    expect((await call("PATCH", `/games/${id}/notes/board`, a!.who, { subject: b!.player, tag: "suspicious", note: secret })).status).toBe(200);
    // A change in the game afterwards pushes fresh views to both.
    wsA.send(JSON.stringify({ cmd: { type: "submitMove", move: { room: "office", pocket: 0 } }, id: "m1" }));
    await vi.waitFor(() => expect(mine.some((t) => t.includes('"m1"'))).toBe(true), { interval: 1, timeout: 5000 });
    const state = (await store.load(id))!;
    expect(JSON.stringify(state)).not.toContain(secret);
    expect(JSON.stringify(state)).not.toContain("suspicious");
    for (const t of [...raw, ...mine]) {
      expect(t).not.toContain(secret);
      expect(t).not.toContain("suspicious");
    }
    ws.close();
    wsA.close();
  });
});
