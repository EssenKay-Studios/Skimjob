// The case board's pure helpers. design §15.4
import { describe, expect, it } from "vitest";
import { leadsNaming, newestFirst, pinnedItems, playerStat, togglePin } from "./caseBoard";
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
