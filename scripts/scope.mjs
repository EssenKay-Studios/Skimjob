// What must a change test? (docs/testing.md "Scoped tests")
//   node scripts/scope.mjs           changed paths (one per line) on stdin -> JSON { full, unit, tags, sim, pipeline, reason }
//                                    (CI runs it on the PR's diff, docs/testing.md "Scoped tests")
//   node scripts/scope.mjs --check   features.json coverage; fails if an e2e test lacks exactly one feature tag
//   node scripts/scope.mjs --run     `pnpm test:scoped`: scope the diff against origin/main and run it
//   node scripts/scope.mjs --shard 3/6   the e2e spec files of CI shard 3 of 6, balanced by apps/web/e2e/shard-weights.json
// unit: "all", "" (none) or package dirs ("scripts" for the runner's tests); tags: "all", "" (none) or a Playwright --grep regex;
// sim: games; pipeline: run the pipeline checks (gate.qa.test.sh, shellcheck, actionlint).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEATURES = "apps/web/e2e/features.json";
const SOURCE = /^(apps|packages)\/[^/]+\/(src|e2e)\/.*\.(tsx?|css)$/;
const TEST = /\.(test|testkit)\.tsx?$/;
export const SPEC = /\/e2e\/.*\.spec\.ts$/;
const TAG = /@[a-z][a-z-]*/g;
const RULES = ["packages/engine", "packages/content", "packages/bots"];
const FULL = { full: true, unit: "all", tags: "all", sim: 200, pipeline: true };
// The runner, the gate and CI: their own tests and checks only, no sim or e2e.
const PIPELINE = /^(docs\/pipeline\/|scripts\/agent-|scripts\/runner|\.github\/)/;
// Docs (not the pipeline's): the static checks only.
const DOCS = /(^docs\/|\.md$)/;

export function buildGraph(files, readFile) {
  const set = new Set(files);
  const dirOf = {}; // package name -> dir
  const needs = {}; // dir -> workspace package names it depends on
  for (const f of files) {
    const m = /^((?:apps|packages)\/[^/]+)\/package\.json$/.exec(f);
    if (!m) continue;
    const pkg = JSON.parse(readFile(f));
    dirOf[pkg.name] = m[1];
    needs[m[1]] = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  }
  const resolve = (from, spec) => {
    const base = spec.startsWith(".") ? posix.join(posix.dirname(from), spec) : dirOf[spec] && `${dirOf[spec]}/src/index`;
    return base && [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((c) => set.has(c));
  };
  const importers = new Map();
  for (const f of files) {
    if (!SOURCE.test(f) || f.endsWith(".css") || TEST.test(f)) continue;
    for (const m of readFile(f).matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const target = resolve(f, m[1]);
      if (target) importers.set(target, [...(importers.get(target) ?? []), f]);
    }
  }
  return {
    importers,
    // The package and everything that depends on it, directly or not.
    dependents(dir) {
      const out = new Set([dir]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const [d, names] of Object.entries(needs)) {
          if (!out.has(d) && names.some((n) => out.has(dirOf[n]))) out.add(d), (grew = true);
        }
      }
      return out;
    },
  };
}

// Tags of the entry points a file leads to: walk up the importers, stopping at each entry point.
function reach(graph, file, tagsOf) {
  const seen = new Set([file]);
  const hit = new Set();
  for (const queue = [file]; queue.length; ) {
    const x = queue.shift();
    const own = tagsOf(x);
    if (own.length) {
      own.forEach((t) => hit.add(t));
      continue;
    }
    for (const y of graph.importers.get(x) ?? []) if (!seen.has(y)) seen.add(y), queue.push(y);
  }
  return hit;
}

// An entry is one tag, several, or "*" (shared: a change to it runs everything).
const tagsFor = (features, f) => [features[f] ?? []].flat().filter((t) => t !== "*");
const vocabOf = (features) => new Set(Object.keys(features).flatMap((f) => tagsFor(features, f)));
const specTags = (text, features) => [...new Set(text.match(TAG))].filter((t) => vocabOf(features).has(t));

export function scope(changed, graph, features, readFile) {
  if (!changed.some(Boolean)) return { ...FULL, reason: "no changed paths" };
  const full = (reason) => ({ ...FULL, reason });
  const specOf = (f) => {
    try {
      return specTags(readFile(f), features);
    } catch {
      return null; // deleted or renamed away
    }
  };
  const tagsOf = (f) => (features[f] ? [features[f]].flat() : SPEC.test(f) ? (specOf(f) ?? []) : []);
  const unit = new Set();
  const tags = new Set();
  let sim = 0;
  let pipeline = false;
  for (const f of changed.filter(Boolean)) {
    if (PIPELINE.test(f)) {
      unit.add("scripts"), (pipeline = true);
      continue;
    }
    if (DOCS.test(f)) continue;
    if (!SOURCE.test(f)) return full(`${f} is config or not source`);
    const pkg = f.split("/").slice(0, 2).join("/");
    if (!f.startsWith(`${pkg}/e2e/`)) for (const d of TEST.test(f) ? [pkg] : graph.dependents(pkg)) unit.add(d);
    if (TEST.test(f)) continue;
    if (SPEC.test(f)) {
      const own = specOf(f);
      if (own === null) continue; // a deleted spec has nothing left to run
      if (!own.length) return full(`${f} has no feature tag`);
      own.forEach((t) => tags.add(t));
      continue;
    }
    const hit = reach(graph, f, tagsOf);
    if (hit.has("*")) return full(`${f} is, or is imported by, a shared module`);
    if (hit.size === 0) return full(`${f} reaches no feature entry`);
    if (hit.size >= 3) return full(`${f} reaches ${[...hit].join(" ")}`);
    hit.forEach((t) => tags.add(t));
    if (f.startsWith("apps/server/")) tags.add("@lobby").add("@host");
    if (RULES.includes(pkg)) unit.add("packages/engine"), (sim = 50);
  }
  return { full: false, unit: [...unit].sort().join(" "), tags: [...tags].sort().join("|"), sim, pipeline, reason: "scoped" };
}

