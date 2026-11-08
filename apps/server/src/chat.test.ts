// Chat over the game socket: crew, DMs, notices, history, limits, evidence cards.
// design §12.1; docs/m2-plan.md M2-8 (server half, M2-8a)
import type { PlayerView } from "@skimjob/engine";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { SESSION_COOKIE } from "./auth";
import { checkChatText, createChat, evidenceCard, type ChatHistory, type ChatMessage, type DmNotice } from "./chat";
import { fakeClock } from "./clock";
import type { Db } from "./db";
import type { ServerMessage } from "./live";
import type { LobbyView } from "./lobby";
import { buildServer } from "./server";
import { CHAT_MAX_CHARS, CHAT_MAX_MARKS, CHAT_RATE, type LobbySettings } from "./settings";
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
/** A started game: `people` humans (host first), then `bots` bots. */
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
  return { id: game.id, humans, botIds };
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
    const id = `m${++this.n}`;
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
  /** Every message queued for this socket so far has arrived (the reply goes through the game's lock). */
  async barrier() {
    await this.sendRaw({});
    return this.raw.length;
  }
}

const closeAll = (...cs: Client[]) => cs.forEach((c) => c.ws.close());

/** Submits a move (Office, all in) and returns its private `moveSubmitted` case-file entry: a shareable card. */
async function movedEntry(c: Client) {
  expect(await c.sendRaw({ cmd: { type: "submitMove", move: { room: "office", duffel: 2, pocket: 0 } } })).toMatchObject({ ok: true });
  let entry: PlayerView["caseFile"][number] | undefined;
  await vi.waitFor(() => {
    entry = c.view().caseFile.find((e) => e.event.type === "moveSubmitted");
    expect(entry).toBeDefined();
  }, quick);
  return entry!;
}

describe("crew chat (design §12.1)", () => {
  it("reaches every seat; the sender comes from the session; text stays plain text", async () => {
    const { id, humans } = await startGame(3);
    const [a, b, c] = await Promise.all(humans.map((h) => Client.open(id, h)));
    expect(await a!.chat({ text: "  <b>meet</b> in the vault\r\nok?  " })).toMatchObject({ ok: true });
    for (const cl of [a!, b!, c!]) await vi.waitFor(() => expect(cl.chats()).toHaveLength(1), quick);
    const msg = b!.chats()[0]!;
    expect(msg).toMatchObject({ from: humans[0]!.player, to: null, text: "<b>meet</b> in the vault\nok?", verified: false, at: "2026-11-01T00:00:00.000Z" });
    expect(msg.id).toMatch(/^[0-9a-f-]{36}$/);
    // A forged sender (or any unknown field) is refused, not believed.
    expect(await b!.chat({ text: "hi", from: humans[0]!.player })).toMatchObject({ rejected: true, reason: 'unknown chat field "from"' });
    closeAll(a!, b!, c!);
  });

  it("limits length and rate, and refuses empty or control-character text", async () => {
    const { id, humans } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    expect(await a.chat({ text: "x".repeat(CHAT_MAX_CHARS + 1) })).toMatchObject({ rejected: true });
    expect(await a.chat({ text: "   " })).toMatchObject({ rejected: true, reason: "message is empty" });
    expect(await a.chat({ text: "a‮b" })).toMatchObject({ rejected: true });
    expect(await a.chat({ text: 5 })).toMatchObject({ rejected: true });
    expect(await a.chat({ text: "hi", evidence: 1 })).toMatchObject({ rejected: true, reason: "send either text or evidence" });
    for (let i = 0; i < CHAT_RATE.messages; i++) expect(await a.chat({ text: i === 0 ? "😀".repeat(CHAT_MAX_CHARS) : `m${i}` })).toMatchObject({ ok: true });
    expect(await a.chat({ text: "one more" })).toMatchObject({ rejected: true, reason: "slow down: too many messages" });
    clock.advance(CHAT_RATE.windowMs);
    expect(await a.chat({ text: "later" })).toMatchObject({ ok: true });
    expect(checkChatText("tab\tand\nnewline")).toEqual({ ok: true, value: "tab\tand\nnewline" });
    // Invisible-only text is empty (PR #24 QA); stacked marks are capped; real text with them is fine.
    for (const blank of ["\u200b", "\u200e\u200f\u061c", "\u{e0041}\u{e0042}", "\u3164\u115f\u1160\uffa0", "\u2800", "\u034f\u2060", "\u200d\u0301"]) {
      expect(checkChatText(blank)).toEqual({ ok: false, reason: "message is empty" });
    }
    expect(checkChatText(`a${"\u0301".repeat(CHAT_MAX_MARKS + 1)}`)).toMatchObject({ ok: false });
    expect(checkChatText(`a${"\u0301\u200b".repeat(CHAT_MAX_MARKS + 1)}`)).toMatchObject({ ok: false });
    for (const fine of ["Tiếng Việt", "नमस्ते", "👩‍👩‍👧 family", `a${"\u0301".repeat(CHAT_MAX_MARKS)}`]) expect(checkChatText(fine)).toMatchObject({ ok: true });
    closeAll(a);
  });
});

