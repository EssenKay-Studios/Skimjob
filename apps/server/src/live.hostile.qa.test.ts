// QA (PR #28): hostile command and chat values through the real socket path.
// Every player command type, every field, values a JSON client can build to
// trip up lookups and reason strings. Each must be refused on that socket
// only, never reach the engine-threw fallback or the error log, and change
// nothing. design §17.2, §12.1
import type { GameState } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import { MAX_QUEUED_MESSAGES, type ServerMessage } from "./live";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import { createGameStore } from "./store";
import { testDb } from "./testkit";
import { BANK_JOB } from "@skimjob/content";

const quick = { interval: 2, timeout: 20_000 };
let db: Db;
let app: FastifyInstance;
beforeAll(async () => {
  db = await testDb();
  app = buildServer({ db, clock: fakeClock(Date.UTC(2026, 10, 1)), store: createGameStore(db) });
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
async function startGame(people: number) {
  const host = (await post("/auth/guest", null, { nickname: "Host" })).session!;
  const game = (await post("/games", host)).body;
  const who = [host];
  for (let i = 1; i < people; i++) who.push((await post(`/invites/${game.inviteCode}/join`, null, { nickname: `G${i}` })).session!);
  await post(`/games/${game.id}/start`, host);
  const players: string[] = [];
  for (const w of who) {
    const res = await app.inject({ method: "GET", url: `/games/${game.id}`, cookies: { [SESSION_COOKIE]: w } });
    players.push((res.json() as LobbyView).seats.find((s) => s.you)!.playerId!);
  }
  return { id: game.id, who, players };
}

class Client {
  readonly raw: string[] = [];
  private n = 0;
  ws!: WebSocket;
  static async open(gameId: string, who: string) {
    const c = new Client();
    c.ws = await app.injectWS(`/games/${gameId}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${who}` } }, { onInit: (ws) => ws.on("message", (d) => c.raw.push(String(d))) });
    await vi.waitFor(() => expect(c.raw.some((t) => t.includes('"chatHistory"'))).toBe(true), quick);
    return c;
  }
  replyTo(id: string): ServerMessage | undefined {
    return this.raw.map((t) => JSON.parse(t) as ServerMessage).find((m) => "id" in m && m.id === id);
  }
  /** Sends raw JSON texts (each gets an id spliced in), in chunks under the queue limit; the replies in order. */
  async sendMany(texts: readonly string[]): Promise<ServerMessage[]> {
    const out: ServerMessage[] = [];
    for (let i = 0; i < texts.length; i += MAX_QUEUED_MESSAGES / 2) {
      const ids = texts.slice(i, i + MAX_QUEUED_MESSAGES / 2).map((t) => {
        const id = `h${++this.n}`;
        this.ws.send(t === "{}" ? `{"id":"${id}"}` : `{"id":"${id}",${t.slice(1)}`);
        return id;
      });
      await vi.waitFor(() => expect(ids.every((id) => this.replyTo(id))).toBe(true), quick);
      out.push(...ids.map((id) => this.replyTo(id)!));
    }
    return out;
  }
  async send(cmd: unknown) {
    return (await this.sendMany([JSON.stringify({ cmd })]))[0]!;
  }
  /** Waits until every earlier message has been handled. */
  async barrier() {
    await this.sendMany(["{}"]);
    return this.raw.length;
  }
}

// ---------------------------------------------------------------- hostile values

/** JSON text for each value (raw, so "__proto__" keys stay own keys). */
const NON_STRING = ['{"toString":null}', '{"toString":null,"valueOf":null}', '{"__proto__":{"x":1}}', "{}", "[]", '[{"toString":null}]', '["lobby"]', "42", "-1", "1e308", "true", "null"];
const BAD_STRINGS = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "NaN", "Infinity", "-0", "1e999", "undefined", "x".repeat(12_000)].map((s) => JSON.stringify(s));
const ALL = [...NON_STRING, ...BAD_STRINGS];
const NOT_NUMBER = ALL.filter((v) => !/^-?\d/.test(v));

/** `base` with the value at `path` replaced by the JSON text `value`. */
function mutate(base: object, path: readonly string[], value: string): string {
  const mark = "\u0000HOSTILE\u0000";
  const copy = structuredClone(base) as Record<string, unknown>;
  let at = copy;
  for (const k of path.slice(0, -1)) at = (at[k] ??= {}) as Record<string, unknown>;
  at[path.at(-1)!] = mark;
  return JSON.stringify({ cmd: copy }).replace(JSON.stringify(mark), value);
}

