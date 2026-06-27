import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockOrgBuilder,
  mockMembershipBuilder,
  mockInsertBuilder,
  mockFrom,
  mockGetClaims,
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

  const mockOrgBuilder = makeBuilder({ data: null, error: null });
  const mockMembershipBuilder = makeBuilder({ data: null, error: null });
  const mockInsertBuilder = makeBuilder({ data: null, error: null });

  const mockFrom = vi.fn((table: string) => {
    if (table === "organizations") return mockOrgBuilder;
    if (table === "organization_memberships") return mockMembershipBuilder;
    if (table === "tournaments") return mockInsertBuilder;
    return mockOrgBuilder;
  });

  const mockGetClaims = vi.fn();

  return {
    mockOrgBuilder,
    mockMembershipBuilder,
    mockInsertBuilder,
    mockFrom,
    mockGetClaims,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
  }),
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
const TOUR_ID = "cccccccc-0000-0000-0000-000000000001";
const MEMBER_USER_ID = "aaaaaaaa-0000-0000-0000-000000000002";

const APPROVED_ORG = {
  id: ORG_ID,
  approval_status: "approved",
  created_by: USER_ID,
};

const CREATED_TOURNAMENT = {
  id: TOUR_ID,
  name: "KL Open Rapid 2026",
  status: "draft",
  created_at: "2026-05-26T00:00:00Z",
};

const VALID_BODY = {
  name: "KL Open Rapid 2026",
  venue_name: "KLCC",
  venue_state: "Kuala Lumpur",
  venue_address: "Jalan Pinang, 50088 KL",
  format: { type: "rapid", system: "swiss", rounds: 7 },
  time_control: { base_minutes: 10, increment_seconds: 5, delay_seconds: 0 },
  start_date: "2026-08-15",
  end_date: "2026-08-16",
  registration_deadline: "2026-08-10T23:59:59Z",
  max_participants: 120,
  is_fide_rated: true,
  is_mcf_rated: false,
  entry_fees: {
    standard: { amount_cents: 5000 },
    additional: [],
  },
};

function makeRequest(
  orgId: string = ORG_ID,
  body: unknown = VALID_BODY,
): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/tournaments`,
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
  mockGetClaims.mockResolvedValue({ data: { claims: { sub: id } }, error: null });
}

function setNoUser() {
  mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
}

function setOrgResult(data: unknown, error: unknown = null) {
  (mockOrgBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setMembershipResult(data: unknown, error: unknown = null) {
  (mockMembershipBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setInsertResult(data: unknown, error: unknown = null) {
  (mockInsertBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  setOrgResult(APPROVED_ORG);
  setMembershipResult({ roles: { name: "owner" } });
  setInsertResult(CREATED_TOURNAMENT);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/organizations/[orgId]/tournaments", () => {
  describe("authentication", () => {
    it("returns 401 when not authenticated", async () => {
      setNoUser();
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("input validation", () => {
    it("returns 400 for invalid orgId format", async () => {
      setUser();
      const res = await POST(makeRequest("not-a-uuid"), {
        params: Promise.resolve({ orgId: "not-a-uuid" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when name is missing", async () => {
      setUser();
      const res = await POST(makeRequest(ORG_ID, { ...VALID_BODY, name: "" }), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toMatch(/name/i);
    });

    it("returns 400 for invalid JSON body", async () => {
      setUser();
      const req = new NextRequest(
        `http://localhost/api/v1/organizations/${ORG_ID}/tournaments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not-json",
        },
      );
      const res = await POST(req, {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("organization checks", () => {
    it("returns 404 when organization does not exist", async () => {
      setUser();
      setOrgResult(null, { code: "PGRST116", message: "Not found" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 403 when organization is not approved", async () => {
      setUser();
      setOrgResult({ ...APPROVED_ORG, approval_status: "pending" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("permission checks", () => {
    it("allows the org creator to create a tournament", async () => {
      setUser(USER_ID);
      setOrgResult({ ...APPROVED_ORG, created_by: USER_ID });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(201);
    });

    it("allows an org admin member to create a tournament", async () => {
      setUser(MEMBER_USER_ID);
      setOrgResult({ ...APPROVED_ORG, created_by: USER_ID });
      setMembershipResult({ roles: { name: "admin" } });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(201);
    });

    it("returns 403 for a member-role user", async () => {
      setUser(MEMBER_USER_ID);
      setOrgResult({ ...APPROVED_ORG, created_by: USER_ID });
      setMembershipResult({ roles: { name: "member" } });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("returns 403 for a non-member user", async () => {
      setUser(MEMBER_USER_ID);
      setOrgResult({ ...APPROVED_ORG, created_by: USER_ID });
      setMembershipResult(null, { code: "PGRST116", message: "Not found" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("successful creation", () => {
    it("returns 201 with the created tournament", async () => {
      setUser();
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe(TOUR_ID);
      expect(body.data.name).toBe("KL Open Rapid 2026");
      expect(body.data.status).toBe("draft");
    });

    it("creates a draft tournament with only a name (partial wizard data)", async () => {
      setUser();
      const res = await POST(makeRequest(ORG_ID, { name: "My Draft" }), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(201);
    });
  });

  describe("database errors", () => {
    it("returns 500 when the insert fails", async () => {
      setUser();
      setInsertResult(null, { message: "DB constraint violation" });
      const res = await POST(makeRequest(), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });
  });
});