describe("rate limiter memory", () => {
  it("forgets senders whose window has passed", async () => {
    const own = fakeClock(Date.UTC(2026, 10, 2));
    const chat = createChat(db, own);
    const { id, humans } = await startGame(2, 1);
    const state = (await createGameStore(db).load(id))!;
    for (const h of humans) expect(await chat.post(id, state, h.player, { to: null, text: "hi" })).toMatchObject({ ok: true });
    expect(chat.rateTracked()).toBe(2);
    own.advance(CHAT_RATE.windowMs);
    expect(await chat.post(id, state, humans[0]!.player, { to: null, text: "again" })).toMatchObject({ ok: true });
    expect(chat.rateTracked()).toBe(1);
  });
});

describe("DMs (design §12.1)", () => {
  it("a DM reaches only its two players; a third socket gets only the notice", async () => {
    const { id, humans } = await startGame(3);
    const [a, b, c] = await Promise.all(humans.map((h) => Client.open(id, h)));
    const before = c!.raw.length;
    expect(await a!.chat({ to: humans[1]!.player, text: "secret deal" })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(b!.chats()).toHaveLength(1), quick);
    expect(a!.chats()[0]).toMatchObject({ from: humans[0]!.player, to: humans[1]!.player, text: "secret deal" });
    await c!.barrier();
    const third = c!.raw.slice(before);
    expect(third.join()).not.toContain("secret deal");
    expect(c!.chats()).toHaveLength(0);
    expect(c!.notices()).toEqual([{ from: humans[0]!.player, to: humans[1]!.player, at: a!.chats()[0]!.at }]);
    expect(a!.notices()).toHaveLength(0);
    closeAll(a!, b!, c!);
  });

  it("with notices off, a third socket gets nothing at all", async () => {
    const { id, humans } = await startGame(3, 0, { dmNotices: false });
    const [a, b, c] = await Promise.all(humans.map((h) => Client.open(id, h)));
    const before = await c!.barrier();
    expect(await a!.chat({ to: humans[1]!.player, text: "psst" })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(b!.chats()).toHaveLength(1), quick);
    expect(await c!.barrier()).toBe(before + 1); // only the barrier's own reply
    closeAll(a!, b!, c!);
  });

  it("refuses DMs to yourself, to a bot or to someone not in the game", async () => {
    const { id, humans, botIds } = await startGame(2, 1);
    const a = await Client.open(id, humans[0]!);
    expect(await a.chat({ to: humans[0]!.player, text: "me" })).toMatchObject({ rejected: true, reason: "you can't message yourself" });
    expect(botIds).toHaveLength(1);
    expect(await a.chat({ to: botIds[0], text: "bot?" })).toMatchObject({ rejected: true, reason: "bots don't read messages" });
    expect(await a.chat({ to: "p99", text: "who" })).toMatchObject({ rejected: true, reason: "no such player" });
    expect(await a.chat({ to: 2, text: "who" })).toMatchObject({ rejected: true });
    closeAll(a);
  });
});

