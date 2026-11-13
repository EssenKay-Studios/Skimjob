// Render checks for your private note on a seat in the case board's Players
// strip. design §15.3, §15.4
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BoardChannel } from "../game/notes";
import { SeatNote } from "./SeatNote";

const ben = { id: "p2", name: "Ben" };
const channel = (board: BoardChannel["board"], error: string | null = null): BoardChannel => ({ board, error, save: async () => null });
const html = (c: BoardChannel) => renderToStaticMarkup(createElement(SeatNote, { person: ben, board: c, seed: "t" }));

describe("your note on a seat (design §15.3)", () => {
  it("is private and names the seat; shows the note as plain text with Edit note", () => {
    const out = html(channel({ p2: "<b>liar</b>" }));
    expect(out).toContain('role="group" aria-label="Your note on Ben"');
    expect(out).toContain("Only you");
    expect(out).toContain('<p class="cb__note-text">&lt;b&gt;liar&lt;/b&gt;</p>');
    expect(out).toContain("Edit note");
  });

  it("offers Add note when there is none, and draws no empty note", () => {
    const out = html(channel({ p3: "someone else" }));
    expect(out).toContain("Add note");
    expect(out).not.toContain("cb__note-text");
    expect(out).not.toContain("someone else");
  });

  it("waits while loading, and says so when the notes can't load", () => {
    expect(html(channel(null))).toContain("Opening your notes…");
    const err = html(channel(null, "Can't reach the hideout."));
    expect(err).toContain('role="alert"');
    expect(err).toContain("Couldn&#x27;t load your notes. Can&#x27;t reach the hideout.");
    expect(err).not.toContain("Add note");
  });

  it("has no seat tags anywhere (#202), and never injects HTML", () => {
    const src = readFileSync(new URL("./SeatNote.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/dangerouslySetInnerHTML|innerHTML|tag/);
  });
});
