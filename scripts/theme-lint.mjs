// Theme-token lint (CLAUDE.md "UI rules"; part of `pnpm precheck`, docs/testing.md "Precheck").
// In apps/web/src, colours, fonts, shadows and radii come from theme.css tokens, so outside theme.css:
//   - no raw colour (#hex, rgb(), hsl(), ...) in a CSS declaration or in .ts/.tsx source;
//   - font-family / font name a --font-* token (or inherit);
//   - border-radius, box-shadow and text-shadow are var(--...), 0, none or inherit.
// scripts/theme-lint.baseline.json counts the violations that predate the lint, per file. It can only go
// down: a file may not exceed its count (a file not listed gets none), and a count above the file's real
// number fails too: clean a file up, then lower its count (`--update`).
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
const NAMED = new Set("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" "));
// A property that takes a colour (CSS name or React camelCase name), or a custom property.
const COLOUR_PROP = /^(?:--[\w-]+|(?:[a-z]+-)*(?:color|fill|stroke|background|border|outline))$/;
const SHAPE = /^(?:border(?:-[a-z]+)*-radius|box-shadow|text-shadow)$/;
const KEYWORD = /^(?:0|none|inherit|initial|unset|,)$/;

const kebab = (p) => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const hasNamedColour = (prop, v) => COLOUR_PROP.test(kebab(prop)) && v.replace(/(?:var|url)\([^)]*\)/g, "").split(/[^a-zA-Z]+/).some((w) => NAMED.has(w.toLowerCase()));
const badShape = (prop, v) =>
  prop === "font-family" ? !/^(?:var\(--font-[a-z]+\)|inherit)$/.test(v)
  : prop === "font" ? !/^inherit$|var\(--font-/.test(v)
  : SHAPE.test(prop) && v.replace(/var\(--[\w-]+\)/g, "").split(/\s+|(,)/).some((t) => t && !KEYWORD.test(t));
// Inline style props in .tsx: `borderRadius: 9`, `boxShadow: "..."`, `fontFamily: "..."`.
const STYLE_PROP = /\b(border(?:[A-Z][a-z]+)*Radius|boxShadow|textShadow|fontFamily|font)\s*:\s*("[^"]*"|'[^']*'|`[^`]*`|[^,}\n]+)/g;

// Number of violations in one file's text.
export function violations(file, text) {
  if (CSS.test(file)) {
    let n = 0;
    for (const [, prop, value] of text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
      const v = value.trim();
      if (v.match(COLOUR) || hasNamedColour(prop, v)) n++;
      else if (badShape(prop, v)) n++;
    }
    return n;
  }
  let n = 0;
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\*.*$/gm, "").replace(/(^|\s)\/\/.*$/gm, "$1")
    .replace(STYLE_PROP, (_, prop, value) => {
      if (badShape(kebab(prop), value.trim().replace(/^["'`]|["'`]$/g, ""))) n++;
      return "";
    });
  for (const [, prop, value] of code.matchAll(/\b([\w-]+)\s*[:=]\s*\{?\s*["'`]([^"'`]*)["'`]/g)) if (hasNamedColour(prop, value)) n++;
  return n + (code.match(COLOUR)?.length ?? 0);
}

export function check(counts, baseline) {
  const over = Object.entries(counts)
    .filter(([f, n]) => n > (baseline[f] ?? 0))
    .map(([f, n]) => `${f}: ${n} raw colour/font/shadow/radius value(s), allowed ${baseline[f] ?? 0}. Use a theme.css token (add one there if none fits).`);
  const stale = Object.entries(baseline)
    .filter(([f, n]) => (counts[f] ?? 0) < n)
    .map(([f, n]) => `${f}: baseline allows ${n} but it now has ${counts[f] ?? 0}. Lower the baseline: run \`node scripts/theme-lint.mjs --update\` and commit it.`);
  return [...over, ...stale];
}

function main(mode) {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "apps/web/src"], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => f && f !== THEME && (CSS.test(f) || (TS.test(f) && !TEST.test(f))));
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