describe("history on (re)connect", () => {
  it("crew chat and your own DMs; others' DMs only as notices, and none when notices are off", async () => {
    for (const dmNotices of [true, false]) {
      const { id, humans } = await startGame(3, 0, { dmNotices });
      const [p1, p2, p3] = humans.map((h) => h.player);
      const a = await Client.open(id, humans[0]!);
      await a.chat({ text: "crew 1" });
      await a.chat({ to: p2, text: "to two" });
      await a.chat({ to: p3, text: "to three" });
      const h2 = (await Client.open(id, humans[1]!)).history()!;
      expect(h2.messages.map((m) => ("text" in m ? m.text : null))).toEqual(["crew 1", "to two"]);
      expect(JSON.stringify(h2)).not.toContain("to three");
      expect(h2.dmNotices).toEqual(dmNotices ? [{ from: p1, to: p3, at: expect.any(String) }] : []);
      expect((await Client.open(id, humans[0]!)).history()!.messages).toHaveLength(3);
      closeAll(a);
    }
  });

  it("a non-member can't read or send: no socket, and another game's chat never shows", async () => {
    const g1 = await startGame(2, 1);
    const g2 = await startGame(2, 1);
    const a = await Client.open(g1.id, g1.humans[0]!);
    await a.chat({ text: "game one only" });
    await expect(app.injectWS(`/games/${g1.id}/ws`, { headers: { cookie: `${SESSION_COOKIE}=${g2.humans[1]!.who}` } })).rejects.toThrow(/404/);
    const other = await Client.open(g2.id, g2.humans[0]!);
    expect(other.history()).toEqual({ messages: [], dmNotices: [] });
    closeAll(a, other);
  });
});

