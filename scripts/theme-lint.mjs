// Theme-token lint (CLAUDE.md "UI rules"; part of `pnpm precheck`, docs/testing.md "Precheck").
// In apps/web/src, colours, fonts, shadows and radii come from theme.css tokens, so outside theme.css:
//   - no raw colour (#hex, rgb(), hsl(), ...) in a CSS declaration or in .ts/.tsx source;
//   - font-family / font name a --font-* token (or inherit);
//   - border-radius, box-shadow and text-shadow are var(--...), 0, none or inherit.
// scripts/theme-lint.baseline.json counts the violations that predate the lint, per file. It can only go
// down: a file may not exceed its count (a file not listed gets none). Clean a file up, then lower its count.
//   node scripts/theme-lint.mjs            check
//   node scripts/theme-lint.mjs --update   rewrite the baseline to today's counts (only after cleaning up)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = "scripts/theme-lint.baseline.json";
const THEME = "apps/web/src/theme.css";
const CSS = /^apps\/web\/src\/.*\.css$/;
const TS = /^apps\/web\/src\/.*\.tsx?$/;
const TEST = /\.(test|testkit)\.tsx?$/;
const COLOUR = /(?<!url\()#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl|hwb|lab|lch|oklab|oklch)a?\(/g;
const SHAPE = /^(?:border(?:-[a-z]+)*-radius|box-shadow|text-shadow)$/;
const KEYWORD = /^(?:0|none|inherit|initial|unset|,)$/;

// Number of violations in one file's text.
export function violations(file, text) {
  if (CSS.test(file)) {
    let n = 0;
    for (const [, prop, value] of text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
      const v = value.trim();
      if (v.match(COLOUR)) n++;
      else if (prop === "font-family" && !/^(?:var\(--font-[a-z]+\)|inherit)$/.test(v)) n++;
      else if (prop === "font" && !/^inherit$|var\(--font-/.test(v)) n++;
      else if (SHAPE.test(prop) && v.replace(/var\(--[\w-]+\)/g, "").split(/\s+|(,)/).some((t) => t && !KEYWORD.test(t))) n++;
    }
    return n;
  }
  return text.split("\n").filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join("\n").match(COLOUR)?.length ?? 0;
}

export function check(counts, baseline) {
  return Object.entries(counts)
    .filter(([f, n]) => n > (baseline[f] ?? 0))
    .map(([f, n]) => `${f}: ${n} raw colour/font/shadow/radius value(s), allowed ${baseline[f] ?? 0}. Use a theme.css token (add one there if none fits).`);
}

function main(mode) {
  const files = execFileSync("git", ["ls-files", "apps/web/src"], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => f && f !== THEME && (CSS.test(f) || (TS.test(f) && !TEST.test(f))));
  const counts = {};
  for (const f of files) {
    const n = violations(f, readFileSync(join(root, f), "utf8"));
    if (n) counts[f] = n;
  }
  if (mode === "--update") return writeFileSync(join(root, BASELINE), `${JSON.stringify(counts, null, 2)}\n`);
  const problems = check(counts, JSON.parse(readFileSync(join(root, BASELINE), "utf8")));
  problems.forEach((p) => console.error(p));
  process.exit(problems.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2]);
