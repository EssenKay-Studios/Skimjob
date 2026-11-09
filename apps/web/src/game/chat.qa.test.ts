// QA for PR #38 (M2-8b chat UI): the client's chat logic against the server's
// rules. Rate limit and length limit parity with the real server code, unread
// counts across tabs, hidden DMs for a third player, hostile frames.
// design §12.1, §11.2, docs/m2-plan.md M2-8
import { describe, expect, it } from "vitest";
import type { GameEvent, GameState, PlayerView } from "@skimjob/engine";
import { checkChatText, createChat, evidenceCard } from "../../../server/src/chat";
import { sampleEvents } from "../../../../packages/engine/src/types/samples";
import { fakeClock } from "../../../server/src/clock";
import type { Db } from "../../../server/src/db";
import {
  asChatMessage,
  cardText,
  CHAT_MAX_CHARS,
  CHAT_RATE,
  CHAT_WARN_AT,
  chatReducer,
  composerStatus,
  dmPartners,
  dmThread,
  EMPTY_CHAT,
  feedFor,
  feedWorthy,
  latestAt,
  markRead,
  rateWaitMs,
  shareableEntries,
  threadMessages,
  totalUnread,
  unreadCount,
  type ChatAction,
  type ChatMessage,
  type ChatState,
  type DmNotice,
} from "./chat";
import { chatActionOf } from "./useGame";

const t = (s: number) => new Date(Date.UTC(2026, 10, 2, 12, 0, 0) + s * 1000).toISOString();
const msg = (id: string, from: string, to: string | null, s: number, text = id): ChatMessage => ({ id, from, to, at: t(s), text, verified: false });
const notice = (from: string, to: string, s: number): DmNotice => ({ from, to, at: t(s) });
const fold = (...actions: ChatAction[]): ChatState => actions.reduce(chatReducer, EMPTY_CHAT);
const history = (messages: ChatMessage[], dmNotices: DmNotice[] = []): ChatAction => ({ type: "history", history: { messages, dmNotices } });

/** The real server limiter (apps/server chat.ts) on a fake clock, with a Db that only answers the insert. */
function serverChat(start: number) {
  const clock = fakeClock(start);
  let n = 0;
  const db = {
    async query(_sql: string, params: unknown[] = []) {
      const [, from, to, sentAt, text] = params as [string, string, string | null, Date, string];
      return [{ id: `m${++n}`, from_player: from, to_player: to, sent_at: sentAt, text, card: null }];
    },
  } as unknown as Db;
  const chat = createChat(db, clock);
  return { clock, post: (text: string) => chat.post("g1", {} as GameState, "p1", { to: null, text }) };
}