describe("evidence cards (design §12.1)", () => {
  it("shares your own case-file entry, verified, re-read by the server, without seq", async () => {
    const { id, humans } = await startGame(3);
    const [a, b] = await Promise.all(humans.slice(0, 2).map((h) => Client.open(id, h)));
    const own = await movedEntry(a!);
    expect(await a!.chat({ evidence: own.seq })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(b!.chats()).toHaveLength(1), quick);
    const card = b!.chats()[0]!;
    expect(card).toMatchObject({ from: humans[0]!.player, verified: true, card: { type: "moveSubmitted", payload: { player: humans[0]!.player, move: { room: "office", duffel: 2, pocket: 0 } } } });
    expect(JSON.stringify(card)).not.toMatch(/"seq"|"visibility"/);
    // Typed claims are never verified.
    await a!.chat({ text: "I'm the Lookout, honest" });
    await vi.waitFor(() => expect(b!.chats()).toHaveLength(2), quick);
    expect(b!.chats()[1]!.verified).toBe(false);
    closeAll(a!, b!);
  });

  it("refuses role cards: your deal, or any entry stating a role or faction (design §8, PM decision on PR #38)", async () => {
    const { id, humans } = await startGame(2, 1);
    const [a, b] = await Promise.all(humans.map((h) => Client.open(id, h)));
    const deal = a!.view().caseFile.find((e) => e.event.type === "roleDealt")!;
    const reason = "role cards can't be shared: role claims stay unverified";
    expect(await a!.chat({ evidence: deal.seq })).toMatchObject({ rejected: true, reason });
    expect(await a!.chat({ to: humans[1]!.player, evidence: deal.seq })).toMatchObject({ rejected: true, reason });
    await b!.barrier();
    expect(b!.chats()).toEqual([]);
    const pv = (event: Record<string, unknown>) => ({ caseFile: [{ seq: 3, event: { visibility: { kind: "private", player: "p1" }, player: "p1", ...event } }], ledger: [] }) as unknown as PlayerView;
    expect(evidenceCard(pv({ type: "insideTip", round: 2, subject: "p2", role: "mole" }), 3)).toEqual({ ok: false, reason });
    expect(evidenceCard(pv({ type: "perkUsed", round: 2, perk: { kind: "peek", target: "p2", role: "hacker" } }), 3)).toEqual({ ok: false, reason });
    expect(evidenceCard(pv({ type: "alliesLearned", allies: ["p2"], via: "deal" }), 3)).toEqual({ ok: false, reason });
    // Ability results stay shareable.
    expect(evidenceCard(pv({ type: "roomSighting", round: 1, room: "vault", others: ["p2"] }), 3)).toMatchObject({ ok: true });
    closeAll(a!, b!);
  });

  it("refuses a forged entry, a ledger entry, or anything but your own case-file seq", async () => {
    const { id, humans } = await startGame(2, 1);
    const [a, b] = await Promise.all(humans.map((h) => Client.open(id, h)));
    const ledgerSeq = a!.view().ledger[0]!.seq;
    const theirs = await movedEntry(b!);
    const mine = await movedEntry(a!);
    expect(await a!.chat({ evidence: ledgerSeq })).toMatchObject({ rejected: true, reason: "that isn't an entry of your case file" });
    expect(await a!.chat({ evidence: 9999 })).toMatchObject({ rejected: true });
    expect(await a!.chat({ evidence: theirs })).toMatchObject({ rejected: true }); // a whole (forged) entry
    expect(await a!.chat({ evidence: theirs.event })).toMatchObject({ rejected: true });
    // A seq names an entry of the sender's own case file: never someone else's.
    expect(await a!.chat({ evidence: mine.seq })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(b!.chats()).toHaveLength(1), quick);
    expect(b!.chats()[0]).toMatchObject({ card: { payload: { player: humans[0]!.player } } });
    closeAll(a!, b!);
  });

  it("a secret-mode ballot can't be shared (design §11.2)", () => {
    const view = {
      caseFile: [{ seq: 7, event: { type: "voteCast", visibility: { kind: "secret", player: "p1" }, player: "p1", meetingId: "meeting-1", choice: "skip" } }],
    } as unknown as PlayerView;
    expect(evidenceCard(view, 7)).toEqual({ ok: false, reason: "secret ballots can't be shared" });
  });

  it("hidden mode: a ballot is shareable only once its meeting has closed; a sealed vote never (design §11.2, PR #24 review)", () => {
    const vote = { kind: "skip" };
    const cast = { seq: 9, event: { type: "voteCast", visibility: { kind: "private", player: "p1" }, meetingId: "meeting-1", player: "p1", vote, sealed: false } };
    const sealed = { seq: 8, event: { type: "voteSealed", visibility: { kind: "private", player: "p1" }, player: "p1", vote } };
    const closed = { seq: 10, event: { type: "meetingClosed", visibility: { kind: "public" }, meetingId: "meeting-1", tally: { skip: 1, targets: {} }, ballots: { p1: vote }, result: { kind: "skipped" } } };
    const open = { caseFile: [sealed, cast], ledger: [] } as unknown as PlayerView;
    const after = { caseFile: [sealed, cast], ledger: [closed] } as unknown as PlayerView;
    expect(evidenceCard(open, 9)).toEqual({ ok: false, reason: "ballots can be shared once the meeting has closed" });
    expect(evidenceCard(after, 9)).toEqual({ ok: true, value: { type: "voteCast", payload: { meetingId: "meeting-1", player: "p1", vote, sealed: false } } });
    for (const v of [open, after]) expect(evidenceCard(v, 8)).toEqual({ ok: false, reason: "sealed votes can't be shared" });
  });
});
