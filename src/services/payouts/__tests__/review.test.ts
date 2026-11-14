import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockRpc, mockSign, tables, eqCalls } = vi.hoisted(() => {
  const tables: Record<string, Array<{ data: unknown; error: unknown }>> = {};
  const eqCalls: Array<[string, string, unknown]> = [];

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "maybeSingle", "single"]) {
      b[m] = vi.fn(() => b);
    }
    b.eq = vi.fn((col: string, val: unknown) => {
      eqCalls.push([table, col, val]);
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
    eqCalls,
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
    mockRpc: vi.fn(),
    mockSign: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: {
    from: mockFrom,
    rpc: mockRpc,
    storage: { from: vi.fn(() => ({ createSignedUrl: mockSign })) },
  },
}));

import { ORGANIZER_AGREEMENT_VERSION } from "@/lib/reference/legal";
import { DOCUMENT_URL_TTL_SECONDS, loadPayoutReview } from "../review";

const ID = "11111111-1111-1111-1111-111111111111";
const ORG = "22222222-2222-2222-2222-222222222222";
const T = "33333333-3333-3333-3333-333333333333";

const CAP = {
  net_revenue_cents: 1000000,
  paid_payouts_cents: 0,
  live_refund_cents: 0,
  max_pct: 50,
  ceiling_cents: 500000,
  early_committed_cents: 0,
  available_cents: 1000000,
  cap_cents: 500000,
};

function givenPayout(overrides: Record<string, unknown> = {}) {
  tables.payouts = [
    {
      data: {
        id: ID,
        kind: "early",
        approval: "pending",
        status: "pending",
        amount_cents: 400000,
        settled_amount_cents: null,
        request_seq: 1,
        reason: "Venue deposit",
        rejection_reason: null,
        failure_reason: null,
        requested_at: "2026-11-01T00:00:00Z",
        reviewed_at: null,
        processed_at: null,
        chip_send_instruction_id: null,
        tournament_id: T,
        recipient_organization_id: ORG,
        requester: { first_name: "Olivia", last_name: "Tan", email: "o@x.test" },
        reviewer: null,
        tournament: {
          id: T,
          name: "KL Open",
          status: "published",
          start_date: "2026-12-01",
          end_date: "2026-12-02",
          registration_closed_at: "2026-11-01T00:00:00Z",
        },
        recipient: {
          id: ORG,
          name: "KL Chess",
          approval_status: "approved",
          entity_type: "company",
          registration_number: "202601000001",
          agreement_version: ORGANIZER_AGREEMENT_VERSION,
          agreement_accepted_at: "2026-08-03T00:00:00Z",
        },
        bank: {
          bank_name: "Old Bank",
          account_holder: "KL Chess",
          account_number: "514100009999",
          status: "verified",
          is_active: false,
        },
        ...overrides,
      },
      error: null,
    },
  ];
}

