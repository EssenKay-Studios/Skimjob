// A simulator worker thread (pool.ts): runs tasks sent by the main thread.
import { parentPort } from "node:worker_threads";
import { runTask, type Task } from "./tasks";

if (!parentPort) throw new Error("worker.ts runs as a worker thread (see pool.ts)");
const port = parentPort;
port.on("message", (msg: { id: number; task: Task }) => {
  try {
    port.postMessage({ id: msg.id, result: runTask(msg.task) });
  } catch (e) {
    port.postMessage({ id: msg.id, error: (e as Error).stack ?? String(e) });
  }
});
