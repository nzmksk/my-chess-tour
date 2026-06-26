import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockDetailBuilder, mockFrom, mockGetUser, mockRpc, mockAdminRpc } =
  vi.hoisted(() => {
    function makeBuilder(finalResult: { data?: unknown; error?: unknown }) {
      const b: Record<string, unknown> = {};
      for (const m of [
        "select",
        "eq",
        "is",
        "update",
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

    const mockDetailBuilder = makeBuilder({ data: null, error: null });

    const mockFrom = vi.fn((_table: string) => mockDetailBuilder);
    const mockGetUser = vi.fn();
    const mockRpc = vi.fn();
    const mockAdminRpc = vi.fn();

    return {
      mockDetailBuilder,
      mockFrom,
      mockGetUser,
      mockRpc,
      mockAdminRpc,
    };
  });

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockAdminRpc },
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

import { GET, PATCH } from "../route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const APP_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const NOT_UUID = "not-a-uuid";

const FULL_APPLICATION = {
  id: APP_ID,
  name: "Penang Chess Club",
  description: "Community club in Georgetown",
  links: { website: "https://penangchess.org", facebook: "fb.com/penang" },
  email: "penang@chess.my",
  phone: "+60123456789",
  past_tournament_refs: "Penang Open 2025 — 80 participants",
  approval_status: "pending",
  rejection_reason: null,
  created_at: "2026-02-22T10:00:00Z",
  reviewed_at: null,
  applicant: {
    id: "cccccccc-0000-0000-0000-000000000001",
    first_name: "Lee",
    last_name: "Wei Hao",
    email: "weihao@gmail.com",
    created_at: "2026-01-15T00:00:00Z",
    player_profiles: {
      fide_id: 5834567,
      fide_rating: { standard: 1923, rapid: 1900 },
      title: "FM",
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGetRequest(id = APP_ID): NextRequest {
  return new NextRequest(`http://localhost/api/v1/admin/applications/${id}`);
}

function makePatchRequest(
  id = APP_ID,
  body: object = { action: "approve" },
): NextRequest {
  return new NextRequest(`http://localhost/api/v1/admin/applications/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setUser(id = ADMIN_USER_ID) {
  mockGetUser.mockResolvedValue({ data: { user: { id } }, error: null });
}

function setNoUser() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
}

function setAdminPermission(isAdmin: boolean) {
  mockRpc.mockResolvedValue({ data: isAdmin, error: null });
}

function setBuilderResult(
  builder: Record<string, unknown>,
  result: { data?: unknown; error?: unknown },
) {
  builder.then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve(result).then(onfulfilled, onrejected);
}

// ---------------------------------------------------------------------------
// Tests: GET
// ---------------------------------------------------------------------------

describe("GET /api/v1/admin/applications/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUser();
    setAdminPermission(true);
    setBuilderResult(mockDetailBuilder, {
      data: FULL_APPLICATION,
      error: null,
    });
    mockFrom.mockReturnValue(mockDetailBuilder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Validation ────────────────────────────────────────────────────────────

  describe("validation", () => {
    it("returns 400 for non-UUID id", async () => {
      const res = await GET(makeGetRequest(NOT_UUID), {
        params: Promise.resolve({ id: NOT_UUID }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ── Authentication ────────────────────────────────────────────────────────

  describe("authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      setNoUser();
      const res = await GET(makeGetRequest(), {
        params: Promise.resolve({ id: APP_ID }),
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });
  });

  // ── Authorization ─────────────────────────────────────────────────────────

  describe("authorization", () => {
    it("returns 403 when user is not admin", async () => {
      setAdminPermission(false);
      const res = await GET(makeGetRequest(), {
        params: Promise.resolve({ id: APP_ID }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("returns 500 when permission check fails", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "RPC error" },
      });
      const res = await GET(makeGetRequest(), {
        params: Promise.resolve({ id: APP_ID }),
      });
      expect(res.status).toBe(500);
    });
  });

  // ── Response ──────────────────────────────────────────────────────────────

  describe("response", () => {
    it("returns 200 with full application data", async () => {
      const res = await GET(makeGetRequest(), {
        params: Promise.resolve({ id: APP_ID }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty("data");
      expect(json.data.id).toBe(APP_ID);
      expect(json.data.name).toBe("Penang Chess Club");
      expect(json.data.links).toEqual({
        website: "https://penangchess.org",
        facebook: "fb.com/penang",
      });
      expect(json.data.applicant).toBeDefined();
      expect(json.data.applicant.first_name).toBe("Lee");
    });

    it("returns 404 when application does not exist", async () => {
      setBuilderResult(mockDetailBuilder, {
        data: null,
        error: { code: "PGRST116", message: "No rows found" },
      });
      const res = await GET(makeGetRequest(), {
        params: Promise.resolve({ id: APP_ID }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 500 on database error", async () => {
      setBuilderResult(mockDetailBuilder, {
        data: null,
        error: { code: "500", message: "DB error" },
      });
      const res = await GET(makeGetRequest(), {
        params: Promise.resolve({ id: APP_ID }),
      });
      expect(res.status).toBe(500);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: PATCH
// ---------------------------------------------------------------------------

describe("PATCH /api/v1/admin/applications/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUser();
    setAdminPermission(true);
    mockAdminRpc.mockResolvedValue({
      data: {
        id: APP_ID,
        name: "Penang Chess Club",
        approval_status: "approved",
        reviewed_at: "2026-05-01T00:00:00Z",
      },
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Validation ────────────────────────────────────────────────────────────

  describe("validation", () => {
    it("returns 400 for non-UUID id", async () => {
      const res = await PATCH(makePatchRequest(NOT_UUID), {
        params: Promise.resolve({ id: NOT_UUID }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid action", async () => {
      const res = await PATCH(makePatchRequest(APP_ID, { action: "suspend" }), {
        params: Promise.resolve({ id: APP_ID }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when rejecting without a reason", async () => {
      const res = await PATCH(makePatchRequest(APP_ID, { action: "reject" }), {
        params: Promise.resolve({ id: APP_ID }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when rejection_reason is blank", async () => {
      const res = await PATCH(
        makePatchRequest(APP_ID, { action: "reject", rejection_reason: "   " }),
        { params: Promise.resolve({ id: APP_ID }) },
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 when rejection_reason is a non-string type", async () => {
      const res = await PATCH(
        makePatchRequest(APP_ID, {
          action: "reject",
          rejection_reason: {} as unknown as string,
        }),
        { params: Promise.resolve({ id: APP_ID }) },
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ── Authentication ────────────────────────────────────────────────────────

  describe("authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      setNoUser();
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ id: APP_ID }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ── Authorization ─────────────────────────────────────────────────────────

  describe("authorization", () => {
    it("returns 403 when user is not admin", async () => {
      setAdminPermission(false);
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ id: APP_ID }),
      });
      expect(res.status).toBe(403);
    });
  });

  // ── Approve ───────────────────────────────────────────────────────────────

  describe("approve", () => {
    it("returns 200 with updated application on approve", async () => {
      const res = await PATCH(makePatchRequest(APP_ID, { action: "approve" }), {
        params: Promise.resolve({ id: APP_ID }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.approval_status).toBe("approved");
    });
  });

  // ── Reject ────────────────────────────────────────────────────────────────

  describe("reject", () => {
    it("returns 200 with updated application on reject", async () => {
      mockAdminRpc.mockResolvedValue({
        data: {
          id: APP_ID,
          name: "Penang Chess Club",
          approval_status: "rejected",
          reviewed_at: "2026-05-01T00:00:00Z",
        },
        error: null,
      });
      const res = await PATCH(
        makePatchRequest(APP_ID, {
          action: "reject",
          rejection_reason: "Insufficient information",
        }),
        { params: Promise.resolve({ id: APP_ID }) },
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.approval_status).toBe("rejected");
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 404 when application does not exist", async () => {
      mockAdminRpc.mockResolvedValue({
        data: null,
        error: { code: "P0002", message: "organization not found" },
      });
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ id: APP_ID }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 500 on database error", async () => {
      mockAdminRpc.mockResolvedValue({
        data: null,
        error: { code: "500", message: "DB error" },
      });
      const res = await PATCH(makePatchRequest(), {
        params: Promise.resolve({ id: APP_ID }),
      });
      expect(res.status).toBe(500);
    });
  });
});
