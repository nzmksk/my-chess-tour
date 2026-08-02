import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockOrgBuilder,
  mockUpdateBuilder,
  mockMembershipBuilder,
  mockFrom,
  mockGetClaims,
  mockGetAuthClaims,
  mockHasOrgPermission,
} = vi.hoisted(() => {
  function makeBuilder(finalResult: {
    data?: unknown;
    count?: unknown;
    error?: unknown;
  }) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "single", "maybeSingle", "update"]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) => Promise.resolve(finalResult).then(onfulfilled, onrejected);
    return b;
  }

  const mockOrgBuilder = makeBuilder({ data: null, error: null });
  const mockUpdateBuilder = makeBuilder({ data: null, error: null });
  const mockMembershipBuilder = makeBuilder({ count: 1, error: null });

  // The route reads the org and then updates it; route update() to its own
  // builder so the read result and the write result can be set independently.
  (mockOrgBuilder as Record<string, unknown>).update = vi.fn(
    () => mockUpdateBuilder,
  );

  const mockFrom = vi.fn((table: string) => {
    if (table === "organization_memberships") return mockMembershipBuilder;
    return mockOrgBuilder;
  });

  const mockGetClaims = vi.fn();
  const mockGetAuthClaims = vi.fn(async () => {
    const { data } = await mockGetClaims();
    const claims = data?.claims;
    if (!claims) return null;
    return {
      id: claims.sub,
      email: claims.email ?? "",
      userMetadata: claims.user_metadata ?? {},
      role: claims.role,
    };
  });
  const mockHasOrgPermission = vi.fn().mockResolvedValue(true);

  return {
    mockOrgBuilder,
    mockUpdateBuilder,
    mockMembershipBuilder,
    mockFrom,
    mockGetClaims,
    mockGetAuthClaims,
    mockHasOrgPermission,
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

vi.mock("@/services/supabase/permission", () => ({
  hasOrgPermission: mockHasOrgPermission,
  getAuthClaims: mockGetAuthClaims,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

import { POST } from "../route";
import { ORGANIZER_AGREEMENT_VERSION } from "@/lib/legal";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const STALE_VERSION = "2025-01-01";

function makeRequest(
  orgId: string = ORG_ID,
  body: unknown = { agreement_accepted: true },
): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/agreement`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function params(orgId: string = ORG_ID) {
  return { params: Promise.resolve({ orgId }) };
}

function setUser(id = USER_ID) {
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: id } },
    error: null,
  });
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

function setUpdateResult(data: unknown, error: unknown = null) {
  (mockUpdateBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

function setMembershipResult(count: number | null, error: unknown = null) {
  (mockMembershipBuilder as Record<string, unknown>).then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ count, error }).then(onfulfilled, onrejected);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/organizations/[orgId]/agreement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUser();
    setMembershipResult(1);
    mockHasOrgPermission.mockResolvedValue(true);
    setOrgResult({
      id: ORG_ID,
      agreement_version: STALE_VERSION,
      agreement_accepted_at: "2025-01-01T00:00:00Z",
    });
    setUpdateResult({
      agreement_version: ORGANIZER_AGREEMENT_VERSION,
      agreement_accepted_at: "2026-08-02T00:00:00Z",
    });
  });

  // --- Validation -----------------------------------------------------------

  it("returns 400 for a non-UUID organization id", async () => {
    const res = await POST(makeRequest("not-a-uuid"), params("not-a-uuid"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const req = new NextRequest(
      `http://localhost/api/v1/organizations/${ORG_ID}/agreement`,
      { method: "POST", body: "not json" },
    );
    const res = await POST(req, params());
    expect(res.status).toBe(400);
  });

  it.each([undefined, false, "true", 1])(
    "returns 400 when agreement_accepted is %s",
    async (agreement_accepted) => {
      const res = await POST(
        makeRequest(ORG_ID, { agreement_accepted }),
        params(),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/organizer agreement/i);
    },
  );

  // --- Access control -------------------------------------------------------

  it("returns 401 when unauthenticated", async () => {
    setNoUser();
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 when the organization does not exist", async () => {
    setOrgResult(null, { code: "PGRST116", message: "No rows" });
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("returns 403 when the caller is not a member", async () => {
    setMembershipResult(0);
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toMatch(/access denied/i);
  });

  it("returns 403 without the org.manage permission", async () => {
    mockHasOrgPermission.mockResolvedValue(false);
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(403);
    expect(mockHasOrgPermission).toHaveBeenCalledWith(
      USER_ID,
      ORG_ID,
      "org.manage",
    );
  });

  it("lets a pending organization accept a new version", async () => {
    // A version bump must not strand an org that has not been approved yet —
    // there is deliberately no approval_status gate on this route.
    setOrgResult({
      id: ORG_ID,
      approval_status: "pending",
      agreement_version: STALE_VERSION,
      agreement_accepted_at: "2025-01-01T00:00:00Z",
    });

    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(200);
  });

  // --- Recording the acceptance ---------------------------------------------

  it("records the current version, timestamp and acceptor", async () => {
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(200);

    const updateMock = mockOrgBuilder.update as ReturnType<typeof vi.fn>;
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agreement_version: ORGANIZER_AGREEMENT_VERSION,
        agreement_accepted_by: USER_ID,
        agreement_accepted_at: expect.any(String),
      }),
    );

    const json = await res.json();
    expect(json.data.agreement_version).toBe(ORGANIZER_AGREEMENT_VERSION);
  });

  it("ignores an agreement version supplied in the request body", async () => {
    await POST(
      makeRequest(ORG_ID, {
        agreement_accepted: true,
        agreement_version: "1999-01-01",
        agreement_accepted_by: "cccccccc-0000-0000-0000-000000000009",
      }),
      params(),
    );

    const updateMock = mockOrgBuilder.update as ReturnType<typeof vi.fn>;
    const written = updateMock.mock.calls[0][0];
    expect(written.agreement_version).toBe(ORGANIZER_AGREEMENT_VERSION);
    expect(written.agreement_accepted_by).toBe(USER_ID);
    expect(JSON.stringify(written)).not.toContain("1999-01-01");
  });

  it("is a no-op when the current version is already accepted", async () => {
    // Re-accepting would only move the timestamp, and the timestamp is the
    // evidence of when THIS version was agreed to.
    setOrgResult({
      id: ORG_ID,
      agreement_version: ORGANIZER_AGREEMENT_VERSION,
      agreement_accepted_at: "2026-08-02T09:00:00Z",
    });

    const res = await POST(makeRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.agreement_accepted_at).toBe("2026-08-02T09:00:00Z");
    expect(mockOrgBuilder.update).not.toHaveBeenCalled();
  });

  it("returns 500 when the update fails", async () => {
    setUpdateResult(null, { message: "DB down" });
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL_ERROR");
  });
});
