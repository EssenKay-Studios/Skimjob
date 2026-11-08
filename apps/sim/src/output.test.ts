// Per-game CSV/JSON output and the printed report. design §17.4 "Outputs"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GAME_COLUMNS, PLAYER_COLUMNS, csvCell, gameRows, playerRows, prepareOutDir, toCsv, writeOutputs } from "./output";
import { summarize } from "./metrics";
import { formatReport } from "./report";
import { gameRec, seat } from "./testkit";

const games = [
  gameRec({ seed: "a,b", players: 2, playerRecords: [seat({ id: "p1" }), seat({ id: "p2", role: "priest" })], winners: ["p1"] }),
  gameRec({ seed: "c", players: 2, result: "failed", reason: "bust", playerRecords: [seat({ id: "p1", role: "mole" }), seat({ id: "p2" })] }),
];

describe("CSV", () => {
  it("quotes only fields that need it", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("x\ny")).toBe('"x\ny"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(false)).toBe("false");
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\n1,"x,y"\n');
  });
  it("one row per game and one per seat, matching the headers", () => {
    expect(gameRows(games)).toHaveLength(2);
    expect(gameRows(games).every((r) => r.length === GAME_COLUMNS.length)).toBe(true);
    expect(playerRows(games)).toHaveLength(4);
    expect(playerRows(games).every((r) => r.length === PLAYER_COLUMNS.length)).toBe(true);
  });
});

describe("writeOutputs", () => {
  it("writes games.csv, players.csv, games.json and summary.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "sim-out-"));
    try {
      const files = writeOutputs(join(dir, "nested"), games, summarize(games), { seed: "x" });
      expect(files.map((f) => f.slice(f.lastIndexOf("/") + 1))).toEqual(["games.csv", "players.csv", "games.json", "summary.json"]);
      expect(JSON.parse(readFileSync(files[2] as string, "utf8"))).toEqual(games);
      expect(JSON.parse(readFileSync(files[3] as string, "utf8")).options).toEqual({ seed: "x" });
      expect(readFileSync(files[0] as string, "utf8").split("\n")[1]).toMatch(/^"a,b",2,success/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("prepareOutDir — checked before any game runs (PR #10 QA)", () => {
  it("creates a missing directory and accepts an existing one", () => {
    const dir = mkdtempSync(join(tmpdir(), "sim-prep-"));
    try {
      expect(prepareOutDir(join(dir, "a", "b"))).toBeNull();
      expect(prepareOutDir(join(dir, "a", "b"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("refuses a file in place of the directory, or a directory in place of an output file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sim-prep-"));
    try {
      writeFileSync(join(dir, "file"), "x");
      expect(prepareOutDir(join(dir, "file"))).toMatch(/not a directory/);
      expect(prepareOutDir(join(dir, "file", "below"))).toMatch(/--out/);
      mkdirSync(join(dir, "out", "games.csv"), { recursive: true });
      expect(prepareOutDir(join(dir, "out"))).toMatch(/games\.csv exists and is not a file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("formatReport", () => {
  it("shows every design §21 metric with its target, one column per player count", () => {
    const text = formatReport(summarize([...games, { ...games[0]!, players: 3 }]), "title");
    for (const label of ["Heist success rate", "Bust rate", "Raids per game", "Games with a raid", "Rooftop stalls", "Shakedown accuracy", "Win rate, honest", "Win rate, moderate", "Win rate, heavy", "Ended at the cap", "Sunk by theft", "of those, won by a Mole or Fixer"]) {
      expect(text).toContain(label);
    }
    expect(text).toMatch(/2p\s+3p\s+all/);
    expect(text).toContain("55–70%");
    // design §17.4: heavy pocketing "should lose more often than it wins".
    expect(text).toMatch(/Win rate, heavy[^\n]*< 50%/);
    // design §21 G5: each role's win rate ÷ the average seat's, with its band.
    expect(text).toContain("Role win rate ÷ the average seat's, all endings (design §21 G5: 0.75–1.33)");
  });
  it("warns about refused commands", () => {
    const text = formatReport(summarize([gameRec({ playerRecords: [seat()], rejections: 2 })]), "t");
    expect(text).toContain("WARNING: bots sent 2 refused commands");
  });
});
