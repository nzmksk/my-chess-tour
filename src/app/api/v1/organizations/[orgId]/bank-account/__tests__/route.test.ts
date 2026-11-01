import { beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, mockGetClaims, mockPermissionRpc, builder } =
  vi.hoisted(() => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is"]) {
      builder[m] = vi.fn(() => builder);
    }
    builder.single = vi.fn();
    builder.maybeSingle = vi.fn();

    return {
      builder,
      mockFrom: vi.fn(() => builder),
      mockRpc: vi.fn(),
      mockGetClaims: vi.fn(),
      mockPermissionRpc: vi.fn(),
    };
  });

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
    rpc: mockPermissionRpc,
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

import { GET, PUT } from "../route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";

const VALID_BODY = {
  bank_code: "MBBEMYKL",
  account_holder: "KL Chess Association",
  account_number: "5140 1234-5678",
};

const params = (orgId = ORG_ID) => ({ params: Promise.resolve({ orgId }) });

function makeGet(orgId = ORG_ID) {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/bank-account`,
  );
}

function makePut(body: unknown = VALID_BODY, orgId = ORG_ID) {
  return new NextRequest(
    `http://localhost/api/v1/organizations/${orgId}/bank-account`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const single = () => builder.single as ReturnType<typeof vi.fn>;
const maybeSingle = () => builder.maybeSingle as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: USER_ID } },
    error: null,
  });
  // Org exists; caller holds bank_account.manage.
  single().mockResolvedValue({ data: { id: ORG_ID }, error: null });
  mockPermissionRpc.mockResolvedValue({ data: true, error: null });
  maybeSingle().mockResolvedValue({ data: null, error: null });
  mockRpc.mockResolvedValue({
    data: {
      changed: true,
      id: "cccccccc-0000-0000-0000-000000000001",
      bank_name: "Maybank",
      bank_code: "MBBEMYKL",
      account_holder: "KL Chess Association",
      account_number_last4: "5678",
      status: "pending",
      rejection_reason: null,
      verified_at: null,
    },
    error: null,
  });
});

// ---------------------------------------------------------------------------
// Authorization — identical for both verbs
// ---------------------------------------------------------------------------

describe.each([
  ["GET", () => GET(makeGet(), params())],
  ["PUT", () => PUT(makePut(), params())],
])("%s /api/v1/organizations/[orgId]/bank-account — authorization", (
  _verb,
  call,
) => {
  it("400 for a non-UUID orgId", async () => {
    const res =
      _verb === "GET"
        ? await GET(makeGet("nope"), params("nope"))
        : await PUT(makePut(VALID_BODY, "nope"), params("nope"));
    expect(res.status).toBe(400);
  });

  it("401 when unauthenticated", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await call();
    expect(res.status).toBe(401);
  });

  it("404 when the organization does not exist", async () => {
    single().mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const res = await call();
    expect(res.status).toBe(404);
  });

  // Owner-only: a delegated org `admin` has no business reading or redirecting
  // where the organization's money lands.
  it("403 without bank_account.manage", async () => {
    mockPermissionRpc.mockResolvedValue({ data: false, error: null });
    const res = await call();
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("checks bank_account.manage, not org.manage", async () => {
    await call();
    expect(mockPermissionRpc).toHaveBeenCalledWith("has_org_permission", {
      p_user_id: appIdFor(USER_ID),
      p_org_id: ORG_ID,
      p_permission: "bank_account.manage",
    });
  });
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe("GET /api/v1/organizations/[orgId]/bank-account", () => {
  it("returns null data when there is no active account", async () => {
    const res = await GET(makeGet(), params());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toBeNull();
  });

  it("returns the last 4 digits and never the full account number", async () => {
    maybeSingle().mockResolvedValue({
      data: {
        bank_name: "Maybank",
        bank_code: "MBBEMYKL",
        account_holder: "KL Chess Association",
        account_number: "514012345678",
        status: "verified",
        rejection_reason: null,
        verified_at: "2026-03-01T00:00:00Z",
      },
      error: null,
    });

    const res = await GET(makeGet(), params());
    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).toContain("5678");
    expect(body).not.toContain("514012345678");

    const { data } = JSON.parse(body);
    expect(data.account_number_last4).toBe("5678");
    expect(data).not.toHaveProperty("account_number");
  });

  it("reads only the active row", async () => {
    await GET(makeGet(), params());
    const eq = builder.eq as ReturnType<typeof vi.fn>;
    expect(eq).toHaveBeenCalledWith("is_active", true);
  });

  it("500 when the read fails", async () => {
    maybeSingle().mockResolvedValue({
      data: null,
      error: { message: "db down" },
    });
    const res = await GET(makeGet(), params());
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------

describe("PUT /api/v1/organizations/[orgId]/bank-account", () => {
  it("400 for a body that isn't JSON", async () => {
    const req = new NextRequest(
      `http://localhost/api/v1/organizations/${ORG_ID}/bank-account`,
      { method: "PUT", body: "not json" },
    );
    const res = await PUT(req, params());
    expect(res.status).toBe(400);
  });

  it("400 for a SWIFT code that isn't a bank we support", async () => {
    const res = await PUT(
      makePut({ ...VALID_BODY, bank_code: "NOTABANK" }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each(["1234", "12345678901234567890123", "not-digits"])(
    "400 for account number %s",
    async (account_number) => {
      const res = await PUT(
        makePut({ ...VALID_BODY, account_number }),
        params(),
      );
      expect(res.status).toBe(400);
    },
  );

  it("normalizes the account number and derives the bank name server-side", async () => {
    await PUT(makePut(), params());
    expect(mockRpc).toHaveBeenCalledWith("set_organization_bank_account", {
      p_org_id: ORG_ID,
      p_bank_code: "MBBEMYKL",
      p_bank_name: "Maybank",
      p_account_holder: "KL Chess Association",
      p_account_number: "514012345678",
      p_actor_id: appIdFor(USER_ID),
    });
  });

  it("ignores a bank_name supplied by the client", async () => {
    await PUT(
      makePut({ ...VALID_BODY, bank_name: "Definitely Not Maybank" }),
      params(),
    );
    expect(mockRpc.mock.calls[0][1].p_bank_name).toBe("Maybank");
  });

  it("returns the masked result of the RPC", async () => {
    const res = await PUT(makePut(), params());
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.account_number_last4).toBe("5678");
    expect(data.status).toBe("pending");
  });

  it("404 when the RPC reports the organization is gone", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "organization ... not found" },
    });
    const res = await PUT(makePut(), params());
    expect(res.status).toBe(404);
  });

  // uniq_active_bank_destination: one account cannot be the active payout
  // destination for two organizations.
  it("409 when the account is another organization's payout destination", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value ..." },
    });
    const res = await PUT(makePut(), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("BANK_ACCOUNT_IN_USE");
  });

  it("500 on an unexpected RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "boom" },
    });
    const res = await PUT(makePut(), params());
    expect(res.status).toBe(500);
  });
});
