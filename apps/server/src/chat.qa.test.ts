// QA (M2-8a): adversarial chat checks over the game socket. design §12.1, §11.2
import type { Command, GameState, PlayerView } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import type { ChatHistory, ChatMessage, DmNotice } from "./chat";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import type { ServerMessage } from "./live";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import { CHAT_MAX_CHARS, CHAT_RATE, type LobbySettings } from "./settings";
import { createGameStore } from "./store";
import { testDb } from "./testkit";

const quick = { interval: 1, timeout: 10_000 };
const clock = fakeClock(Date.UTC(2026, 10, 1));
let db: Db;
let app: FastifyInstance;
const boot = async () => {
  const a = buildServer({ db, clock, store: createGameStore(db) });
  await a.ready();
  return a;
};
beforeAll(async () => {
  db = await testDb();
  app = await boot();
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
  return { id: game.id, humans, botIds: started.seats.filter((s) => s.bot !== null).map((s) => s.playerId!) };
}

class Client {
  readonly raw: string[] = [];
  private n = 0;
  ws!: WebSocket;
  static async open(gameId: string, h: Human) {
    const c = new Client();
    const onInit = (ws: WebSocket) => ws.on("message", (data) => c.raw.push(String(data)));
    c.ws = await app.injectWS(`/games/${gameId}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${h.who}` } }, { onInit });
    await vi.waitFor(() => expect(c.history()).toBeDefined(), quick);
    return c;
  }
  get messages(): ServerMessage[] {
    return this.raw.map((t) => JSON.parse(t) as ServerMessage);
  }
  view(): PlayerView {
    return this.messages.flatMap((m) => ("view" in m ? [m.view] : [])).at(-1)!;
  }
  history(): ChatHistory | undefined {
    return this.messages.flatMap((m) => ("chatHistory" in m ? [m.chatHistory] : [])).at(-1);
  }
  chats(): ChatMessage[] {
    return this.messages.flatMap((m) => ("chat" in m ? [m.chat] : []));
  }
  notices(): DmNotice[] {
    return this.messages.flatMap((m) => ("dmNotice" in m ? [m.dmNotice] : []));
  }
  async sendRaw(msg: Record<string, unknown>): Promise<ServerMessage> {
    const id = `q${++this.n}`;
    this.ws.send(JSON.stringify({ ...msg, id }));
    let reply: ServerMessage | undefined;
    await vi.waitFor(() => {
      reply = this.messages.find((m) => "id" in m && m.id === id);
      expect(reply).toBeDefined();
    }, quick);
    return reply!;
  }
  chat(chat: unknown) {
    return this.sendRaw({ chat });
  }
  async barrier() {
    await this.sendRaw({});
  }
}
const closeAll = (...cs: Client[]) => cs.forEach((c) => c.ws.close());
const texts = (ms: readonly ChatMessage[]) => ms.map((m) => ("text" in m ? m.text : `card:${m.card.type}`));
const loadVia = async (id: string) => (await createGameStore(db).load(id))!;

function nextDeadline(state: GameState): Command[] {
  const phase = state.phase;
  if (phase.kind === "meeting") return [{ type: "advance", deadline: { kind: "closeMeeting", meetingId: phase.meetingId } }];
  if (phase.kind === "shakedownPending") return [{ type: "advance", deadline: { kind: "resolveShakedown", meetingId: phase.meetingId } }];
  if (state.pendingEmergency) {
    return [{ type: "advance", deadline: { kind: "openMeeting", meetingId: state.pendingEmergency.meetingId } }];
  }
  if (phase.kind === "planning") return [{ type: "advance", deadline: { kind: "round", round: phase.round } }];
  // design §9.3: the result window closes when nobody called an emergency.
  if (phase.kind === "result") return [{ type: "advance", deadline: { kind: "result", round: phase.round } }];
  if (phase.kind === "awaitingMeeting") {
    const schedule: Command[] = state.scheduledMeeting ? [] : [{ type: "scheduleMeeting", meetingId: phase.meetingId, slot: `server-${phase.meetingId}` }];
    return [...schedule, { type: "advance", deadline: { kind: "openMeeting", meetingId: phase.meetingId } }];
  }
  return [];
}

