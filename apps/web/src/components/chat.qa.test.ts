// QA for PR #38 (M2-8b chat UI): hostile text and names render inertly
// (HTML, markdown, RTL/bidi, zero-width, 500-char unbroken strings), evidence
// cards with hostile payloads, and a third player's panel holds no DM. design §12.1
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chatReducer, EMPTY_CHAT, type ChatMessage, type ChatState, type DmNotice } from "../game/chat";
import { ChatPanel, EvidenceCardView, type ChatPanelProps, type ChatPerson } from "./Chat";

const at = (s: number) => new Date(Date.UTC(2026, 10, 2, 12, 0, s)).toISOString();
const text = (id: string, from: string, to: string | null, s: number, body: string): ChatMessage => ({ id, from, to, at: at(s), text: body, verified: false });
const state = (messages: ChatMessage[], notices: DmNotice[] = []): ChatState => chatReducer(EMPTY_CHAT, { type: "history", history: { messages, dmNotices: notices } });

const HOSTILE_NAME = `<img src=x onerror=alert(1)>`;
const people: ChatPerson[] = [
  { id: "p1", name: "Ana", isBot: false },
  { id: "p2", name: HOSTILE_NAME, isBot: false },
  { id: "p3", name: "\u202eesreveR", isBot: false },
  { id: "p4", name: "עמית", isBot: false },
  { id: "p5", name: "DotB", isBot: true },
];
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
      drafts: {},
      onDraft: () => {},
      ...over,
    }),
  );
