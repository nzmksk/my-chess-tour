import { AsyncLocalStorage } from "node:async_hooks";
import { after } from "next/server";

type Task = () => unknown;

const orderedScope = new AsyncLocalStorage<Task[]>();

async function runSafely(task: Task): Promise<void> {
  try {
    await task();
  } catch (err) {
    console.error("afterResponse: a task scheduled after the response failed", err);
  }
}

function schedule(callback: () => Promise<void>): void {
  try {
    after(callback);
  } catch (err) {
    console.error(
      "afterResponse: after() is unavailable; running the task without waiting",
      err,
    );
    void callback();
  }
}

export function afterResponse(task: Task): void {
  const queue = orderedScope.getStore();
  if (queue) {
    queue.push(task);
    return;
  }
  schedule(() => runSafely(task));
}

export async function inOrderAfterResponse<T>(fn: () => Promise<T>): Promise<T> {
  const queue: Task[] = [];
  try {
    return await orderedScope.run(queue, fn);
  } finally {
    if (queue.length > 0) {
      schedule(async () => {
        for (const task of queue) await runSafely(task);
      });
    }
  }
}
