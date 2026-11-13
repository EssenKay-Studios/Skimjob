// Render checks for the plan board. design §10, §15.6
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanSnapshot } from "@skimjob/engine";
import { PlanBoard, type PlanBoardProps } from "./PlanBoard";

const seats = [
  { id: "p1", name: "Sam", isBot: false, you: true, look: 0 },
  { id: "p2", name: "Ava", isBot: false, you: false, look: 1 },
  { id: "p3", name: "Eli", isBot: true, you: false, look: 2 },
];
const rooms = [
  { id: "office", name: "Office", closed: null },
  { id: "vault", name: "Vault", closed: null },
  { id: "depositBoxes", name: "Deposit boxes", closed: "Taped off" },
];
const board = {
  round: 2,
  entries: [
    { player: "p3", placed: "office", room: "office", power: null, agreed: true },
    { player: "p1", placed: null, room: "vault", power: { role: "detective", target: "p2" }, agreed: false },
  ],
};
const plan: PlanSnapshot = {
  entries: [{ player: "p2", placed: "vault", room: "vault", power: { role: "hacker", target: "vault" }, agreed: true }],
  history: [
    { actor: "p2", kind: "room", subject: "p2", value: "vault", target: null, msBeforeDeadline: 60_000 },
    { actor: "p3", kind: "room", subject: "p3", value: "office", target: null, msBeforeDeadline: null },
    { actor: "p2", kind: "agree", subject: "p2", value: "true", target: null, msBeforeDeadline: 3_600_000 },
  ],
};
const html = (p: Partial<PlanBoardProps> = {}) =>
  renderToStaticMarkup(createElement(PlanBoard, { seats, rooms, board, onEdit: async () => {}, last: null, ...p }));

describe("the plan board (design §10)", () => {
  it("lists the ledger in seat order with a door for a room claim and a bolt for a pledge", () => {
    const out = html();
    expect(out.indexOf("Sam: Vault, Detective on Ava")).toBeLessThan(out.indexOf("Ava: no claims"));
    expect(out.indexOf("Ava: no claims")).toBeLessThan(out.indexOf("Eli: Office"));
    expect(out).toContain("Detective → Ava");
  });

  it("counts the agreed over every seat, bots too", () => {
    expect(html()).toContain("1 of 3 agreed");
  });

  it("closes a taped-off room and marks your own room claim", () => {
    const out = html();
    expect(out).toMatch(/disabled=""[^>]*aria-label="Deposit boxes, closed"|aria-label="Deposit boxes, closed"[^>]*disabled=""/);
    expect(out).toContain("Vault: your spot, tap to drop it");
  });

  it("with no live board says so, and shows only the last snapshot", () => {
    const out = html({ board: null, last: { round: 1, plan } });
    expect(out).toContain("The board opens with the next round.");
    expect(out).toContain("Round 1 plan");
    expect(out).not.toContain("Claim a power");
  });

  it("orders a snapshot's history by time left, a bot's edit first, and never shows a wall time (design §10)", () => {
    const out = html({ board: null, last: { round: 1, plan } });
    const bot = out.indexOf("Eli claimed the Office");
    const hour = out.indexOf("Ava agreed");
    const minute = out.indexOf("Ava claimed the Vault");
    expect(bot).toBeGreaterThan(-1);
    expect(bot).toBeLessThan(hour);
    expect(hour).toBeLessThan(minute);
    expect(out).toContain("1 h 0 min before the deadline");
    expect(out).not.toMatch(/\d{1,2}:\d{2}|\bago\b/);
  });
});

describe("heads (design §10)", () => {
  it("draw the tag they are given, so bots sharing a prefix tell apart", () => {
    const bots = [
      { id: "p1", name: "Sam", isBot: false, you: true, look: 0, tag: "Sa" },
      { id: "p2", name: "Bot · Riya", isBot: true, you: false, look: 1, tag: "Ri" },
      { id: "p3", name: "Bot · Max", isBot: true, you: false, look: 2, tag: "Ma" },
    ];
    const out = html({ seats: bots });
    expect(out).toContain(">Ri<");
    expect(out).toContain(">Ma<");
    expect(out).not.toContain(">B·<");
  });
});

describe("plan board styles", () => {
  const code = readFileSync(new URL("./planboard.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("use theme.css tokens only", () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    for (const m of code.matchAll(/(border-radius|box-shadow):\s*([^;]+);/g)) expect(m[2], m[0]).toMatch(/^(var\(--[\w-]+\)|0|none)$/);
    for (const m of code.matchAll(/font:\s*([^;]+);/g)) expect(m[1], m[0]).toContain("var(--font-");
  });

  it("keep heads, rooms and ledger lines 44 px", () => {
    for (const sel of ["plan__room-btn", "plan__head-btn", "plan__line", "plan__snap summary"]) expect(code, sel).toMatch(new RegExp(`\\.${sel}\\s*\\{[^}]*(min-height|line-height): 44px`));
  });
});
