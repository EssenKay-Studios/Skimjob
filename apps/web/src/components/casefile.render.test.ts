// Render checks for M2-10: the "While you were away" recap and the suspicion
// board. design §12.3, §13
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AwayRecap } from "./AwayRecap";
import { SuspicionBoard, SuspicionMark } from "./SuspicionBoard";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("the recap and the board", () => {
  it("draws nothing without lines, and the narrator and every line with them", () => {
    expect(html(createElement(AwayRecap, { lines: [], onDismiss: () => {} }))).toBe("");
    const out = html(createElement(AwayRecap, { lines: ["Round 1 done: 3 taken, 0 went missing, 61 coins left in the bank.", "Now: round 2."], onDismiss: () => {} }));
    expect(out).toContain("While you were away");
    expect(out).toContain('role="img" aria-label="The crew&#x27;s raccoon lookout"');
    expect(out.match(/class="away__line"/g)).toHaveLength(2);
    expect(out).toContain("Caught up");
  });

  it("shows each person with three tags, the chosen one pressed, and notes as plain text", () => {
    const out = html(
      createElement(SuspicionBoard, {
        people: [
          { id: "p2", name: "Ben", look: 1, isBot: false },
          { id: "p3", name: "Cy", look: 2, isBot: false },
        ],
        board: { p2: { tag: "suspicious", note: "<b>liar</b>" } },
        onSave: async () => null,
      }),
    );
    expect(out).toContain("Only you see this");
    expect(out.match(/sus-tag sus-tag--/g)).toHaveLength(6);
    expect(out).toMatch(/is-on sus-tag sus-tag--suspicious" aria-pressed="true"/);
    expect(out).toContain("&lt;b&gt;liar&lt;/b&gt;");
    expect(html(createElement(SuspicionMark, { tag: null }))).toBe("");
  });

  it("never inject HTML (UI rules)", () => {
    for (const f of ["./AwayRecap.tsx", "./SuspicionBoard.tsx", "./casefile.css", "../art/Raccoon.tsx", "../game/away.ts", "../game/notes.ts", "../screens/GalleryNotes.tsx"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    }
  });
});
