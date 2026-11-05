import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, mockGetClaims, mockHasPermission, tables, orCalls } =
  vi.hoisted(() => {
    const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};
    const orCalls: string[] = [];

    function makeBuilder(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "maybeSingle", "order"]) {
        b[m] = vi.fn(() => b);
      }
      b.or = vi.fn((filter: string) => {
        orCalls.push(filter);
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
      orCalls,
      mockFrom: vi.fn((table: string) => makeBuilder(table)),
      mockRpc: vi.fn(),
      mockGetClaims: vi.fn(),
      mockHasPermission: vi.fn(),
    };
  });

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));
vi.mock("@/services/supabase/permission", () => ({
  getAuthClaims: mockGetClaims,
  hasOrgPermission: mockHasPermission,
}));

import { GET } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHER_ORG = "bbbbbbbb-0000-4000-8000-000000000002";
const T_ID = "cccccccc-0000-4000-8000-000000000001";

const call = (orgId = ORG_ID) =>
  GET(new NextRequest(`http://localhost/api/v1/organizations/${orgId}/payouts`), {
    params: Promise.resolve({ orgId }),
  });

const overviewRow = {
  tournament_id: T_ID,
  tournament_name: "KL Open",
  tournament_status: "published",
  organizing_organization_id: ORG_ID,
  organizing_organization: "KL Chess",
  recipient_organization_id: ORG_ID,
  recipient_organization: "KL Chess",
  is_beneficiary: false,
  net_revenue_cents: 100000,
  paid_payouts_cents: 40000,
  available_cents: 60000,
  early_requests_used: 1,
  recipient_problem: null,
};

const historyRow = {
  id: "dddddddd-0000-4000-8000-000000000001",
  tournament_id: T_ID,
  kind: "early",
  amount_cents: 40000,
  settled_amount_cents: 39000,
  status: "paid",
  approval: "approved",
  failure_reason: null,
  chip_receipt_url: "https://chip.test/r/1",
  requested_at: "2026-10-01T00:00:00Z",
  processed_at: "2026-10-02T00:00:00Z",
  organization_id: ORG_ID,
  recipient_organization_id: ORG_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  orCalls.length = 0;
  mockGetClaims.mockResolvedValue({ id: USER_ID });
  mockHasPermission.mockResolvedValue(true);
  tables.organizations = [{ data: { id: ORG_ID, approval_status: "approved" }, error: null }];
  tables.payouts = [{ data: [historyRow], error: null }];
  mockRpc.mockResolvedValue({ data: [overviewRow], error: null });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /organizations/[orgId]/payouts: gate", () => {
  it("400s on a malformed id", async () => {
    expect((await call("nope")).status).toBe(400);
  });

  it("401s without a session", async () => {
    mockGetClaims.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("404s on an unknown organization", async () => {
    tables.organizations = [{ data: null, error: null }];
    expect((await call()).status).toBe(404);
  });

  it("403s on an unapproved organization", async () => {
    tables.organizations = [{ data: { id: ORG_ID, approval_status: "pending" }, error: null }];
    expect((await call()).status).toBe(403);
  });

  it("checks payout.view, and 403s without it", async () => {
    mockHasPermission.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(mockHasPermission).toHaveBeenCalledWith(USER_ID, ORG_ID, "payout.view");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("GET /organizations/[orgId]/payouts", () => {
  it("returns per-tournament figures and history", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.tournaments).toEqual([
      {
        tournament_id: T_ID,
        name: "KL Open",
        status: "published",
        organizer: "KL Chess",
        recipient: { organization_id: ORG_ID, name: "KL Chess", problem: null },
        is_beneficiary: false,
        net_revenue_cents: 100000,
        paid_payouts_cents: 40000,
        available_cents: 60000,
        early_requests_used: 1,
      },
    ]);
    expect(data.payouts[0]).toMatchObject({
      tournament_name: "KL Open",
      amount_cents: 39000, // what actually settled, not what was requested
      receipt_url: "https://chip.test/r/1",
      is_beneficiary: false,
    });
  });

  it("includes payouts on either side, for a beneficiary", async () => {
    tables.payouts = [
      {
        data: [{ ...historyRow, organization_id: OTHER_ORG }],
        error: null,
      },
    ];
    const { data } = await (await call()).json();
    expect(orCalls[0]).toBe(
      `organization_id.eq.${ORG_ID},recipient_organization_id.eq.${ORG_ID}`,
    );
    expect(data.payouts[0].is_beneficiary).toBe(true);
  });

  it("states a lapsed recipient in words", async () => {
    mockRpc.mockResolvedValue({
      data: [{ ...overviewRow, recipient_problem: "agreement_not_current" }],
      error: null,
    });
    const { data } = await (await call()).json();
    expect(data.tournaments[0].recipient.problem).toMatch(/Organizer Agreement/);
  });

  it("shows a failure in plain language, never CHIP's raw response", async () => {
    tables.payouts = [
      {
        data: [
          {
            ...historyRow,
            status: "failed",
            settled_amount_cents: null,
            failure_reason: 'chip_send_400: {"message":"secret detail"}',
          },
        ],
        error: null,
      },
    ];
    const body = JSON.stringify(await (await call()).json());
    expect(body).not.toContain("secret detail");
    expect(body).toContain("The transfer could not be completed.");
  });

  it("exposes no bank details", async () => {
    const body = JSON.stringify(await (await call()).json());
    expect(body).not.toMatch(/bank|account_number|last4/i);
  });

  it("500s when the overview fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    expect((await call()).status).toBe(500);
  });

  it("500s when the history fails", async () => {
    tables.payouts = [{ data: null, error: { message: "db down" } }];
    expect((await call()).status).toBe(500);
  });
});