// Heaviest spec file first onto the lightest shard (Playwright's own --shard slices by test count, which
// bunches the slow full-game tests). Weights are seconds per file on a local run; a file without one counts 60.
export function shard(specs, weights, i, n) {
  const weight = (f) => weights[f] ?? 60;
  const loads = Array.from({ length: n }, () => ({ total: 0, files: [] }));
  for (const f of [...specs].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const lightest = loads.reduce((m, x) => (x.total < m.total ? x : m));
    lightest.total += weight(f);
    lightest.files.push(f);
  }
  return loads[i - 1].files.sort();
}

const out = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
const lines = (s) => s.split("\n").filter(Boolean);

// Paths this checkout changed against origin/main (committed, staged, unstaged and untracked).
export function changedPaths() {
  const base = out("git", ["merge-base", "origin/main", "HEAD"]).trim();
  return [...lines(out("git", ["diff", "--name-only", "--no-renames", base])), ...lines(out("git", ["ls-files", "--others", "--exclude-standard"]))];
}

function check(files, features) {
  const vocab = vocabOf(features);
  const problems = Object.keys(features).filter((f) => !files.includes(f)).map((f) => `${FEATURES}: ${f} does not exist`);
  const used = new Set();
  const walk = (suite, path) => {
    const here = /\.spec\.ts$/.test(suite.title) ? path : [...path, suite.title];
    for (const s of suite.specs ?? []) {
      const tags = [...new Set([...here, s.title].join(" ").match(TAG))].filter((t) => t !== "@fast-clock");
      if (tags.length === 1 && vocab.has(tags[0])) used.add(tags[0]);
      else problems.push(`${suite.file ?? s.file}: "${s.title}" needs exactly one feature tag of ${[...vocab].join(" ")}, has ${tags.join(" ") || "none"}`);
    }
    for (const c of suite.suites ?? []) walk(c, here);
  };
  const list = JSON.parse(out("npx", ["playwright", "test", "--list", "--reporter=json"], join(root, "apps/web")));
  for (const s of list.suites) walk(s, []);
  for (const t of vocab) if (!used.has(t)) problems.push(`${FEATURES}: no e2e test carries ${t}`);
  const graph = buildGraph(files, (f) => readFileSync(join(root, f), "utf8"));
  const tagsOf = (f) => (features[f] ? ["entry"] : []);
  for (const f of files) {
    if (!/^(apps\/web\/src\/(screens|components|game)|apps\/server\/src|packages\/(engine|bots|content)\/src)\//.test(f) || !SOURCE.test(f) || TEST.test(f) || f.endsWith(".css")) continue;
    if (graph.importers.has(f) && reach(graph, f, tagsOf).size === 0) problems.push(`${f} is imported but reaches no entry in ${FEATURES}`);
  }
  return problems;
}

function main(mode) {
  const files = lines(out("git", ["ls-files"])).filter((f) => existsSync(join(root, f))); // not deleted in the working tree
  const read = (f) => readFileSync(join(root, f), "utf8");
  const features = JSON.parse(read(FEATURES));
  if (mode === "--check") {
    const problems = check(files, features);
    problems.forEach((p) => console.error(p));
    return process.exit(problems.length ? 1 : 0);
  }
  if (mode === "--shard") {
    const [i, n] = process.argv[3].split("/").map(Number);
    const specs = files.filter((f) => SPEC.test(f)).map((f) => f.replace("apps/web/", ""));
    const weights = JSON.parse(read("apps/web/e2e/shard-weights.json"));
    return console.log(shard(specs, Object.fromEntries(Object.entries(weights).map(([f, w]) => [`e2e/${f}`, w])), i, n).join(" "));
  }
  const graph = buildGraph(files, read);
  if (mode !== "--run") return console.log(JSON.stringify(scope(lines(readFileSync(0, "utf8")), graph, features, read)));
  const s = scope(changedPaths(), graph, features, read);
  console.log(JSON.stringify(s));
  const run = (cmd, args, cwd = root) => spawnSync(cmd, args, { cwd, stdio: "inherit" }).status === 0 || process.exit(1);
  if (s.unit) run("pnpm", ["test", ...(s.unit === "all" ? [] : s.unit.split(" "))]);
  if (s.tags) run("npx", ["playwright", "test", "--pass-with-no-tests", ...(s.tags === "all" ? [] : ["--grep", s.tags])], join(root, "apps/web"));
  if (s.sim) run("bash", ["scripts/sim-smoke.sh", String(s.sim)]);
  if (s.pipeline) run("bash", ["docs/pipeline/gate.qa.test.sh"]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2]);
