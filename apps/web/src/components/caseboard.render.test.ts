// Render checks for the case board shell. design §15.4, §15.6
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_LEADS } from "../game/caseBoard";
import { FIXTURE } from "../game/caseBoard.fixture";
import type { PinsChannel } from "../game/notes";
import { CaseBoard } from "./CaseBoard";

const people = [
  { id: "p2", name: "Ben", look: 1, isBot: false },
  { id: "p3", name: "Cy", look: 2, isBot: false },
];
const pins = (ids: string[], ready = true): PinsChannel => ({ pins: new Set(ids), ready, error: null, toggle: () => {} });
const html = (data = FIXTURE, p = pins([])) => renderToStaticMarkup(createElement(CaseBoard, { data, people, pins: p, marks: { p2: { tag: "suspicious", note: "" } } }));

describe("the case board shell (design §15.4)", () => {
  it("shows the suspect with the adapter's one-line reason, and nobody when there is none", () => {
    expect(html()).toContain("Said Security in R4; you saw him in the Vault.");
    const none = html(NO_LEADS);
    expect(none).toContain("Nobody yet.");
    expect(none).toContain("Nothing yet.");
  });

  it("lists leads newest first with ⚠ and bell icons, facts folded away until tapped", () => {
    const out = html();
    expect(out.indexOf("Vault")).toBeLessThan(out.indexOf("Lobby"));
    expect(out).toContain('aria-label="Doesn&#x27;t add up"');
    expect(out).toContain('aria-label="Bell rang"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("The bell rang 3 times.");
  });

  it("has a Pinned group only with pins, shows a pinned fact with its lead, and marks pin buttons", () => {
    expect(html()).not.toContain('aria-label="Pinned"');
    const out = html(FIXTURE, pins(["fact:r4.vault.saw", "lead:r3.crew"]));
    expect(out).toContain('role="group" aria-label="Pinned"');
    expect(out).toContain("You saw Ben here.");
    expect(out).toContain('aria-label="Unpin: The crew"');
    expect(out).toContain('aria-label="Pin: Vault"');
    expect(out).toContain("Only you");
  });

  it("holds pins back until they have loaded", () => {
    expect(html(FIXTURE, pins([], false))).toMatch(/class="cb__pin"[^>]*disabled/);
  });

  it("draws the Players strip with ⚠ and pin counts and your tag", () => {
    const out = html(FIXTURE, pins(["lead:r4.vault"]));
    expect(out).toContain('aria-label="Ben, 1 warnings, 1 pins"');
    expect(out).toContain('aria-label="Cy, 0 warnings, 1 pins"');
    expect(out).toContain("sus-mark--suspicious");
  });

  it("carries the InfoTips for Leads, Pins and Suspect, and never injects HTML", () => {
    const out = html(FIXTURE, pins(["lead:r4.vault"]));
    expect((out.match(/class="infotip/g) ?? []).length).toBeGreaterThanOrEqual(3);
    for (const f of ["./CaseBoard.tsx", "./caseboard.css", "../game/caseBoard.ts", "../game/caseBoard.fixture.ts"]) {
      expect(readFileSync(new URL(f, import.meta.url), "utf8"), f).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    }
  });
});
