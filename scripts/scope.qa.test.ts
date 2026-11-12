// QA for #87 (scripts/scope.mjs on the real repo): the scoped set must be a superset of what a change affects.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraph, scope, shard, testsOf } from "./scope.mjs";

const root = join(import.meta.dirname, "..");
const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const readRepo = (f: string) => readFileSync(join(root, f), "utf8");
const features: Record<string, string | string[]> = JSON.parse(readRepo("apps/web/e2e/features.json"));
const graph = buildGraph(files, readRepo);
const run = (changed: string[], read = readRepo) => scope(changed, graph, features, read);
const FULL = { full: true, unit: "all", tags: "all", sim: 200, pipeline: true };

describe("scope on the real import graph", () => {
  it("runs everything for the shared UI kit", () => {
    for (const f of [
      "apps/web/src/theme.css",
      "apps/web/src/components/components.css",
      "apps/web/src/components/SketchFrame.tsx",
      "apps/web/src/components/Button.tsx",
      "apps/web/src/api.ts",
      "apps/web/src/router.ts",
      "apps/web/src/App.tsx",
      "apps/web/src/main.tsx",
    ]) {
      expect(run([f]), f).toMatchObject(FULL);
    }
  });

  it("runs everything for root and workspace config, lockfile, CI, scripts and the scoping data", () => {
    for (const f of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.base.json",
      "vitest.config.ts",
      "knip.json",
      "apps/web/package.json",
      "apps/web/playwright.config.ts",
      "apps/web/vite.config.ts",
      "apps/web/index.html",
      "scripts/scope.mjs",
      "scripts/sim-smoke.sh",
      "apps/web/e2e/features.json",
      "apps/web/e2e/shard-weights.json",
      "apps/server/migrations/001_init.sql",
      "apps/web/src/fonts/inter-latin-wght-normal.woff2",
    ]) {
      expect(run([f]), f).toMatchObject(FULL);
    }
    // One config file among code files still runs everything.
    expect(run(["apps/web/src/screens/Meetings.tsx", "pnpm-lock.yaml"])).toMatchObject(FULL);
  });

  it("runs everything for every module marked shared in features.json", () => {
    for (const [f, t] of Object.entries(features)) if (t === "*") expect(run([f]), f).toMatchObject(FULL);
  });

  it("runs everything for the content package (every feature reads its numbers)", () => {
    for (const f of files.filter((f) => /^packages\/content\/src\/.*\.ts$/.test(f) && !/\.(test|testkit)\.ts$/.test(f))) {
      expect(run([f]).full, f).toBe(true);
    }
  });

  it("an engine entry runs its tag, the engine tests, every dependent package and the 50-game smoke", () => {
    const s = run(["packages/engine/src/meeting.ts"]);
    expect(s.tags.split("|")).toContain("@meeting");
    expect(s.sim).toBeGreaterThanOrEqual(50);
    for (const p of ["packages/engine", "packages/bots", "apps/server", "apps/sim", "apps/web"]) expect(s.unit.split(" ")).toContain(p);
  });

  it("every engine, bots or content source change runs the sim smoke and the engine tests", () => {
    for (const f of files.filter((f) => /^packages\/(engine|bots|content)\/src\/.*\.ts$/.test(f) && !/\.(test|testkit)\.ts$/.test(f))) {
      const s = run([f]);
      expect(s.sim, f).toBeGreaterThanOrEqual(50);
      expect(s.unit === "all" || s.unit.split(" ").includes("packages/engine"), f).toBe(true);
    }
  });

  it("every server source change runs the server unit tests and @lobby @host", () => {
    for (const f of files.filter((f) => /^apps\/server\/src\/.*\.ts$/.test(f) && !/\.(test|testkit)\.ts$/.test(f))) {
      const s = run([f]);
      if (s.full) continue;
      expect(s.unit.split(" "), f).toContain("apps/server");
      expect(s.tags.split("|"), f).toEqual(expect.arrayContaining(["@host", "@lobby"]));
    }
  });

  it("every web entry point runs at least its own tags and the web unit tests", () => {
    for (const [f, t] of Object.entries(features)) {
      if (t === "*" || !f.startsWith("apps/web/src/")) continue;
      const s = run([f]);
      if (s.full) continue;
      expect(s.tags.split("|"), f).toEqual(expect.arrayContaining([t].flat()));
      expect(s.unit.split(" "), f).toContain("apps/web");
    }
  });

  it("a single spec runs its own tag", () => {
    for (const f of files.filter((f) => /^apps\/web\/e2e\/.*\.spec\.ts$/.test(f))) {
      const s = run([f]);
      const own = [...new Set(readRepo(f).match(/@[a-z][a-z-]*/g))].filter((t) => t !== "@fast-clock");
      if (s.full) continue;
      for (const t of own.filter((t) => Object.values(features).flat().includes(t))) expect(s.tags.split("|"), f).toContain(t);
    }
  });

  it("a new spec without a feature tag runs everything", () => {
    const f = "apps/web/e2e/brand-new.qa.spec.ts";
    const read = (p: string) => (p === f ? 'import { test } from "@playwright/test";\ntest("does a thing", async () => {});' : readRepo(p));
    expect(run([f], read)).toMatchObject(FULL);
    // A tag outside the features.json vocabulary does not count as one.
    const read2 = (p: string) => (p === f ? 'test("does a thing @smoke @fast-clock", async () => {});' : readRepo(p));
    expect(run([f], read2)).toMatchObject(FULL);
  });

  it("a new web module that no entry point imports yet runs everything", () => {
    expect(run(["apps/web/src/components/BrandNew.tsx"])).toMatchObject(FULL);
    expect(run(["apps/server/src/brandNew.ts"])).toMatchObject(FULL);
  });

  it("docs only (anywhere but docs/pipeline) runs no unit test, browser, sim or pipeline check (#272)", () => {
    expect(run(["docs/testing.md", "README.md", "docs/balance/baseline.json", "apps/web/README.md"])).toMatchObject({ full: false, unit: "", tags: "", sim: 0, pipeline: false });
    // design.md is read word for word by content's text.qa and web's TeachingPopup.qa tests
    expect(run(["docs/design.md"])).toMatchObject({ full: false, unit: "apps/web packages/content", tags: "", sim: 0, pipeline: false });
  });
});

