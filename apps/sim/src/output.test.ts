// Per-game CSV/JSON output and the printed report. design §17.4 "Outputs"
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GAME_COLUMNS, PLAYER_COLUMNS, csvCell, gameRows, playerRows, toCsv, writeOutputs } from "./output";
import { summarize } from "./metrics";
import { formatReport } from "./report";
import { gameRec, seat } from "./testkit";

const games = [
  gameRec({ seed: "a,b", players: 2, playerRecords: [seat({ id: "p1" }), seat({ id: "p2", role: "insider", canPocket: false })], winners: ["p1"] }),
  gameRec({ seed: "c", players: 2, result: "failed", reason: "heat", playerRecords: [seat({ id: "p1", role: "mole" }), seat({ id: "p2" })] }),
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

describe("formatReport", () => {
  it("shows every design §17.4 metric with its target, one column per player count", () => {
    const text = formatReport(summarize([...games, { ...games[0]!, players: 3 }]), "title");
    for (const label of ["Heist success rate", "Heat-bust share", "Shakedown accuracy", "Win rate, honest", "Win rate, moderate", "Win rate, heavy", "Comeback", "Decided before Act 3", "Mole win rate"]) {
      expect(text).toContain(label);
    }
    expect(text).toMatch(/2p\s+3p\s+all/);
    expect(text).toContain("55–70%");
  });
  it("says when no Mole was dealt, and warns about refused commands", () => {
    const text = formatReport(summarize([gameRec({ playerRecords: [seat()], rejections: 2 })]), "t");
    expect(text).toContain("no Moles dealt");
    expect(text).toContain("WARNING: bots sent 2 refused commands");
  });
});