describe("QA: rate limit matches the server's, 8 per 10 s (design §12.1)", () => {
  it("is exact at the boundary: the 9th waits until the 1st is 10 000 ms old, not a ms more or less", async () => {
    const t0 = 1_000_000;
    const s = serverChat(t0);
    const sent: number[] = [];
    for (let i = 0; i < CHAT_RATE.messages; i++) {
      expect(rateWaitMs(sent, s.clock.now())).toBe(0);
      expect((await s.post(`m${i}`)).ok).toBe(true);
      sent.push(s.clock.now());
    }
    expect(rateWaitMs(sent, s.clock.now())).toBe(10_000);
    s.clock.advance(9_999);
    expect(rateWaitMs(sent, s.clock.now())).toBe(1);
    expect(composerStatus("x", sent, s.clock.now()).note).toBe("Slow down: 8 messages per 10 s. Send again in 1 s.");
    expect((await s.post("too soon")).ok).toBe(false);
    s.clock.advance(1);
    expect(rateWaitMs(sent, s.clock.now())).toBe(0);
    expect(composerStatus("x", sent, s.clock.now()).canSend).toBe(true);
    expect((await s.post("now fine")).ok).toBe(true);
  });

  it("agrees with the server on every attempt of a long irregular burst (client sends only when it says it may)", async () => {
    const t0 = 5_000_000;
    const s = serverChat(t0);
    const sent: number[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let agreed = 0;
    for (let i = 0; i < 600; i++) {
      s.clock.advance(Math.floor(rnd() * 2_500));
      const clientSays = rateWaitMs(sent, s.clock.now()) === 0;
      const server = await s.post(`burst ${i}`);
      expect(server.ok, `attempt ${i} at +${s.clock.now() - t0} ms`).toBe(clientSays);
      if (server.ok) sent.push(s.clock.now());
      agreed++;
    }
    expect(agreed).toBe(600);
    expect(sent.length).toBeGreaterThan(100);
  });

  it("ignores old and out-of-order send times, and the wait counts down to the right whole second", () => {
    const now = 100_000;
    const sent = [now - 50_000, now - 9_000, now - 1_000, now - 8_000, now - 2_000, now - 7_000, now - 3_000, now - 6_000, now - 4_000];
    // Eight in the window; the oldest of them (now − 9 000) frees a slot in 1 000 ms.
    expect(rateWaitMs(sent, now)).toBe(1_000);
    expect(composerStatus("hi", sent, now).note).toContain("Send again in 1 s.");
    expect(rateWaitMs(sent, now + 1_000)).toBe(0);
    // Seven in the window is fine.
    expect(rateWaitMs(sent.slice(0, 8), now)).toBe(0);
  });

  it("the over-length note wins over the rate note; both block Send", () => {
    const now = 0;
    const sent = Array.from({ length: 8 }, (_, i) => now - i);
    const st = composerStatus("x".repeat(CHAT_MAX_CHARS + 1), sent, now);
    expect(st.canSend).toBe(false);
    expect(st.note).toMatch(/^Too long by 1/);
  });
});

describe("QA: the 500-character limit matches the server's (design §12.1)", () => {
  const cases: [string, string][] = [
    ["exactly 500 ASCII", "x".repeat(500)],
    ["501 ASCII", "x".repeat(501)],
    ["500 astral emoji (1000 UTF-16 units)", "😀".repeat(500)],
    ["501 astral emoji", "😀".repeat(501)],
    ["500 after trimming padding", `  \n\t${"y".repeat(500)}\n  `],
    ["499 + CRLF + 1 = 501", `${"z".repeat(499)}\r\nz`],
    ["498 + CRLF + 1 = 500", `${"z".repeat(498)}\r\nz`],
    ["500 unbroken with a zero-width space inside", `${"w".repeat(250)}\u200b${"w".repeat(249)}`],
    ["ZWJ family emoji ×100 (500 code points)", "👨\u200d👩\u200d👧".repeat(100)],
    ["Arabic and Hebrew", "مرحبا שלום hello"],
    ["markdown and HTML", "**bold** <img src=x onerror=alert(1)> [x](javascript:alert(1))"],
    ["zero-width only", "\u200b\u200c\u200d\u2060"],
    ["whitespace only", " \n\t 　 "],
    ["combining mark only", "́"],
  ];
  it.each(cases)("%s: client and server agree on length and on sendability", (_label, text) => {
    const server = checkChatText(text);
    const client = composerStatus(text, [], 0);
    expect(client.canSend).toBe(server.ok);
    if (server.ok) expect(client.length).toBe([...server.value].length);
    expect(client.over).toBe(!server.ok && /at most 500/.test(server.reason));
  });

  it("the counter shows from exactly 400, and 'Too long by N' counts code points", () => {
    expect(composerStatus("x".repeat(CHAT_WARN_AT - 1), [], 0).warn).toBe(false);
    expect(composerStatus("x".repeat(CHAT_WARN_AT), [], 0).warn).toBe(true);
    expect(composerStatus("😀".repeat(503), [], 0).note).toMatch(/^Too long by 3:/);
    expect(composerStatus("😀".repeat(500), [], 0)).toMatchObject({ over: false, canSend: true, note: null });
  });
});

describe("QA: a third player never gets a DM (design §12.1)", () => {
  // p3's stream: crew chat, notices of p1↔p2 DMs, never their text.
  const p3 = fold(
    history([msg("c1", "p1", null, 1, "crew hi")], [notice("p1", "p2", 2)]),
    { type: "notice", notice: notice("p2", "p1", 3) },
    { type: "message", message: msg("c2", "p2", null, 4, "crew again") },
    history([msg("c1", "p1", null, 1, "crew hi"), msg("c2", "p2", null, 4, "crew again")], [notice("p1", "p2", 2), notice("p2", "p1", 3), notice("p1", "p2", 5)]),
  );

  it("notices give the third player no DM thread, no unread and no DM text after a reconnect", () => {
    expect(dmPartners(p3, "p3")).toEqual([]);
    expect(threadMessages(p3, dmThread("p1"), "p3")).toEqual([]);
    expect(threadMessages(p3, dmThread("p2"), "p3")).toEqual([]);
    expect(totalUnread(p3, "p3", {})).toBe(2); // the two crew messages only
    const feed = feedFor(p3, "crew", "p3");
    expect(feed.map((f) => f.kind)).toEqual(["message", "notice", "message", "notice"]);
    expect(feed[1]).toMatchObject({ kind: "notice", count: 2, mutual: true });
    expect(JSON.stringify(feed)).not.toMatch(/"text":"(?!crew)/);
  });

  it("a notice for the same pair and time arriving live and again in history shows once", () => {
    const s = fold({ type: "notice", notice: notice("p1", "p2", 2) }, history([], [notice("p1", "p2", 2)]), { type: "notice", notice: notice("p1", "p2", 2) });
    expect(s.notices).toHaveLength(1);
  });

  it("the DM thread of the two players holds the DM; the crew feed of the two shows no notice for their own DM", () => {
    const p1 = fold(history([msg("d1", "p1", "p2", 1, "psst"), msg("d2", "p2", "p1", 2, "ok")]));
    expect(threadMessages(p1, dmThread("p2"), "p1").map((m) => m.id)).toEqual(["d1", "d2"]);
    expect(feedFor(p1, "crew", "p1")).toEqual([]);
    expect(dmPartners(p1, "p1")).toEqual(["p2"]);
  });
});

describe("QA: unread badges across tabs (design §12.1)", () => {
  // p1 sees: crew from p2 and p3, a DM from p2, a DM from p3, own messages.
  const s = fold(
    history([
      msg("a", "p2", null, 1),
      msg("b", "p1", null, 2),
      msg("c", "p2", "p1", 3),
      msg("d", "p3", "p1", 4),
      msg("e", "p3", null, 5),
      msg("f", "p1", "p3", 6),
      msg("g", "p3", "p1", 7),
    ]),
  );

  it("counts each tab on its own and the total is their sum; your own messages never count", () => {
    expect(unreadCount(s, "crew", "p1", {})).toBe(2);
    expect(unreadCount(s, dmThread("p2"), "p1", {})).toBe(1);
    expect(unreadCount(s, dmThread("p3"), "p1", {})).toBe(2);
    expect(totalUnread(s, "p1", {})).toBe(5);
  });

  it("reading one tab leaves the others' badges alone", () => {
    const read = markRead({}, dmThread("p3"), latestAt(s, dmThread("p3"), "p1")!);
    expect(unreadCount(s, dmThread("p3"), "p1", read)).toBe(0);
    expect(unreadCount(s, "crew", "p1", read)).toBe(2);
    expect(unreadCount(s, dmThread("p2"), "p1", read)).toBe(1);
    expect(totalUnread(s, "p1", read)).toBe(3);
  });

  it("a read mark at your own latest message clears what came before it, and a newer one comes back as unread", () => {
    const read = markRead({}, dmThread("p3"), t(6)); // you replied at 6 having read d
    expect(unreadCount(s, dmThread("p3"), "p1", read)).toBe(1); // g is newer
    const more = chatReducer(s, { type: "message", message: msg("h", "p2", null, 8) });
    expect(unreadCount(more, "crew", "p1", markRead({}, "crew", t(5)))).toBe(1);
  });

  it("marks never move backwards, so an older tab can't un-read a thread", () => {
    const read = markRead({}, "crew", t(5));
    expect(markRead(read, "crew", t(1))).toBe(read);
  });
});

describe("QA: hostile frames are dropped, never half-rendered", () => {
  const ok = { id: "m1", from: "p2", to: null, at: t(1), text: "hi", verified: false };
  it.each([
    ["verified as a string", { ...ok, verified: "false" }],
    ["text as an object", { ...ok, text: { toString: "x" } }],
    ["to missing", { id: "m1", from: "p2", at: t(1), text: "hi", verified: false }],
    ["to a number", { ...ok, to: 3 }],
    ["an array", [ok]],
    ["a verified card without payload", { ...ok, verified: true, card: { type: "roomSighting" } }],
    ["a verified message with only text (typed text is never verified)", { ...ok, verified: true }],
    ["a card payload that is an array", { ...ok, verified: true, card: { type: "x", payload: [] } }],
  ])("%s", (_label, frame) => {
    expect(asChatMessage(frame)).toBeNull();
    expect(chatActionOf({ chat: frame })).toBeNull();
  });

  it("an unverified message carrying a card is shown as its text only", () => {
    const m = asChatMessage({ ...ok, card: { type: "roomSighting", payload: { player: "p2" } } });
    expect(m).toEqual(ok);
  });

  it("a history with junk entries keeps the good ones; __proto__ keys from JSON don't pollute", () => {
    const raw = JSON.parse(`{"chatHistory":{"messages":[null,7,${JSON.stringify(ok)},{"__proto__":{"polluted":1}}],"dmNotices":"nope"}}`) as Record<string, unknown>;
    const a = chatActionOf(raw);
    expect(a).toEqual({ type: "history", history: { messages: [ok], dmNotices: [] } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("a card with a hostile type or payload falls back to a plain line and never throws", () => {
    const ctx = { me: "p1", name: (p: string) => p };
    // Types come from the server's copy of a real case-file entry; an unknown one is shown as plain text (escaped by React).
    expect(cardText({ type: "unknownFutureType", payload: {} }, "p2", ctx)).toBe("A case-file entry (unknownFutureType).");
    expect(() => cardText({ type: "<img src=x onerror=alert(1)>", payload: {} }, "p2", ctx)).not.toThrow();
    expect(cardText({ type: "roomSighting", payload: {} }, "p2", ctx)).toMatch(/^A case-file entry \(roomSighting\)\.$|\S+ \S+/);
    expect(() => cardText({ type: "roomSighting", payload: { player: null, others: "x", round: {} } }, "p2", ctx)).not.toThrow();
    expect(() => cardText({ type: "toString", payload: {} }, "p2", ctx)).not.toThrow();
    expect(() => cardText({ type: "__proto__", payload: {} }, "p2", ctx)).not.toThrow();
  });
});

describe("QA: game events in the crew feed while phases change", () => {
  const ev = (type: string, visibility: GameEvent["visibility"] = { kind: "public" }) => ({ type, visibility }) as unknown as GameEvent;
  it("phase changes and the end of the game get a row; private and secret events never do", () => {
    for (const type of ["roundResolved", "meetingOpened", "meetingClosed", "gameEnded", "eventFlipped"]) expect(feedWorthy(ev(type)), type).toBe(true);
    for (const type of ["roundStarted", "moveLocked"]) expect(feedWorthy(ev(type)), type).toBe(false);
    expect(feedWorthy(ev("roundResolved", { kind: "private", player: "p1" }))).toBe(false);
    expect(feedWorthy(ev("voteCast", { kind: "secret", player: "p1" }))).toBe(false);
    expect(feedWorthy(ev("gameEnded", { kind: "reveal" }))).toBe(false);
  });

  it("event rows interleave with messages by time and never split a notice run unless they fall between", () => {
    const s = fold(history([msg("a", "p2", null, 1)], [notice("p2", "p3", 2), notice("p3", "p2", 4)]));
    const rows = feedFor(s, "crew", "p1", [{ key: "9", at: t(3), text: "Round 1 resolved" }]);
    expect(rows.map((r) => r.kind)).toEqual(["message", "notice", "event", "notice"]);
    const after = feedFor(s, "crew", "p1", [{ key: "9", at: t(5), text: "Game over" }]);
    expect(after.map((r) => r.kind)).toEqual(["message", "notice", "event"]);
  });
});

describe("QA: the evidence picker offers exactly what the server accepts (design §8, §11.2, §12.1, PR #38)", () => {
  it("for every case-file sample, with one meeting closed and one open", () => {
    const entries = Object.values(sampleEvents)
      .filter((e) => e.visibility.kind === "private" || e.visibility.kind === "secret")
      .map((event, i) => ({ seq: 100 + i, event }));
    // A ballot of an open meeting too.
    entries.push({ seq: 999, event: { ...sampleEvents.voteCast, meetingId: "still-open" } });
    const view = { caseFile: entries, ledger: [{ seq: 1, event: { ...sampleEvents.meetingClosed, meetingId: "m1" } }] } as unknown as PlayerView;
    const offered = new Set(shareableEntries(view).map((e) => e.seq));
    const accepted = new Set(entries.filter((e) => evidenceCard(view, e.seq).ok).map((e) => e.seq));
    expect([...offered].sort()).toEqual([...accepted].sort());
    const typeOf = (seq: number) => entries.find((e) => e.seq === seq)!.event.type;
    const offeredTypes = new Set([...offered].map(typeOf));
    for (const t of ["roleDealt", "moleAllies", "alliesLearned", "insideTip", "voteSealed"]) expect(offeredTypes.has(t as never), t).toBe(false);
    for (const t of ["roomSighting", "roomWatched", "coinsGrabbed", "moveSubmitted"]) expect(offeredTypes.has(t as never), t).toBe(true);
    expect(offered.has(999)).toBe(false);
  });
});
