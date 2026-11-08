import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";

// docs/pipeline/common.md: `bg.sh wait` returns inside the terminal tool's 60 s limit, measured against a deadline.
const dir = mkdtempSync(join(process.cwd(), "..", ".skimjob-bg-test-"));
const bg = (...args: string[]) => execFileSync("bash", ["scripts/bg.sh", ...args], { env: { ...process.env, BG_DIR: dir }, encoding: "utf8" });
afterAll(() => {
  bg("stop", "t");
  rmSync(dir, { recursive: true, force: true });
});

it("wait stops at its deadline while the command still runs, and reports the exit once it ends", () => {
  bg("start", "t", "--", "sleep", "30");
  const t0 = Date.now();
  expect(bg("wait", "t", "2")).toContain("running");
  expect(Date.now() - t0).toBeLessThan(5000);
  bg("stop", "t");
  bg("start", "t", "--", "true");
  expect(bg("wait", "t", "10")).toContain("exited 0");
});
