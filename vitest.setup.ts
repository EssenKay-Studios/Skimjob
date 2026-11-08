import { afterEach } from "vitest";

// A file of back-to-back CPU-bound tests never leaves the microtask queue, so the worker can't read
// the reply to its "onTaskUpdate" RPC and vitest's fixed 60 s timeout fires once the file passes
// ~60 s (#170). A macrotask turn after each test lets the reply in.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
