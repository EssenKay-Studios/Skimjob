// Chat client logic (M2-8b): feed state, threads, unread, composer limits,
// evidence cards. design §12.1, docs/m2-plan.md M2-8
import { describe, expect, it } from "vitest";
import type { CaseFileEvent, GameEvent, LoggedEvent, PublicEvent } from "@skimjob/engine";
import { sampleEvents } from "../../../../packages/engine/src/types/samples";
import { checkChatText } from "../../../server/src/chat";
import * as server from "../../../server/src/settings";
import {
  asChatMessage,
  cardText,
  CHAT_MAX_CHARS,
  CHAT_RATE,
  chatLength,
  chatReducer,
  composerStatus,
  dmPartners,
  EMPTY_CHAT,
  feedFor,
  feedWorthy,
  markRead,
  mergeRead,
  noticeText,
  rateWaitMs,
  shareableEntries,
  threadOf,
  totalUnread,
  unreadCount,
  type ChatMessage,
  type ChatState,
  type DmNotice,
} from "./chat";
import { chatActionOf } from "./useGame";

const NAMES: Record<string, string> = { p1: "Ana", p2: "Ben", p3: "Cyd", ana: "Ana", ben: "Ben" };
const name = (p: string) => NAMES[p] ?? p;
const t = (s: number) => new Date(Date.UTC(2026, 10, 2, 12, 0, s)).toISOString();
const msg = (id: string, from: string, to: string | null, s: number, text = id): ChatMessage => ({ id, from, to, at: t(s), text, verified: false });
const notice = (from: string, to: string, s: number): DmNotice => ({ from, to, at: t(s) });
const fold = (...actions: Parameters<typeof chatReducer>[1][]): ChatState => actions.reduce(chatReducer, EMPTY_CHAT);

describe("chat limits", () => {
  it("match the server's (apps/server settings.ts)", () => {
    expect(CHAT_MAX_CHARS).toBe(server.CHAT_MAX_CHARS);
    expect(CHAT_RATE).toEqual(server.CHAT_RATE);
  });
});

