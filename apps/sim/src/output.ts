// Per-game output: CSV rows (one per game, one per seat) and JSON. design §17.4 "Outputs"
import { accessSync, constants, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameRecord } from "./record";
import type { Summary } from "./metrics";
import { decidedEarly } from "./metrics";

type Cell = string | number | boolean | null;

/** One CSV field: quoted when it holds a comma, quote or line break. */
export function csvCell(v: Cell): string {
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

export const GAME_COLUMNS = [
  "seed", "players", "result", "reason", "endedRound", "haul", "finalTarget", "heat", "checkpointsMissed",
  "meetings", "shakedowns", "cleanShakedowns", "winners", "act1Leaders", "act2Leaders", "act2Lead", "decidedEarly", "rejections",
] as const;

export function gameRows(records: readonly GameRecord[]): Cell[][] {
  return records.map((g) => [
    g.seed, g.players, g.result, g.reason, g.endedRound, g.haul, g.finalTarget, g.heat, g.checkpointsMissed,
    g.meetings, g.shakedowns.length, g.shakedowns.filter((s) => s.clean).length, g.winners.join(" "),
    g.afterAct1?.leaders.join(" ") ?? null, g.afterAct2?.leaders.join(" ") ?? null, g.afterAct2?.lead ?? null,
    decidedEarly(g), g.rejections,
  ]);
}

export const PLAYER_COLUMNS = [
  "seed", "players", "result", "player", "personality", "role", "score", "stash", "looted", "pocketed", "timesShakenDown", "winner",
] as const;

export function playerRows(records: readonly GameRecord[]): Cell[][] {
  return records.flatMap((g) =>
    g.playerRecords.map((p) => [
      g.seed, g.players, g.result, p.id, p.personality, p.role, p.score, p.stash, p.looted, p.pocketed, p.timesShakenDown, p.winner,
    ]),
  );
}

const OUTPUT_FILES = ["games.csv", "players.csv", "games.json", "summary.json"] as const;

/**
 * Make sure `dir` can take the output before any game runs: create it if
 * missing, and refuse a path that is a file, an output name that is a
 * directory, or a directory we can't write. Returns the problem, or null.
 */
export function prepareOutDir(dir: string): string | null {
  try {
    const st = statSync(dir, { throwIfNoEntry: false });
    if (st && !st.isDirectory()) return `--out ${dir} exists and is not a directory`;
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    for (const name of OUTPUT_FILES) {
      const f = statSync(join(dir, name), { throwIfNoEntry: false });
      if (f && !f.isFile()) return `--out ${join(dir, name)} exists and is not a file`;
    }
    return null;
  } catch (e) {
    return `--out ${dir}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`;
  }
}

/** Write games.csv, players.csv, games.json and summary.json into `dir`; returns the paths. */
export function writeOutputs(dir: string, records: readonly GameRecord[], summary: Summary, options: unknown): string[] {
  mkdirSync(dir, { recursive: true });
  const files: [(typeof OUTPUT_FILES)[number], string][] = [
    ["games.csv", toCsv(GAME_COLUMNS, gameRows(records))],
    ["players.csv", toCsv(PLAYER_COLUMNS, playerRows(records))],
    ["games.json", JSON.stringify(records) + "\n"],
    ["summary.json", JSON.stringify({ options, summary }, null, 2) + "\n"],
  ];
  return files.map(([name, text]) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  });
}
