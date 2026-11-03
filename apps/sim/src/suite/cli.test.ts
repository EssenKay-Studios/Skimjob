// The suite CLI's exit codes and early input checks (PR #34 QA): a bad
// baseline, shard file or --out path is a clean `sim:suite: …` message and
// exit 2, found before any game runs; exit 1 is kept for --strict FAILs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const dir = mkdtempSync(join(tmpdir(), "sim-suite-cli-"));
const file = (name: string, text: string): string => {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
};
// A one-game cell: if a check didn't run first, the run would print progress before failing.
const tiny = ["-p", "2", "--setups", "balanced", "--events", "off", "-n", "1", "-w", "1"];

function run(args: string[]) {
  const r = spawnSync(process.execPath, ["--import", tsx, cli, ...args], { encoding: "utf8", env: { ...process.env, INIT_CWD: dir } });
  return { code: r.status, err: r.stderr, out: r.stdout };
}

describe("sim:suite CLI input errors exit 2 before running (PR #34 QA)", () => {
  it("a missing, truncated or wrong-shaped --compare baseline", { timeout: 60_000 }, () => {
    for (const [base, msg] of [
      [join(dir, "missing.json"), /--compare .*ENOENT/],
      [file("cut.json", '{"kind":"skimjob-sim-suite","for'), /isn't valid JSON/],
      [file("shape.json", '{"kind":"skimjob-sim-suite","format":1}'), /versions/],
    ] as const) {
      const r = run([...tiny, "--no-files", "--compare", base]);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/^sim:suite: /);
      expect(r.err).toMatch(msg);
      expect(r.err).not.toMatch(/games in|at .*\.ts:\d+/); // no games played, no stack trace
    }
  });

  it("malformed shard files for merge", { timeout: 60_000 }, () => {
    const noShard = file("s1.json", JSON.stringify({ kind: "skimjob-sim-suite-shard", format: 1, versions: { engine: "e", content: "c" }, options: {}, cells: [] }));
    const r = run(["merge", noShard, "--no-files"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^sim:suite merge: file 1 options/);
    expect(run(["merge", join(dir, "nope.json"), "--no-files"]).code).toBe(2);
  });

  it("an --out path that can't be written", { timeout: 60_000 }, () => {
    const r = run([...tiny, "--out", dir]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--out .* is not a file/);
  });

  it("a good run exits 0", { timeout: 60_000 }, () => {
    const r = run([...tiny, "--out", "out/suite.json"]);
    expect(r.err).toMatch(/1 games in/);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Fixed: 1 games per cell");
  });
});