function givenRpc({ cap = CAP, problem = null as string | null } = {}) {
  mockRpc.mockImplementation((name: string) =>
    Promise.resolve(
      name === "early_payout_cap"
        ? { data: [cap], error: null }
        : { data: problem, error: null },
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  eqCalls.length = 0;
  givenPayout();
  givenRpc();
  tables.organization_bank_accounts = [
    {
      data: {
        bank_name: "Maybank",
        account_holder: "KL Chess",
        account_number: "514100001234",
        status: "verified",
        is_active: true,
      },
      error: null,
    },
  ];
  tables.organization_documents = [
    {
      data: [
        { id: "d1", doc_type: "ssm", storage_path: `${ORG}/ssm.pdf`, original_filename: "ssm.pdf" },
        { id: "d2", doc_type: "other", storage_path: `${ORG}/x.pdf`, original_filename: null },
      ],
      error: null,
    },
  ];
  mockSign
    .mockResolvedValueOnce({ data: { signedUrl: "https://signed.test/ssm" }, error: null })
    .mockResolvedValueOnce({ data: null, error: { message: "nope" } });
});

describe("loadPayoutReview", () => {
  it("returns null data for a payout that doesn't exist", async () => {
    tables.payouts = [{ data: null, error: null }];
    expect(await loadPayoutReview(ID)).toEqual({ data: null, error: null });
  });

  it("reports a failed load", async () => {
    tables.payouts = [{ data: null, error: { message: "db down" } }];
    expect(await loadPayoutReview(ID)).toEqual({ data: null, error: "db down" });
  });

  it("asks for the cap and blockers excluding the request itself", async () => {
    await loadPayoutReview(ID);
    expect(mockRpc).toHaveBeenCalledWith("early_payout_cap", {
      p_tournament_id: T,
      p_exclude_payout_id: ID,
    });
    expect(mockRpc).toHaveBeenCalledWith("early_payout_problem", {
      p_tournament_id: T,
      p_exclude_payout_id: ID,
    });
  });

  it("shows a pending request's current active account, masked to the last 4", async () => {
    const { data } = await loadPayoutReview(ID);
    expect(data?.bank_account).toEqual({
      bank_name: "Maybank",
      account_holder: "KL Chess",
      account_number_last4: "1234",
      status: "verified",
      is_active: true,
    });
    expect(JSON.stringify(data)).not.toContain("514100001234");
    expect(eqCalls).toContainEqual(["organization_bank_accounts", "is_active", true]);
  });

  it("shows a reviewed request's recorded account instead", async () => {
    givenPayout({ approval: "approved", reviewed_at: "2026-11-02T00:00:00Z" });
    const { data } = await loadPayoutReview(ID);
    expect(data?.bank_account).toMatchObject({ bank_name: "Old Bank", account_number_last4: "9999" });
    expect(JSON.stringify(data)).not.toContain("514100009999");
    expect(mockRpc).not.toHaveBeenCalledWith("early_payout_problem", expect.anything());
    expect(data?.approval_blocked).toBeNull();
  });

  it("signs each document for a short while, and survives one that can't be signed", async () => {
    const { data } = await loadPayoutReview(ID);
    expect(mockSign).toHaveBeenCalledWith(`${ORG}/ssm.pdf`, DOCUMENT_URL_TTL_SECONDS);
    expect(data?.documents).toEqual([
      { id: "d1", doc_type: "ssm", original_filename: "ssm.pdf", url: "https://signed.test/ssm" },
      { id: "d2", doc_type: "other", original_filename: null, url: null },
    ]);
  });

  it("says whether the agreement is current", async () => {
    expect((await loadPayoutReview(ID)).data?.organization.agreement_current).toBe(true);
    givenPayout({
      recipient: {
        id: ORG,
        name: "KL Chess",
        approval_status: "approved",
        entity_type: "company",
        registration_number: null,
        agreement_version: "2020-01-01",
        agreement_accepted_at: null,
      },
    });
    tables.organization_documents = [{ data: [], error: null }];
    expect((await loadPayoutReview(ID)).data?.organization.agreement_current).toBe(false);
  });

  it("explains why approval would be refused", async () => {
    givenRpc({ problem: "refund_pending" });
    const { data } = await loadPayoutReview(ID);
    expect(data?.approval_blocked).toMatch(/refund has not settled/);
  });

  it("refuses approval of a request over the current cap", async () => {
    givenRpc({ cap: { ...CAP, cap_cents: 300000 } });
    const { data } = await loadPayoutReview(ID);
    expect(data?.approval_blocked).toMatch(/more than can be paid early/);
  });

  it("offers a re-send once approved, until the payout is out with CHIP", async () => {
    expect((await loadPayoutReview(ID)).data?.can_resend).toBe(false);

    givenPayout({ approval: "approved", reviewed_at: "2026-11-02T00:00:00Z" });
    tables.organization_documents = [{ data: [], error: null }];
    expect((await loadPayoutReview(ID)).data?.can_resend).toBe(true);

    givenPayout({ approval: "approved", status: "processing", chip_send_instruction_id: 8 });
    tables.organization_documents = [{ data: [], error: null }];
    expect((await loadPayoutReview(ID)).data?.can_resend).toBe(false);
  });

  it("names the requester", async () => {
    const { data } = await loadPayoutReview(ID);
    expect(data?.requested_by).toEqual({ name: "Olivia Tan", email: "o@x.test" });
  });
});
