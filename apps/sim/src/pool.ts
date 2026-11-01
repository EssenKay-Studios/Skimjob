// A pool of worker threads for the simulator. Each game is a pure function of
// its settings and index (design §17.2), so which worker plays it changes
// nothing: callers put results back in index order and get the same output
// for any pool size. One worker or fewer runs tasks on the main thread.
import { availableParallelism } from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { runTask, type Task, type TaskResult } from "./tasks";

export interface Pool {
  readonly size: number;
  run<T extends Task>(task: T): Promise<TaskResult<T>>;
  close(): Promise<void>;
}

export const defaultWorkers = (): number => availableParallelism();

/** The workers run TypeScript sources too, so they load tsx (a root dev dependency) as the CLI does. */
const tsxLoader = (): string => pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

function inlinePool(): Pool {
  return {
    size: 1,
    // Yield first, so progress output and other callbacks get a turn between tasks.
    run: <T extends Task>(task: T) => new Promise<TaskResult<T>>((resolve, reject) => {
      setImmediate(() => {
        try {
          resolve(runTask(task) as TaskResult<T>);
        } catch (e) {
          reject(e as Error);
        }
      });
    }),
    close: async () => {},
  };
}

interface Job {
  readonly id: number;
  readonly task: Task;
  readonly resolve: (v: unknown) => void;
  readonly reject: (e: Error) => void;
}

export function createPool(workers: number): Pool {
  if (workers <= 1) return inlinePool();
  const url = new URL("./worker.ts", import.meta.url);
  const execArgv = ["--import", tsxLoader()];
  const queue: Job[] = [];
  const busy = new Map<Worker, Job>();
  const idle: Worker[] = [];
  let nextId = 0;
  let failure: Error | null = null;
  let closing = false;

  const pump = (): void => {
    while (idle.length > 0 && queue.length > 0) {
      const w = idle.pop() as Worker;
      const job = queue.shift() as Job;
      busy.set(w, job);
      w.postMessage({ id: job.id, task: job.task });
    }
  };
  const fail = (e: Error): void => {
    failure ??= e;
    for (const job of [...busy.values(), ...queue.splice(0)]) job.reject(e);
    busy.clear();
  };

  const all: Worker[] = [];
  for (let i = 0; i < workers; i++) {
    const w = new Worker(url, { execArgv });
    w.on("message", (msg: { id: number; result?: unknown; error?: string }) => {
      const job = busy.get(w);
      busy.delete(w);
      idle.push(w);
      if (job && job.id === msg.id) {
        if (msg.error !== undefined) job.reject(new Error(msg.error));
        else job.resolve(msg.result);
      }
      pump();
    });
    w.on("error", fail);
    w.on("exit", (code) => {
      if (code !== 0 && !closing) fail(new Error(`simulator worker exited with code ${code}`));
    });
    all.push(w);
    idle.push(w);
  }

  return {
    size: workers,
    run: <T extends Task>(task: T) =>
      new Promise<TaskResult<T>>((resolve, reject) => {
        if (failure) return reject(failure);
        queue.push({ id: nextId++, task, resolve: resolve as (v: unknown) => void, reject });
        pump();
      }),
    close: async () => {
      closing = true;
      await Promise.all(all.map((w) => w.terminate()));
    },
  };
}
