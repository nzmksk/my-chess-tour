import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockOrgBuilder,
  mockMembershipCheckBuilder,
  mockMembersListBuilder,
  mockFrom,
  mockGetUser,
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
  const mockMembershipCheckBuilder = makeBuilder({ count: 0, error: null });
  const mockMembersListBuilder = makeBuilder({ data: [], error: null });

  // Track call index to distinguish the two organization_memberships queries:
  // first call = membership check (count), second call = members list
  let membershipCallIndex = 0;

  const mockFrom = vi.fn((table: string) => {
    if (table === "organizations") return mockOrgBuilder;
    if (table === "organization_memberships") {
      return membershipCallIndex++ % 2 === 0
        ? mockMembershipCheckBuilder
        : mockMembersListBuilder;
    }
    return mockOrgBuilder;
  });

  (mockFrom as unknown as { _resetIndex: () => void })._resetIndex = () => {
    membershipCallIndex = 0;
  };

  const mockGetUser = vi.fn();

  return {
    mockOrgBuilder,
    mockMembershipCheckBuilder,
    mockMembersListBuilder,
    mockFrom,
    mockGetUser,
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

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const OTHER_USER_ID = "aaaaaaaa-0000-0000-0000-000000000002";

const APPROVED_ORG = {
  id: ORG_ID,
  name: "KL Chess Association",
  approval_status: "approved",
  created_by: USER_ID,
};

const MEMBER_ROW = {
  user_id: USER_ID,
  joined_at: "2026-01-01T00:00:00Z",
  users: {
    email: "organizer@example.com",
    first_name: "Ahmad",
    last_name: "Kamaruddin",
    avatar_url: null,
  },
  roles: { name: "owner" },
};

const SECOND_MEMBER_ROW = {
  user_id: OTHER_USER_ID,
  joined_at: "2026-02-01T00:00:00Z",
  users: {
    email: "member@example.com",
    first_name: "Wei",
    last_name: "Ming",
    avatar_url: "https://example.com/avatar.png",
  },
  roles: { name: "member" },
};

function makeRequest(orgId: string = ORG_ID): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/members`,
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

function setMembershipCheckResult(count: number | null, error: unknown = null) {
  (mockMembershipCheckBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ count, error }).then(onfulfilled, onrejected);
}

function setMembersListResult(data: unknown, error: unknown = null) {
  (mockMembersListBuilder as Record<string, unknown>).then = (
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

describe("GET /api/v1/organizations/:orgId/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCallIndex();
    setUser();
    setOrgResult(APPROVED_ORG);
    setMembershipCheckResult(1);
    setMembersListResult([MEMBER_ROW]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  describe("validation", () => {
    it("returns 400 for a non-UUID orgId", async () => {
      const res = await GET(makeRequest("not-a-uuid"), {
        params: Promise.resolve({ orgId: "not-a-uuid" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toMatch(/invalid organization id/i);
    });
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  describe("authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      setNoUser();
      const res = await GET(makeRequest(), {
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
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 500 on org query error", async () => {
      setOrgResult(null, { code: "500", message: "DB error" });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 on membership check query error", async () => {
      setMembershipCheckResult(null, { message: "DB error" });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 403 when organization is not approved", async () => {
      setOrgResult({ ...APPROVED_ORG, approval_status: "pending" });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/not approved/i);
    });

    it("returns 403 when org is rejected", async () => {
      setOrgResult({ ...APPROVED_ORG, approval_status: "rejected" });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
    });

    it("returns 403 when user is not a member and not the creator", async () => {
      setOrgResult({ ...APPROVED_ORG, created_by: OTHER_USER_ID });
      setMembershipCheckResult(0);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toMatch(/access denied/i);
    });

    it("returns 403 when member count is null and user is not the creator", async () => {
      setOrgResult({ ...APPROVED_ORG, created_by: OTHER_USER_ID });
      setMembershipCheckResult(null);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
    });

    it("returns 403 when user is the creator but has no membership row", async () => {
      setMembershipCheckResult(0);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
    });
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  describe("response shape", () => {
    it("returns 200 with data array", async () => {
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty("data");
      expect(Array.isArray(json.data)).toBe(true);
    });

    it("shapes each member entry correctly", async () => {
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      const m = data[0];
      expect(m).toHaveProperty("user_id");
      expect(m).toHaveProperty("email");
      expect(m).toHaveProperty("first_name");
      expect(m).toHaveProperty("last_name");
      expect(m).toHaveProperty("avatar_url");
      expect(m).toHaveProperty("role");
      expect(m).toHaveProperty("joined_at");
    });

    it("maps member fields from joined tables correctly", async () => {
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      const m = data[0];
      expect(m.user_id).toBe(USER_ID);
      expect(m.email).toBe("organizer@example.com");
      expect(m.first_name).toBe("Ahmad");
      expect(m.last_name).toBe("Kamaruddin");
      expect(m.avatar_url).toBeNull();
      expect(m.role).toBe("owner");
      expect(m.joined_at).toBe("2026-01-01T00:00:00Z");
    });

    it("includes avatar_url when present", async () => {
      setMembersListResult([SECOND_MEMBER_ROW]);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data[0].avatar_url).toBe("https://example.com/avatar.png");
    });

    it("returns empty array when org has no members", async () => {
      setMembersListResult([]);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data).toEqual([]);
    });

    it("returns multiple members", async () => {
      setMembersListResult([MEMBER_ROW, SECOND_MEMBER_ROW]);
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const { data } = await res.json();
      expect(data).toHaveLength(2);
      expect(data[0].user_id).toBe(USER_ID);
      expect(data[1].user_id).toBe(OTHER_USER_ID);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling — data fetch phase
  // -------------------------------------------------------------------------

  describe("error handling — data fetch", () => {
    it("returns 500 when members list query fails", async () => {
      setMembersListResult(null, { message: "DB error" });
      const res = await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // Query behaviour
  // -------------------------------------------------------------------------

  describe("query behaviour", () => {
    it("filters membership check by organization_id and user_id", async () => {
      await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const eqMock = mockMembershipCheckBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("organization_id", ORG_ID);
      expect(eqMock).toHaveBeenCalledWith("user_id", USER_ID);
    });

    it("filters members list by organization_id", async () => {
      await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const eqMock = mockMembersListBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("organization_id", ORG_ID);
    });

    it("orders members list by joined_at ascending", async () => {
      await GET(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      const orderMock = mockMembersListBuilder.order as ReturnType<
        typeof vi.fn
      >;
      expect(orderMock).toHaveBeenCalledWith("joined_at", { ascending: true });
    });
  });
});
