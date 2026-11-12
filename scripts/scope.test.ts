import { describe, expect, it } from "vitest";
import { buildGraph, scope, shard, testsOf } from "./scope.mjs";

// A tiny repo: web -> engine -> content, one shared web module, entry points for chat and meeting.
const text: Record<string, string> = {
  "apps/server/package.json": '{"name":"@skimjob/server","dependencies":{"@skimjob/engine":"workspace:*"}}',
  "apps/server/src/chat.ts": 'import { x } from "@skimjob/engine"; import { h } from "./helper";',
  "apps/server/src/helper.ts": "export const h = 1;",
  "apps/server/src/clock.ts": "export const clock = 1;",
  "apps/server/src/live.ts": 'import { x } from "@skimjob/engine"; import { h } from "./helper";',
  "apps/web/package.json": '{"name":"@skimjob/web","dependencies":{"@skimjob/engine":"workspace:*"}}',
  "apps/web/src/api.ts": "export const api = 1;",
  "apps/web/src/lonely.ts": "export const lonely = 1;",
  "apps/web/src/Chat.tsx": 'import { api } from "./api"; import "./chat.css";',
  "apps/web/src/chat.css": "",
  "apps/web/src/Meeting.tsx": 'import { api } from "./api"; import { reduce } from "@skimjob/engine";',
  "apps/web/src/Lobby.tsx": 'import { api } from "./api"; import { reduce } from "@skimjob/engine";',
  "apps/web/src/Chat.test.ts": 'import "./Chat";',
  "apps/web/e2e/chat.spec.ts": 'import { go } from "./go"; test("chat @chat @fast-clock", () => {});',
  "apps/web/e2e/go.ts": "export const go = 1;",
  "apps/web/e2e/meeting.spec.ts": 'import { go } from "./go"; test("meeting @meeting", () => {});',
  "packages/engine/package.json": '{"name":"@skimjob/engine","dependencies":{"@skimjob/content":"workspace:*"}}',
  "packages/engine/src/index.ts": 'export * from "./meeting"; export * from "./reduce";',
  "packages/engine/src/meeting.ts": 'import { reduce } from "./reduce";',
  "packages/engine/src/reduce.ts": "export const reduce = 1;",
  "packages/content/package.json": '{"name":"@skimjob/content"}',
  "packages/content/src/index.ts": "export const rooms = 1;",
};
const features = {
  "apps/server/src/chat.ts": "@chat",
  "apps/server/src/live.ts": "*",
  "apps/web/src/Chat.tsx": "@chat",
  "apps/web/src/Meeting.tsx": "@meeting",
  "apps/web/src/Lobby.tsx": ["@lobby", "@auth"],
  "packages/engine/src/meeting.ts": "@meeting",
};
const read = (f: string) => text[f];
const run = (...changed: string[]) => scope(changed, buildGraph(Object.keys(text), read), features, read);
const none = { full: false, tags: "", sim: 0, pipeline: false };