describe("shard edge cases", () => {
  const units = ["e2e/a.spec.ts:3", "e2e/a.spec.ts:20", "e2e/b.spec.ts:5"];
  const weights = { "e2e/a.spec.ts:3": 5, "e2e/a.spec.ts:20": 9, "e2e/b.spec.ts:5": 0 };

  it("puts every test on exactly one shard, even with more shards than tests or a zero weight", () => {
    const all = [1, 2, 3, 4, 5, 6].flatMap((i) => shard(units, weights, i, 6));
    expect(all.sort()).toEqual([...units].sort());
  });

  it("ignores weights of tests that no longer exist", () => {
    const all = [1, 2].flatMap((i) => shard(units, { ...weights, "e2e/deleted.spec.ts:1": 999 }, i, 2));
    expect(all).not.toContain("e2e/deleted.spec.ts:1");
    expect(all).toHaveLength(units.length);
  });
});

// QA for #282: the per-test shards on the real Playwright list and weights.
describe("per-test shards on the real e2e list (#282)", () => {
  const web = join(root, "apps/web");
  type Spec = { title: string; file: string; tests: { projectName: string }[] };
  type Suite = { title: string; file?: string; specs?: Spec[]; suites?: Suite[] };
  const report: { suites: Suite[] } = JSON.parse(execFileSync("npx", ["playwright", "test", "--list", "--reporter=json"], { cwd: web, encoding: "utf8", maxBuffer: 1 << 28 }));
  const list = testsOf(report);
  const weights: Record<string, number> = JSON.parse(readRepo("apps/web/e2e/shard-weights.json"));
  // What Playwright's --grep matches: project, file and titles joined by spaces.
  const runs = list.flatMap((t) => t.tests.map((x: { projectName: string }) => `${x.projectName} ${t.file} ${t.title}`));
  const grepOf = (i: number, tags: string) => execFileSync("node", ["scripts/scope.mjs", "--shard", `${i}/6`, tags], { cwd: root, encoding: "utf8" }).trim();
  const loads = (re: RegExp) => {
    const by = Object.fromEntries(list.filter((t) => re.test(t.title) && weights[t.key] !== undefined).map((t) => [t.key, weights[t.key]]));
    return { heaviest: Math.max(...Object.values(by)), total: Object.values(by).reduce((s, w) => s + w, 0), shards: [1, 2, 3, 4, 5, 6].map((i) => shard(Object.keys(by), by, i, 6).reduce((s, k) => s + by[k], 0)) };
  };
  const tags = [...new Set(list.flatMap((t) => t.title.match(/@[\w-]+/g) ?? []))];

  // Missing or stale weights only warn (PR #289 Decisions), so they are not asserted here: main would go red on a new spec.
  it("gives each test its own file + title, so its grep cannot pick up another test", () => {
    expect(new Set(list.map((t) => `${t.file} ${t.title}`)).size).toBe(list.length);
  });

  it("the six full-run greps select every test run exactly once", () => {
    const greps = [1, 2, 3, 4, 5, 6].map((i) => new RegExp(grepOf(i, "all")));
    for (const r of runs) expect(greps.filter((g) => g.test(r)).length, r).toBe(1);
  }, 60_000);

  it("a scoped run's greps select exactly the tests its tags select, each once", () => {
    const tagRe = "@chat|@meeting";
    const greps = [1, 2, 3, 4, 5, 6].map((i) => grepOf(i, tagRe)).filter(Boolean).map((g) => new RegExp(g));
    for (const r of runs) expect(greps.filter((g) => g.test(r)).length, r).toBe(new RegExp(tagRe).test(r) ? 1 : 0);
  }, 60_000);

  it("the slowest full-run shard is within 25% of the median shard", () => {
    const s = loads(/(?:)/).shards.sort((a, b) => a - b);
    expect(s[5]).toBeLessThanOrEqual(1.25 * ((s[2] + s[3]) / 2));
  });

  it("for every feature tag, the slowest shard is its heaviest test or within 25% of an even split", () => {
    for (const tag of tags) {
      const { heaviest, total, shards } = loads(new RegExp(tag));
      expect(Math.max(...shards), tag).toBeLessThanOrEqual(Math.max(heaviest, 1.25 * (total / 6)));
    }
  });
});

