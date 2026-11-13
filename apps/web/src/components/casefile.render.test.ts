// Render checks for M2-10: the "While you were away" recap. design §13
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AwayRecap } from "./AwayRecap";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("the recap", () => {
  it("draws nothing without lines, and the narrator and every line with them", () => {
    expect(html(createElement(AwayRecap, { lines: [], onDismiss: () => {} }))).toBe("");
    const out = html(createElement(AwayRecap, { lines: ["Round 1 done: 3 taken, 0 went missing, 61 coins left in the bank.", "Now: round 2."], onDismiss: () => {} }));
    expect(out).toContain("While you were away");
    expect(out).toContain('role="img" aria-label="The crew&#x27;s raccoon lookout"');
    expect(out.match(/class="away__line"/g)).toHaveLength(2);
    expect(out).toContain("Caught up");
  });

  it("never inject HTML (UI rules)", () => {
    for (const f of ["./AwayRecap.tsx", "./SeatNote.tsx", "./casefile.css", "../art/Raccoon.tsx", "../game/away.ts", "../game/notes.ts", "../screens/GalleryCase.tsx"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    }
  });
});
