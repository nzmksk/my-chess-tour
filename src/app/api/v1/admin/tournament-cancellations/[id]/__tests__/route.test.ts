import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockTournamentBuilder, mockFrom, mockGetClaims, mockRpc, mockAdminRpc } =
  vi.hoisted(() => {
    function makeBuilder(finalResult: { data?: unknown; error?: unknown }) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "single"]) {
        b[m] = vi.fn(() => b);
      }
      b.then = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (r: unknown) => unknown,
      ) => Promise.resolve(finalResult).then(onfulfilled, onrejected);
      return b;
    }

    const mockTournamentBuilder = makeBuilder({ data: null, error: null });
    const mockFrom = vi.fn((_table: string) => mockTournamentBuilder);
    const mockGetClaims = vi.fn();
    const mockRpc = vi.fn();
    const mockAdminRpc = vi.fn();

    return { mockTournamentBuilder, mockFrom, mockGetClaims, mockRpc, mockAdminRpc };
  });

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockAdminRpc },
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

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { PATCH } from "../route";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const REQ_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const TOUR_ID = "cccccccc-0000-0000-0000-000000000001";

function makeRequest(body: unknown, id = REQ_ID): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/admin/tournament-cancellations/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function setAdmin(isAdmin = true) {
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: ADMIN_USER_ID } },
    error: null,
  });
  mockRpc.mockResolvedValue({ data: isAdmin, error: null });
}

function setNoUser() {
  mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  setAdmin();
  mockAdminRpc.mockResolvedValue({
    data: { id: REQ_ID, tournament_id: TOUR_ID, status: "approved" },
    error: null,
  });
  mockTournamentBuilder.then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) =>
    Promise.resolve({ data: { slug: "kl-open-2026" }, error: null }).then(
      onfulfilled,
      onrejected,
    );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/v1/admin/tournament-cancellations/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    setNoUser();
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-admin", async () => {
    setAdmin(false);
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid action", async () => {
    const res = await PATCH(makeRequest({ action: "maybe" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when rejecting without a reason", async () => {
    const res = await PATCH(makeRequest({ action: "reject" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("approves a request and calls the review RPC", async () => {
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(200);
    expect(mockAdminRpc).toHaveBeenCalledWith(
      "review_tournament_cancellation",
      expect.objectContaining({
        p_request_id: REQ_ID,
        p_reviewer_id: ADMIN_USER_ID,
        p_action: "approve",
        p_rejection_reason: null,
      }),
    );
  });

  it("rejects a request with a reason", async () => {
    mockAdminRpc.mockResolvedValue({
      data: { id: REQ_ID, tournament_id: TOUR_ID, status: "rejected" },
      error: null,
    });
    const res = await PATCH(
      makeRequest({ action: "reject", rejection_reason: "Event is proceeding" }),
      { params: Promise.resolve({ id: REQ_ID }) },
    );
    expect(res.status).toBe(200);
    expect(mockAdminRpc).toHaveBeenCalledWith(
      "review_tournament_cancellation",
      expect.objectContaining({
        p_action: "reject",
        p_rejection_reason: "Event is proceeding",
      }),
    );
  });

  it("returns 404 when the request is not found (P0002)", async () => {
    mockAdminRpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the request was already reviewed (P0001)", async () => {
    mockAdminRpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
    const res = await PATCH(makeRequest({ action: "approve" }), {
      params: Promise.resolve({ id: REQ_ID }),
    });
    expect(res.status).toBe(409);
  });
});
