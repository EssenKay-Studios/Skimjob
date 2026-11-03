// QA (PR #50, R6a; R6b adds the Act-label scan): extension.md Build notes item 2 — "once per act" reads
// "once between meetings" everywhere players see it. Scans the UI copy and the
// engine's refusal messages (the web toasts them) for per-act phrasing, skipping comments.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PER_ACT = /\b(once (per|an|each|a) act|(this|per|each|next|that|one) act|in act \$?\{?|claim in act|one claim in Act)\b/i;

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" ? [] : files(p, ext);
    return ext.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.endsWith(".testkit.ts") ? [p] : [];
  });
}

/** Lines of code with comments stripped (line and block comments; good enough for copy). */
function codeLines(src: string): string[] {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"));
}

/** "Act 1", `Act ${n}` or "since the last meeting" in UI copy: the Extension says "meeting 1", "rounds 1–3", "between meetings". */
const ACT_COPY = /(["'`>]|\s)(Act \d|Act \$\{)|since the last meeting/;

describe("no \"Act N\" labels reach players (extension.md: between meetings)", () => {
  it("web UI copy", () => {
    const hits: string[] = [];
    for (const f of files(join(__dirname, "."), /\.tsx?$/)) {
      codeLines(readFileSync(f, "utf8")).forEach((l, i) => {
        if (ACT_COPY.test(l)) hits.push(`${f}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe("no \"once per act\" phrasing reaches players", () => {
  const roots = [join(__dirname, "."), join(__dirname, "../../../packages/engine/src")];
  it.each(roots)("%s", (root) => {
    const hits: string[] = [];
    for (const f of files(root, /\.tsx?$/)) {
      codeLines(readFileSync(f, "utf8")).forEach((l, i) => {
        if (PER_ACT.test(l)) hits.push(`${f}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
