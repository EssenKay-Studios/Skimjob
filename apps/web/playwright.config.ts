import { defineConfig, devices } from "@playwright/test";

// Chromium comes preinstalled (PLAYWRIGHT_BROWSERS_PATH); @playwright/test is
// pinned to the same version so no browser download is needed.
//
// Two game servers, each with its own Vite dev server in front (in-memory
// PGlite, never a dev server's ports):
// - the main one at TIME_SCALE 0.1 (E2E_TIME_SCALE), for everything that
//   needs time to look around (30 s rounds and 18 s vote windows in the 1-hour preset);
// - a fast one at TIME_SCALE 0.05 (E2E_FAST_TIME_SCALE) for the full Quick
//   games tagged @fast-clock (the slowest tests), run by the *-fast projects.
// Ports come from the environment so two clones can run E2E side by side:
// E2E_PORT (web, default 5179), E2E_SERVER_PORT (3179), E2E_FAST_PORT (5180), E2E_FAST_SERVER_PORT (3180).
// CI shards the suite: `playwright test --shard=i/N` (.github/workflows/ci.yml).
const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const port = num("E2E_PORT", 5179);
const serverPort = num("E2E_SERVER_PORT", 3179);
const fastPort = num("E2E_FAST_PORT", 5180);
const fastServerPort = num("E2E_FAST_SERVER_PORT", 3180);
const scale = process.env.E2E_TIME_SCALE ?? "0.1";
const fastScale = process.env.E2E_FAST_TIME_SCALE ?? "0.05";

/** Tests that play a whole Quick game: they run on the fast clock only. */
const FAST = /@fast-clock/;

const servers = (web: number, api: number, timeScale: string) => [
  {
    command: "pnpm --filter @skimjob/server start",
    // The page's origin is the Vite port, which may be any port here.
    env: { PORT: String(api), PGLITE_DIR: "memory", TIME_SCALE: timeScale, ALLOWED_ORIGINS: `http://localhost:${web},http://127.0.0.1:${web}` },
    url: `http://127.0.0.1:${api}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  {
    command: `pnpm exec vite --port ${web} --strictPort`,
    env: { SKIMJOB_SERVER: `http://127.0.0.1:${api}` },
    url: `http://localhost:${web}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
];

const mobile = { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } };
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } };

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: `http://localhost:${port}` },
  // Project names start with "mobile" or "desktop": specs that pick a viewport check the prefix.
  projects: [
    { name: "mobile", grepInvert: FAST, use: mobile },
    { name: "desktop", grepInvert: FAST, use: desktop },
    { name: "mobile-fast", grep: FAST, use: { ...mobile, baseURL: `http://localhost:${fastPort}` } },
    { name: "desktop-fast", grep: FAST, use: { ...desktop, baseURL: `http://localhost:${fastPort}` } },
  ],
  webServer: [...servers(port, serverPort, scale), ...servers(fastPort, fastServerPort, fastScale)],
});
