import { expect, test } from "vitest";

// vitest.setup.ts yields one macrotask after each test so the worker can read vitest's onTaskUpdate
// reply during a long run of CPU-bound tests (#170). Without the setup file the second test below fails.
let immediateRan = false;

test("a test schedules a setImmediate callback and returns", () => {
  setImmediate(() => {
    immediateRan = true;
  });
});

test("the next test starts after a macrotask turn", () => {
  expect(immediateRan).toBe(true);
});
