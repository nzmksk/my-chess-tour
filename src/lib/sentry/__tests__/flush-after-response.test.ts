import { beforeEach, describe, expect, it, vi } from "vitest";

const { after, flush } = vi.hoisted(() => ({
  after: vi.fn(),
  flush: vi.fn(async () => true),
}));

vi.mock("next/server", () => ({ after }));
vi.mock("@sentry/nextjs", () => ({ flush }));

import type { Event } from "@sentry/nextjs";
import { flushAfterResponseIntegration } from "../flush-after-response";

function run(event: Event) {
  return flushAfterResponseIntegration().processEvent(event);
}

describe("flushAfterResponseIntegration", () => {
  beforeEach(() => {
    after.mockReset();
    flush.mockClear();
  });

  it("schedules a flush after the response and passes the event through", async () => {
    const event: Event = { message: "Refund settle failed" };

    expect(run(event)).toBe(event);
    expect(after).toHaveBeenCalledTimes(1);
    expect(flush).not.toHaveBeenCalled();

    const scheduled = after.mock.calls[0][0] as () => Promise<boolean>;
    await scheduled();
    expect(flush).toHaveBeenCalledWith(2000);
  });

  it("still passes the event through outside a request scope", () => {
    after.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });
    const event: Event = { message: "startup error" };

    expect(run(event)).toBe(event);
    expect(flush).not.toHaveBeenCalled();
  });
});
