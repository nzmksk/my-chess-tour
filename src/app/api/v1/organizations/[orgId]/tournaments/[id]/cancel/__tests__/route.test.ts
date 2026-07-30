import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockOrgBuilder,
  mockMembershipBuilder,
  mockTournamentFetchBuilder,
  mockCancellationInsertBuilder,
  mockFrom,
  mockGetClaims,
} = vi.hoisted(() => {
  function makeBuilder(finalResult: { data?: unknown; error?: unknown }) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "insert", "single"]) {
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
  const mockCancellationInsertBuilder = makeBuilder({ data: null, error: null });

  const mockFrom = vi.fn((table: string) => {
    if (table === "organizations") return mockOrgBuilder;
    if (table === "organization_memberships") return mockMembershipBuilder;
    if (table === "tournaments") return mockTournamentFetchBuilder;
    if (table === "tournament_cancellation_requests")
      return mockCancellationInsertBuilder;
    return mockOrgBuilder;
  });

  const mockGetClaims = vi.fn();

  return {
    mockOrgBuilder,
    mockMembershipBuilder,
    mockTournamentFetchBuilder,
    mockCancellationInsertBuilder,
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
// Fixtures & helpers
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const TOUR_ID = "cccccccc-0000-0000-0000-000000000001";

const APPROVED_ORG = { id: ORG_ID, approval_status: "approved" };

function makeRequest(body: unknown, orgId = ORG_ID, id = TOUR_ID): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/tournaments/${id}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
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

// Fixed "today" so date-derived state (upcoming/ongoing/completed) is
// deterministic. In Asia/Kuala_Lumpur (UTC+8) this instant is 2026-06-15.
const TODAY = new Date("2026-06-15T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
  setUser();
  setThen(mockOrgBuilder, APPROVED_ORG);
  setThen(mockMembershipBuilder, { roles: { name: "admin" } });
  setThen(mockTournamentFetchBuilder, {
    id: TOUR_ID,
    status: "published",
    start_date: "2026-08-01",
    end_date: "2026-08-03",
  });
  setThen(mockCancellationInsertBuilder, {
    id: "dddddddd-0000-0000-0000-000000000001",
    tournament_id: TOUR_ID,
    status: "pending",
    reason: "Venue fell through",
    created_at: "2026-06-01T00:00:00Z",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("POST .../tournaments/[id]/cancel", () => {
  it("returns 401 when not authenticated", async () => {
    setNoUser();
    const res = await POST(makeRequest({ reason: "x" }), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when reason is missing/blank", async () => {
    const res = await POST(makeRequest({ reason: "   " }), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("creates a pending cancellation request for a published tournament", async () => {
    const res = await POST(makeRequest({ reason: "Venue fell through" }), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe("pending");
    expect(mockCancellationInsertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tournament_id: TOUR_ID,
        requested_by: appIdFor(USER_ID),
        reason: "Venue fell through",
      }),
    );
  });

  it("returns 409 when the tournament is not published", async () => {
    setThen(mockTournamentFetchBuilder, { id: TOUR_ID, status: "draft" });
    const res = await POST(makeRequest({ reason: "x" }), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 409 when the tournament is already ongoing", async () => {
    // start ≤ today ≤ end (today is 2026-06-15)
    setThen(mockTournamentFetchBuilder, {
      id: TOUR_ID,
      status: "published",
      start_date: "2026-06-14",
      end_date: "2026-06-16",
    });
    const res = await POST(makeRequest({ reason: "x" }), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(409);
    expect(mockCancellationInsertBuilder.insert).not.toHaveBeenCalled();
  });

  it("returns 409 when the tournament has completed", async () => {
    // end < today (today is 2026-06-15)
    setThen(mockTournamentFetchBuilder, {
      id: TOUR_ID,
      status: "published",
      start_date: "2026-06-01",
      end_date: "2026-06-03",
    });
    const res = await POST(makeRequest({ reason: "x" }), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(409);
    expect(mockCancellationInsertBuilder.insert).not.toHaveBeenCalled();
  });

  it("returns 409 when a pending request already exists (unique violation)", async () => {
    setThen(mockCancellationInsertBuilder, null, { code: "23505" });
    const res = await POST(makeRequest({ reason: "x" }), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 404 when the tournament does not exist", async () => {
    setThen(mockTournamentFetchBuilder, null, { code: "PGRST116" });
    const res = await POST(makeRequest({ reason: "x" }), {
      params: Promise.resolve({ orgId: ORG_ID, id: TOUR_ID }),
    });
    expect(res.status).toBe(404);
  });
});
