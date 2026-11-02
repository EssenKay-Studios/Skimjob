// QA (M2-10, PR #46): hostile calls to the per-seat notes routes — the "last
// seen" seq (design §13) and the private suspicion board (design §12.3).
import type { FastifyInstance } from "fastify";
import { handleCommand, type GameState, type SystemCommand } from "@skimjob/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

type Method = "GET" | "POST" | "PATCH";
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
    else if (p.kind === "alibis") cmd = { type: "advance", deadline: { kind: "alibis", round: p.round } };
    else if (p.kind === "awaitingMeeting" && !s.scheduledMeeting) cmd = { type: "scheduleMeeting", act: p.act, slot: `qa-${p.act}` } as SystemCommand;
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

describe("QA: another seat, another game, not seated (design §12.3, §13)", () => {
  it("a seat can only ever read and write its own notes, by game", async () => {
    const g1 = await startGame(3);
    const g2 = await startGame(2);
    const [a, b] = g1.humans;
    const [x, y] = g2.humans;
    expect((await board(g1.id, a!.who, { subject: b!.player, tag: "suspicious", note: "a's secret on b" })).status).toBe(200);
    expect((await seen(g1.id, a!.who, { seq: 3 })).body).toEqual({ lastSeen: 3 });

    // No field names the owner: a forged owner or player is refused, never honoured.
    for (const forged of [{ player: a!.player }, { owner: a!.player }, { playerId: a!.player }, { gameId: g2.id }]) {
      expect((await board(g1.id, b!.who, { subject: a!.player, tag: "trusted", ...forged })).status).toBe(400);
    }
    // b writes its own board about a: a's board is untouched, and b never sees a's.
    expect((await board(g1.id, b!.who, { subject: a!.player, tag: "trusted" })).status).toBe(200);
    expect((await notes(g1.id, a!.who)).board).toEqual({ [b!.player]: { tag: "suspicious", note: "a's secret on b" } });
    expect((await notes(g1.id, b!.who)).board).toEqual({ [a!.player]: { tag: "trusted", note: "" } });
    expect((await notes(g1.id, b!.who)).lastSeen).toBe(-1);

    // A seat in game 2 asking about game 1 (same player ids p1, p2, …): not found, both ways.
    for (const who of [x!.who, y!.who]) {
      expect((await call("GET", `/games/${g1.id}/notes`, who)).status).toBe(404);
      expect((await seen(g1.id, who, { seq: 0 })).status).toBe(404);
      expect((await board(g1.id, who, { subject: b!.player, tag: "trusted" })).status).toBe(404);
    }
    // A game-1 subject id that exists in game 2 by name writes only to game 2's own board for x.
    expect((await board(g2.id, x!.who, { subject: y!.player, tag: "unsure" })).status).toBe(200);
    expect((await notes(g1.id, a!.who)).board).toEqual({ [b!.player]: { tag: "suspicious", note: "a's secret on b" } });
    expect((await notes(g1.id, a!.who)).lastSeen).toBe(3);
    // The rows really are keyed by game and seat.
    const rows = await db.query<{ game_id: string; player_id: string; subject: string }>("select game_id, player_id, subject from suspicion_marks where game_id = $1 order by player_id", [g1.id]);
    expect(rows.map((r) => `${r.player_id}->${r.subject}`)).toEqual([`${a!.player}->${b!.player}`, `${b!.player}->${a!.player}`].sort());
  });

  it("not signed in, a forged session, a stranger, a lobby game, unknown and non-uuid ids", async () => {
    const g = await startGame(2);
    const [a, b] = g.humans;
    const stranger = (await call("POST", "/auth/guest", null, { nickname: "Nosy" })).session!;
    for (const url of [`/games/${g.id}/notes`]) {
      expect((await call("GET", url, null)).status).toBe(401);
      expect((await call("GET", url, "not-a-real-session")).status).toBe(401);
      expect((await call("GET", url, stranger)).status).toBe(404);
    }
    expect((await seen(g.id, stranger, { seq: 0 })).status).toBe(404);
    expect((await board(g.id, stranger, { subject: b!.player, tag: "trusted" })).status).toBe(404);
    expect((await board(g.id, null as unknown as string, { subject: b!.player, tag: "trusted" })).status).toBe(401);
    for (const id of ["00000000-0000-0000-0000-000000000000", "nope", "'; drop table seats; --", "%00", "..%2F..%2Fhealth"]) {
      expect((await call("GET", `/games/${id}/notes`, a!.who)).status).toBe(404);
      expect((await seen(id, a!.who, { seq: 0 })).status).toBe(404);
      expect((await board(id, a!.who, { subject: b!.player, tag: "trusted" })).status).toBe(404);
    }
    // A seat in a game that hasn't started has no notes yet.
    const host = (await call("POST", "/auth/guest", null, { nickname: "Host" })).session!;
    const lobby = (await call("POST", "/games", host, { settings: {} })).body as unknown as LobbyView;
    expect((await seen(lobby.id, host, { seq: 0 })).status).toBe(404);
    expect((await board(lobby.id, host, { subject: "p2", tag: "trusted" })).status).toBe(404);
    // Nothing was written by any of it.
    expect(await notes(g.id, a!.who)).toEqual({ lastSeen: -1, board: {} });
  });
});

