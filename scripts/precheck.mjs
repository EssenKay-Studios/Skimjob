// `pnpm precheck`: everything CI would fail on, run before the push (docs/testing.md "Precheck").
//   typecheck, knip and the theme-token lint (in parallel), then `pnpm test:scoped`, then Playwright
//   --repeat-each=3 on the e2e specs this branch adds or changes against origin/main (flaky new specs show up here).
// Nothing changed against origin/main except .md files: nothing runs and it exits at once.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SPEC, changedPaths } from "./scope.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (what) => (console.error(`\nprecheck FAILED: ${what}`), process.exit(1));

const changed = changedPaths().filter((f) => !f.endsWith(".md"));
const specs = changed.filter((f) => SPEC.test(f) && existsSync(join(root, f))).map((f) => f.replace("apps/web/", ""));

const quiet = (label, cmd, args) =>
  new Promise((done) => {
    let log = "";
    const p = spawn(cmd, args, { cwd: root });
    p.stdout.on("data", (d) => (log += d));
    p.stderr.on("data", (d) => (log += d));
    p.on("close", (code) => (console.log(`${code === 0 ? "ok  " : "FAIL"} ${label}`), code !== 0 && console.log(log), done(code === 0)));
  });

if (!changed.length) {
  console.log("precheck ok: only docs (or nothing) changed against origin/main, nothing to check");
  process.exit(0);
}
const static_ = await Promise.all([
  quiet("pnpm typecheck", "pnpm", ["typecheck"]),
  quiet("pnpm knip", "pnpm", ["knip"]),
  quiet("pnpm lint:theme", "pnpm", ["lint:theme"]),
]);
if (!static_.every(Boolean)) fail("fix the static checks above");

if (spawnSync("pnpm", ["test:scoped"], { cwd: root, stdio: "inherit" }).status !== 0) fail("pnpm test:scoped");
if (specs.length) {
  console.log(`\nplaywright --repeat-each=3: ${specs.join(" ")}`);
  const r = spawnSync("npx", ["playwright", "test", "--repeat-each=3", ...specs], { cwd: join(root, "apps/web"), stdio: "inherit" });
  if (r.status !== 0) fail("a new or changed e2e spec failed or is flaky (--repeat-each=3)");
}
console.log("\nprecheck ok");
