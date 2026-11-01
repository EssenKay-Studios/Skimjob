import { defineConfig, devices } from "@playwright/test";

// Chromium comes preinstalled (PLAYWRIGHT_BROWSERS_PATH); @playwright/test is
// pinned to the same version so no browser download is needed.
const port = 5179;
// The game server for the lobby flows: in-memory PGlite, its own port so a dev server on 3000 isn't touched.
const serverPort = 3179;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      command: "pnpm --filter @skimjob/server start",
      // TIME_SCALE: Quick games run ten times faster, so the game E2E plays 9 rounds in under two minutes.
      env: { PORT: String(serverPort), PGLITE_DIR: "memory", TIME_SCALE: "0.1" },
      url: `http://127.0.0.1:${serverPort}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite --port ${port} --strictPort`,
      env: { SKIMJOB_SERVER: `http://127.0.0.1:${serverPort}` },
      url: `http://localhost:${port}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
