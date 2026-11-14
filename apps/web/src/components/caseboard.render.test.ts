// Render checks for the case board shell. design §15.4, §15.6
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LEAD_KIND_NAMES, NO_LEADS, type Lead, type LeadKind } from "../game/caseBoard";
import { FIXTURE } from "../game/caseBoard.fixture";
import type { BoardChannel, PinsChannel } from "../game/notes";
import { CaseBoard, LeadBlob } from "./CaseBoard";

const people = [
  { id: "p2", name: "Ben", look: 1, isBot: false },
  { id: "p3", name: "Cy", look: 2, isBot: false },
];
const pins = (ids: string[], ready = true): PinsChannel => ({ pins: new Set(ids), ready, error: null, toggle: () => {} });
const board: BoardChannel = { board: { p2: "Said Lobby, saw them in the Vault" }, error: null, save: async () => null };
const html = (data = FIXTURE, p = pins([])) => renderToStaticMarkup(createElement(CaseBoard, { data, people, pins: p, board }));

describe("the case board shell (design §15.4)", () => {
  it("shows the suspect with the adapter's one-line reason, and nobody when there is none", () => {
    expect(html()).toContain("Said Security in R4; you saw him in the Vault.");
    const none = html(NO_LEADS);
    expect(none).toContain("Nobody yet.");
    expect(none).toContain("Nothing yet.");
  });

  it("lists leads newest first with ⚠ and bell icons, facts folded away until tapped", () => {
    const out = html({ ...FIXTURE, played: 0 }); // nothing picked: every round
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

  it("draws the Players strip with ⚠ and pin counts only: no seat tag, and no note until a seat is tapped (§15.3, #202)", () => {
    const out = html(FIXTURE, pins(["lead:r4.vault"]));
    expect(out).toContain('aria-label="Ben, 1 warnings, 1 pins"');
    expect(out).toContain('aria-label="Cy, 0 warnings, 1 pins"');
    expect(out).not.toMatch(/sus-|Suspicious|Trusted|Unsure/);
    expect(out).not.toContain("Said Lobby");
    expect(out).not.toContain("Your note on");
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

  it("gives each lead its one-line summary under the title", () => {
    expect(html()).toContain('<span class="cb__summary">rang 3 · Ben, Cy inside</span>');
  });

  it("starts each lead with its kind's icon blob, and names the kind and round in the lead's button (#245)", () => {
    const all = (FIXTURE.leads as Lead[]).map((l) => ({ ...l, round: 1 }));
    const out = html({ ...FIXTURE, leads: all, played: 1 });
    const btns = [...out.matchAll(/<button type="button" class="cb__lead-btn"[^>]*>(.*?)<\/button>/g)].map((m) => m[1]!);
    expect(btns).toHaveLength(4);
    for (const b of btns) expect(b).toMatch(/^<span class="cb__blob" style="--lk:var\(--lead-(room|market|crew)\);--lk-l:var\(--lead-\1-l\)" aria-hidden="true"><svg/);
    expect(btns[0]).toContain("</span>Room · R1</span>");
    expect(btns[1]).toContain("</span>Black market · R1</span>");
    expect(btns[2]).toContain("</span>The crew · R1</span>");
  });

  it("has a name and an icon for every lead kind, and colour tokens for each (#245)", () => {
    expect(Object.keys(LEAD_KIND_NAMES).sort()).toEqual(["crew", "end", "market", "meeting", "missing", "room", "round", "wanted"]);
    const theme = readFileSync(new URL("../theme.css", import.meta.url), "utf8");
    for (const k of Object.keys(LEAD_KIND_NAMES)) {
      expect(theme).toMatch(new RegExp(`--lead-${k}: #[0-9a-f]{6};`));
      expect(theme).toMatch(new RegExp(`--lead-${k}-l: #[0-9a-f]{6};`));
      expect(renderToStaticMarkup(createElement(LeadBlob, { kind: k as LeadKind }))).toContain("<svg");
    }
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

  it("has a round picker: All, then square buttons up to the round cap, the rounds not played yet disabled, the latest picked and tagged (design §10, §15.4, #245)", () => {
    const out = html();
    expect(out).toContain('role="group" aria-label="Round"');
    expect(out).toContain("Round:");
    expect(out).toContain('<button type="button" class="cb__rbtn cb__all" aria-pressed="false">All</button>');
    const btns = [...out.matchAll(/<button type="button" class="cb__rbtn num"([^>]*)>(\d+)(<span class="cb__latest"> latest<\/span>)?<\/button>/g)];
    expect(btns.map((m) => m[2])).toEqual(Array.from({ length: 12 }, (_, i) => `${i + 1}`));
    expect(btns.map((m) => m[1]!.includes("disabled"))).toEqual(Array.from({ length: 12 }, (_, i) => i >= 4));
    expect(btns.map((m) => m[1]!.includes('aria-pressed="true"'))).toEqual(Array.from({ length: 12 }, (_, i) => i === 3));
    expect(btns.map((m) => !!m[3])).toEqual(Array.from({ length: 12 }, (_, i) => i === 3));
    // Opened on round 4: only its leads.
    expect(out).toContain("Vault");
    expect(out).not.toContain("Lobby");
    // No round played: nothing picked, no latest tag.
    const none = html(NO_LEADS);
    expect(none).not.toContain('aria-pressed="true"');
    expect(none).not.toContain("cb__latest");
    const css = readFileSync(new URL("./caseboard.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.cb__rbtn \{[^}]*width: 44px;[^}]*height: 44px;/);
    expect(css).toMatch(/\.cb__rbtn\[aria-pressed="true"\] \{[^}]*background: var\(--gold\);/);
    expect(css).toMatch(/\.cb__rbtn:disabled \{[^}]*border-style: dashed;/);
    // One row: the rounds scroll sideways and never wrap; smooth scrolling only without reduced motion.
    expect(css).toMatch(/\.cb__rounds \{[^}]*overflow-x: auto;[^}]*mask-image: var\(--edge-fade\);/);
    expect(css).not.toMatch(/\.cb__picker \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/prefers-reduced-motion: no-preference\) \{[^@]*\.cb__rounds \{\s*scroll-behavior: smooth;/);
  });

  it("labels your own trust marks \"Your mark\" and a no-alibi fact as a Fact (design §10)", () => {
    const out = renderToStaticMarkup(createElement(CaseBoard, { data: FIXTURE, people, pins: pins(["fact:r4.vault.mark", "fact:r4.vault.noalibi"]), board }));
    expect(out).toContain('<span class="cb__trust">Your mark</span> You trust Cy&#x27;s alibi: the Vault, round 4');
    expect(out).toContain('<span class="cb__trust">Fact</span> Dot had no alibi: in the Vault, round 4');
  });

  it("keeps ids unique when two boards are drawn, and a lead's repeated warning kind doesn't repeat a key", () => {
    const two = renderToStaticMarkup(createElement("div", null, createElement(CaseBoard, { data: FIXTURE, people, pins: pins([]), board }), createElement(CaseBoard, { data: FIXTURE, people, pins: pins([]), board })));
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
