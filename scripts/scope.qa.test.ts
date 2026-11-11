// QA for #87 (scripts/scope.mjs on the real repo): the scoped set must be a superset of what a change affects.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraph, scope, shard } from "./scope.mjs";

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

describe("shard on the real spec list", () => {
  const specs = files.filter((f) => /^apps\/web\/e2e\/.*\.spec\.ts$/.test(f)).map((f) => f.replace("apps/web/", ""));
  const raw: Record<string, number> = JSON.parse(readRepo("apps/web/e2e/shard-weights.json"));
  const weights = Object.fromEntries(Object.entries(raw).map(([f, w]) => [`e2e/${f}`, w]));

  it("puts every spec file on exactly one of the 6 shards, a spec missing from the weights file included", () => {
    for (const list of [specs, [...specs, "e2e/zz-unweighted.qa.spec.ts"]]) {
      const all = [1, 2, 3, 4, 5, 6].flatMap((i) => shard(list, weights, i, 6));
      expect(all.sort()).toEqual([...list].sort());
    }
  });

  it("ignores weights of spec files that no longer exist", () => {
    const all = [1, 2, 3, 4, 5, 6].flatMap((i) => shard(specs, { ...weights, "e2e/deleted.spec.ts": 999 }, i, 6));
    expect(all).not.toContain("e2e/deleted.spec.ts");
    expect(all).toHaveLength(specs.length);
  });

  it("works with more shards than spec files", () => {
    const few = specs.slice(0, 2);
    const all = [1, 2, 3, 4, 5, 6].flatMap((i) => shard(few, weights, i, 6));
    expect(all.sort()).toEqual([...few].sort());
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

  it("a renamed spec runs its tag at the new path and lands on exactly one shard", () => {
    const from = "apps/web/e2e/landing.spec.ts";
    const to = "apps/web/e2e/landing-renamed.spec.ts";
    const read = (f: string) => (f === to ? readRepo(from) : without([from])(f));
    expect(run([from, to], read)).toMatchObject({ full: false, tags: "@lobby" });
    const specs = files.filter((f) => /^apps\/web\/e2e\/.*\.spec\.ts$/.test(f) && f !== from).concat(to).map((f) => f.replace("apps/web/", ""));
    const all = [1, 2, 3, 4, 5, 6].flatMap((i) => shard(specs, {}, i, 6));
    expect(all.filter((f) => f === "e2e/landing-renamed.spec.ts")).toHaveLength(1);
    expect(all).not.toContain("e2e/landing.spec.ts");
  });

  it("a deleted source file runs everything, whatever still imported it", () => {
    for (const gone of ["apps/web/src/components/Chip.tsx", "apps/web/src/screens/Meetings.tsx", "packages/engine/src/meeting.ts", "apps/server/src/chat.ts"]) {
      const g = buildGraph(files.filter((f) => f !== gone), without([gone]));
      const f2 = Object.fromEntries(Object.entries(features).filter(([f]) => f !== gone));
      expect(scope([gone], g, f2, without([gone])), gone).toMatchObject(FULL);
    }
  });
});
