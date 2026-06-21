import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockOrgBuilder,
  mockCallerMembershipBuilder,
  mockRoleBuilder,
  mockTargetUserBuilder,
  mockTargetMembershipBuilder,
  mockInsertBuilder,
  mockFrom,
  mockGetUser,
  mockHasOrgPermission,
  mockInviteUserByEmail,
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
      "insert",
    ]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) => Promise.resolve(finalResult).then(onfulfilled, onrejected);
    return b;
  }

  const mockInsertBuilder = makeBuilder({ data: null, error: null });
  const mockOrgBuilder = makeBuilder({ data: null, error: null });
  const mockCallerMembershipBuilder = makeBuilder({ count: 0, error: null });
  const mockRoleBuilder = makeBuilder({ data: null, error: null });
  const mockTargetUserBuilder = makeBuilder({ data: null, error: null });
  const mockTargetMembershipBuilder = makeBuilder({ count: 0, error: null });

  // Route insert() on all membership builders to mockInsertBuilder so that
  // tests for insert failures work regardless of call index (new vs existing user).
  (mockCallerMembershipBuilder as Record<string, unknown>).insert = vi.fn(
    () => mockInsertBuilder,
  );
  (mockTargetMembershipBuilder as Record<string, unknown>).insert = vi.fn(
    () => mockInsertBuilder,
  );
  // mockInsertBuilder.insert() already returns itself (b[m] = vi.fn(() => b))

  let callIndex = 0;
  const mockFrom = vi.fn((table: string) => {
    if (table === "organizations") return mockOrgBuilder;
    if (table === "roles") return mockRoleBuilder;
    if (table === "organization_memberships") {
      const idx = callIndex++;
      if (idx === 0) return mockCallerMembershipBuilder;
      if (idx === 1) return mockTargetMembershipBuilder;
      return mockInsertBuilder;
    }
    if (table === "users") return mockTargetUserBuilder;
    return mockOrgBuilder;
  });

  (mockFrom as unknown as { _resetIndex: () => void })._resetIndex = () => {
    callIndex = 0;
  };

  const mockGetUser = vi.fn();
  const mockHasOrgPermission = vi.fn().mockResolvedValue(true);
  const mockInviteUserByEmail = vi.fn();

  return {
    mockOrgBuilder,
    mockCallerMembershipBuilder,
    mockRoleBuilder,
    mockTargetUserBuilder,
    mockTargetMembershipBuilder,
    mockInsertBuilder,
    mockFrom,
    mockGetUser,
    mockHasOrgPermission,
    mockInviteUserByEmail,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    from: mockFrom,
    auth: {
      admin: {
        inviteUserByEmail: mockInviteUserByEmail,
      },
    },
  },
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

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const TARGET_USER_ID = "cccccccc-0000-0000-0000-000000000001";
const NEW_USER_ID = "dddddddd-0000-0000-0000-000000000001";
const ROLE_ID = 2;

const APPROVED_ORG = {
  id: ORG_ID,
  approval_status: "approved",
  created_by: USER_ID,
};

