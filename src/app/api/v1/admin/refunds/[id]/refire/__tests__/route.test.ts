import { beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";

const { mockGetClaims, mockRpc, mockFire } = vi.hoisted(() => ({
  mockGetClaims: vi.fn(),
  mockRpc: vi.fn(),
  mockFire: vi.fn(),
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
    rpc: mockRpc,
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

vi.mock("@/services/supabase/admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/services/refunds/fire", () => ({ fireRefund: mockFire }));

import { POST } from "../route";

const ADMIN_USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const REFUND_ID = "bbbbbbbb-0000-0000-0000-000000000001";

const refire = (id = REFUND_ID) =>
  POST(
    new Request(`http://localhost/api/v1/admin/refunds/${id}/refire`, { method: "POST" }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: ADMIN_USER_ID } },
    error: null,
  });
  mockRpc.mockResolvedValue({ data: true, error: null });
  mockFire.mockResolvedValue("refunded");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/v1/admin/refunds/[id]/refire", () => {
  it("rejects a malformed id", async () => {
    expect((await refire("nope")).status).toBe(400);
    expect(mockFire).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: null });
    expect((await refire()).status).toBe(401);
    expect(mockFire).not.toHaveBeenCalled();
  });

  it("requires a platform admin", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    expect((await refire()).status).toBe(403);
    expect(mockRpc).toHaveBeenCalledWith("has_global_permission", {
      p_user_id: appIdFor(ADMIN_USER_ID),
      p_permission: "platform.manage",
    });
    expect(mockFire).not.toHaveBeenCalled();
  });

  it("500s when the permission check fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    expect((await refire()).status).toBe(500);
    expect(mockFire).not.toHaveBeenCalled();
  });

  it("re-fires with the CHIP check first and reports what happened", async () => {
    mockFire.mockResolvedValue("reconciled");
    const res = await refire();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { refund_id: REFUND_ID, outcome: "reconciled" },
    });
    expect(mockFire).toHaveBeenCalledWith(REFUND_ID, { reconcile: true });
  });

  it.each(["settled", "in_flight", "no_purchase", "rejected", "error", "processing"])(
    "answers 200 with a %s outcome so the admin is told why",
    async (outcome) => {
      mockFire.mockResolvedValue(outcome);
      const res = await refire();
      expect(res.status).toBe(200);
      expect((await res.json()).data.outcome).toBe(outcome);
    },
  );

  it("404s an unknown refund", async () => {
    mockFire.mockResolvedValue("not_found");
    expect((await refire()).status).toBe(404);
  });
});
