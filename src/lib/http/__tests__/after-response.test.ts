import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { after, runAfterCallbacks } from "@/test/after";
import { afterResponse, inOrderAfterResponse } from "../after-response";

/** A task whose completion the test controls. */
function deferredTask(log: string[], name: string) {
  let finish!: () => void;
  const task = vi.fn(() => {
    log.push(`${name}:start`);
    return new Promise<void>((resolve) => {
      finish = () => {
        log.push(`${name}:end`);
        resolve();
      };
    });
  });
  return { task, finish: () => finish() };
}

describe("afterResponse", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("holds the task until the response has been sent", async () => {
    const task = vi.fn(async () => {});

    afterResponse(task);

    expect(after).toHaveBeenCalledTimes(1);
    expect(task).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("logs a failing task instead of throwing", async () => {
    afterResponse(async () => {
      throw new Error("Resend is down");
    });

    await expect(runAfterCallbacks()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("failed"),
      expect.objectContaining({ message: "Resend is down" }),
    );
  });

  it("runs the task straight away when after() is unavailable", async () => {
    after.mockImplementationOnce(() => {
      throw new Error("`after` was called outside a request scope");
    });
    const task = vi.fn(async () => {});

    afterResponse(task);

    expect(task).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("unavailable"),
      expect.any(Error),
    );
  });
});

describe("inOrderAfterResponse", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("runs tasks one at a time in the order they were scheduled, including from awaited calls", async () => {
    const log: string[] = [];
    const first = deferredTask(log, "approved");
    const second = deferredTask(log, "processed");

    async function settle() {
      await Promise.resolve();
      afterResponse(second.task);
    }

    const result = await inOrderAfterResponse(async () => {
      afterResponse(first.task);
      await settle();
      return "sent";
    });

    expect(result).toBe("sent");
    expect(after).toHaveBeenCalledTimes(1);
    expect(log).toEqual([]);

    const running = runAfterCallbacks();
    await vi.waitFor(() => expect(log).toEqual(["approved:start"]));
    first.finish();
    await vi.waitFor(() =>
      expect(log).toEqual(["approved:start", "approved:end", "processed:start"]),
    );
    second.finish();
    await running;
    expect(log).toEqual([
      "approved:start",
      "approved:end",
      "processed:start",
      "processed:end",
    ]);
  });

  it("keeps going after a failing task", async () => {
    const later = vi.fn(async () => {});

    await inOrderAfterResponse(async () => {
      afterResponse(async () => {
        throw new Error("Resend is down");
      });
      afterResponse(later);
    });
    await runAfterCallbacks();

    expect(later).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });

  it("still schedules the tasks queued before fn threw, and rethrows", async () => {
    const task = vi.fn(async () => {});

    await expect(
      inOrderAfterResponse(async () => {
        afterResponse(task);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await runAfterCallbacks();

    expect(task).toHaveBeenCalledTimes(1);
  });

  it("schedules nothing when fn queued nothing", async () => {
    await inOrderAfterResponse(async () => {});

    expect(after).not.toHaveBeenCalled();
  });

  it("leaves tasks scheduled outside the scope unordered", async () => {
    await inOrderAfterResponse(async () => {});
    afterResponse(async () => {});

    expect(after).toHaveBeenCalledTimes(1);
  });
});
