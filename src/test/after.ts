import { vi } from "vitest";

/**
 * Test double for `after` from `next/server`, installed for every test by
 * `setup.ts`.
 *
 * Callbacks are held, not run, the way Next holds them until the response has
 * been sent. A test that expects work scheduled after the response (such as a
 * notification email) calls `runAfterCallbacks()` once the handler has
 * returned, which also proves the handler didn't wait for that work.
 */
const pending: Array<() => unknown> = [];

export const after = vi.fn((task: (() => unknown) | PromiseLike<unknown>) => {
  pending.push(typeof task === "function" ? task : () => task);
});

/** Runs held callbacks, concurrently like Next, including any they schedule. */
export async function runAfterCallbacks(): Promise<void> {
  while (pending.length > 0) {
    const batch = pending.splice(0);
    await Promise.all(batch.map((callback) => callback()));
  }
}

export function resetAfterCallbacks(): void {
  pending.length = 0;
  after.mockClear();
}
