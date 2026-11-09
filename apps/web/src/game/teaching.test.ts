// The teaching pop-ups (design §15.6, §20.6): which one is due, once per player, never with Tips off.
import { LESSONS } from "@skimjob/content";
import type { PlayerView } from "@skimjob/engine";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dueLesson, happened, loadSeen, saveSeen } from "./teaching";

type Ev = Record<string, unknown> & { type: string };
const view = (events: Ev[], extra: { round?: number; wanted?: number } = {}): PlayerView =>
  ({ round: 5, wanted: 0, phase: { kind: "planning" }, ...extra, ledger: events.map((event, seq) => ({ seq, event })) }) as unknown as PlayerView;
const resolved = (round: number, missing = 0): Ev => ({ type: "roundResolved", round, missing });
const raided: Ev = { type: "roomRaided", round: 4, room: "office" };
const bells = (n: number): Ev => ({ type: "bellsRung", round: 4, bells: { vault: n }, hidden: [] });

describe("what happened — design §20.6", () => {
  it("maps each trigger to its lesson", () => {
    expect(happened(view([raided]))).toEqual(new Set(["raid"]));
    expect(happened(view([{ type: "shakedownResolved" }]))).toEqual(new Set(["shakedown"]));
    expect(happened(view([{ type: "powerCut", round: 4, room: "vault" }]))).toEqual(new Set(["powerCut"]));
    expect(happened(view([resolved(4, 2)]))).toEqual(new Set(["missing"]));
    expect(happened(view([bells(1)]))).toEqual(new Set(["bell"]));
  });
  it("does not fire for a quiet round or a bell nobody lit", () => {
    expect(happened(view([resolved(4, 0), bells(0)]))).toEqual(new Set());
  });
  it("warns one star from a bust (2 of 3), not at 0, 1 or 3 stars", () => {
    expect([0, 1, 2, 3].map((wanted) => happened(view([], { wanted })).has("oneStar"))).toEqual([false, false, true, false]);
  });
  it("only looks at about the last two rounds", () => {
    const old = view([{ ...raided, round: 1 }, resolved(1), resolved(2), resolved(3), resolved(4)], { round: 5 });
    expect(happened(old).has("raid")).toBe(false);
    const recent = view([resolved(2), { ...raided, round: 3 }, resolved(3), resolved(4)], { round: 5 });
    expect(happened(recent).has("raid")).toBe(true);
  });
});

describe("the due lesson — design §15.6", () => {
  const busy = view([raided, { type: "shakedownResolved" }, bells(2)], { wanted: 2 });
  it("shows the most serious unseen lesson first, then the next, then none", () => {
    const seen = new Set<string>();
    const order = [];
    for (let l = dueLesson(busy, seen, true); l; l = dueLesson(busy, seen, true)) {
      order.push(l);
      seen.add(l);
    }
    expect(order).toEqual(["raid", "oneStar", "shakedown", "bell"]);
  });
  it("never shows one when Tips is off", () => {
    expect(dueLesson(busy, new Set(), false)).toBeNull();
  });
  it("shows nothing once the game has ended", () => {
    expect(dueLesson({ ...busy, phase: { kind: "ended" } } as unknown as PlayerView, new Set(), true)).toBeNull();
  });
  it("shows nothing when nothing happened", () => {
    expect(dueLesson(view([]), new Set(), true)).toBeNull();
  });
});

describe("the seen set", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  });
  it("is kept per player and survives a reload", () => {
    saveSeen("p1", new Set(["raid"]));
    expect(loadSeen("p1")).toEqual(new Set(["raid"]));
    expect(loadSeen("p2")).toEqual(new Set());
  });
  it("drops junk and unknown lessons", () => {
    localStorage.setItem("skimjob.lessons.p1", JSON.stringify(["raid", "nope", 3]));
    expect(loadSeen("p1")).toEqual(new Set(["raid"]));
    localStorage.setItem("skimjob.lessons.p1", "{not json");
    expect(loadSeen("p1")).toEqual(new Set());
  });
});

describe("lesson text — design §20.6", () => {
  it("has the three parts for every lesson, with the numbers from content", () => {
    for (const l of Object.values(LESSONS)) for (const part of [l.title, l.happened, l.means, l.canDo]) expect(part.trim()).not.toBe("");
    expect(LESSONS.raid.happened).toContain("4th");
    expect(LESSONS.oneStar.happened).toContain("2 of 3");
  });
});
