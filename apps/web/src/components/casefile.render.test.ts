// Render checks for M2-10: the ledger / case file sheet, the "While you were
// away" recap and the suspicion board. Lists keep the names the game screen's
// E2E reads; private rows carry the lock; nothing shows another player's hidden
// entries; theme tokens only. design §12.3, §13
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, handleCommand, viewFor, type GameConfig, type GameState, type PlayerCommand, type SystemCommand } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { describeEvent } from "../game/describeEvent";
import { namesOf } from "../game/hud";
import { AwayRecap } from "./AwayRecap";
import { CaseFile } from "./CaseFile";
import { SuspicionBoard, SuspicionMark } from "./SuspicionBoard";

const config: GameConfig = {
  seed: "casefile-render",
  players: ["Ana", "Ben", "Cy"].map((name, i) => ({ id: `p${i + 1}`, name, isBot: false })),
  job: "bank",
  rolePool: ["rookie"],
  mole: "off",
  eventsEnabled: false,
  voteVisibility: "hiddenThenRevealed",
  starterMode: true,
  uniqueRoles: false,
};
function run(state: GameState, ...commands: (PlayerCommand | SystemCommand)[]): GameState {
  for (const c of commands) {
    const r = handleCommand(state, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    state = r.state;
  }
  return state;
}
const game = run(
  createGame(config),
  { type: "submitMove", player: "p1", move: { room: "office", pocket: 0 } },
  { type: "submitMove", player: "p2", move: { room: "vault", pocket: 3 } },
  { type: "submitMove", player: "p3", move: { room: "lobby", pocket: 0 } },
  { type: "advance", deadline: { kind: "round", round: 1 } },
);
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("the case file sheet (design §13)", () => {
  const view = viewFor(game, "p1");
  const ctx = { me: "p1", name: namesOf(view) };

  it("opens on the ledger, as a list named Ledger, grouped under round cards", () => {
    const out = html(createElement(CaseFile, { view, ctx }));
    expect(out).toContain('role="list" aria-label="Ledger"');
    expect(out).toContain("Round 1 · Act 1");
    expect(out).toContain("Before the job");
    expect(out).toMatch(/aria-pressed="true"[^>]*>.*Ledger/);
    expect(out).not.toContain("is-private");
  });

  it("shows private rows with the lock and highlighter in the case file and in Both", () => {
    for (const source of ["case", "all"] as const) {
      const out = html(createElement(CaseFile, { view, ctx, initial: { source, act: null, round: null } }));
      expect(out).toContain('class="records__row is-private"');
      expect(out).toContain('aria-label="Only you"');
      expect(out).toContain("You picked the Office for round 1");
    }
    expect(html(createElement(CaseFile, { view, ctx, initial: { source: "case", act: null, round: null } }))).toContain('aria-label="Case file"');
  });

  it("never shows another player's private entries, in any tab", () => {
    const theirs = game.log.filter((e) => e.visibility.kind !== "public" && "player" in e.visibility && e.visibility.player !== "p1");
    expect(theirs.length).toBeGreaterThan(0);
    const out = (["ledger", "case", "all"] as const).map((source) => html(createElement(CaseFile, { view, ctx, initial: { source, act: null, round: null } }))).join("\n");
    for (const e of theirs) expect(out).not.toContain(describeEvent(e, ctx).replace(/'/g, "&#x27;"));
    expect(out).not.toMatch(/Ben (picked|found)|Vault: Ben/);
  });

  it("filters to a round and says so when a filter is empty", () => {
    const out = html(createElement(CaseFile, { view, ctx, initial: { source: "ledger", act: 3, round: null } }));
    expect(out).toContain("Nothing here for this filter.");
  });
});

describe("the recap and the board", () => {
  it("draws nothing without lines, and the narrator and every line with them", () => {
    expect(html(createElement(AwayRecap, { lines: [], onDismiss: () => {} }))).toBe("");
    const out = html(createElement(AwayRecap, { lines: ["Round 1 done: Haul +3 (now 3), Heat +4 (now 4).", "Now: round 2."], onDismiss: () => {} }));
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

  it("take radii and shadows from theme.css tokens (review, PR #46)", () => {
    const css = readFileSync(new URL("./casefile.css", import.meta.url), "utf8");
    for (const m of css.matchAll(/(border-radius|box-shadow):\s*([^;]+);/g)) expect(m[2], m[0]).toMatch(/^(var\(--[\w-]+\)|0|none)$/);
  });

  it("use theme tokens only and never inject HTML (UI rules)", () => {
    for (const f of ["./CaseFile.tsx", "./AwayRecap.tsx", "./SuspicionBoard.tsx", "./casefile.css", "../art/Raccoon.tsx", "../game/away.ts", "../game/records.ts", "../game/notes.ts", "../screens/GalleryNotes.tsx"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
      expect(src.replace(/^\s*(\/\/|\/?\*).*$/gm, ""), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
  });
});