describe("QA: forged sender (design §12.1)", () => {
  it("a from/player at the top level or a __proto__ field never changes the sender; chat wins over a cmd in the same frame", async () => {
    const { id, humans } = await startGame(3);
    const [a, b] = await Promise.all(humans.slice(0, 2).map((h) => Client.open(id, h)));
    const victim = humans[1]!.player;
    expect(await a!.sendRaw({ chat: { text: "top-level from" }, from: victim, player: victim })).toMatchObject({ ok: true });
    expect(await a!.sendRaw({ chat: { text: "with cmd" }, cmd: { type: "submitMove", move: { room: "lobby", duffel: 1, pocket: 0 } } })).toMatchObject({ ok: true });
    a!.ws.send(`{"chat":{"text":"proto","__proto__":{"from":"${victim}"}},"id":"p"}`);
    await vi.waitFor(() => expect(a!.messages.find((m) => "id" in m && m.id === "p")).toMatchObject({ rejected: true }), quick);
    expect(await a!.chat({ text: "x", to: null, verified: true })).toMatchObject({ rejected: true });
    await vi.waitFor(() => expect(b!.chats()).toHaveLength(2), quick);
    expect(b!.chats().map((m) => [m.from, m.verified])).toEqual([
      [humans[0]!.player, false],
      [humans[0]!.player, false],
    ]);
    // The cmd riding along with chat was not run.
    expect(a!.view().me.move).toBeNull();
    closeAll(a!, b!);
  });
});

describe("QA: DMs (design §12.1)", () => {
  it("two tabs per seat: both tabs of sender and recipient get it, the third seat only a notice; and nothing when notices are off", async () => {
    for (const dmNotices of [true, false]) {
      const { id, humans } = await startGame(3, 0, { dmNotices });
      const [a1, a2, b1, b2, c] = await Promise.all([0, 0, 1, 1, 2].map((i) => Client.open(id, humans[i]!)));
      const cBefore = c!.raw.length;
      expect(await a1!.chat({ to: humans[1]!.player, text: "tabs secret" })).toMatchObject({ ok: true });
      for (const t of [a1!, a2!, b1!, b2!]) await vi.waitFor(() => expect(texts(t.chats())).toEqual(["tabs secret"]), quick);
      for (const t of [a1!, a2!, b1!, b2!]) expect(t.notices()).toEqual([]);
      await c!.barrier();
      const third = c!.raw.slice(cBefore);
      expect(third.join()).not.toContain("tabs secret");
      expect(third.join()).not.toContain(a1!.chats()[0]!.id);
      expect(c!.notices()).toHaveLength(dmNotices ? 1 : 0);
      expect(third).toHaveLength(dmNotices ? 2 : 1); // notice + barrier reply, or the reply alone
      closeAll(a1!, a2!, b1!, b2!, c!);
    }
  });

  it("refuses to: '', __proto__, constructor, an id from another game, an object, and a bot in an ended or running game", async () => {
    const g1 = await startGame(2, 1);
    const g2 = await startGame(4);
    const a = await Client.open(g1.id, g1.humans[0]!);
    for (const to of ["", "__proto__", "constructor", "toString", g2.humans[3]!.player, { id: g1.humans[1]!.player }, [g1.humans[1]!.player], g1.botIds[0]]) {
      expect(await a.chat({ to, text: "hey" })).toMatchObject({ rejected: true });
    }
    expect(a.chats()).toEqual([]);
    closeAll(a);
  });
});

