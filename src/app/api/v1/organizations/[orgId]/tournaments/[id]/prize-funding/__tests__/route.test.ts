import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockFrom,
  mockGetClaims,
  mockHasPermission,
  mockSync,
  mockLoadPool,
  tables,
  inserts,
  updates,
} = vi.hoisted(() => {
  const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};
  const inserts: Array<{ table: string; row: unknown }> = [];
  const updates: Array<{ table: string; patch: unknown }> = [];

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "maybeSingle", "single"]) {
      b[m] = vi.fn(() => b);
    }
    b.insert = vi.fn((row: unknown) => {
      inserts.push({ table, row });
      return b;
    });
    b.update = vi.fn((patch: unknown) => {
      updates.push({ table, patch });
      return b;
    });
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) =>
      Promise.resolve(tables[table]?.shift() ?? { data: null, error: null }).then(
        onfulfilled,
        onrejected,
      );
    return b;
  }

  return {
    tables,
    inserts,
    updates,
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
    mockGetClaims: vi.fn(),
    mockHasPermission: vi.fn(),
    mockSync: vi.fn(),
    mockLoadPool: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));
vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetClaims,
  hasOrgPermission: mockHasPermission,
}));
vi.mock("@/services/prizes/funding-requests", () => ({
  syncPrizeFundingRequests: mockSync,
}));
vi.mock("@/services/prizes/pool", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/prizes/pool")>()),
  loadPrizePoolPosition: mockLoadPool,
}));

import { GET, POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const T_ID = "cccccccc-0000-4000-8000-000000000001";
const FUNDING_ID = "dddddddd-0000-4000-8000-000000000001";

const params = { params: Promise.resolve({ orgId: ORG_ID, id: T_ID }) };

const post = () =>
  POST(
    new NextRequest(`http://localhost/api/v1/organizations/${ORG_ID}/tournaments/${T_ID}/prize-funding`, {
      method: "POST",
    }),
    params,
  );

const get = () =>
  GET(
    new NextRequest(`http://localhost/api/v1/organizations/${ORG_ID}/tournaments/${T_ID}/prize-funding`),
    params,
  );

const platformTournament = {
  id: T_ID,
  name: "Merdeka Open",
  status: "pending_funding",
  prizes: {
    categories: [
      {
        name: "Open",
        funding: { source: "sponsor", funder_name: "Acme" },
        entries: [{ place: "1st", amount_cents: 45000 }],
      },
    ],
    special: [
      { name: "Best Junior", funding: { source: "grant", funder_name: "Ministry" }, amount_cents: 5000 },
    ],
    distribution: "platform",
  },
};

const position = (funded: number) => ({
  distribution: "platform",
  declared_cents: 50000,
  funded_cents: funded,
  paid_out_cents: 0,
  balance_cents: funded,
  reserved_cents: 0,
  pending_review_cents: 0,
  available_cents: funded,
  fully_funded: funded >= 50000,
});


beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  inserts.length = 0;
  updates.length = 0;
  mockGetClaims.mockResolvedValue({ id: USER_ID });
  mockHasPermission.mockResolvedValue(true);
  tables.organizations = [{ data: { id: ORG_ID, approval_status: "approved" }, error: null }];
  tables.tournaments = [{ data: platformTournament, error: null }];
  mockLoadPool.mockResolvedValue({ ok: true, position: position(20000) });
  mockSync.mockResolvedValue({
    error: null,
    released: false,
    linked: 1,
    unlinked: 0,
    missingContacts: [],
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe("POST prize-funding (retry)", () => {
  it("needs payout.request", async () => {
    mockHasPermission.mockResolvedValue(false);
    const res = await post();
    expect(res.status).toBe(403);
    expect(mockHasPermission).toHaveBeenCalledWith(USER_ID, ORG_ID, "payout.request");
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("re-runs the funding requests and reports what was sent", async () => {
    mockSync.mockResolvedValue({
      error: null,
      released: false,
      linked: 1,
      unlinked: 0,
      missingContacts: ["Ministry"],
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith(T_ID, USER_ID);
    expect((await res.json()).data).toEqual({
      linked: 1,
      missing_contacts: ["Ministry"],
      released: false,
    });
  });

  it("answers 503 when a link still couldn't be created", async () => {
    mockSync.mockResolvedValue({
      error: null,
      released: false,
      linked: 0,
      unlinked: 2,
      missingContacts: [],
    });
    const res = await post();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("PAYMENT_GATEWAY_ERROR");
  });

  it("500s when the reconcile fails", async () => {
    mockSync.mockResolvedValue({
      error: { message: "db down" },
      released: false,
      linked: 0,
      unlinked: 0,
      missingContacts: [],
    });
    const res = await post();
    expect(res.status).toBe(500);
  });

  it("refuses a tournament whose organizer pays its own winners", async () => {
    tables.tournaments = [
      { data: { ...platformTournament, prizes: { distribution: "organizer" } }, error: null },
    ];
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_PLATFORM_DISTRIBUTED");
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("refuses a draft, whose links go out when it is published", async () => {
    tables.tournaments = [{ data: { ...platformTournament, status: "draft" }, error: null }];
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_PUBLISHED");
  });

  it("refuses a cancelled tournament", async () => {
    tables.tournaments = [{ data: { ...platformTournament, status: "cancelled" }, error: null }];
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("TOURNAMENT_CANCELLED");
  });

  it("404s a tournament of another organization", async () => {
    tables.tournaments = [{ data: null, error: null }];
    const res = await post();
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe("GET prize-funding", () => {
  it("returns the pool, the contributions and the funders with no address", async () => {
    const fundings = [
      { id: FUNDING_ID, funder_name: "Acme", amount_cents: 45000, status: "pending", cancelled_at: null },
    ];
    tables.prize_fundings = [{ data: fundings, error: null }];
    tables.prize_funder_contacts = [{ data: [{ funder_name: " acme " }], error: null }];
    const res = await get();
    expect(res.status).toBe(200);
    expect(mockHasPermission).toHaveBeenCalledWith(USER_ID, ORG_ID, "payout.view");
    expect((await res.json()).data).toEqual({
      pool: position(20000),
      status: "pending_funding",
      fundings,
      missing_contacts: ["Ministry"],
    });
  });

  it("500s when the pool can't be read", async () => {
    mockLoadPool.mockResolvedValue({ ok: false, error: { message: "db down" } });
    const res = await get();
    expect(res.status).toBe(500);
  });
});