describe("fix round: shared modules, deleted and renamed specs, deleted sources", () => {
  const without = (gone: string[]) => (f: string) => {
    if (gone.includes(f)) throw new Error(`ENOENT: ${f}`);
    return readRepo(f);
  };
  const source = (f: string) => /^(apps|packages)\/[^/]+\/src\/.*\.tsx?$/.test(f) && !/\.(test|testkit)\.tsx?$/.test(f);

  it("every bots source runs everything (the shared live.ts and scheduler.ts drive every bot game)", () => {
    for (const f of files.filter((f) => f.startsWith("packages/bots/src/") && source(f))) expect(run([f]), f).toMatchObject(FULL);
  });

  it("every module a shared (*) module imports directly runs everything, even when an entry imports it too", () => {
    const shared = Object.keys(features).filter((f) => features[f] === "*");
    const fed = [...graph.importers].filter(([, by]) => by.some((x) => shared.includes(x))).map(([f]) => f).filter((f) => !features[f]); // an entry point stops the walk at its own tags
    expect(fed).toContain("packages/bots/src/index.ts");
    for (const f of fed) expect(run([f]), f).toMatchObject(FULL);
  });

  it("a deleted spec does not crash, runs nothing for itself and keeps the other changes' tags", () => {
    const read = without(["apps/web/e2e/landing.spec.ts"]);
    expect(run(["apps/web/e2e/landing.spec.ts"], read)).toMatchObject({ full: false, tags: "", sim: 0 });
    expect(run(["apps/web/e2e/landing.spec.ts", "apps/web/src/screens/Meetings.tsx"], read)).toMatchObject({ full: false, tags: "@meeting" });
  });

  it("a renamed spec runs its tag at the new path", () => {
    const from = "apps/web/e2e/landing.spec.ts";
    const to = "apps/web/e2e/landing-renamed.spec.ts";
    const read = (f: string) => (f === to ? readRepo(from) : without([from])(f));
    expect(run([from, to], read)).toMatchObject({ full: false, tags: "@lobby" });
  });

  it("a deleted source file runs everything, whatever still imported it", () => {
    for (const gone of ["apps/web/src/components/Chip.tsx", "apps/web/src/screens/Meetings.tsx", "packages/engine/src/meeting.ts", "apps/server/src/chat.ts"]) {
      const g = buildGraph(files.filter((f) => f !== gone), without([gone]));
      const f2 = Object.fromEntries(Object.entries(features).filter(([f]) => f !== gone));
      expect(scope([gone], g, f2, without([gone])), gone).toMatchObject(FULL);
    }
  });
});