describe("chatReducer", () => {
  it("merges history on every reconnect without doubles, oldest first", () => {
    const a = msg("a", "p1", null, 1);
    const b = msg("b", "p2", null, 2);
    const c = msg("c", "p1", "p2", 3);
    let s = fold({ type: "history", history: { messages: [a, b], dmNotices: [] } });
    expect(s.loaded).toBe(true);
    s = chatReducer(s, { type: "message", message: c });
    s = chatReducer(s, { type: "message", message: c });
    // Reconnect: the server resends the latest messages plus what came in while away.
    const d = msg("d", "p2", null, 4);
    s = chatReducer(s, { type: "history", history: { messages: [b, c, d], dmNotices: [notice("p2", "p3", 5)] } });
    s = chatReducer(s, { type: "history", history: { messages: [d], dmNotices: [notice("p2", "p3", 5)] } });
    expect(s.messages.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
    expect(s.notices).toHaveLength(1);
  });

  it("keeps time order when a live message beats the history", () => {
    const s = fold({ type: "message", message: msg("late", "p1", null, 9) }, { type: "history", history: { messages: [msg("early", "p2", null, 1)], dmNotices: [] } });
    expect(s.messages.map((m) => m.id)).toEqual(["early", "late"]);
  });
});

describe("server frames", () => {
  it("become reducer actions; malformed ones are dropped", () => {
    const m = msg("x", "p1", null, 1);
    expect(chatActionOf({ chat: m })).toEqual({ type: "message", message: m });
    expect(chatActionOf({ dmNotice: notice("p1", "p2", 1) })).toEqual({ type: "notice", notice: notice("p1", "p2", 1) });
    expect(chatActionOf({ chatHistory: { messages: [m, { id: 3 }], dmNotices: [null] } })).toEqual({ type: "history", history: { messages: [m], dmNotices: [] } });
    expect(chatActionOf({ chat: { ...m, text: 5 } })).toBeNull();
    expect(chatActionOf({ ok: true, id: "c1" })).toBeNull();
    expect(asChatMessage({ id: "e", from: "p1", to: null, at: t(1), verified: true, card: { type: "roomSighting", payload: {} } })).not.toBeNull();
    expect(asChatMessage({ id: "e", from: "p1", to: null, at: t(1), verified: true, text: "fake proof" })).toBeNull();
  });
});

describe("threads and unread (design §12.1: crew chat plus private DMs)", () => {
  const s = fold({
    type: "history",
    history: {
      messages: [msg("1", "p2", null, 1), msg("2", "p1", "p2", 2), msg("3", "p3", "p1", 3), msg("4", "p2", "p1", 4), msg("5", "p1", null, 5)],
      dmNotices: [],
    },
  });

  it("puts each DM in the thread of the other player", () => {
    expect(threadOf(s.messages[1]!, "p1")).toBe("dm:p2");
    expect(threadOf(s.messages[2]!, "p1")).toBe("dm:p3");
    expect(threadOf(s.messages[0]!, "p1")).toBe("crew");
  });

  it("lists DM partners by latest activity, then threads opened but empty", () => {
    expect(dmPartners(s, "p1", ["p4", "p2"])).toEqual(["p2", "p3", "p4"]);
  });

  it("counts only others' messages newer than the read mark", () => {
    expect(unreadCount(s, "crew", "p1", {})).toBe(1); // your own "5" isn't unread
    expect(unreadCount(s, "dm:p2", "p1", {})).toBe(1);
    expect(totalUnread(s, "p1", {})).toBe(3);
    const read = markRead({}, "dm:p2", t(4));
    expect(unreadCount(s, "dm:p2", "p1", read)).toBe(0);
    expect(totalUnread(s, "p1", read)).toBe(2);
    expect(markRead(read, "dm:p2", t(1))).toBe(read); // never backwards
  });
});

describe("read marks across tabs (QA, PR #38)", () => {
  it("merge to the latest mark per thread, so a thread read in one tab stays read in the other", () => {
    const tabA = markRead({}, "dm:p3", t(5));
    const tabB = markRead({ "dm:p3": t(1) }, "crew", t(6));
    const merged = mergeRead(tabB, tabA);
    expect(merged).toEqual({ "dm:p3": t(5), crew: t(6) });
    expect(mergeRead(tabA, tabB)).toEqual(merged);
    // Never backwards, and junk in storage is ignored.
    expect(mergeRead(merged, { crew: t(2), "dm:p3": 7 } as never)).toEqual(merged);
    const s = fold({ type: "history", history: { messages: [msg("d", "p3", "p1", 5)], dmNotices: [] } });
    expect(unreadCount(s, "dm:p3", "p1", tabB)).toBe(1);
    expect(unreadCount(s, "dm:p3", "p1", mergeRead(tabB, tabA))).toBe(0);
  });
});

describe("feedFor", () => {
  it("shows DM notices in the crew feed only, folding a run for the same two players (design §12.1)", () => {
    const s = fold({
      type: "history",
      history: { messages: [msg("a", "p1", null, 1), msg("b", "p1", "p2", 6)], dmNotices: [notice("p2", "p3", 2), notice("p3", "p2", 3), notice("p2", "p3", 4)] },
    });
    const crew = feedFor(s, "crew", "p1", [{ key: "9", at: t(5), text: "Round 1: 12 taken." }]);
    expect(crew.map((i) => i.kind)).toEqual(["message", "notice", "event"]);
    const n = crew[1]!;
    expect(n.kind === "notice" && [n.count, n.mutual]).toEqual([3, true]);
    expect(n.kind === "notice" && noticeText(n.notice, name, n.mutual)).toBe("Ben and Cyd are DMing");
    expect(feedFor(s, "dm:p2", "p1").map((i) => i.key)).toEqual(["b"]);
    expect(noticeText(notice("p2", "p3", 1), name)).toBe("Ben is DMing Cyd");
  });

  it("keeps quiet events (alibis, round starts) out of the feed, and only public ones in; role claims show", () => {
    const pub = (e: GameEvent) => feedWorthy(e);
    expect(pub(sampleEvents.roundResolved)).toBe(true);
    expect(pub(sampleEvents.eventFlipped)).toBe(true);
        const said = (statement: object) => ({ type: "said", visibility: { kind: "public" }, statement }) as GameEvent;
    expect(pub(said({ kind: "alibi", player: "p1", round: 1, room: "lobby" }))).toBe(false);
    expect(pub(said({ kind: "role", player: "p1", role: "lookout", stretch: 1 }))).toBe(true);
    expect(pub(sampleEvents.roundStarted)).toBe(false);
    expect(pub(sampleEvents.roomSighting)).toBe(false);
  });
});

describe("composer limits (server: 500 characters, 8 messages per 10 s)", () => {
  it("counts like the server: trimmed, CRLF as one, code points", () => {
    expect(chatLength("  hi\r\nthere  ")).toBe(8);
    expect(chatLength("😀😀")).toBe(2);
  });

  it("flags empty, invisible-only and too-long text", () => {
    expect(composerStatus("   ", [], 0).canSend).toBe(false);
    expect(composerStatus("​​", [], 0).empty).toBe(true);
    expect(composerStatus("hey", [], 0)).toMatchObject({ canSend: true, warn: false, note: null });
    const near = composerStatus("x".repeat(420), [], 0);
    expect(near).toMatchObject({ canSend: true, warn: true, over: false });
    const over = composerStatus("x".repeat(512), [], 0);
    expect(over).toMatchObject({ canSend: false, over: true });
    expect(over.note).toMatch(/Too long by 12/);
  });

  it.each([
    ["bidi override", "hi \u202e there"],
    ["bidi isolate", "a\u2066b"],
    ["C0 control", "bell\u0007"],
    ["C1 control", "x\u0085y"],
    ["Hangul filler only", "\u3164\u3164"],
    ["halfwidth filler only", "\uffa0"],
    ["braille blank only", "\u2800\u2800"],
    ["nine stacked accents", `e${"\u0301".repeat(9)}`],
    ["eight stacked accents", `e${"\u0301".repeat(8)}`],
    ["tab and newline", "a\tb\nc"],
  ])("Send is on exactly when the server would accept it: %s (QA nit, PR #38)", (_label, text) => {
    const st = composerStatus(text, [], 0);
    expect(st.canSend).toBe(checkChatText(text).ok);
    if (!st.canSend && !st.empty) expect(st.note).toBeTruthy();
  });

  it("waits out the rate limit from your 8th message in 10 s", () => {
    const sent = [0, 1000, 2000, 3000, 4000, 5000, 6000];
    expect(rateWaitMs(sent, 6500)).toBe(0);
    const eight = [...sent, 7000];
    expect(rateWaitMs(eight, 7500)).toBe(2500); // the oldest (0) leaves the window at 10 000
    const st = composerStatus("hi", eight, 7500);
    expect(st.canSend).toBe(false);
    expect(st.note).toMatch(/Slow down.*3 s/);
    expect(rateWaitMs(eight, 10_001)).toBe(0);
  });
});

describe("evidence cards (design §12.1)", () => {
  const caseFile = (events: CaseFileEvent[]): LoggedEvent<CaseFileEvent>[] => events.map((event, i) => ({ seq: i + 1, event }));

  it("read from the reader's side, for every case-file event type", () => {
    for (const event of Object.values(sampleEvents) as GameEvent[]) {
      if (event.visibility.kind !== "private") continue;
      const { type, visibility: _v, ...payload } = event;
      const owner = event.visibility.player;
      const text = cardText({ type, payload }, owner, { me: "cyd", name });
      expect(text, type).toMatch(/^[A-Z0-9]/);
      expect(text, type).not.toMatch(/undefined|\[object/);
    }
  });

  it("falls back to a plain line for a type this build doesn't know", () => {
    expect(cardText({ type: "fromTheFuture", payload: {} }, "p1", { me: "p2", name })).toBe("A case-file entry (fromTheFuture).");
  });

  it("offers only entries the server will accept: no secret ballots, sealed votes or open-meeting ballots (design §11.2)", () => {
    const cast = sampleEvents.voteCast as unknown as CaseFileEvent & { meetingId: string };
    const secret = { ...cast, visibility: { kind: "secret", player: "ben" } } as unknown as CaseFileEvent;
    const view = {
      caseFile: caseFile([sampleEvents.roomSighting, sampleEvents.voteSealed as CaseFileEvent, cast, secret]),
      ledger: [] as LoggedEvent<PublicEvent>[],
    };
    expect(shareableEntries(view).map((e) => e.event.type)).toEqual(["roomSighting"]);
    // Role cards never show (design §8, PM decision on PR #38): the deal, an Inside tip.
    const roles = { caseFile: caseFile([sampleEvents.roleDealt, sampleEvents.insideTip, sampleEvents.coinsGrabbed]), ledger: [] };
    expect(shareableEntries(roles).map((e) => e.event.type)).toEqual(["coinsGrabbed"]);
    const closed = { ...view, ledger: [{ seq: 9, event: { ...sampleEvents.meetingClosed, meetingId: cast.meetingId } as PublicEvent }] };
    expect(shareableEntries(closed).map((e) => e.seq)).toEqual([3, 1]); // newest first
  });
});
