import { vi } from "vitest";

const pending: Array<() => unknown> = [];

export const after = vi.fn((task: (() => unknown) | PromiseLike<unknown>) => {
  pending.push(typeof task === "function" ? task : () => task);
});

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
