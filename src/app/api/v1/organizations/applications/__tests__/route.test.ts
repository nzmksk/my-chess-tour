import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockBuilder, mockFrom, mockGetClaims, mockRpc, mockInfo } = vi.hoisted(
  () => {
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
    const mockRpc = vi.fn();
    const mockInfo = vi.fn();

    return { mockBuilder, mockFrom, mockGetClaims, mockRpc, mockInfo };
  },
);

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    from: mockFrom,
    rpc: mockRpc,
    storage: { from: vi.fn(() => ({ info: mockInfo })) },
  },
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
import { ORGANIZER_AGREEMENT_VERSION } from "@/lib/legal";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";

// The document prefix is keyed to the RESOLVED public.users.id, not the JWT sub.
const DOC_PATH = `users/${appIdFor(USER_ID)}/org-kyb/1.pdf`;

const VALID_BODY = {
  name: "KL Chess Association",
  email: "chess@klca.com",
  agreement_accepted: true,
  entity_type: "society",
  registration_number: "PPM-001-14-01012020",
  bank_code: "MBBEMYKL",
  bank_account_holder: "KL Chess Association",
  bank_account_number: "5140 1234-5678",
  documents: [
    { doc_type: "ros", storage_path: DOC_PATH, original_filename: "ros.pdf" },
  ],
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
    setQueryResult(null);
    // Default: every claimed upload exists and is acceptable, and the RPC
    // creates the application.
    mockInfo.mockResolvedValue({
      data: { size: 2048, contentType: "application/pdf" },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: makeOrg(), error: null });
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

    it.each([undefined, false, "true", 1])(
      "returns 400 when agreement_accepted is %s",
      async (agreement_accepted) => {
        const res = await POST(
          makePostRequest({ ...VALID_BODY, agreement_accepted }),
        );
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error.code).toBe("VALIDATION_ERROR");
        expect(json.error.message).toMatch(/organizer agreement/i);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Bank account, entity and document validation
  // -------------------------------------------------------------------------

  describe("payout bank account", () => {
    it("returns 400 for a SWIFT code that isn't a bank we support", async () => {
      const res = await POST(
        makePostRequest({ ...VALID_BODY, bank_code: "NOTABANK" }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/bank/i);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it.each(["1234", "12345678901234567890123", "abcdefgh"])(
      "returns 400 for account number %s",
      async (bank_account_number) => {
        const res = await POST(
          makePostRequest({ ...VALID_BODY, bank_account_number }),
        );
        expect(res.status).toBe(400);
      },
    );

    it("normalizes spaces and dashes out of the account number", async () => {
      await POST(makePostRequest());
      expect(mockRpc).toHaveBeenCalledWith(
        "create_organization_application",
        expect.objectContaining({ p_account_number: "514012345678" }),
      );
    });

    it("derives the bank display name server-side from the SWIFT code", async () => {
      // The client never supplies bank_name, so the stored name cannot
      // contradict the code it arrived with.
      await POST(
        makePostRequest({ ...VALID_BODY, bank_name: "Definitely Not Maybank" }),
      );
      expect(mockRpc).toHaveBeenCalledWith(
        "create_organization_application",
        expect.objectContaining({
          p_bank_code: "MBBEMYKL",
          p_bank_name: "Maybank",
        }),
      );
    });
  });

  describe("entity identity", () => {
    it("returns 400 for an unknown entity type", async () => {
      const res = await POST(
        makePostRequest({ ...VALID_BODY, entity_type: "cooperative" }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 when a society supplies no registration number", async () => {
      const res = await POST(
        makePostRequest({ ...VALID_BODY, registration_number: "  " }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/ROS registration number/i);
    });

    it("returns 400 when a company supplies no SSM document", async () => {
      const res = await POST(
        makePostRequest({
          ...VALID_BODY,
          entity_type: "company",
          documents: [
            {
              doc_type: "other",
              storage_path: DOC_PATH,
              original_filename: "misc.pdf",
            },
          ],
        }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toMatch(/SSM document/i);
    });

    it("drops a registration number for an individual organizer", async () => {
      await POST(
        makePostRequest({
          ...VALID_BODY,
          entity_type: "individual",
          registration_number: "PPM-999",
          documents: [
            {
              doc_type: "identity_document",
              storage_path: DOC_PATH,
              original_filename: "mykad.pdf",
            },
          ],
        }),
      );
      expect(mockRpc).toHaveBeenCalledWith(
        "create_organization_application",
        expect.objectContaining({ p_registration_number: null }),
      );
    });
  });

  describe("verification documents", () => {
    it("returns 400 when no documents are submitted", async () => {
      const res = await POST(
        makePostRequest({ ...VALID_BODY, documents: [] }),
      );
      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    // SECURITY: storage RLS stops a user WRITING outside their folder; only this
    // check stops them CLAIMING someone else's object as their document, which
    // the admin page would then mint a signed URL for.
    it("returns 400 for a path in another user's folder", async () => {
      const res = await POST(
        makePostRequest({
          ...VALID_BODY,
          documents: [
            {
              doc_type: "ros",
              storage_path:
                "users/cccccccc-0000-0000-0000-000000000009/org-kyb/1.pdf",
              original_filename: "theirs.pdf",
            },
          ],
        }),
      );
      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("returns 400 for a path containing a traversal segment", async () => {
      const res = await POST(
        makePostRequest({
          ...VALID_BODY,
          documents: [
            {
              doc_type: "ros",
              storage_path: `users/${appIdFor(USER_ID)}/org-kyb/../../secret.pdf`,
              original_filename: "x.pdf",
            },
          ],
        }),
      );
      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("returns 400 when no object exists at the claimed path", async () => {
      mockInfo.mockResolvedValue({
        data: null,
        error: { message: "not found" },
      });
      const res = await POST(makePostRequest());
      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("returns 400 when the uploaded object exceeds 5MB", async () => {
      mockInfo.mockResolvedValue({
        data: { size: 6 * 1024 * 1024, contentType: "application/pdf" },
        error: null,
      });
      const res = await POST(makePostRequest());
      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("returns 400 when the uploaded object is a disallowed type", async () => {
      mockInfo.mockResolvedValue({
        data: { size: 2048, contentType: "application/zip" },
        error: null,
      });
      const res = await POST(makePostRequest());
      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Creation (one transactional RPC)
  // -------------------------------------------------------------------------

  describe("creation", () => {
    it("returns 201 with the created organization on success", async () => {
      const res = await POST(makePostRequest());
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.id).toBe(ORG_ID);
      expect(json.data.approval_status).toBe("pending");
    });

    it("returns 201 when optional fields are provided", async () => {
      const res = await POST(
        makePostRequest({
          ...VALID_BODY,
          description: "A chess club",
          phone: "+60123456789",
          past_tournament_refs: "KL Open 2025",
          links: [{ label: "Facebook", url: "https://facebook.com/klchess" }],
        }),
      );
      expect(res.status).toBe(201);
    });

    it("records the agreement version from the server constant", async () => {
      await POST(makePostRequest());
      expect(mockRpc).toHaveBeenCalledWith(
        "create_organization_application",
        expect.objectContaining({
          p_agreement_version: ORGANIZER_AGREEMENT_VERSION,
          p_created_by: appIdFor(USER_ID),
        }),
      );
    });

    it("ignores an agreement version supplied in the request body", async () => {
      // The recorded version must name the document the platform served, so a
      // body-supplied version can never reach the row.
      await POST(
        makePostRequest({
          ...VALID_BODY,
          agreement_version: "1999-01-01",
          agreement_accepted_at: "1999-01-01T00:00:00Z",
          agreement_accepted_by: "cccccccc-0000-0000-0000-000000000009",
        }),
      );

      const args = mockRpc.mock.calls[0][1];
      expect(args.p_agreement_version).toBe(ORGANIZER_AGREEMENT_VERSION);
      expect(args.p_created_by).toBe(appIdFor(USER_ID));
      expect(JSON.stringify(args)).not.toContain("1999-01-01");
    });

    it("returns 409 when the RPC reports the name is taken", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          code: "P0001",
          message: "NAME_TAKEN: an organization with this name already exists",
        },
      });
      const res = await POST(makePostRequest());
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe("NAME_TAKEN");
      expect(json.error.message).toMatch(/already exists/i);
    });

    it("returns 409 when the account is another organization's destination", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          code: "P0001",
          message: "BANK_ACCOUNT_IN_USE: this bank account is already...",
        },
      });
      const res = await POST(makePostRequest());
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe("BANK_ACCOUNT_IN_USE");
    });

    it("returns 400 when the RPC rejects the entity/document combination", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          code: "P0001",
          message: "ENTITY_DOCS_REQUIRED: a company must supply an SSM document",
        },
      });
      const res = await POST(makePostRequest());
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 500 on an unexpected RPC error", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: "XX000", message: "Unexpected DB error" },
      });
      const res = await POST(makePostRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });
});
