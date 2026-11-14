// The case board's pure helpers. design §15.4
import { describe, expect, it } from "vitest";
import { leadsNaming, newestFirst, pinnedItems, playerStat, suspectOf, togglePin, type Lead, type Warning } from "./caseBoard";
import { FIXTURE_LEADS } from "./caseBoard.fixture";

describe("leads list (design §15.4)", () => {
  it("is newest first, and keeps the adapter's order within a round", () => {
    const shuffled = [FIXTURE_LEADS[3]!, FIXTURE_LEADS[0]!, FIXTURE_LEADS[2]!, FIXTURE_LEADS[1]!];
    expect(newestFirst(shuffled).map((l) => l.id)).toEqual(["lead:r4.vault", "lead:r4.market", "lead:r3.crew", "lead:r2.lobby"]);
    expect(newestFirst([])).toEqual([]);
  });

  it("toggles a pin on and off without touching the others", () => {
    expect(togglePin(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePin(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("pinned group (design §15.4: pin a whole lead or a single fact, kept across rounds)", () => {
  it("lists pinned leads and pinned facts, newest first, a fact with its lead", () => {
    const items = pinnedItems(FIXTURE_LEADS, new Set(["fact:r2.lobby.bell", "lead:r4.vault", "fact:r4.vault.saw"]));
    expect(items.map((i) => i.fact?.id ?? i.lead.id)).toEqual(["lead:r4.vault", "fact:r4.vault.saw", "fact:r2.lobby.bell"]);
    expect(items[1]!.lead.title).toBe("Vault");
  });

  it("is empty with no pins, and ignores pins whose lead is gone", () => {
    expect(pinnedItems(FIXTURE_LEADS, new Set())).toEqual([]);
    expect(pinnedItems(FIXTURE_LEADS, new Set(["lead:r1.gone"]))).toEqual([]);
  });
});

describe("Players strip (design §15.4: ⚠ count, pin count; tapping shows the leads that name them)", () => {
  const pins = new Set(["lead:r4.vault", "fact:r4.vault.saw", "fact:r3.crew.claim"]);

  it("counts the warnings that name a player, and the pins on leads that mention them", () => {
    expect(playerStat(FIXTURE_LEADS, pins, "p2")).toEqual({ warnings: 1, pins: 2 });
    expect(playerStat(FIXTURE_LEADS, pins, "p3")).toEqual({ warnings: 0, pins: 3 });
    expect(playerStat(FIXTURE_LEADS, pins, "p4")).toEqual({ warnings: 0, pins: 0 });
    expect(playerStat([], pins, "p2")).toEqual({ warnings: 0, pins: 0 });
  });

  it("lists the leads naming a player, newest first, whether mentioned or warned about", () => {
    expect(leadsNaming(FIXTURE_LEADS, "p3").map((l) => l.id)).toEqual(["lead:r4.vault", "lead:r3.crew"]);
    expect(leadsNaming(FIXTURE_LEADS, "p4").map((l) => l.id)).toEqual(["lead:r2.lobby"]);
    expect(leadsNaming(FIXTURE_LEADS, "nobody")).toEqual([]);
  });
});

describe("suspect card (design §15.4)", () => {
  const w = (names: string[], text: string): Warning => ({ kind: "seenElsewhere", names, text });
  const lead = (id: string, round: number, warnings: Warning[]): Lead => ({ id, kind: "room", round, title: id, bell: false, warnings, names: [], facts: [{ id: `${id}:f`, text: "f", trust: "fact" }] });
  const seats = ["me", "p2", "p3", "p4"];

  it("names nobody without a contradiction, and never you", () => {
    expect(suspectOf([], new Set(), "me", seats)).toBeNull();
    expect(suspectOf([lead("a", 1, [])], new Set(), "me", seats)).toBeNull();
    expect(suspectOf([lead("a", 1, [w(["me"], "you")])], new Set(), "me", seats)).toBeNull();
  });

  it("ranks by contradictions, then the most recent, then seat order; the reason quotes the latest", () => {
    const leads = [lead("a", 1, [w(["p3"], "p3 old"), w(["p4"], "p4 r1")]), lead("b", 2, [w(["p3"], "p3 new")]), lead("c", 2, [w(["p4"], "p4 r2")])];
    expect(suspectOf(leads, new Set(), "me", seats)).toEqual({ player: "p4", reason: "p4 r2" });
    // Same count and same latest warning (one ⚠ naming both): seat order.
    expect(suspectOf([lead("a", 1, [w(["p4", "p3"], "both")])], new Set(), "me", seats)?.player).toBe("p3");
    // More points beat recency.
    expect(suspectOf([...leads, lead("d", 0, [w(["p2"], "x"), w(["p2"], "y"), w(["p2"], "z")])], new Set(), "me", seats)?.player).toBe("p2");
  });

  it("reads only pinned leads (whole, or through a pinned fact) from 2 pins; 1 pin reads everything", () => {
    const leads = [lead("a", 1, [w(["p3"], "p3")]), lead("b", 2, [w(["p4"], "p4")]), lead("c", 3, [])];
    expect(suspectOf(leads, new Set(["a"]), "me", seats)?.player).toBe("p4");
    expect(suspectOf(leads, new Set(["a", "c:f"]), "me", seats)?.player).toBe("p3");
    expect(suspectOf(leads, new Set(["c", "c:f"]), "me", seats)).toBeNull();
  });
});