/** Every element tag in the markup. */
const tags = (html: string) => new Set([...html.matchAll(/<([a-z][a-z0-9-]*)/g)].map((m) => m[1]!));
/** Event-handler attributes on any element (quoted values blanked first, so escaped text in a label doesn't count). */
const eventAttrs = (html: string) => [...html.replace(/"[^"]*"/g, '""').matchAll(/<[^>]+>/g)].flatMap((m) => m[0].match(/\son[a-z]+=/gi) ?? []);
const SAFE_TAGS = new Set(["section", "div", "h2", "span", "svg", "path", "g", "defs", "filter", "fe-turbulence", "feturbulence", "fedisplacementmap", "rect", "circle", "button", "p", "ol", "li", "time", "form", "label", "textarea", "polyline", "line", "ellipse", "pattern", "clippath", "mask", "use", "lineargradient", "stop", "polygon", "ul"]);

describe("QA: hostile message text renders as inert text (design §12.1)", () => {
  const evil = [
    `<img src=x onerror=alert(1)>`,
    `<svg onload=alert(1)>`,
    `"><script>alert(1)</script>`,
    `<a href="javascript:alert(1)">x</a>`,
    `<iframe srcdoc="<script>alert(1)</script>">`,
    `**bold** _it_ # heading [link](javascript:alert(1)) ![img](x)`,
    "`code` ```fence```",
    `&lt;already escaped&gt; &amp;`,
    `{{constructor.constructor('alert(1)')()}}`,
  ];

  it.each(evil)("%s", (body) => {
    const out = panel({ chat: state([text("m1", "p2", null, 1, body)]) });
    for (const tag of tags(out)) expect(SAFE_TAGS.has(tag.toLowerCase()), `unexpected <${tag}>`).toBe(true);
    expect(eventAttrs(out)).toEqual([]);
    expect(out).not.toMatch(/href="javascript:/i);
    // The text round-trips exactly: unescape the rendered text node and compare.
    const node = /class="chat-msg__text">([^<]*)</.exec(out)?.[1] ?? "";
    expect(node.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&")).toBe(body);
  });

  it("RTL, bidi overrides and zero-width characters are kept as typed, inside the message's own block", () => {
    const body = "שלום \u202eevil\u202c مرحبا a\u200bb\u200d\u2060 \u200f!";
    const out = panel({ chat: state([text("m1", "p2", null, 1, body), text("m2", "p4", null, 2, "after")]) });
    expect(out).toContain(`class="chat-msg__text">${body}</p>`);
    // The next message is its own list item, so an unclosed override can't run into it.
    expect(out).toMatch(/<\/p><\/div><\/li><li class="chat-msg"/);
  });

  it("a 500-character unbroken string is one wrapping text node", () => {
    const body = "W".repeat(500);
    const out = panel({ chat: state([text("m1", "p2", null, 1, body)]) });
    expect(out).toContain(`class="chat-msg__text">${body}</p>`);
  });
});

describe("QA: hostile nicknames render inertly everywhere they appear", () => {
  const chat = state([text("m1", "p2", null, 1, "hi"), text("d1", "p2", "p1", 2, "psst")], [{ from: "p2", to: "p3", at: at(3) }]);
  const out = panel({ chat });

  it("in the message name, DM tab, notice and avatar", () => {
    for (const tag of tags(out)) expect(SAFE_TAGS.has(tag.toLowerCase()), `unexpected <${tag}>`).toBe(true);
    expect(eventAttrs(out)).toEqual([]);
    expect(out).toContain('class="chat-msg__name">&lt;img src=x onerror=alert(1)&gt;</span>');
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt; is DMing \u202eesreveR");
    expect(out).toContain('aria-label="&lt;img src=x onerror=alert(1)&gt;"');
  });

  it("the DM tab label is the escaped name, and the bot gets no tab", () => {
    expect(out).toMatch(/class="chat__ellipsis">&lt;img src=x onerror=alert\(1\)&gt;<\/span>/);
    expect(out).not.toContain("Dot</span>");
  });
});

describe("QA: a third player's panel has no DM (design §12.1)", () => {
  it("p3 sees the crew message and the notice only; no DM tab, no DM text anywhere in the markup", () => {
    // What the server sends p3: crew chat and notices, never the p1↔p2 DM.
    const chat = state([text("c1", "p1", null, 1, "crew line")], [{ from: "p1", to: "p2", at: at(2) }, { from: "p2", to: "p1", at: at(3) }]);
    const out = panel({ me: "p3", chat });
    expect(out).toContain("crew line");
    expect(out).toContain("Ana and &lt;img src=x onerror=alert(1)&gt; are DMing");
    expect(out).not.toContain("(direct message)");
  });
});

describe("QA: evidence cards with hostile payloads (design §12.1)", () => {
  const ctx = { me: "p1", name: (p: string) => people.find((x) => x.id === p)?.name ?? p };
  it("an unknown or hostile type falls back to a plain escaped line, still verified and still warning", () => {
    const out = renderToStaticMarkup(createElement(EvidenceCardView, { card: { type: "<script>alert(1)</script>", payload: { x: "<img onerror=1>" } }, from: "p2", ctx, seed: "q" }));
    expect(out).not.toContain("<script");
    expect(out).toContain("A case-file entry (&lt;script&gt;alert(1)&lt;/script&gt;).");
    expect(out).toContain("Cameras can be tampered with.");
    expect(out).toContain("The app really showed this to &lt;img src=x onerror=alert(1)&gt;.");
  });

  it("a known type with hostile strings in its payload renders them as text", () => {
    const out = renderToStaticMarkup(
      createElement(EvidenceCardView, { card: { type: "roomSighting", payload: { player: "p2", round: 1, room: "<img src=x onerror=alert(1)>", others: ["p3"] } }, from: "p2", ctx, seed: "q" }),
    );
    for (const tag of tags(out)) expect(SAFE_TAGS.has(tag.toLowerCase()), `unexpected <${tag}>`).toBe(true);
    expect(eventAttrs(out)).toEqual([]);
  });

  it("a card whose payload tries to override its type or visibility is read by its own type", () => {
    const out = renderToStaticMarkup(
      createElement(EvidenceCardView, { card: { type: "nopeType", payload: { type: "roomSighting", visibility: { kind: "public" } } }, from: "p2", ctx, seed: "q" }),
    );
    expect(out).toContain("A case-file entry (nopeType).");
  });
});
