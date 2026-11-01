// Render checks for the chat panel (M2-8b): plain text only, evidence cards
// say they're verified and that cameras can be fooled, DM notices, unread
// badges, limits feedback, and no raw colours. design §12.1
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chatReducer, EMPTY_CHAT, type ChatMessage, type ChatState } from "../game/chat";
import { ChatBadge, ChatPanel, EvidenceCardView, type ChatPanelProps } from "./Chat";

const at = (s: number) => new Date(Date.UTC(2026, 10, 2, 12, 0, s)).toISOString();
const text = (id: string, from: string, to: string | null, s: number, body: string): ChatMessage => ({ id, from, to, at: at(s), text: body, verified: false });
const people = [
  { id: "p1", name: "Ana", isBot: false },
  { id: "p2", name: "Ben", isBot: false },
  { id: "p3", name: "Cyd", isBot: false },
  { id: "p4", name: "Bot · Dot", isBot: true },
];
const state = (messages: ChatMessage[], notices: { from: string; to: string; at: string }[] = []): ChatState =>
  chatReducer(EMPTY_CHAT, { type: "history", history: { messages, dmNotices: notices } });

const panel = (over: Partial<ChatPanelProps> = {}) =>
  renderToStaticMarkup(
    createElement(ChatPanel, {
      me: "p1",
      people,
      chat: state([]),
      read: {},
      onRead: () => {},
      send: async () => ({ ok: true }) as const,
      connection: "open",
      evidence: [],
      visible: true,
      ...over,
    }),
  );

describe("ChatPanel", () => {
  it("renders message text as text: HTML and markdown stay literal", () => {
    const evil = `<img src=x onerror=alert(1)> **bold** [link](javascript:alert(1)) <script>alert(2)</script>`;
    const out = panel({ chat: state([text("m1", "p2", null, 1, evil)]) });
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<strong");
    expect(out).not.toContain("<a ");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt; **bold** [link](javascript:alert(1))");
  });

  it("puts long words and newlines in a wrapping, pre-wrap text block", () => {
    const out = panel({ chat: state([text("m1", "p2", null, 1, `${"A".repeat(300)}\nline two`)]) });
    expect(out).toMatch(/class="chat-msg__text">A{300}\nline two</);
    const css = readFileSync(new URL("./chat.css", import.meta.url), "utf8");
    const rule = /\.chat-msg__text \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("white-space: pre-wrap");
    expect(rule).toContain("overflow-wrap: anywhere");
  });

  it("shows the crew tab with unread badges and a tab per DM partner", () => {
    const out = panel({
      chat: state([text("a", "p2", null, 1, "hi"), text("b", "p2", null, 2, "you there?"), text("c", "p3", "p1", 3, "psst")]),
    });
    expect(out).toContain("Crew");
    expect(out).toMatch(/Crew<\/span><span class="chat-badge num" aria-hidden="true">2<\/span>/);
    expect(out).toContain(">Cyd</span>");
    expect(out).toContain("(direct message), 1 unread");
  });

  it("shows others' DMs as notices in the crew feed (design §12.1)", () => {
    const out = panel({ chat: state([], [{ from: "p2", to: "p3", at: at(1) }]) });
    expect(out).toContain("Ben is DMing Cyd");
  });

  it("says when it's reconnecting and doesn't let you send", () => {
    const out = panel({ connection: "reconnecting" });
    expect(out).toContain("Connection lost. Trying again");
    expect(out).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("has a close button only as a sheet", () => {
    expect(panel()).not.toContain('aria-label="Close chat"');
    expect(panel({ onClose: () => {} })).toContain('aria-label="Close chat"');
  });
});

describe("EvidenceCardView (design §12.1)", () => {
  const card = { type: "roomSighting", payload: { player: "p2", round: 1, room: "vault", others: ["p3"] } };
  const ctx = { me: "p1", name: (p: string) => people.find((x) => x.id === p)?.name ?? p };

  it("is marked verified and warns that cameras can be tampered with", () => {
    const out = renderToStaticMarkup(createElement(EvidenceCardView, { card, from: "p2", ctx, seed: "t" }));
    expect(out).toContain("Verified case file");
    expect(out).toContain("The app really showed this to Ben. Cameras can be tampered with.");
    expect(out).toContain("Ben");
    expect(out).toContain("Vault");
  });

  it("renders inside a chat message, and typed text never does", () => {
    const shared: ChatMessage = { id: "e1", from: "p2", to: null, at: at(1), verified: true, card };
    const out = panel({ chat: state([shared, text("t1", "p3", null, 2, "Verified case file: trust me")]) });
    expect(out.match(/class="sk-frame evidence"/g)).toHaveLength(1);
  });
});

describe("ChatBadge", () => {
  it("shows nothing at zero and caps at 99+", () => {
    expect(renderToStaticMarkup(createElement(ChatBadge, { count: 0 }))).toBe("");
    expect(renderToStaticMarkup(createElement(ChatBadge, { count: 140 }))).toContain("99+");
  });
});

describe("chat sources", () => {
  it("never inject HTML and use theme tokens only (UI rules)", () => {
    for (const f of ["./Chat.tsx", "./chat.css", "../screens/GameChat.tsx", "../game/chat.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
      expect(src.replace(/^\s*(\/\/|\/?\*).*$/gm, ""), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
  });
});