describe("QA: bad bodies are 4xx, never 500 or a write", () => {
  it("bad JSON, wrong content types, arrays, null, strings, huge bodies", async () => {
    const g = await startGame(2);
    const [a, b] = g.humans;
    for (const path of ["seen", "board"]) {
      const url = `/games/${g.id}/notes/${path}`;
      for (const [body, type] of [
        ["{", "application/json"],
        ['{"seq": 1,}', "application/json"],
        ["", "application/json"],
        ["null", "application/json"],
        ["[]", "application/json"],
        ['"seq"', "application/json"],
        ["42", "application/json"],
        ["seq=1", "application/x-www-form-urlencoded"],
        ["seq=1", "text/plain"],
        ["<seq>1</seq>", "application/xml"],
        ['{"seq":1}', null],
      ] as const) {
        const status = await raw("PATCH", url, a!.who, body, type);
        expect(status, `${path} ${type} ${body}`).toBeGreaterThanOrEqual(400);
        expect(status, `${path} ${type} ${body}`).toBeLessThan(500);
      }
      // Far past any body limit.
      const huge = await raw("PATCH", url, a!.who, JSON.stringify({ seq: 1, subject: b!.player, note: "x".repeat(2_000_000) }), "application/json");
      expect(huge).toBe(413);
    }
    for (const seq of [Number.MAX_SAFE_INTEGER + 1, 1e308, -1e308, "1", true, [1], { n: 1 }, 2.000001]) expect((await seen(g.id, a!.who, { seq })).status, String(seq)).toBe(400);
    for (const p of [{ subject: b!.player, tag: "trusted", note: 7 }, { subject: b!.player, tag: ["trusted"] }, { subject: b!.player, tag: "TRUSTED" }, { subject: [b!.player], tag: "trusted" }, { subject: "__proto__", tag: "trusted" }, { subject: "constructor", tag: "trusted" }, { tag: "trusted" }, {}]) {
      expect((await board(g.id, a!.who, p)).status, JSON.stringify(p)).toBe(400);
    }
    expect(await notes(g.id, a!.who)).toEqual({ lastSeen: -1, board: {} });
  });

  it("-1 is allowed (and changes nothing); a seq only ever grows, also under a race", async () => {
    const g = await startGame(2, 1);
    const [a] = g.humans;
    expect((await seen(g.id, a!.who, { seq: -1 })).body).toEqual({ lastSeen: -1 });
    const top = topSeq((await store.load(g.id))!, a!.player);
    const seqs = Array.from({ length: 30 }, (_, i) => i % (top + 1));
    const results = await Promise.all(seqs.map((seq) => seen(g.id, a!.who, { seq })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect((await notes(g.id, a!.who)).lastSeen).toBe(Math.max(...seqs));
  });
});

describe("QA: note text (design §12.3)", () => {
  it("huge, invisible, control, accent-stacked notes are refused; scripts and emoji are stored as plain text", async () => {
    const g = await startGame(2);
    const [a, b] = g.humans;
    const put = (note: unknown, tag: string | null = "unsure") => board(g.id, a!.who, { subject: b!.player, tag, note });
    expect((await put("y".repeat(10_000))).status).toBe(400);
    expect((await put("😈".repeat(BOARD_NOTE_MAX_CHARS + 1))).status).toBe(400);
    expect((await put("😈".repeat(BOARD_NOTE_MAX_CHARS))).status).toBe(200); // counted in characters, not UTF-16 units
    for (const bad of ["​", "​‍⁠﻿", "‮", "a\u0000b", "a\u001bb", "a" + "́".repeat(30)]) {
      const r = await put(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    const script = `<script>alert("x")</script><img src=x onerror=alert(1)>`;
    const r = await put(script, "suspicious");
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/^application\/json/);
    expect((await notes(g.id, a!.who)).board[b!.player]).toEqual({ tag: "suspicious", note: script });
    // Whitespace around a note is trimmed; CRLF becomes LF.
    await put("  two\r\nlines  ");
    expect((await notes(g.id, a!.who)).board[b!.player]!.note).toBe("two\nlines");
  });

  it("20 racing edits of one mark: no 500s, and one row survives", async () => {
    const g = await startGame(2);
    const [a, b] = g.humans;
    const tags = ["trusted", "unsure", "suspicious"] as const;
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => board(g.id, a!.who, { subject: b!.player, tag: tags[i % 3], note: `edit ${i}` })));
    expect(rs.map((r) => r.status)).toEqual(Array(20).fill(200));
    const rows = await db.query("select * from suspicion_marks where game_id = $1", [g.id]);
    expect(rows).toHaveLength(1);
  });
});

describe("QA: 2, 3 and 12 seats; the board and last seen after the game ends", () => {
  for (const [people, bots] of [
    [2, 0],
    [3, 0],
    [4, 8],
  ] as const) {
    it(`${people + bots} seats: every other seat can be tagged, and nobody else sees it`, async () => {
      const g = await startGame(people, bots);
      const all = [...g.humans.map((h) => h.player), ...g.bots];
      expect(all).toHaveLength(people + bots);
      const [a] = g.humans;
      const others = all.filter((p) => p !== a!.player);
      for (const [i, p] of others.entries()) expect((await board(g.id, a!.who, { subject: p, tag: (["trusted", "unsure", "suspicious"] as const)[i % 3], note: `n${i}` })).status).toBe(200);
      expect(Object.keys((await notes(g.id, a!.who)).board).sort()).toEqual([...others].sort());
      for (const h of g.humans.slice(1)) expect((await notes(g.id, h.who)).board).toEqual({});
      // The lobby view (seats) carries none of it.
      const lobby = JSON.stringify((await call("GET", `/games/${g.id}`, g.humans.at(-1)!.who)).body);
      expect(lobby).not.toMatch(/"n\d+"|suspicious/);
    });
  }

  it("after the end: notes still read and write, the end-of-game reveal holds no board, and last seen caps at the (same) view", async () => {
    const g = await startGame(3);
    const [a, b] = g.humans;
    const secret = "QA-OKAPI-91";
    expect((await board(g.id, a!.who, { subject: b!.player, tag: "suspicious", note: secret })).status).toBe(200);
    const mid = await playOn(g.id, (s) => s.round >= 2);
    const midTop = topSeq(mid, a!.player);
    expect((await seen(g.id, a!.who, { seq: midTop })).body).toEqual({ lastSeen: midTop });
    const end = await playOn(g.id);
    expect(end.phase.kind).toBe("ended");
    const endTop = topSeq(end, a!.player);
    expect(endTop).toBeGreaterThan(midTop);
    // The mark set before the end still points into the same numbering (the reveal is apart).
    expect((await notes(g.id, a!.who)).lastSeen).toBe(midTop);
    expect((await seen(g.id, a!.who, { seq: 1e9 })).body).toEqual({ lastSeen: endTop });
    expect((await notes(g.id, a!.who)).board[b!.player]!.note).toBe(secret);
    expect(JSON.stringify(end)).not.toContain(secret);
    const page = JSON.stringify((await call("GET", `/games/${g.id}`, b!.who)).body);
    expect(page).not.toContain(secret);
  }, 60_000);
});
