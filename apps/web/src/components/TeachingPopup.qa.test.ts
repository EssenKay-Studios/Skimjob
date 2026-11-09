// QA for S4.6 (design §15.6, §20.6): the pop-up's prose comes from content and matches the spec table,
// nothing is due with Tips off or once seen, and the "last two rounds" window holds at its edges.
import { readFileSync } from "node:fs";
import { LESSONS, TERMS, TIPS, type LessonId } from "@skimjob/content";
import type { PlayerView } from "@skimjob/engine";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dueLesson, happened } from "../game/teaching";
import { TeachingPopup } from "./TeachingPopup";

type Ev = Record<string, unknown> & { type: string };
const view = (events: Ev[], extra: Record<string, unknown> = {}): PlayerView =>
  ({ round: 5, wanted: 0, phase: { kind: "planning" }, ...extra, ledger: events.map((event, seq) => ({ seq, event })) }) as unknown as PlayerView;
const resolved = (round: number): Ev => ({ type: "roundResolved", round, missing: 0 });
const raid = (round: number): Ev => ({ type: "roomRaided", round, room: "vault" });
const everything: Ev[] = [raid(4), { type: "shakedownResolved" }, { type: "powerCut", round: 4, room: "vault" }, { ...resolved(4), missing: 1 }, { type: "bellsRung", round: 4, bells: { vault: 1 }, hidden: [] }];
const ALL = Object.keys(LESSONS) as LessonId[];

describe("the text comes from content — design §20.6", () => {
  // The §20.6 table, with "The X line of §20.5" read as that content line.
  const table = readFileSync(new URL("../../../../docs/design.md", import.meta.url), "utf8").split("### 20.6")[1]!.split("\n---")[0]!;
  const rows = table.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Pop-up") && !l.startsWith("|---"));
  const lineOf: Record<string, string> = { "The Shakedown line of §20.5.": TERMS.shakedown.text, "The Missing line of §20.5.": TIPS.missing.text, "The Bell line of §20.5.": TIPS.bell.text };

  it("has one lesson per table row, with the same words", () => {
    expect(rows).toHaveLength(ALL.length);
    for (const row of rows) {
      const [title, happenedText, means, canDo] = row.split("|").slice(1, 5).map((c) => c.trim());
      const lesson = Object.values(LESSONS).find((l) => l.title.toLowerCase() === title!.toLowerCase());
      expect(lesson, title).toBeDefined();
      expect(lesson!.happened, title).toBe(happenedText);
      expect(lesson!.means, title).toBe(lineOf[means!] ?? means);
      expect(lesson!.canDo, title).toBe(canDo);
    }
  });

  it("renders exactly the content strings plus the fixed labels, for every lesson", () => {
    const labels = ["Tip", "What just happened", "What it means", "What you can do", "Got it", "Turn tips off"];
    for (const id of ALL) {
      const html = renderToStaticMarkup(createElement(TeachingPopup, { lesson: id, busy: false, onGotIt: () => {}, onTipsOff: () => {} }));
      const texts = [...html.matchAll(/>([^<>]+)</g)].map((m) => m[1]!.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim()).filter(Boolean);
      const l = LESSONS[id];
      expect(texts).toEqual(expect.arrayContaining([l.title, l.happened, l.means, l.canDo, "Got it"]));
      for (const t of texts) expect([...labels, l.title, l.happened, l.means, l.canDo], `${id}: "${t}"`).toContain(t);
    }
  });
});

describe("when a lesson is due — design §15.6, §20.6", () => {
  it("never with Tips off, whatever happened and whatever the phase", () => {
    for (const kind of ["planning", "result", "meeting", "ended"]) expect(dueLesson(view(everything, { wanted: 2, phase: { kind } }), new Set(), false)).toBeNull();
  });

  it("never once every lesson is seen", () => {
    expect(dueLesson(view(everything, { wanted: 2 }), new Set(ALL), true)).toBeNull();
  });

  it("each lesson exactly once when the queue is walked, never a repeat", () => {
    const v = view(everything, { wanted: 2 });
    const seen = new Set<string>();
    const shown: string[] = [];
    for (let l = dueLesson(v, seen, true); l && shown.length < 20; l = dueLesson(v, seen, true)) {
      shown.push(l);
      seen.add(l);
    }
    expect(shown).toEqual(["raid", "oneStar", "shakedown", "powerCut", "missing", "bell"]);
  });

  it("in round 1 and 2 (no round 3 back to cut at) every event counts", () => {
    expect(happened(view([raid(1), resolved(1)], { round: 2 })).has("raid")).toBe(true);
  });

  it("the window edge: an event in round N-3 is out, in N-2 is in", () => {
    expect(happened(view([resolved(2), raid(3), resolved(3), resolved(4), resolved(5)], { round: 6 })).has("raid")).toBe(false);
    expect(happened(view([resolved(2), resolved(3), raid(4), resolved(4), resolved(5)], { round: 6 })).has("raid")).toBe(true);
  });

  it("a stale seen entry for an unknown lesson does not block the real ones", () => {
    expect(dueLesson(view([raid(4)]), new Set(["nope"]), true)).toBe("raid");
  });
});