describe("QA: history on reconnect", () => {
  it("never carries others' DM text or ids; notices-off history has no trace of them", async () => {
    for (const dmNotices of [true, false]) {
      const { id, humans } = await startGame(3, 0, { dmNotices });
      const [a, b] = await Promise.all(humans.slice(0, 2).map((h) => Client.open(id, h)));
      await a!.chat({ to: humans[1]!.player, text: "a to b" });
      await b!.chat({ to: humans[0]!.player, text: "b to a" });
      await a!.chat({ text: "crew" });
      const dmIds = a!.chats().filter((m) => m.to !== null).map((m) => m.id);
      const c = await Client.open(id, humans[2]!);
      const raw = JSON.stringify(c.history());
      for (const s of ["a to b", "b to a", ...dmIds]) expect(raw).not.toContain(s);
      expect(texts(c.history()!.messages)).toEqual(["crew"]);
      expect(c.history()!.dmNotices).toHaveLength(dmNotices ? 2 : 0);
      if (!dmNotices) expect(raw).not.toContain(humans[1]!.player); // b never posted to the crew
      // A recipient's reconnect has both directions of their own DM thread, in order.
      expect(texts((await Client.open(id, humans[1]!)).history()!.messages)).toEqual(["a to b", "b to a", "crew"]);
      closeAll(a!, b!, c);
    }
  });

  it("messages stay in send order per game across a server restart (same clock time, games interleaved)", async () => {
    const g1 = await startGame(2, 1);
    const g2 = await startGame(2, 1);
    let a = await Client.open(g1.id, g1.humans[0]!);
    let x = await Client.open(g2.id, g2.humans[0]!);
    for (const t of ["1", "2", "3"]) {
      await a.chat({ text: `g1-${t}` });
      await x.chat({ text: `g2-${t}` });
    }
    closeAll(a, x);
    await app.close();
    app = await boot();
    a = await Client.open(g1.id, g1.humans[1]!);
    await a.chat({ text: "g1-4" });
    x = await Client.open(g2.id, g2.humans[1]!);
    expect(texts((await Client.open(g1.id, g1.humans[0]!)).history()!.messages)).toEqual(["g1-1", "g1-2", "g1-3", "g1-4"]);
    expect(texts(x.history()!.messages)).toEqual(["g2-1", "g2-2", "g2-3"]);
    closeAll(a, x);
  }, 30_000);
});

describe("QA: evidence cards (design §12.1, §11.2)", () => {
  it("refuses non-integer, string, __proto__, negative, out-of-range and other-game seqs; the card is the sender's own entry", async () => {
    const g1 = await startGame(2, 1);
    const g2 = await startGame(6);
    const [a, b] = await Promise.all(g1.humans.map((h) => Client.open(g1.id, h)));
    const other = await Client.open(g2.id, g2.humans[0]!);
    const own = new Set(a!.view().caseFile.map((e) => e.seq));
    const foreign = other.view().caseFile.map((e) => e.seq).find((s) => !own.has(s));
    for (const evidence of ["__proto__", "0", "1", 1.5, -1, null, true, {}, [0], 2 ** 53, Number.MAX_SAFE_INTEGER, ...(foreign === undefined ? [] : [foreign])]) {
      expect(await a!.chat({ evidence })).toMatchObject({ rejected: true });
    }
    expect(a!.chats()).toEqual([]);
    // Role cards are refused (design §8, PR #38): share a move instead.
    expect(await a!.sendRaw({ cmd: { type: "submitMove", move: { room: "office", duffel: 2, pocket: 0 } } })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(a!.view().caseFile.some((e) => e.event.type === "moveSubmitted")).toBe(true), quick);
    const entry = a!.view().caseFile.find((e) => e.event.type === "moveSubmitted")!;
    expect(await a!.chat({ evidence: entry.seq, to: g1.humans[1]!.player })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(b!.chats()).toHaveLength(1), quick);
    const { type, visibility: _v, ...payload } = entry.event;
    expect(b!.chats()[0]).toMatchObject({ verified: true, to: g1.humans[1]!.player, card: { type, payload } });
    expect(Object.keys(b!.chats()[0]!)).not.toContain("text");
    expect(JSON.stringify(b!.chats()[0])).not.toMatch(/"seq"|"visibility"/);
    closeAll(a!, b!, other);
  });

  it("a real sealed ballot can't be shared, in secret mode or hidden mode (PR #24 review: not while its vote is open)", async () => {
    for (const voteVisibility of ["secret", "hiddenThenRevealed"] as const) {
      const { id, humans } = await startGame(3, 0, { voteVisibility });
      const a = await Client.open(id, humans[0]!);
      expect(await a.sendRaw({ cmd: { type: "sealVote", vote: { kind: "shakedown", target: humans[1]!.player } } })).toMatchObject({ ok: true });
      await vi.waitFor(() => expect(a.view().caseFile.some((e) => e.event.type === "voteSealed")).toBe(true), quick);
      const ballot = a.view().caseFile.find((e) => e.event.type === "voteSealed")!;
      expect(await a.chat({ evidence: ballot.seq })).toMatchObject({ rejected: true, reason: voteVisibility === "secret" ? "secret ballots can't be shared" : "sealed votes can't be shared" });
      closeAll(a);
    }
  });
});

