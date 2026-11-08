import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "scripts/*.test.ts"],
    // One worker on CI (2 cores): with two, the main process is starved and a worker's "onTaskUpdate" RPC
    // (60 s, not configurable) times out after every test passed (#170).
    maxWorkers: process.env.CI ? 1 : undefined,
  },
});
