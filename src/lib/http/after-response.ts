import { AsyncLocalStorage } from "node:async_hooks";
import { after } from "next/server";

type Task = () => unknown;

/** The queue of the innermost `inOrderAfterResponse` scope, if any. */
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
    // Outside a request, or the platform gives `after` no way to outlive the
    // response. Run it now rather than drop it, and say so: on a serverless
    // runtime, work left running after the response may be frozen mid-way.
    console.error(
      "afterResponse: after() is unavailable; running the task without waiting",
      err,
    );
    void callback();
  }
}

/**
 * Runs `task` once the response has been sent, so side effects such as
 * notification emails don't hold up the request. The platform keeps the
 * function alive until the task settles (Next's `after()`, backed by
 * `waitUntil`).
 *
 * A failing task is logged and never reaches the caller. Tasks scheduled this
 * way run concurrently, with no ordering between them, unless they are
 * scheduled inside `inOrderAfterResponse`.
 */
export function afterResponse(task: Task): void {
  const queue = orderedScope.getStore();
  if (queue) {
    queue.push(task);
    return;
  }
  schedule(() => runSafely(task));
}

/**
 * Runs `fn` now. Every `afterResponse` task it schedules, directly or from
 * anything it awaits, runs after the response one at a time, in the order it
 * was scheduled, each waiting for the previous one to settle.
 *
 * For emails whose order the reader sees: "your payout was approved" has to
 * arrive before "your payout was sent", even when the send completes inside
 * the same request. Only work `fn` awaits is covered; a task scheduled after
 * `fn` has settled falls outside the scope.
 */
export async function inOrderAfterResponse<T>(fn: () => Promise<T>): Promise<T> {
  const queue: Task[] = [];
  try {
    return await orderedScope.run(queue, fn);
  } finally {
    // Scheduled even when fn throws: the work before the throw has happened,
    // and so should the emails that go with it.
    if (queue.length > 0) {
      schedule(async () => {
        for (const task of queue) await runSafely(task);
      });
    }
  }
}
