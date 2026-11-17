import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockSweep } = vi.hoisted(() => ({ mockSweep: vi.fn() }));

vi.mock("@/services/refunds/sweep", () => ({
  sweepUnfiredRefunds: mockSweep,
}));

import { POST } from "../route";

const SECRET = "test-cron-secret";

function makeReq(auth?: string) {
  return new NextRequest("http://localhost/api/v1/cron/refunds", {
    method: "POST",
    headers: auth ? { Authorization: auth } : {},
  });
}

const authed = () => POST(makeReq(`Bearer ${SECRET}`));

describe("POST /api/v1/cron/refunds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", SECRET);
    mockSweep.mockResolvedValue({ fired: 0, outcomes: {}, more: false });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is a 500 when CRON_SECRET isn't configured", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const res = await authed();

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("MISCONFIGURED");
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong secret", async () => {
    for (const auth of [undefined, "Bearer nope", SECRET]) {
      const res = await POST(makeReq(auth));
      expect(res.status).toBe(401);
    }
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("runs one sweep and returns its counts", async () => {
    const stats = { fired: 7, outcomes: { refunded: 6, error: 1 }, more: true };
    mockSweep.mockResolvedValue(stats);

    const res = await authed();

    expect(res.status).toBe(200);
    expect(mockSweep).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ data: stats });
  });

  it("is a 500 when the sweep can't load its work list", async () => {
    mockSweep.mockRejectedValue(new Error("db down"));

    const res = await authed();

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL_ERROR");
  });
});