/** Field paths of each command (beyond `type`), with the values to try there. */
type Fields = readonly (readonly [path: readonly string[], values: readonly string[]])[];
const id = (p: string[]) => [p, ALL] as const;
const commandFields = (room: string, proposalId: string, other: string): readonly [object, Fields][] => [
  [{ type: "submitMove", move: { room, duffel: BANK_JOB.rooms[room]?.coins ?? 0, pocket: 0 } }, [id(["move"]), id(["move", "room"]), [["move", "duffel"], NOT_NUMBER], [["move", "pocket"], NOT_NUMBER], id(["move", "watch"]), id(["move", "ability"])]],
  [{ type: "submitMove", move: { room, duffel: BANK_JOB.rooms[room]?.coins ?? 0, pocket: 0, ability: { kind: "hide", room } } }, [id(["move", "ability", "kind"]), id(["move", "ability", "room"])]],
  [{ type: "submitMove", move: { room, duffel: BANK_JOB.rooms[room]?.coins ?? 0, pocket: 0, ability: { kind: "absolve", target: other } } }, [id(["move", "ability", "target"])]],
  // '["lobby"]' is a valid rooms list, accepted when the (randomly dealt) attacker is a Lookout, so it isn't tried there.
  [{ type: "submitMove", move: { room, duffel: BANK_JOB.rooms[room]?.coins ?? 0, pocket: 0, ability: { kind: "lookout", rooms: [room] } } }, [[["move", "ability", "rooms"], ALL.filter((v) => v !== '["lobby"]')], id(["move", "ability", "rooms", "0"])]],
  [{ type: "postAlibi", room }, [id(["room"])]],
  [{ type: "proposeMeeting", slot: "s" }, [[["slot"], NON_STRING]]],
  [{ type: "acceptMeeting", proposalId }, [id(["proposalId"])]],
  [{ type: "castVote", vote: { kind: "shakedown", target: other } }, [id(["vote"]), id(["vote", "kind"]), id(["vote", "target"])]],
  [{ type: "sealVote", vote: { kind: "shakedown", target: other } }, [id(["vote"]), id(["vote", "kind"]), id(["vote", "target"])]],
  [{ type: "useAbility", ability: { kind: "detect", target: other } }, [id(["ability"]), id(["ability", "kind"]), id(["ability", "target"])]],
  [{ type: "useAbility", ability: { kind: "audit", room } }, [id(["ability", "room"])]],
  [{ type: "useAbility", ability: { kind: "tail", room } }, [id(["ability", "room"])]],
  [{ type: "useAbility", ability: { kind: "peek", target: other } }, [id(["ability", "target"])]],
  [{ type: "useAbility", ability: { kind: "rigPick", card: "blackout" } }, [id(["ability", "card"])]],
  // No fields but the seat: a hostile `player` is overwritten, so only `type` is left to attack.
  [{ type: "callEmergency" }, []],
];
const BAD_TYPES = ALL.map((t) => `{"cmd":{"type":${t}}}`).concat(['{"cmd":{"__proto__":{"type":"submitMove"},"move":{"room":"lobby","pocket":0}}}']);

const loadVia = async (gameId: string) => (await createGameStore(db).load(gameId))!;

/**
 * Throws every hostile mutation at `attacker` and checks: each refused with a
 * reason that isn't the engine-threw fallback, nothing logged as an error, the
 * log unchanged, and no frame to any other socket.
 */
async function attack(gameId: string, attacker: Client, others: readonly Client[], state: GameState, players: readonly string[]) {
  const error = vi.spyOn(app.log, "error");
  const room = state.rooms.find((r) => r !== "security")!;
  const texts = [...BAD_TYPES];
  for (const [base, fields] of commandFields(room, state.proposals[0]?.id ?? "none", players[1]!)) {
    for (const [path, values] of fields) for (const v of values) texts.push(mutate(base, path, v));
  }
  const seen = others.map((o) => o.raw.length);
  const replies = await attacker.sendMany(texts);
  const bad = replies.flatMap((r, i) => ("rejected" in r && r.reason !== "command could not be handled" ? [] : [{ sent: texts[i]!.slice(0, 200), r }]));
  expect(bad).toEqual([]);
  expect(error.mock.calls).toEqual([]);
  error.mockRestore();
  expect((await loadVia(gameId)).log).toEqual(state.log);
  others.forEach((o, i) => expect(o.raw.length).toBe(seen[i]));
  return texts.length;
}

