import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockOrgBuilder,
  mockCallerMembershipCheckBuilder,
  mockTargetMembershipBuilder,
  mockRoleBuilder,
  mockMembershipUpdateBuilder,
  mockFrom,
  mockGetUser,
  mockHasOrgPermission,
} = vi.hoisted(() => {
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
      "update",
      "delete",
    ]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) => Promise.resolve(finalResult).then(onfulfilled, onrejected);
    return b;
  }

  const mockOrgBuilder = makeBuilder({ data: null, error: null });
  const mockCallerMembershipCheckBuilder = makeBuilder({
    count: 1,
    error: null,
  });
  const mockTargetMembershipBuilder = makeBuilder({ data: null, error: null });
  const mockRoleBuilder = makeBuilder({ data: null, error: null });
  const mockMembershipUpdateBuilder = makeBuilder({ data: null, error: null });
  const mockMembershipDeleteBuilder = makeBuilder({ data: null, error: null });

  // membership table call index:
  // 0 = caller membership check (count)
  // 1 = target membership fetch (single)
  // 2 = membership update/delete
  let membershipCallIndex = 0;

  const mockFrom = vi.fn((table: string) => {
    if (table === "organizations") return mockOrgBuilder;
    if (table === "roles") return mockRoleBuilder;
    if (table === "organization_memberships") {
      const idx = membershipCallIndex++;
      if (idx === 0) return mockCallerMembershipCheckBuilder;
      if (idx === 1) return mockTargetMembershipBuilder;
      return mockMembershipUpdateBuilder;
    }
    return mockOrgBuilder;
  });

  (mockFrom as unknown as { _resetIndex: () => void })._resetIndex = () => {
    membershipCallIndex = 0;
  };

  const mockGetUser = vi.fn();
  const mockHasOrgPermission = vi.fn().mockResolvedValue(true);

  return {
    mockOrgBuilder,
    mockCallerMembershipCheckBuilder,
    mockTargetMembershipBuilder,
    mockRoleBuilder,
    mockMembershipUpdateBuilder,
    mockMembershipDeleteBuilder,
    mockFrom,
    mockGetUser,
    mockHasOrgPermission,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("@/services/supabase/permission", () => ({
  hasOrgPermission: mockHasOrgPermission,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

import { PATCH, DELETE } from "../route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CALLER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const TARGET_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const ROLE_ID = "cccccccc-0000-0000-0000-000000000001";

const APPROVED_ORG = {
  id: ORG_ID,
  approval_status: "approved",
  created_by: CALLER_ID,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePatchRequest(
  orgId: string = ORG_ID,
  memberId: string = TARGET_ID,
  body: unknown = { role: "admin" },
): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/members/${memberId}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}

function makeDeleteRequest(
  orgId: string = ORG_ID,
  memberId: string = TARGET_ID,
): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/members/${memberId}`,
    { method: "DELETE" },
  );
}

function setUser(id = CALLER_ID) {
  mockGetUser.mockResolvedValue({ data: { user: { id } }, error: null });
}

function setNoUser() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
}

function setOrgResult(data: unknown, error: unknown = null) {
  (mockOrgBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setCallerMembershipCheck(count: number | null, error: unknown = null) {
  (mockCallerMembershipCheckBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ count, error }).then(onfulfilled, onrejected);
}

function setTargetMembership(data: unknown, error: unknown = null) {
  (mockTargetMembershipBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setRoleResult(data: unknown, error: unknown = null) {
  (mockRoleBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setMembershipUpdateResult(data: unknown, error: unknown = null) {
  (mockMembershipUpdateBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function resetCallIndex() {
  (mockFrom as unknown as { _resetIndex: () => void })._resetIndex();
}

// ---------------------------------------------------------------------------
// PATCH Tests
// ---------------------------------------------------------------------------

describe("PATCH /api/v1/organizations/:orgId/members/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCallIndex();
    setUser();
    setOrgResult(APPROVED_ORG);
    setCallerMembershipCheck(1);
    setTargetMembership({ user_id: TARGET_ID });
    setRoleResult({ id: ROLE_ID });
    setMembershipUpdateResult(null);
    mockHasOrgPermission.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  describe("validation", () => {
    it("returns 400 for a non-UUID orgId", async () => {
      const res = await PATCH(makePatchRequest("not-a-uuid"), {
        params: Promise.resolve({ orgId: "not-a-uuid", id: TARGET_ID }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toMatch(/invalid organization id/i);
    });

    it("returns 400 for a non-UUID member id", async () => {
      const res = await PATCH(makePatchRequest(ORG_ID, "not-a-uuid"), {
        params: Promise.resolve({ orgId: ORG_ID, id: "not-a-uuid" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toMatch(/invalid member id/i);
    });

    it("returns 400 for missing role", async () => {
      const res = await PATCH(makePatchRequest(ORG_ID, TARGET_ID, {}), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toMatch(/role must be/i);
    });

    it("returns 400 for invalid role value", async () => {
      const res = await PATCH(
        makePatchRequest(ORG_ID, TARGET_ID, { role: "owner" }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }) },
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid JSON body", async () => {
      const req = new NextRequest(
        `http://localhost/api/v1/organizations/${ORG_ID}/members/${TARGET_ID}`,
        {
          method: "PATCH",
          body: "not-json",
          headers: { "content-type": "application/json" },
        },
      );
      const res = await PATCH(req, {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  describe("authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      setNoUser();
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });
  });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  describe("authorization", () => {
    it("returns 403 when caller tries to change their own role", async () => {
      const res = await PATCH(makePatchRequest(ORG_ID, CALLER_ID), {
        params: Promise.resolve({ orgId: ORG_ID, id: CALLER_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/cannot change your own role/i);
    });

    it("returns 404 when organization does not exist", async () => {
      setOrgResult(null, { code: "PGRST116", message: "No rows found" });
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 500 on org query error", async () => {
      setOrgResult(null, { code: "500", message: "DB error" });
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(500);
    });

    it("returns 403 when org is not approved", async () => {
      setOrgResult({ ...APPROVED_ORG, approval_status: "pending" });
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/not approved/i);
    });

    it("returns 403 when caller is not a member and not the creator", async () => {
      setOrgResult({ ...APPROVED_ORG, created_by: TARGET_ID });
      setCallerMembershipCheck(0);
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/access denied/i);
    });

    it("returns 403 when caller lacks org.manage permission", async () => {
      setOrgResult({ ...APPROVED_ORG, created_by: TARGET_ID });
      setCallerMembershipCheck(1);
      mockHasOrgPermission.mockResolvedValue(false);
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/insufficient permissions/i);
    });

    it("checks org.manage permission for the org creator", async () => {
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(200);
      expect(mockHasOrgPermission).toHaveBeenCalledWith(
        CALLER_ID,
        ORG_ID,
        "org.manage",
      );
    });

    it("returns 404 when target member does not exist", async () => {
      setTargetMembership(null, {
        code: "PGRST116",
        message: "No rows found",
      });
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
      expect(json.error.message).toMatch(/member not found/i);
    });

    it("returns 500 on target membership query error", async () => {
      setTargetMembership(null, { code: "500", message: "DB error" });
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // Success
  // -------------------------------------------------------------------------

  describe("success", () => {
    it("returns 200 with updated user_id and role", async () => {
      const res = await PATCH(
        makePatchRequest(ORG_ID, TARGET_ID, { role: "admin" }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }) },
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toMatchObject({ user_id: TARGET_ID, role: "admin" });
    });

    it("accepts 'member' as a valid role", async () => {
      const res = await PATCH(
        makePatchRequest(ORG_ID, TARGET_ID, { role: "member" }),
        { params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }) },
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.role).toBe("member");
    });

    it("returns 500 when role lookup fails", async () => {
      setRoleResult(null, { message: "DB error" });
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when membership update fails", async () => {
      setMembershipUpdateResult(null, { message: "DB error" });
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE Tests
// ---------------------------------------------------------------------------

describe("DELETE /api/v1/organizations/:orgId/members/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCallIndex();
    setUser();
    setOrgResult(APPROVED_ORG);
    setCallerMembershipCheck(1);
    setTargetMembership({ user_id: TARGET_ID });
    // For DELETE, the 3rd membership call (index 2) is the delete operation
    // Route the delete builder to mockMembershipUpdateBuilder (reused as delete builder)
    setMembershipUpdateResult(null);
    mockHasOrgPermission.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  describe("validation", () => {
    it("returns 400 for a non-UUID orgId", async () => {
      const res = await DELETE(makeDeleteRequest("not-a-uuid"), {
        params: Promise.resolve({ orgId: "not-a-uuid", id: TARGET_ID }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toMatch(/invalid organization id/i);
    });

    it("returns 400 for a non-UUID member id", async () => {
      const res = await DELETE(makeDeleteRequest(ORG_ID, "not-a-uuid"), {
        params: Promise.resolve({ orgId: ORG_ID, id: "not-a-uuid" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toMatch(/invalid member id/i);
    });
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  describe("authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      setNoUser();
      const res = await DELETE(makeDeleteRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });
  });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  describe("authorization", () => {
    it("returns 403 when caller tries to remove themselves", async () => {
      const res = await DELETE(makeDeleteRequest(ORG_ID, CALLER_ID), {
        params: Promise.resolve({ orgId: ORG_ID, id: CALLER_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/cannot remove yourself/i);
    });

    it("returns 404 when organization does not exist", async () => {
      setOrgResult(null, { code: "PGRST116", message: "No rows found" });
      const res = await DELETE(makeDeleteRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 403 when org is not approved", async () => {
      setOrgResult({ ...APPROVED_ORG, approval_status: "pending" });
      const res = await DELETE(makeDeleteRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(403);
    });

    it("returns 403 when caller is not a member and not the creator", async () => {
      setOrgResult({ ...APPROVED_ORG, created_by: TARGET_ID });
      setCallerMembershipCheck(0);
      const res = await DELETE(makeDeleteRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/access denied/i);
    });

    it("returns 403 when caller lacks org.manage permission", async () => {
      setOrgResult({ ...APPROVED_ORG, created_by: TARGET_ID });
      setCallerMembershipCheck(1);
      mockHasOrgPermission.mockResolvedValue(false);
      const res = await DELETE(makeDeleteRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/insufficient permissions/i);
    });

    it("checks org.manage permission for the org creator", async () => {
      const res = await DELETE(makeDeleteRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(204);
      expect(mockHasOrgPermission).toHaveBeenCalledWith(
        CALLER_ID,
        ORG_ID,
        "org.manage",
      );
    });

    it("returns 404 when target member does not exist", async () => {
      setTargetMembership(null, {
        code: "PGRST116",
        message: "No rows found",
      });
      const res = await DELETE(makeDeleteRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
      expect(json.error.message).toMatch(/member not found/i);
    });

    it("returns 500 on target membership query error", async () => {
      setTargetMembership(null, { code: "500", message: "DB error" });
      const res = await DELETE(makeDeleteRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // Success
  // -------------------------------------------------------------------------

  describe("success", () => {
    it("returns 204 with no body on successful deletion", async () => {
      const res = await DELETE(makeDeleteRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(204);
    });

    it("returns 500 when delete operation fails", async () => {
      setMembershipUpdateResult(null, { message: "DB error" });
      const res = await DELETE(makeDeleteRequest(), {
        params: Promise.resolve({ orgId: ORG_ID, id: TARGET_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });
});