function makeRequest(
  orgId: string = ORG_ID,
  body: unknown = { email: "new@example.com", role: "member" },
): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/members/invite`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setUser(id = USER_ID) {
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

function setCallerMembershipResult(
  count: number | null,
  error: unknown = null,
) {
  (mockCallerMembershipBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ count, error }).then(onfulfilled, onrejected);
}

function setRoleResult(data: unknown, error: unknown = null) {
  (mockRoleBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setTargetUserResult(data: unknown, error: unknown = null) {
  (mockTargetUserBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setTargetMembershipResult(
  count: number | null,
  error: unknown = null,
) {
  (mockTargetMembershipBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ count, error }).then(onfulfilled, onrejected);
}

function setInsertResult(data: unknown, error: unknown = null) {
  (mockInsertBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function resetCallIndex() {
  (mockFrom as unknown as { _resetIndex: () => void })._resetIndex();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/organizations/:orgId/members/invite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCallIndex();
    setUser();
    setOrgResult(APPROVED_ORG);
    setCallerMembershipResult(1);
    setRoleResult({ id: ROLE_ID });
    setTargetUserResult(null); // no existing user by default
    setTargetMembershipResult(0);
    setInsertResult(null);
    mockHasOrgPermission.mockResolvedValue(true);
    mockInviteUserByEmail.mockResolvedValue({
      data: { user: { id: NEW_USER_ID } },
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  describe("validation", () => {
    it("returns 400 for a non-UUID orgId", async () => {
      const res = await POST(makeRequest("not-a-uuid"), {
        params: Promise.resolve({ orgId: "not-a-uuid" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toMatch(/invalid organization id/i);
    });

    it("returns 400 when body is not JSON", async () => {
      const req = new NextRequest(
        `http://localhost/api/v1/organizations/${ORG_ID}/members/invite`,
        { method: "POST", body: "not-json" },
      );
      const res = await POST(req, {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when email is missing", async () => {
      const res = await POST(makeRequest(ORG_ID, { role: "member" }), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toMatch(/email/i);
    });

    it("returns 400 when email is invalid", async () => {
      const res = await POST(
        makeRequest(ORG_ID, { email: "not-an-email", role: "member" }),
        { params: Promise.resolve({ orgId: ORG_ID }) },
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toMatch(/invalid email/i);
    });

    it("returns 400 when role is missing", async () => {
      const res = await POST(
        makeRequest(ORG_ID, { email: "test@example.com" }),
        { params: Promise.resolve({ orgId: ORG_ID }) },
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toMatch(/role/i);
    });

    it("returns 400 when role is 'owner'", async () => {
      const res = await POST(
        makeRequest(ORG_ID, { email: "test@example.com", role: "owner" }),
        { params: Promise.resolve({ orgId: ORG_ID }) },
      );
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
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
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
    it("returns 404 when organization does not exist", async () => {
      setOrgResult(null, { code: "PGRST116", message: "No rows found" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 500 on org query error", async () => {
      setOrgResult(null, { code: "500", message: "DB error" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 on membership check error", async () => {
      setCallerMembershipResult(null, { message: "DB error" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 403 when organization is not approved", async () => {
      setOrgResult({ ...APPROVED_ORG, approval_status: "pending" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("returns 403 when user is not a member and not creator", async () => {
      setOrgResult({ ...APPROVED_ORG, created_by: "other-user-id" });
      setCallerMembershipResult(0);
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/access denied/i);
    });

    it("returns 403 when member lacks org.invite permission", async () => {
      setOrgResult({ ...APPROVED_ORG, created_by: "other-user-id" });
      setCallerMembershipResult(1);
      mockHasOrgPermission.mockResolvedValue(false);
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/insufficient permissions/i);
    });

    it("allows creator without checking hasOrgPermission", async () => {
      setCallerMembershipResult(0);
      setInsertResult(null);
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(mockHasOrgPermission).not.toHaveBeenCalled();
      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // Invite new user (no account)
  // -------------------------------------------------------------------------

  describe("invite new user", () => {
    it("returns 201 with status pending for a new user", async () => {
      const res = await POST(
        makeRequest(ORG_ID, { email: "new@example.com", role: "member" }),
        { params: Promise.resolve({ orgId: ORG_ID }) },
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.status).toBe("pending");
      expect(json.data.email).toBe("new@example.com");
      expect(json.data.role).toBe("member");
      expect(json.data.id).toBe(NEW_USER_ID);
      expect(json.data).toHaveProperty("invited_at");
    });

    it("calls inviteUserByEmail with the target email", async () => {
      await POST(
        makeRequest(ORG_ID, { email: "NEW@Example.com", role: "admin" }),
        { params: Promise.resolve({ orgId: ORG_ID }) },
      );
      expect(mockInviteUserByEmail).toHaveBeenCalledWith("new@example.com");
    });

    it("returns 500 when inviteUserByEmail fails", async () => {
      mockInviteUserByEmail.mockResolvedValue({
        data: { user: null },
        error: { message: "Invite failed" },
      });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when membership insert fails for new user", async () => {
      setInsertResult(null, { message: "Insert error" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // Invite existing user
  // -------------------------------------------------------------------------

  describe("invite existing user", () => {
    beforeEach(() => {
      setTargetUserResult({ id: TARGET_USER_ID });
    });

    it("returns 201 with status active for existing user", async () => {
      const res = await POST(
        makeRequest(ORG_ID, { email: "existing@example.com", role: "admin" }),
        { params: Promise.resolve({ orgId: ORG_ID }) },
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.status).toBe("active");
      expect(json.data.id).toBe(TARGET_USER_ID);
      expect(json.data.role).toBe("admin");
    });

    it("does not call inviteUserByEmail for existing user", async () => {
      await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(mockInviteUserByEmail).not.toHaveBeenCalled();
    });

    it("returns 409 when user is already a member", async () => {
      setTargetMembershipResult(1);
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe("CONFLICT");
      expect(json.error.message).toMatch(/already a member/i);
    });

    it("returns 500 on target membership check error", async () => {
      setTargetMembershipResult(null, { message: "DB error" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when membership insert fails for existing user", async () => {
      setInsertResult(null, { message: "Insert error" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  describe("response shape", () => {
    it("normalises email to lowercase", async () => {
      const res = await POST(
        makeRequest(ORG_ID, { email: "UPPER@EXAMPLE.COM", role: "member" }),
        { params: Promise.resolve({ orgId: ORG_ID }) },
      );
      const json = await res.json();
      expect(json.data.email).toBe("upper@example.com");
    });

    it("response contains all required fields", async () => {
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const json = await res.json();
      expect(json.data).toHaveProperty("id");
      expect(json.data).toHaveProperty("email");
      expect(json.data).toHaveProperty("role");
      expect(json.data).toHaveProperty("status");
      expect(json.data).toHaveProperty("invited_at");
    });
  });
});
