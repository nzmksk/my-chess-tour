import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockApplicationsBuilder, mockFrom, mockGetClaims, mockRpc } = vi.hoisted(
  () => {
    function makeBuilder(finalResult: {
      data?: unknown;
      count?: unknown;
      error?: unknown;
    }) {
      const b: Record<string, unknown> = {};
      for (const m of [
        "select",
        "eq",
        "in",
        "is",
        "order",
        "limit",
        "single",
        "maybeSingle",
      ]) {
        b[m] = vi.fn(() => b);
      }
      b.then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) => Promise.resolve(finalResult).then(onfulfilled, onrejected);
      return b;
    }

    const mockApplicationsBuilder = makeBuilder({ data: [], error: null });

    const mockFrom = vi.fn((_table: string) => mockApplicationsBuilder);

    const mockGetClaims = vi.fn();
    const mockRpc = vi.fn();

    return { mockApplicationsBuilder, mockFrom, mockGetClaims, mockRpc };
  },
);

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
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

import { GET } from "../route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID_1 = "bbbbbbbb-0000-0000-0000-000000000001";
const ORG_ID_2 = "bbbbbbbb-0000-0000-0000-000000000002";
const ORG_ID_3 = "bbbbbbbb-0000-0000-0000-000000000003";

const PENDING_APP = {
  id: ORG_ID_1,
  name: "Penang Chess Club",
  description: "Community club in Georgetown",
  email: "penang@chess.my",
  phone: "+60123456789",
  approval_status: "pending",
  rejection_reason: null,
  created_at: "2026-02-22T10:00:00Z",
  reviewed_at: null,
};

const APPROVED_APP = {
  id: ORG_ID_2,
  name: "KL Chess Association",
  description: "Premier chess org in KL",
  email: "kl@chess.my",
  phone: "+60198765432",
  approval_status: "approved",
  rejection_reason: null,
  created_at: "2026-01-10T08:00:00Z",
  reviewed_at: "2026-01-12T09:00:00Z",
};

const REJECTED_APP = {
  id: ORG_ID_3,
  name: "Fake Chess Club",
  description: null,
  email: "fake@chess.my",
  phone: null,
  approval_status: "rejected",
  rejection_reason: "Insufficient information provided",
  created_at: "2026-01-05T07:00:00Z",
  reviewed_at: "2026-01-06T08:00:00Z",
};

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/v1/admin/applications");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setUser(id = ADMIN_USER_ID) {
  mockGetClaims.mockResolvedValue({ data: { claims: { sub: id } }, error: null });
}

function setNoUser() {
  mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
}

function setAdminPermission(isAdmin: boolean) {
  mockRpc.mockResolvedValue({ data: isAdmin, error: null });
}

function setResult(
  builder: Record<string, unknown>,
  result: { data?: unknown; count?: unknown; error?: unknown },
) {
  builder.then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve(result).then(onfulfilled, onrejected);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/admin/applications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUser();
    setAdminPermission(true);
    setResult(mockApplicationsBuilder, {
      data: [PENDING_APP, APPROVED_APP, REJECTED_APP],
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  describe("authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      setNoUser();
      const res = await GET(makeRequest());
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });
  });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  describe("authorization", () => {
    it("returns 403 when user does not have platform.manage permission", async () => {
      setAdminPermission(false);
      const res = await GET(makeRequest());
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/admin access required/i);
    });

    it("checks the platform.manage permission with the correct user id", async () => {
      await GET(makeRequest());
      expect(mockRpc).toHaveBeenCalledWith("has_global_permission", {
        p_user_id: appIdFor(ADMIN_USER_ID),
        p_permission: "platform.manage",
      });
    });

    it("returns 500 when has_global_permission RPC fails", async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: "RPC error" } });
      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  describe("response shape", () => {
    it("returns 200 with data containing counts and applications", async () => {
      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty("data");
      expect(json.data).toHaveProperty("counts");
      expect(json.data).toHaveProperty("applications");
    });

    it("counts has pending, approved, rejected, and total fields", async () => {
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.counts).toHaveProperty("pending");
      expect(data.counts).toHaveProperty("approved");
      expect(data.counts).toHaveProperty("rejected");
      expect(data.counts).toHaveProperty("total");
    });

    it("each application has the expected fields", async () => {
      const res = await GET(makeRequest());
      const { data } = await res.json();
      const app = data.applications[0];
      expect(app).toHaveProperty("id");
      expect(app).toHaveProperty("name");
      expect(app).toHaveProperty("description");
      expect(app).toHaveProperty("email");
      expect(app).toHaveProperty("phone");
      expect(app).toHaveProperty("approval_status");
      expect(app).toHaveProperty("rejection_reason");
      expect(app).toHaveProperty("created_at");
      expect(app).toHaveProperty("reviewed_at");
    });
  });

  // -------------------------------------------------------------------------
  // Counts calculation
  // -------------------------------------------------------------------------

  describe("counts calculation", () => {
    it("correctly counts applications by status", async () => {
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.counts.pending).toBe(1);
      expect(data.counts.approved).toBe(1);
      expect(data.counts.rejected).toBe(1);
      expect(data.counts.total).toBe(3);
    });

    it("returns zero counts when no applications exist", async () => {
      setResult(mockApplicationsBuilder, { data: [], error: null });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.counts.pending).toBe(0);
      expect(data.counts.approved).toBe(0);
      expect(data.counts.rejected).toBe(0);
      expect(data.counts.total).toBe(0);
    });

    it("counts multiple applications of the same status", async () => {
      setResult(mockApplicationsBuilder, {
        data: [
          { ...PENDING_APP, id: "p1" },
          { ...PENDING_APP, id: "p2" },
          { ...PENDING_APP, id: "p3" },
          { ...APPROVED_APP, id: "a1" },
        ],
        error: null,
      });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.counts.pending).toBe(3);
      expect(data.counts.approved).toBe(1);
      expect(data.counts.rejected).toBe(0);
      expect(data.counts.total).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // Data correctness
  // -------------------------------------------------------------------------

  describe("data correctness", () => {
    it("returns all applications with correct field values", async () => {
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.applications).toHaveLength(3);
      const pending = data.applications.find(
        (a: { id: string }) => a.id === ORG_ID_1,
      );
      expect(pending.name).toBe("Penang Chess Club");
      expect(pending.approval_status).toBe("pending");
      expect(pending.reviewed_at).toBeNull();
    });

    it("includes rejection_reason for rejected applications", async () => {
      const res = await GET(makeRequest());
      const { data } = await res.json();
      const rejected = data.applications.find(
        (a: { id: string }) => a.id === ORG_ID_3,
      );
      expect(rejected.rejection_reason).toBe(
        "Insufficient information provided",
      );
    });

    it("returns empty applications array when there are none", async () => {
      setResult(mockApplicationsBuilder, { data: [], error: null });
      const res = await GET(makeRequest());
      const { data } = await res.json();
      expect(data.applications).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("returns 500 when the database query fails", async () => {
      setResult(mockApplicationsBuilder, {
        data: null,
        error: { message: "DB connection error" },
      });
      const res = await GET(makeRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });
});
