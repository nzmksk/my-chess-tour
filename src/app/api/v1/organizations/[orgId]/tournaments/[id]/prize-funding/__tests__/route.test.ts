import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockFrom,
  mockGetClaims,
  mockHasPermission,
  mockCreatePurchase,
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
    mockCreatePurchase: vi.fn(),
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
vi.mock("@/services/chip/chip", () => ({
  createChipPurchase: mockCreatePurchase,
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

const post = (body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/v1/organizations/${ORG_ID}/tournaments/${T_ID}/prize-funding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
  status: "published",
  prizes: { distribution: "platform" },
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

const VALID = { funder_name: "Acme Sdn Bhd", funder_email: "Sponsor@Acme.test" };

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  inserts.length = 0;
  updates.length = 0;
  mockGetClaims.mockResolvedValue({ id: USER_ID });
  mockHasPermission.mockResolvedValue(true);
  tables.organizations = [{ data: { id: ORG_ID, approval_status: "approved" }, error: null }];
  tables.tournaments = [{ data: platformTournament, error: null }];
  tables.prize_fundings = [{ data: { id: FUNDING_ID }, error: null }];
  mockLoadPool.mockResolvedValue({ ok: true, position: position(20000) });
  mockCreatePurchase.mockResolvedValue({
    id: "chip-purchase-1",
    checkout_url: "https://gate.chip-in.asia/p/1",
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe("POST prize-funding", () => {
  it("needs payout.request", async () => {
    mockHasPermission.mockResolvedValue(false);
    const res = await post(VALID);
    expect(res.status).toBe(403);
    expect(mockHasPermission).toHaveBeenCalledWith(USER_ID, ORG_ID, "payout.request");
    expect(mockCreatePurchase).not.toHaveBeenCalled();
  });

  it("asks for what the pool still needs when no amount is given", async () => {
    const res = await post(VALID);
    expect(res.status).toBe(201);
    expect(inserts).toEqual([
      {
        table: "prize_fundings",
        row: {
          tournament_id: T_ID,
          funder_name: "Acme Sdn Bhd",
          funder_email: "sponsor@acme.test",
          amount_cents: 30000,
          created_by: USER_ID,
        },
      },
    ]);
    const json = await res.json();
    expect(json.data).toEqual({
      id: FUNDING_ID,
      amount_cents: 30000,
      checkout_url: "https://gate.chip-in.asia/p/1",
    });
  });

  it("creates a CHIP purchase referencing the funding, with no expiry", async () => {
    await post({ ...VALID, amount_cents: 10000 });
    const request = mockCreatePurchase.mock.calls[0][0];
    expect(request.reference).toBe(FUNDING_ID);
    expect(request.client).toEqual({ email: "sponsor@acme.test", full_name: "Acme Sdn Bhd" });
    expect(request.purchase.products).toEqual([
      { name: "Prize fund — Merdeka Open", price: 10000, quantity: "1" },
    ]);
    expect(request.due).toBeUndefined();
    expect(request.purchase.due_strict).toBeUndefined();
    expect(updates).toContainEqual({
      table: "prize_fundings",
      patch: {
        chip_transaction_id: "chip-purchase-1",
        checkout_url: "https://gate.chip-in.asia/p/1",
      },
    });
  });

  it("refuses more than the pool still needs", async () => {
    const res = await post({ ...VALID, amount_cents: 30001 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("EXCEEDS_REMAINING");
    expect(inserts).toEqual([]);
  });

  it("refuses a pool that is already funded", async () => {
    mockLoadPool.mockResolvedValue({ ok: true, position: position(50000) });
    const res = await post(VALID);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("POOL_ALREADY_FUNDED");
  });

  it("refuses a tournament whose organizer pays its own winners", async () => {
    tables.tournaments = [
      { data: { ...platformTournament, prizes: { distribution: "organizer" } }, error: null },
    ];
    const res = await post(VALID);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_PLATFORM_DISTRIBUTED");
    expect(mockLoadPool).not.toHaveBeenCalled();
  });

  it("refuses a cancelled tournament", async () => {
    tables.tournaments = [{ data: { ...platformTournament, status: "cancelled" }, error: null }];
    const res = await post(VALID);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("TOURNAMENT_CANCELLED");
  });

  it("404s a tournament of another organization", async () => {
    tables.tournaments = [{ data: null, error: null }];
    const res = await post(VALID);
    expect(res.status).toBe(404);
  });

  it.each<[Record<string, unknown>, string]>([
    [{ funder_email: "a@b.test" }, "missing name"],
    [{ funder_name: "Acme", funder_email: "not-an-email" }, "bad email"],
    [{ ...VALID, amount_cents: 0 }, "zero amount"],
    [{ ...VALID, amount_cents: 12.5 }, "fractional amount"],
  ])("400 on %o (%s)", async (body: Record<string, unknown>) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(inserts).toEqual([]);
  });

  it("marks the funding failed and answers 503 when CHIP is down", async () => {
    mockCreatePurchase.mockRejectedValue(new Error("CHIP API error 502"));
    const res = await post(VALID);
    expect(res.status).toBe(503);
    expect(updates).toContainEqual({ table: "prize_fundings", patch: { status: "failed" } });
  });
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe("GET prize-funding", () => {
  it("returns the pool and its contributions to payout viewers", async () => {
    const fundings = [
      { id: FUNDING_ID, funder_name: "Acme", amount_cents: 20000, status: "paid" },
    ];
    tables.prize_fundings = [{ data: fundings, error: null }];
    const res = await get();
    expect(res.status).toBe(200);
    expect(mockHasPermission).toHaveBeenCalledWith(USER_ID, ORG_ID, "payout.view");
    expect((await res.json()).data).toEqual({ pool: position(20000), fundings });
  });

  it("500s when the pool can't be read", async () => {
    mockLoadPool.mockResolvedValue({ ok: false, error: { message: "db down" } });
    const res = await get();
    expect(res.status).toBe(500);
  });
});
