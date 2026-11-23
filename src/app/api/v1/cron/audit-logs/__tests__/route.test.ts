import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockPrune } = vi.hoisted(() => ({ mockPrune: vi.fn() }));

vi.mock("@/services/audit/retention", () => ({
  pruneAuditLogs: mockPrune,
}));

import { POST } from "../route";

const SECRET = "test-cron-secret";

const RESULT = {
  mode: "dry_run",
  tables: [{ audited_table: "users", eligible: 2, deleted: 0 }],
  eligible: 2,
  deleted: 0,
  more: false,
  storage: { total_bytes: 1, estimated_rows: 1 },
};

function makeReq(auth?: string) {
  return new NextRequest("http://localhost/api/v1/cron/audit-logs", {
    method: "POST",
    headers: auth ? { Authorization: auth } : {},
  });
}

const authed = () => POST(makeReq(`Bearer ${SECRET}`));

describe("POST /api/v1/cron/audit-logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", SECRET);
    mockPrune.mockResolvedValue(RESULT);
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
    expect(mockPrune).not.toHaveBeenCalled();
  });

  it("is a 401 without the secret", async () => {
    const res = await POST(makeReq("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(mockPrune).not.toHaveBeenCalled();
  });

  it("runs the prune and returns its result", async () => {
    const res = await authed();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: RESULT });
    expect(console.info).toHaveBeenCalledWith(
      "Audit-log prune (dry_run): 2 past retention, 0 deleted",
    );
  });

  it("is a 500 with no error detail when the prune fails", async () => {
    mockPrune.mockRejectedValue(new Error("Audit-log prune failed: boom"));
    const res = await authed();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(json)).not.toContain("boom");
  });
});
