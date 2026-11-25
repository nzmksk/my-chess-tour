import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));

vi.mock("@/services/guardianship/age-out", () => ({
  runGuardianshipAgeOuts: mockRun,
}));

import { POST } from "../route";

const SECRET = "test-cron-secret";

function makeReq(auth?: string) {
  return new NextRequest("http://localhost/api/v1/cron/guardianships", {
    method: "POST",
    headers: auth ? { Authorization: auth } : {},
  });
}

const authed = () => POST(makeReq(`Bearer ${SECRET}`));

describe("POST /api/v1/cron/guardianships", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", SECRET);
    mockRun.mockResolvedValue({ ended: 0, notices: 0, emailed: 0, failed: 0 });
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
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong secret", async () => {
    for (const auth of [undefined, "Bearer nope", SECRET]) {
      const res = await POST(makeReq(auth));
      expect(res.status).toBe(401);
    }
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("runs the age-outs and returns their counts", async () => {
    const stats = { ended: 1, notices: 2, emailed: 3, failed: 0 };
    mockRun.mockResolvedValue(stats);
    const res = await authed();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: stats });
  });

  it("is a 500 when the run fails, without leaking why", async () => {
    mockRun.mockRejectedValue(
      new Error("end_aged_out_minor_guardianships failed: secret detail"),
    );
    const res = await authed();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
