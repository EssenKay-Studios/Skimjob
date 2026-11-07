// QA (S3b.5, PR #165): the case board helpers at the edges — many pins, 12
// seats, pins whose lead or fact is gone, and the pin list the server takes.
// design §15.4
import { describe, expect, it } from "vitest";
import { leadsNaming, newestFirst, pinnedItems, playerStat, togglePin, type Lead } from "./caseBoard";
import { FIXTURE_LEADS } from "./caseBoard.fixture";

const SEATS = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
/** 9 rounds × 4 leads, each naming two seats and holding 3 facts; every 3rd lead warns about its first seat. */
const BIG: Lead[] = Array.from({ length: 36 }, (_, i) => {
  const round = Math.floor(i / 4) + 1;
  const names = [SEATS[i % 12]!, SEATS[(i + 5) % 12]!];
  return {
    id: `lead:r${round}.${i}`,
    round,
    title: `Lead ${i}`,
    bell: i % 2 === 0,
    names,
    warnings: i % 3 === 0 ? [{ kind: "seenElsewhere", names: [names[0]!], text: "x" }] : [],
    facts: [0, 1, 2].map((f) => ({ id: `fact:r${round}.${i}.${f}`, text: `fact ${f}`, trust: "fact" as const })),
  };
});
// The server's id rule (apps/server settings PIN_ID_PATTERN): what the adapter's ids must pass.
const SERVER_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

describe("QA: many pins and 12 seats (design §15.4)", () => {
  it("pinning everything lists each lead and fact once, newest round first", () => {
    const all = new Set(BIG.flatMap((l) => [l.id, ...l.facts.map((f) => f.id)]));
    const items = pinnedItems(BIG, all);
    expect(items).toHaveLength(36 * 4);
    expect(new Set(items.map((i) => i.fact?.id ?? i.lead.id)).size).toBe(items.length);
    const rounds = items.map((i) => i.lead.round);
    expect(rounds).toEqual([...rounds].sort((a, b) => b - a));
  });

  it("the Players strip's counts add up over 12 seats", () => {
    const pins = new Set(BIG.filter((_, i) => i % 2 === 0).map((l) => l.id));
    const stats = SEATS.map((s) => playerStat(BIG, pins, s));
    // Each pinned lead names two seats, so it counts twice; each warning names one seat.
    expect(stats.reduce((n, s) => n + s.pins, 0)).toBe(pins.size * 2);
    expect(stats.reduce((n, s) => n + s.warnings, 0)).toBe(12);
    for (const s of SEATS) expect(leadsNaming(BIG, s).length).toBe(6);
  });

  it("pins whose lead or fact is gone (an adapter change) are dropped from Pinned, not shown broken", () => {
    const pins = new Set(["lead:r99.gone", "fact:r4.vault.gone", "fact:r4.vault.saw"]);
    expect(pinnedItems(FIXTURE_LEADS, pins).map((i) => i.fact?.id ?? i.lead.id)).toEqual(["fact:r4.vault.saw"]);
  });

  it("toggling builds a list the server accepts: distinct ids, order kept, back to empty", () => {
    let list: string[] = [];
    const ids = FIXTURE_LEADS.flatMap((l) => [l.id, ...l.facts.map((f) => f.id)]);
    for (const id of ids) list = togglePin(list, id);
    expect(list).toEqual(ids);
    expect(new Set(list).size).toBe(list.length);
    for (const id of list) expect(id).toMatch(SERVER_ID);
    for (const id of [...ids].reverse()) list = togglePin(list, id);
    expect(list).toEqual([]);
    expect(newestFirst(BIG).map((l) => l.id)).toEqual(newestFirst(newestFirst(BIG)).map((l) => l.id));
  });
});
