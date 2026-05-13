import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockExistingBuilder,
  mockInsertBuilder,
  mockFrom,
  mockGetUser,
  resetOrgCallCount,
} = vi.hoisted(() => {
  function makeBuilder(finalResult: {
    data?: unknown;
    error?: unknown;
  }) {
    const b: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "in",
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

  const mockExistingBuilder = makeBuilder({ data: null, error: null });
  const mockInsertBuilder = makeBuilder({ data: null, error: null });

  let orgCallCount = 0;
  const resetOrgCallCount = () => {
    orgCallCount = 0;
  };

  const mockFrom = vi.fn((table: string) => {
    if (table === "organizations") {
      const builders = [mockExistingBuilder, mockInsertBuilder];
      return builders[orgCallCount++] ?? mockInsertBuilder;
    }
    return makeBuilder({ data: null, error: null });
  });

  const mockGetUser = vi.fn();

  return {
    mockExistingBuilder,
    mockInsertBuilder,
    mockFrom,
    mockGetUser,
    resetOrgCallCount,
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

import { POST } from "../route";

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
    created_by: USER_ID,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRequest(body: unknown = VALID_BODY): NextRequest {
  return new NextRequest("http://localhost/api/v1/organizer/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

function setExistingResult(data: unknown, error: unknown = null) {
  (mockExistingBuilder as Record<string, unknown>).then = (
    r: (v: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(r);
}

function setInsertResult(data: unknown, error: unknown = null) {
  (mockInsertBuilder as Record<string, unknown>).then = (
    r: (v: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(r);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/organizer/apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOrgCallCount();
    setUser();
    setExistingResult(null);
    setInsertResult(makeOrg());
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
      const res = await POST(makeRequest());
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
      const req = new NextRequest("http://localhost/api/v1/organizer/apply", {
        method: "POST",
        body: "not json",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when name is missing", async () => {
      const res = await POST(makeRequest({ email: "chess@klca.com" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/name/i);
    });

    it("returns 400 when name is empty string", async () => {
      const res = await POST(makeRequest({ name: "  ", email: "chess@klca.com" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/name/i);
    });

    it("returns 400 when email is missing", async () => {
      const res = await POST(makeRequest({ name: "KL Chess" }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/email/i);
    });

    it("returns 400 when email is invalid", async () => {
      const res = await POST(
        makeRequest({ name: "KL Chess", email: "not-an-email" }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/invalid email/i);
    });

    it("returns 400 when links is not an array", async () => {
      const res = await POST(
        makeRequest({ ...VALID_BODY, links: "https://example.com" }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/links/i);
    });

    it("returns 400 when a link has an empty label", async () => {
      const res = await POST(
        makeRequest({
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
        makeRequest({
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
  // Duplicate application check
  // -------------------------------------------------------------------------

  describe("duplicate check", () => {
    it("returns 409 when user already has a pending application", async () => {
      setExistingResult({ id: ORG_ID, approval_status: "pending" });
      const res = await POST(makeRequest());
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe("ALREADY_APPLIED");
      expect(json.error.message).toMatch(/pending/i);
    });

    it("returns 409 when user already has an approved organization", async () => {
      setExistingResult({ id: ORG_ID, approval_status: "approved" });
      const res = await POST(makeRequest());
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe("ALREADY_APPLIED");
      expect(json.error.message).toMatch(/approved/i);
    });

    it("returns 500 when the duplicate check query fails", async () => {
      setExistingResult(null, { message: "DB connection error" });
      const res = await POST(makeRequest());
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
      const res = await POST(makeRequest());
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.id).toBe(ORG_ID);
      expect(json.data.approval_status).toBe("pending");
    });

    it("returns 201 when optional fields are provided", async () => {
      const body = {
        name: "KL Chess",
        email: "chess@klca.com",
        description: "A chess club",
        phone: "+60123456789",
        past_tournament_refs: "KL Open 2025",
        links: [{ label: "Facebook", url: "https://facebook.com/klchess" }],
      };
      setInsertResult(makeOrg({ description: "A chess club" }));
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(201);
    });

    it("returns 500 on an unexpected insert error", async () => {
      setInsertResult(null, { message: "Unexpected DB error" });
      const res = await POST(makeRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });
});