describe("QA: text limits", () => {
  it("exactly 500 code points is fine, 501 isn't; empty/whitespace refused; HTML stays literal text in delivery and history", async () => {
    const { id, humans } = await startGame(2, 1);
    const [a, b] = await Promise.all(humans.map((h) => Client.open(id, h)));
    expect(await a!.chat({ text: "é".repeat(CHAT_MAX_CHARS + 1) })).toMatchObject({ rejected: true });
    expect(await a!.chat({ text: "𝔸".repeat(CHAT_MAX_CHARS + 1) })).toMatchObject({ rejected: true });
    expect(await a!.chat({ text: ` ${"a".repeat(CHAT_MAX_CHARS)}\n ` })).toMatchObject({ ok: true }); // trimmed first
    for (const text of ["", " ", "\n\t \r\n", " 　", "﻿", "\u0000", "a\u0007b", "‮reversed", "a⁧b⁩", "x\u001bm"]) {
      expect(await a!.chat({ text })).toMatchObject({ rejected: true });
    }
    const html = `<script>alert(1)</script><img src=x onerror=alert(2)> &amp; &lt;`;
    expect(await a!.chat({ text: html })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(b!.chats()).toHaveLength(2), quick);
    expect(texts(b!.chats())[1]).toBe(html);
    expect(texts((await Client.open(id, humans[1]!)).history()!.messages).at(-1)).toBe(html);
    closeAll(a!, b!);
  });
});

describe("QA: rate limit (8 per 10 s)", () => {
  it("is exact at the boundary, shared by two tabs, per player, and not spent by refused messages", async () => {
    const { id, humans } = await startGame(2, 1);
    const [a1, a2, b] = await Promise.all([0, 0, 1].map((i) => Client.open(id, humans[i]!)));
    for (let i = 0; i < 20; i++) expect(await a1!.chat({ text: "" })).toMatchObject({ rejected: true, reason: "message is empty" });
    for (let i = 0; i < CHAT_RATE.messages; i++) {
      expect(await (i % 2 ? a2! : a1!).chat({ text: `m${i}` })).toMatchObject({ ok: true });
      if (i === 0) clock.advance(1000); // the first message is older than the rest
    }
    expect(await a2!.chat({ text: "ninth" })).toMatchObject({ rejected: true, reason: "slow down: too many messages" });
    expect(await b!.chat({ text: "others unaffected" })).toMatchObject({ ok: true });
    clock.advance(CHAT_RATE.windowMs - 1000 - 1); // 1 ms before the first leaves the window
    expect(await a1!.chat({ text: "still too soon" })).toMatchObject({ rejected: true });
    clock.advance(1); // exactly windowMs after the first: it has left
    expect(await a1!.chat({ text: "one slot" })).toMatchObject({ ok: true });
    expect(await a1!.chat({ text: "no second slot" })).toMatchObject({ rejected: true });
    closeAll(a1!, a2!, b!);
  });
});

describe("QA: chat after the game ends (decisions.md M2-8a: stays open)", () => {
  it("crew chat, DMs and history work after the end; DMs to bots still refused; evidence is still case-file only", async () => {
    const { id, humans, botIds } = await startGame(2, 3);
    const a = await Client.open(id, humans[0]!);
    await a.chat({ text: "during" });
    let steps = 0;
    for (let s = await loadVia(id); s.phase.kind !== "ended"; s = await loadVia(id)) {
      expect(++steps).toBeLessThan(200);
      for (const command of nextDeadline(s)) await app.live.system(id, command as Parameters<typeof app.live.system>[1]);
    }
    await a.barrier();
    const view = a.view();
    expect(view.reveal).not.toBeNull();
    expect(await a.chat({ text: "gg" })).toMatchObject({ ok: true });
    expect(await a.chat({ to: humans[1]!.player, text: "gg dm" })).toMatchObject({ ok: true });
    expect(await a.chat({ to: botIds[0], text: "gg bot" })).toMatchObject({ rejected: true });
    // A reveal-only entry (beyond the case file's seqs) still isn't shareable.
    expect(await a.chat({ evidence: view.reveal!.log.length + 1000 })).toMatchObject({ rejected: true });
    const b = await Client.open(id, humans[1]!);
    expect(texts(b.history()!.messages)).toEqual(["during", "gg", "gg dm"]);
    closeAll(a, b);
  }, 90_000);
});
