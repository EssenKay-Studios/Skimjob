// Production build of the server: one ESM file, dist/main.js, with the
// workspace packages (engine, content, bots) bundled in and every npm
// dependency left external (they come from node_modules; PGlite loads its
// WASM files from its own package). Run by the Dockerfile. docs/deploy.md
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.entries(pkg.dependencies)
  .filter(([, version]) => !String(version).startsWith("workspace:"))
  .flatMap(([name]) => [name, `${name}/*`]);

await build({
  entryPoints: [new URL("./src/main.ts", import.meta.url).pathname],
  outfile: new URL("./dist/main.js", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  // `pg` requires this only if it's installed (it isn't).
  external: [...external, "pg-native"],
  logLevel: "info",
});
