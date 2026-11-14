// The Learn the game guide (design §14): a scripted pop-up at every step, from
// the game's ruleset (§19.2 seam 3), shown once each, only while planning.
import { ALIBI_WINDOW_MS, RULESETS } from "@skimjob/content";
import type { PlayerView } from "@skimjob/engine";
import { describe, expect, it } from "vitest";
import { dueStep, guideKey, guideOf } from "./guide";

type Ev = Record<string, unknown> & { type: string };
const view = (o: { ruleset?: string; round?: number; phase?: string; lockedIn?: boolean; events?: Ev[] } = {}): PlayerView =>
  ({
    me: { id: "p1" },
    round: o.round ?? 1,
    phase: { kind: o.phase ?? "planning", round: o.round ?? 1 },
    lockedIn: o.lockedIn ? ["p1"] : [],
    ledger: [{ type: "gameCreated", ruleset: o.ruleset ?? "learn" }, ...(o.events ?? [])].map((event, seq) => ({ seq, event })),
  }) as unknown as PlayerView;

const learn = guideOf(view());
/** The ids due one after another at this moment, as each is dismissed. */
function queue(v: PlayerView, seen: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (let step = dueStep(v, learn, seen); step; step = dueStep(v, learn, seen)) {
    out.push(step.id);
    seen.add(step.id);
  }
  return out;
}

describe("which guide step is due — design §14", () => {
  it("opens round 1 with the welcome, your role and your move, then the alibi once you lock in", () => {
    const seen = new Set<string>();
    expect(queue(view(), seen)).toEqual(["welcome", "role", "move"]);
    expect(queue(view({ lockedIn: true }), seen)).toEqual(["alibi"]);
  });

  const before = (round: number) => new Set(learn.filter((s) => s.round !== undefined && s.round < round).map((s) => s.id));

  it("teaches the snapshot card in round 2 and trust marks in round 3", () => {
    expect(queue(view({ round: 2 }), before(2))).toEqual(["snapshot"]);
    expect(queue(view({ round: 3 }), before(3))).toEqual(["marks"]);
  });

  it("explains meetings in the first planning after one, and the ending in round 5", () => {
    expect(queue(view({ round: 4, events: [{ type: "meetingClosed" }] }), before(4))).toEqual(["meeting"]);
    expect(queue(view({ round: 5 }), before(5))).toEqual(["end"]);
  });

  it("never shows a step twice, nor before its round or its event", () => {
    expect(queue(view(), new Set(["welcome", "role", "move"]))).toEqual([]);
    expect(queue(view({ round: 4 }), before(4))).toEqual([]);
  });

  it("shows a step it missed at the next planning: a round taken up by a meeting's card loses nothing", () => {
    expect(queue(view({ round: 3 }), before(2))).toEqual(["snapshot", "marks"]);
  });

  it("waits outside planning: the alibi pop-up, meetings, the result and the reveal own the screen", () => {
    for (const phase of ["alibi", "meeting", "result", "ended"]) expect(dueStep(view({ phase }), learn, new Set())).toBeNull();
  });

  it("has no guide in an ordinary game, or one set up before rulesets", () => {
    expect(guideOf(view({ ruleset: "simplified" }))).toEqual([]);
    const old = { ...view(), ledger: [{ seq: 0, event: { type: "gameCreated" } }] } as unknown as PlayerView;
    expect(guideOf(old)).toEqual([]);
  });

  it("keeps the seen steps per game and player", () => {
    expect(guideKey("g1", "p1")).not.toBe(guideKey("g2", "p1"));
    expect(guideKey("g1", "p1")).not.toBe(guideKey("g1", "p2"));
  });
});

describe("guide text — design §14, §10", () => {
  const text = (id: string) => learn.find((s) => s.id === id)!.lines.join(" ");

  it("is the Learn ruleset's guide", () => {
    expect(learn).toBe(RULESETS.learn!.guide);
  });

  it("teaches the alibi pop-up: its 20 seconds from content, and that a missed alibi shows your real room", () => {
    expect(text("alibi")).toContain(`${ALIBI_WINDOW_MS / 1000} seconds`);
    expect(text("alibi")).toMatch(/Miss it and the crew sees the room you were really in/);
  });

  it("teaches the snapshot card and marking a crook Trusted or Liar", () => {
    expect(text("snapshot")).toMatch(/dashed ring/);
    expect(text("marks")).toMatch(/Trusted or Liar/);
  });

  it("never mentions a plan board, pledges or a Stamped alibi (owner, 13 Nov)", () => {
    const all = learn.map((s) => `${s.title} ${s.lines.join(" ")}`).join(" ");
    expect(all).not.toMatch(/plan board|pledge|stamp/i);
  });
});
