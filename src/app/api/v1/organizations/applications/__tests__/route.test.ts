import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockBuilder, mockFrom, mockGetClaims } = vi.hoisted(() => {
  function makeBuilder(finalResult: { data?: unknown; error?: unknown }) {
    const b: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "in",
      "ilike",
      "is",
      "order",
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

  // A single configurable builder used by all queries in a given test
  const mockBuilder = makeBuilder({ data: null, error: null });
  const mockFrom = vi.fn(() => mockBuilder);
  const mockGetClaims = vi.fn();

  return { mockBuilder, mockFrom, mockGetClaims };
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

import { GET, POST } from "../route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";

const VALID_BODY = {
  name: "KL Chess Association",
  email: "chess@klca.com",
};

function makeOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: ORG_ID,
    name: "KL Chess Association",
    description: null,
    links: null,
    email: "chess@klca.com",
    phone: null,
    past_tournament_refs: null,
    approval_status: "pending",
    rejection_reason: null,
    created_by: USER_ID,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    reviewed_at: null,
    ...overrides,
  };
}

function makeGetRequest() {
  return new NextRequest("http://localhost/api/v1/organizations/applications");
}

function makePostRequest(body: unknown = VALID_BODY): NextRequest {
  return new NextRequest(
    "http://localhost/api/v1/organizations/applications",
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
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: id } },
    error: null,
  });
}

function setNoUser() {
  mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
}

function setQueryResult(data: unknown, error: unknown = null) {
  (mockBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

// ---------------------------------------------------------------------------
// GET Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/organizations/applications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUser();
    setQueryResult([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      setNoUser();
      const res = await GET(makeGetRequest());
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("queries only applications belonging to the authenticated user", async () => {
      setQueryResult([]);
      await GET(makeGetRequest());
      const eqMock = mockBuilder.eq as ReturnType<typeof vi.fn>;
      expect(eqMock).toHaveBeenCalledWith("created_by", appIdFor(USER_ID));
    });
  });

  describe("response shape", () => {
    it("returns 200 with data array", async () => {
      const org = makeOrg();
      setQueryResult([
        {
          id: org.id,
          name: org.name,
          approval_status: org.approval_status,
          rejection_reason: org.rejection_reason,
          created_at: org.created_at,
          reviewed_at: org.reviewed_at,
        },
      ]);

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe(ORG_ID);
      expect(json.data[0].approval_status).toBe("pending");
    });

    it("returns empty array when user has no applications", async () => {
      setQueryResult([]);
      const res = await GET(makeGetRequest());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual([]);
    });

    it("returns multiple applications ordered by created_at desc", async () => {
      const orgs = [
        {
          id: "bbbbbbbb-0000-0000-0000-000000000002",
          name: "Penang Chess Club",
          approval_status: "rejected",
          rejection_reason: "Insufficient history",
          created_at: "2026-02-01T00:00:00Z",
          reviewed_at: "2026-02-03T00:00:00Z",
        },
        {
          id: ORG_ID,
          name: "KL Chess Association",
          approval_status: "pending",
          rejection_reason: null,
          created_at: "2026-01-01T00:00:00Z",
          reviewed_at: null,
        },
      ];
      setQueryResult(orgs);

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(2);
    });

    it("excludes soft-deleted organizations", async () => {
      await GET(makeGetRequest());
      const isMock = mockBuilder.is as ReturnType<typeof vi.fn>;
      expect(isMock).toHaveBeenCalledWith("deleted_at", null);
    });
  });

  describe("error handling", () => {
    it("returns 500 when Supabase returns an error", async () => {
      setQueryResult(null, { message: "DB connection failed" });
      const res = await GET(makeGetRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
      expect(json.error.message).toBe("DB connection failed");
    });
  });
});

// ---------------------------------------------------------------------------
// POST Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/organizations/applications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUser();
    // Default: no existing org, successful insert
    setQueryResult(null);
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
      const res = await POST(makePostRequest());
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  describe("input validation", () => {
    it("returns 400 when body is not valid JSON", async () => {
      const req = new NextRequest(
        "http://localhost/api/v1/organizations/applications",
        {
          method: "POST",
          body: "not json",
        },
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when name is missing", async () => {
      const res = await POST(makePostRequest({ email: "chess@klca.com" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/name/i);
    });

    it("returns 400 when name is empty string", async () => {
      const res = await POST(
        makePostRequest({ name: "  ", email: "chess@klca.com" }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/name/i);
    });

    it("returns 400 when email is missing", async () => {
      const res = await POST(makePostRequest({ name: "KL Chess" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/email/i);
    });

    it("returns 400 when email is invalid", async () => {
      const res = await POST(
        makePostRequest({ name: "KL Chess", email: "not-an-email" }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/invalid email/i);
    });

    it("returns 400 when links is not an array", async () => {
      const res = await POST(
        makePostRequest({ ...VALID_BODY, links: "https://example.com" }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/links/i);
    });

    it("returns 400 when a link has an empty label", async () => {
      const res = await POST(
        makePostRequest({
          ...VALID_BODY,
          links: [{ label: "", url: "https://facebook.com/..." }],
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/label/i);
    });

    it("returns 400 when a link has an empty url", async () => {
      const res = await POST(
        makePostRequest({
          ...VALID_BODY,
          links: [{ label: "Facebook", url: "" }],
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/url/i);
    });
  });

  // -------------------------------------------------------------------------
  // Name uniqueness check
  // -------------------------------------------------------------------------

  describe("name uniqueness", () => {
    it("returns 409 when an organization with the same name already exists", async () => {
      setQueryResult({ id: ORG_ID });
      const res = await POST(makePostRequest());
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe("NAME_TAKEN");
      expect(json.error.message).toMatch(/already exists/i);
    });

    it("returns 500 when the name uniqueness check query fails", async () => {
      setQueryResult(null, { message: "DB connection error" });
      const res = await POST(makePostRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // Insert
  // -------------------------------------------------------------------------

  describe("insert", () => {
    it("returns 201 with the created organization on success", async () => {
      // First call (maybeSingle check) returns null, second call (insert) returns org
      let callIndex = 0;
      (mockBuilder as Record<string, unknown>).then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) => {
        const result =
          callIndex++ === 0
            ? { data: null, error: null }
            : { data: makeOrg(), error: null };
        return Promise.resolve(result).then(onfulfilled, onrejected);
      };

      const res = await POST(makePostRequest());
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.id).toBe(ORG_ID);
      expect(json.data.approval_status).toBe("pending");
    });

    it("returns 201 when optional fields are provided", async () => {
      let callIndex = 0;
      (mockBuilder as Record<string, unknown>).then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) => {
        const result =
          callIndex++ === 0
            ? { data: null, error: null }
            : { data: makeOrg({ description: "A chess club" }), error: null };
        return Promise.resolve(result).then(onfulfilled, onrejected);
      };

      const body = {
        name: "KL Chess",
        email: "chess@klca.com",
        description: "A chess club",
        phone: "+60123456789",
        past_tournament_refs: "KL Open 2025",
        links: [{ label: "Facebook", url: "https://facebook.com/klchess" }],
      };
      const res = await POST(makePostRequest(body));
      expect(res.status).toBe(201);
    });

    it("returns 500 on an unexpected insert error", async () => {
      let callIndex = 0;
      (mockBuilder as Record<string, unknown>).then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) => {
        const result =
          callIndex++ === 0
            ? { data: null, error: null }
            : { data: null, error: { message: "Unexpected DB error" } };
        return Promise.resolve(result).then(onfulfilled, onrejected);
      };

      const res = await POST(makePostRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });
});
