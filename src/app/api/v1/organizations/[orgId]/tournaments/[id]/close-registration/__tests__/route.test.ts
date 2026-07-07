import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockOrgBuilder,
  mockMembershipBuilder,
  mockTournamentFetchBuilder,
  mockTournamentUpdateBuilder,
  mockFrom,
  mockGetClaims,
} = vi.hoisted(() => {
  function makeBuilder(finalResult: { data?: unknown; error?: unknown }) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "update", "single"]) {
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
  const mockTournamentFetchBuilder = makeBuilder({ data: null, error: null });
  const mockTournamentUpdateBuilder = makeBuilder({ data: null, error: null });

  let tournamentCallIndex = 0;

  const mockFrom = vi.fn((table: string) => {
    if (table === "organizations") return mockOrgBuilder;
    if (table === "organization_memberships") return mockMembershipBuilder;
    if (table === "tournaments") {
      const builder =
        tournamentCallIndex === 0
          ? mockTournamentFetchBuilder
          : mockTournamentUpdateBuilder;
      tournamentCallIndex += 1;
      return builder;
    }
    return mockOrgBuilder;
  });

  (
    mockFrom as unknown as { _resetTournamentCallIndex: () => void }
  )._resetTournamentCallIndex = () => {
    tournamentCallIndex = 0;
  };

  const mockGetClaims = vi.fn();

  return {
    mockOrgBuilder,
    mockMembershipBuilder,
    mockTournamentFetchBuilder,
    mockTournamentUpdateBuilder,
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

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const TOUR_ID = "cccccccc-0000-0000-0000-000000000001";

const APPROVED_ORG = { id: ORG_ID, approval_status: "approved" };

const PUBLISHED_OPEN = {
  id: TOUR_ID,
  slug: "kl-open-2026",
  status: "published",
  registration_deadline: "2099-01-10T23:59:59Z",
  registration_closed_at: null,
};

function makeRequest(orgId = ORG_ID, id = TOUR_ID): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/tournaments/${id}/close-registration`,
    { method: "POST" },
  );
}

function resetTournamentCalls() {
  (
    mockFrom as unknown as { _resetTournamentCallIndex: () => void }
  )._resetTournamentCallIndex();
}

function setUser(userId = USER_ID) {
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: userId } },
    error: null,
  });
}

function setNoUser() {
  mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
}

function setThen(builder: Record<string, unknown>, data: unknown, error: unknown = null) {
  builder.then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve({ data, error }).then(onfulfilled, onrejected);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetTournamentCalls();
  setUser();
  setThen(mockOrgBuilder, APPROVED_ORG);
  setThen(mockMembershipBuilder, { roles: { name: "owner" } });
  setThen(mockTournamentFetchBuilder, PUBLISHED_OPEN);
  setThen(mockTournamentUpdateBuilder, {
    id: TOUR_ID,
    slug: "kl-open-2026",
    status: "published",
    registration_closed_at: "2026-06-01T00:00:00Z",
  });
});

afterEach(() => {
  vi.clearAllMocks();
  resetTournamentCalls();
});

describe("POST .../tournaments/[id]/close-registration", () => {
  it("returns 401 when not authenticated", async () => {
    setNoUser();
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid tournament id", async () => {
    const res = await POST(makeRequest(ORG_ID, "not-a-uuid"), {
      params: Promise.resolve({ orgId: ORG_ID, id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for a non owner/admin member", async () => {
    setThen(mockMembershipBuilder, { roles: { name: "member" } });
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(403);
  });

  it("closes registration for a published, open tournament", async () => {
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.registration_closed_at).toBeTruthy();
    expect(mockTournamentUpdateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ registration_closed_at: expect.any(String) }),
    );
  });

  it("returns 409 when the tournament is not published", async () => {
    setThen(mockTournamentFetchBuilder, {
      ...PUBLISHED_OPEN,
      status: "draft",
    });
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 409 when registration is already closed", async () => {
    setThen(mockTournamentFetchBuilder, {
      ...PUBLISHED_OPEN,
      registration_closed_at: "2026-05-01T00:00:00Z",
    });
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 404 when the tournament does not exist", async () => {
    setThen(mockTournamentFetchBuilder, null, { code: "PGRST116" });
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(404);
  });
});