describe("QA: hostile command values over the socket (PR #28)", () => {
  it("every command type and field, in planning, alibis and an open meeting: refused on that socket only, no error, nothing changed", async () => {
    const { id, who, players } = await startGame(3);
    const [a, b, c] = await Promise.all(who.map((w) => Client.open(id, w)));
    // A proposal by B, so acceptMeeting has a real id to start from.
    expect(await b!.send({ type: "proposeMeeting", slot: "slot-b" })).toMatchObject({ ok: true });
    await a!.barrier();
    await c!.barrier();
    let tried = 0;

    // Planning, round 1.
    let state = await loadVia(id);
    expect(state.phase.kind).toBe("planning");
    tried += await attack(id, a!, [b!, c!], state, players);
    // Control: the unmutated bases are accepted here, so the hostile value is what got them refused.
    const room = state.rooms.find((r) => r !== "security")!;
    expect(await a!.send({ type: "submitMove", move: { room, duffel: BANK_JOB.rooms[room]?.coins ?? 0, pocket: 0 } })).toMatchObject({ ok: true });
    expect(await a!.send({ type: "acceptMeeting", proposalId: state.proposals[0]!.id })).toMatchObject({ ok: true });

    // Alibis for round 1.
    await app.live.system(id, { type: "advance", deadline: { kind: "round", round: 1 } });
    state = await loadVia(id);
    expect(state.phase.kind).toBe("alibis");
    await Promise.all([a!, b!, c!].map((x) => x.barrier()));
    tried += await attack(id, a!, [b!, c!], state, players);
    expect(await a!.send({ type: "postAlibi", room: state.moves[players[0]!]?.room ?? room })).toMatchObject({ ok: true });

    // The alibis close: round 1's result window (design §9.3).
    await app.live.system(id, { type: "advance", deadline: { kind: "alibis", round: 1 } });
    expect((await loadVia(id)).phase.kind).toBe("result");
    // An emergency, opened: voting. A hostile `player` and a `__proto__` key don't change whose call it is.
    expect(await a!.send(JSON.parse(`{"type":"callEmergency","player":{"toString":null},"__proto__":{"player":"${players[1]}"}}`))).toMatchObject({ ok: true });
    state = await loadVia(id);
    expect(state.pendingEmergency).toMatchObject({ by: players[0] });
    await app.live.system(id, { type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency!.meetingId } });
    state = await loadVia(id);
    expect(state.phase.kind).toBe("meeting");
    await Promise.all([a!, b!, c!].map((x) => x.barrier()));
    tried += await attack(id, a!, [b!, c!], state, players);
    expect(await a!.send({ type: "castVote", vote: { kind: "shakedown", target: players[1] } })).toMatchObject({ ok: true });

    expect(tried).toBeGreaterThan(1000);
    for (const x of [a!, b!, c!]) x.ws.close();
  }, 180_000);
});

describe("QA: hostile chat values over the socket (PR #28)", () => {
  it("hostile evidence ids, recipients and keys: refused, no error, no row stored, no frame to anyone else", async () => {
    const { id, who, players } = await startGame(3);
    const [a, b, c] = await Promise.all(who.map((w) => Client.open(id, w)));
    const seen = [b!.raw.length, c!.raw.length];
    const error = vi.spyOn(app.log, "error");
    const huge = JSON.stringify("x".repeat(12_000));
    const texts = [
      ...[...ALL, "1.5", "-0", "9007199254740993", '"1"'].map((v) => `{"chat":{"evidence":${v}}}`),
      "{\"chat\":{\"evidence\":9007199254740991}}", // a safe integer, but no such entry
      ...[...NON_STRING.filter((v) => v !== "null"), ...BAD_STRINGS].map((v) => `{"chat":{"to":${v},"text":"hi"}}`),
      ...[...NON_STRING.filter((v) => v !== "null"), ...BAD_STRINGS].map((v) => `{"chat":{"to":${v},"evidence":0}}`),
      `{"chat":{"to":"${players[0]}","text":"me"}}`, // yourself
      '{"chat":{"__proto__":{"text":"hi"}}}',
      '{"chat":{"text":"hi","__proto__":{"to":"x"}}}',
      '{"chat":{"text":"hi","constructor":1}}',
      `{"chat":{"text":"hi",${huge}:1}}`,
      ...NON_STRING.map((v) => `{"chat":${v}}`),
      ...NON_STRING.map((v) => `{"chat":{"text":${v}}}`),
      `{"chat":{"text":"hi","from":"${players[1]}"}}`, // a forged sender
    ];
    const replies = await a!.sendMany(texts);
    const bad = replies.flatMap((r, i) => ("rejected" in r ? [] : [{ sent: texts[i]!.slice(0, 200), r }]));
    expect(bad).toEqual([]);
    expect(error.mock.calls).toEqual([]);
    error.mockRestore();
    expect(await db.query("select 1 from chat_messages where game_id = $1", [id])).toEqual([]);
    expect([b!.raw.length, c!.raw.length]).toEqual(seen);
    // Control: a real DM still goes through, and only to its two players.
    expect((await a!.sendMany([`{"chat":{"to":"${players[1]}","text":"psst"}}`]))[0]).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(b!.raw.some((t) => t.includes('"psst"'))).toBe(true), quick);
    await c!.barrier();
    expect(c!.raw.some((t) => t.includes("psst"))).toBe(false);
    for (const x of [a!, b!, c!]) x.ws.close();
  }, 60_000);
});