// QA for #272: CI runs only what a change needs; mixed diffs get the union, never less.
describe("CI scope classes on the real repo (#272)", () => {
  const ENGINE = "packages/engine/src/meeting.ts";
  const WEB = "apps/web/src/screens/Meetings.tsx";
  const SERVER = "apps/server/src/lobby.ts";

  it("every pipeline path runs the scripts tests and the pipeline checks only, docs/pipeline markdown included", () => {
    for (const f of [".github/workflows/ci.yml", ".github/workflows/agent.yml", "docs/pipeline/qa.md", "docs/pipeline/runner/poll.sh", "scripts/agent-start.ts", "scripts/runner.test.ts"])
      expect(run([f]), f).toMatchObject({ full: false, unit: "scripts", tags: "", sim: 0, pipeline: true });
  });

  it("markdown inside apps and packages counts as docs", () => {
    expect(run(["packages/engine/README.md", "apps/web/e2e/README.md"])).toMatchObject({ full: false, unit: "", tags: "", sim: 0, pipeline: false });
  });

  it("a pipeline change alongside scripts/scope.mjs or other config still runs everything", () => {
    expect(run([".github/workflows/ci.yml", "scripts/scope.mjs"])).toMatchObject(FULL);
    expect(run(["docs/pipeline/qa.md", "package.json"])).toMatchObject(FULL);
  });

  it("pipeline plus engine runs both: the engine's tests and sim, and the pipeline checks", () => {
    const s = run([ENGINE, ".github/workflows/ci.yml"]);
    const alone = run([ENGINE]);
    expect(alone.full).toBe(false);
    expect(s).toMatchObject({ full: false, sim: alone.sim, tags: alone.tags, pipeline: true });
    expect(s.unit.split(" ").sort()).toEqual([...alone.unit.split(" "), "scripts"].sort());
  });

  it("docs alongside code never drop the code's tests", () => {
    for (const f of [WEB, SERVER, ENGINE]) {
      const alone = run([f]);
      expect(run([f, "docs/testing.md", "README.md"]), f).toEqual(alone);
    }
  });

  it("the server runs its unit tests and the e2e its contract reaches (@lobby, @host), but no sim or pipeline checks", () => {
    const s = run([SERVER]);
    expect(s).toMatchObject({ full: false, sim: 0, pipeline: false });
    expect(s.unit.split(" ")).toContain("apps/server");
    expect(s.tags.split("|")).toEqual(expect.arrayContaining(["@lobby", "@host"]));
  });

  it("docs/design.md with a pipeline change runs the content and web tests plus the pipeline checks", () => {
    expect(run(["docs/design.md", "docs/pipeline/common.md"])).toMatchObject({ full: false, unit: "apps/web packages/content scripts", tags: "", sim: 0, pipeline: true });
  });

  it("no changed paths (a push to main, the nightly run) runs everything, the pipeline checks included", () => {
    expect(run([])).toMatchObject(FULL);
    expect(run([""])).toMatchObject(FULL);
  });
});
