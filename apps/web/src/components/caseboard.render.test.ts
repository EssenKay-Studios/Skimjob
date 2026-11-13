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

  it("heads the suspect card 'Most likely liar' with its basis: all leads, or the pins once there are 2 or more (§15.4)", () => {
    expect(html()).toContain("Most likely liar · from all leads");
    expect(html(FIXTURE, pins(["lead:r4.vault"]))).toContain("Most likely liar · from all leads");
    expect(html(FIXTURE, pins(["lead:r4.vault", "fact:r4.vault.saw", "lead:r3.crew"]))).toContain("Most likely liar · from 3 pins");
    expect(html(NO_LEADS)).toContain("Nobody yet.");
  });

  it("gives each lead its one-line summary under the title, and the round in a chip", () => {
    const out = html();
    expect(out).toContain('<span class="cb__summary">rang 3 · Ben, Cy inside</span>');
    expect(out).toContain('<span class="cb__round">R4</span>');
  });

  it("shows ⚠ and pin counts on a player chip only above zero, and the whole name", () => {
    const out = html(FIXTURE, pins([]));
    expect(out).toContain('aria-label="Cy, 0 warnings, 0 pins"');
    expect(out.match(/class="cb__counts"/g)).toHaveLength(1); // Ben's ⚠ only
    expect(out).toContain('<span class="cb__pname">Ben</span>');
  });

  it("draws a pinned pin differently from an unpinned one (shape, not colour alone), and tints the Pinned rows", () => {
    const on = html(FIXTURE, pins(["lead:r4.market"]));
    const marked = on.match(/aria-label="Unpin: Black market"[^>]*>(.*?)<\/button>/)![1]!;
    const bare = on.match(/aria-label="Pin: Vault"[^>]*>(.*?)<\/button>/)![1]!;
    expect(marked).toContain('fill="var(--clay)"');
    expect(marked).toContain("M8.2 7.2");
    expect(bare).not.toContain("var(--clay)");
    expect(bare).not.toContain("M8.2 7.2");
    expect(on).toContain('aria-pressed="true"');
  });

  it("has a round picker: square buttons up to the round cap, the rounds not played yet disabled, none picked at first (design §10, §15.4)", () => {
    const out = html();
    expect(out).toContain('role="group" aria-label="Round"');
    expect(out).toContain("Round:");
    const btns = [...out.matchAll(/<button type="button" class="cb__rbtn num"([^>]*)>(\d+)<\/button>/g)];
    expect(btns.map((m) => m[2])).toEqual(Array.from({ length: 12 }, (_, i) => `${i + 1}`));
    expect(btns.map((m) => m[1]!.includes("disabled"))).toEqual(Array.from({ length: 12 }, (_, i) => i >= 4));
    expect(out).not.toContain('class="cb__rbtn num" aria-pressed="true"');
    const css = readFileSync(new URL("./caseboard.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.cb__rbtn \{[^}]*width: 44px;[^}]*height: 44px;/);
    expect(css).toMatch(/\.cb__rbtn\[aria-pressed="true"\] \{[^}]*background: var\(--gold\);/);
    expect(css).toMatch(/\.cb__rbtn:disabled \{[^}]*border-style: dashed;/);
  });

  it("labels your own trust marks \"Your mark\" and a no-alibi fact as a Fact (design §10)", () => {
    const out = renderToStaticMarkup(createElement(CaseBoard, { data: FIXTURE, people, pins: pins(["fact:r4.vault.mark", "fact:r4.vault.noalibi"]), marks: null }));
    expect(out).toContain('<span class="cb__trust">Your mark</span> You trust Cy&#x27;s alibi: the Vault, round 4');
    expect(out).toContain('<span class="cb__trust">Fact</span> Dot had no alibi: in the Vault, round 4');
  });

  it("keeps ids unique when two boards are drawn, and a lead's repeated warning kind doesn't repeat a key", () => {
    const two = renderToStaticMarkup(createElement("div", null, createElement(CaseBoard, { data: FIXTURE, people, pins: pins([]), marks: null }), createElement(CaseBoard, { data: FIXTURE, people, pins: pins([]), marks: null })));
    const ids = [...two.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]!);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the board's place and look (design §15.6, ui-style)", () => {
  const css = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  it("is the game shell's Case panel, with no grid area of its own", () => {
    expect(css("../screens/Game.tsx")).toMatch(/id: "case"[^\n]*<CaseBoard /);
    expect(css("../screens/game.css")).not.toContain(".records");
  });
  it("sits on manila with punch holes, and the players strip is one row that scrolls", () => {
    expect(css("./CaseBoard.tsx")).toContain('fill="var(--manilla)"');
    expect(css("./CaseBoard.tsx")).toMatch(/holes/);
    const cb = css("./caseboard.css");
    expect(cb).toMatch(/\.cb__players \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/);
    expect(cb).not.toMatch(/\.cb__pname \{[^}]*overflow-wrap/);
  });
});
