import { describe, expect, it } from "vitest";
import { buildGraph, scope, shard } from "./scope.mjs";

// A tiny repo: web -> engine -> content, one shared web module, entry points for chat and meeting.
const text: Record<string, string> = {
  "apps/server/package.json": '{"name":"@skimjob/server","dependencies":{"@skimjob/engine":"workspace:*"}}',
  "apps/server/src/chat.ts": 'import { x } from "@skimjob/engine";',
  "apps/server/src/clock.ts": "export const clock = 1;",
  "apps/server/src/live.ts": 'import { x } from "@skimjob/engine";',
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
const none = { full: false, tags: "", sim: 0 };

describe("scope", () => {
  it("runs the whole unit set and no browser for docs only", () => {
    expect(run("docs/testing.md", "README.md")).toMatchObject({ ...none, unit: "all" });
  });
  it("runs everything for config, unknown paths and an empty diff", () => {
    for (const f of ["package.json", "apps/web/package.json", "scripts/scope.mjs", ".github/workflows/ci.yml", "apps/web/e2e/features.json", "apps/server/migrations/001.sql"]) {
      expect(run(f)).toMatchObject({ full: true, unit: "all", tags: "all", sim: 200 });
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
  const weights = { "e2e/a.spec.ts": 300, "e2e/b.spec.ts": 200, "e2e/c.spec.ts": 150, "e2e/d.spec.ts": 150 };
  const specs = [...Object.keys(weights), "e2e/new.spec.ts"];
  it("gives every spec file to exactly one shard", () => {
    const all = [1, 2, 3].flatMap((i) => shard(specs, weights, i, 3));
    expect(all.sort()).toEqual([...specs].sort());
  });
  it("puts the heaviest files on different shards and counts an unlisted file as 60 s", () => {
    expect(shard(specs, weights, 1, 3)).toEqual(["e2e/a.spec.ts"]);
    expect(shard(specs, weights, 2, 3)).toEqual(["e2e/b.spec.ts", "e2e/new.spec.ts"]);
    expect(shard(specs, weights, 3, 3)).toEqual(["e2e/c.spec.ts", "e2e/d.spec.ts"]);
  });
});
