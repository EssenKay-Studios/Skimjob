// QA (design §20): the content text is design.md §20, word for word. Each §20
// table is read from the spec and compared, row by row, with what content serves.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BANK_JOB, BUST_ROLE_TEXT, EVENTS, EVENT_TEXT, PERK_TEXT, ROLE_TEXT, ROLE_WIN, ROOM_TEXT, TERMS, TIPS } from "./index";

const design = readFileSync(new URL("../../../docs/design.md", import.meta.url), "utf8");
const section = (from: string, to: string) => {
  const start = design.indexOf(from);
  const end = design.indexOf(to, start + from.length);
  expect(start, from).toBeGreaterThan(-1);
  expect(end, to).toBeGreaterThan(start);
  return design.slice(start, end);
};
/** The body rows of every markdown table in `md`, one array per table. */
const tables = (md: string) => {
  const out: string[][][] = [];
  let rows: string[][] | undefined;
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) {
      rows = undefined;
      continue;
    }
    const cells = line.slice(1, -1).split("|").map((c) => c.trim());
    if (!rows) out.push((rows = []));
    else if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
  }
  return out; // each table's header row is skipped: rows starts after it
};
const sorted = (rows: readonly (readonly string[])[]) => rows.map((r) => r.join(" | ")).sort();

describe("content text matches design.md §20 word for word (QA)", () => {
  it("§20.1 rooms", () => {
    const [rows] = tables(section("### 20.1", "### 20.2"));
    const ours = Object.entries(ROOM_TEXT).map(([id, text]) => [BANK_JOB.rooms[id]!.name, text]);
    expect(sorted(ours)).toEqual(sorted(rows!));
  });

  it("§20.2 roles: power, how you win and how to spot it, and the bust line", () => {
    const md = section("### 20.2", "### 20.3");
    const [rows] = tables(md);
    const ours = Object.values(ROLE_TEXT).map((r) => [r.name, r.power, ROLE_WIN[r.win], r.spot]);
    expect(sorted(ours)).toEqual(sorted(rows!));
    expect(md).toContain(`Bust (every role): "${BUST_ROLE_TEXT}"`);
  });

  it("§20.3 perks", () => {
    const [rows] = tables(section("### 20.3", "### 20.4"));
    expect(sorted(Object.values(PERK_TEXT).map((p) => [p.name, p.text]))).toEqual(sorted(rows!));
  });

  it("§20.4 events", () => {
    const [rows] = tables(section("### 20.4", "### 20.5"));
    const ours = Object.entries(EVENT_TEXT).map(([id, text]) => [EVENTS[id]!.name, text]);
    expect(sorted(ours)).toEqual(sorted(rows!));
  });

  it("§20.5 Terms and the other InfoTips, in the spec's order", () => {
    const [terms, others] = tables(section("### 20.5", "## 21."));
    expect(Object.values(TERMS).map((t) => [t.name, t.text])).toEqual(terms);
    // "Duffel (your move)" in the spec is the tip named "Duffel" on the move screen.
    expect(Object.values(TIPS).map((t) => [t.name, t.text])).toEqual(others!.map(([name, text]) => [name!.replace(/ \(your move\)$/, ""), text]));
  });
});