describe("scope", () => {
  it("runs no unit test, browser, sim or pipeline check for docs only (#272)", () => {
    expect(run("docs/testing.md", "README.md", "docs/balance/baseline.json")).toMatchObject({ ...none, unit: "", pipeline: false });
  });
  it("runs the content and web unit tests that read docs/design.md, and nothing else (#272)", () => {
    expect(run("docs/design.md", "docs/testing.md")).toMatchObject({ ...none, unit: "apps/web packages/content" });
  });
  it("runs only the scripts tests and the pipeline checks for the pipeline (#272)", () => {
    for (const f of ["docs/pipeline/runner/poll.sh", "docs/pipeline/common.md", "scripts/agent-start.ts", "scripts/runner.test.ts", ".github/workflows/ci.yml"]) {
      expect(run(f), f).toMatchObject({ ...none, unit: "scripts", pipeline: true });
    }
    expect(run("docs/pipeline/verdicts.sh", "apps/web/src/Chat.tsx")).toMatchObject({ ...none, tags: "@chat", unit: "apps/web scripts", pipeline: true });
  });
  it("runs everything for config, unknown paths and an empty diff", () => {
    for (const f of ["package.json", "apps/web/package.json", "scripts/scope.mjs", "scripts/sim-smoke.sh", "apps/web/e2e/features.json", "apps/server/migrations/001.sql"]) {
      expect(run(f)).toMatchObject({ full: true, unit: "all", tags: "all", sim: 200, pipeline: true });
    }
    expect(run()).toMatchObject({ full: true });
  });
  it("runs an entry point's own tags and its package's unit tests", () => {
    expect(run("apps/web/src/Meeting.tsx")).toMatchObject({ ...none, tags: "@meeting", unit: "apps/web" });
    expect(run("apps/web/src/Lobby.tsx")).toMatchObject({ tags: "@auth|@lobby" });
  });
  it("follows imports up to the entry points, css included", () => {
    expect(run("apps/web/src/chat.css")).toMatchObject({ ...none, tags: "@chat" });
  });
  it("runs everything for a module that reaches no entry or 3+ tags", () => {
    expect(run("apps/web/src/lonely.ts").full).toBe(true);
    expect(run("apps/web/src/api.ts")).toMatchObject({ full: true });
  });
  it("runs everything for a module marked shared", () => {
    expect(run("apps/server/src/live.ts")).toMatchObject({ full: true });
  });
  it("runs everything for a module that a shared module imports, even when an entry imports it too", () => {
    expect(run("apps/server/src/helper.ts")).toMatchObject({ full: true, tags: "all" });
  });
  it("does not crash on a deleted or renamed spec, and runs nothing for it", () => {
    expect(run("apps/web/e2e/gone.spec.ts")).toMatchObject({ ...none, tags: "", unit: "" });
    expect(run("apps/web/e2e/gone.spec.ts", "apps/web/e2e/meeting.spec.ts")).toMatchObject({ tags: "@meeting" });
  });
  it("runs everything for a deleted source file nothing imports any more", () => {
    expect(run("apps/web/src/Gone.tsx")).toMatchObject({ full: true });
  });
  it("runs everything for a new spec without a feature tag", () => {
    const text2 = { ...text, "apps/web/e2e/new.spec.ts": 'test("no tag", () => {});' };
    const r = (f: string) => text2[f];
    expect(scope(["apps/web/e2e/new.spec.ts"], buildGraph(Object.keys(text2), r), features, r).full).toBe(true);
  });
  it("adds the lobby and host specs for server code", () => {
    expect(run("apps/server/src/chat.ts")).toMatchObject({ tags: "@chat|@host|@lobby", unit: "apps/server" });
  });
  it("adds the engine tests and a sim smoke for rule packages, and the packages that depend on them", () => {
    expect(run("packages/engine/src/meeting.ts")).toMatchObject({ tags: "@meeting", sim: 50, unit: "apps/server apps/web packages/engine" });
  });
  it("runs everything for a hub that every consumer of a package imports", () => {
    expect(run("packages/engine/src/reduce.ts").full).toBe(true);
    expect(run("packages/engine/src/index.ts").full).toBe(true);
  });
  it("runs only a test file's package for a unit test and the spec's tags for a spec", () => {
    expect(run("apps/web/src/Chat.test.ts")).toMatchObject({ ...none, unit: "apps/web" });
    expect(run("apps/web/e2e/chat.spec.ts")).toMatchObject({ ...none, tags: "@chat", unit: "" });
  });
  it("sends an e2e helper to the specs that import it", () => {
    expect(run("apps/web/e2e/go.ts")).toMatchObject({ tags: "@chat|@meeting" });
  });
  it("combines files and ignores docs next to code", () => {
    expect(run("docs/x.md", "apps/web/src/Chat.tsx", "apps/web/src/Meeting.tsx")).toMatchObject({ tags: "@chat|@meeting", unit: "apps/web" });
  });
});

describe("shard", () => {
  const weights = { "e2e/a.spec.ts:1": 300, "e2e/b.spec.ts:2": 200, "e2e/c.spec.ts:3": 150, "e2e/d.spec.ts:4": 150 };
  const units = Object.keys(weights);
  it("gives every test to exactly one shard", () => {
    const all = [1, 2, 3].flatMap((i) => shard(units, weights, i, 3));
    expect(all.sort()).toEqual([...units].sort());
  });
  it("puts the heaviest tests on different shards", () => {
    expect(shard(units, weights, 1, 3)).toEqual(["e2e/a.spec.ts:1"]);
    expect(shard(units, weights, 2, 3)).toEqual(["e2e/b.spec.ts:2"]);
    expect(shard(units, weights, 3, 3)).toEqual(["e2e/c.spec.ts:3", "e2e/d.spec.ts:4"]);
  });
});

describe("testsOf", () => {
  it("keys a test by file, describes and title, and keeps its line and results", () => {
    const report = { suites: [{ title: "a.spec.ts", file: "a.spec.ts", suites: [{ title: "group", specs: [{ title: "does it @x", file: "a.spec.ts", line: 7, tests: [] }] }] }] };
    expect(testsOf(report)).toEqual([{ key: "a.spec.ts > group > does it @x", file: "a.spec.ts", line: 7, title: "group does it @x", tests: [] }]);
  });
});
