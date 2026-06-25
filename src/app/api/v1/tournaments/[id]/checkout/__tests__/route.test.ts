import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockTournamentBuilder,
  mockExistingBuilder,
  mockPaymentSelectBuilder,
  mockPaymentUpdateBuilder,
  mockFrom,
  mockRpc,
  mockGetUser,
  mockCreateChipPurchase,
  resetCallCounts,
} = vi.hoisted(() => {
  function makeBuilder(finalResult: {
    data?: unknown;
    count?: unknown;
    error?: unknown;
  }) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "single", "maybeSingle", "update"]) {
      b[m] = vi.fn(() => b);
    }
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) => Promise.resolve(finalResult).then(onfulfilled, onrejected);
    return b;
  }

  const mockTournamentBuilder = makeBuilder({ data: null, error: null });
  const mockExistingBuilder = makeBuilder({ data: null, error: null });
  const mockPaymentSelectBuilder = makeBuilder({ data: null, error: null });
  const mockPaymentUpdateBuilder = makeBuilder({ data: null, error: null });

  let payCallCount = 0;
  const resetCallCounts = () => {
    payCallCount = 0;
  };

  const mockFrom = vi.fn((table: string) => {
    if (table === "tournaments") return mockTournamentBuilder;
    // Only one registrations read remains (the existing-registration lookup);
    // capacity is enforced in Postgres, not via a JS pre-check.
    if (table === "registrations") return mockExistingBuilder;
    if (table === "payments") {
      const builders = [mockPaymentSelectBuilder, mockPaymentUpdateBuilder];
      return builders[payCallCount++] ?? mockPaymentUpdateBuilder;
    }
    return makeBuilder({ data: null, error: null });
  });

  const mockRpc = vi.fn<() => Promise<{ data: unknown; error: unknown }>>(() =>
    Promise.resolve({ data: null, error: null }),
  );
  const mockGetUser = vi.fn();
  const mockCreateChipPurchase = vi.fn();
  return {
    mockTournamentBuilder,
    mockExistingBuilder,
    mockPaymentSelectBuilder,
    mockPaymentUpdateBuilder,
    mockFrom,
    mockRpc,
    mockGetUser,
    mockCreateChipPurchase,
    resetCallCounts,
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

vi.mock("@/services/chip/chip", () => ({
  createChipPurchase: mockCreateChipPurchase,
}));

import { POST } from "../route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const FUTURE_DEADLINE = "2099-12-31T23:59:59Z";

function makeTournament(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID,
    name: "Test Open",
    entry_fees: {
      standard: { amount_cents: 5000 },
      additional: [{ type: "early_bird", amount_cents: 3000 }],
    },
    max_participants: 100,
    registration_deadline: FUTURE_DEADLINE,
    restrictions: null,
    format: { type: "rapid" },
    ...overrides,
  };
}

function makeRequest(id: string, body: unknown = { fee_tier: "standard" }) {
  return new NextRequest(`http://localhost/api/v1/tournaments/${id}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setThen(
  builder: Record<string, unknown>,
  result: { data?: unknown; count?: unknown; error?: unknown },
) {
  builder.then = (r: (v: unknown) => unknown) =>
    Promise.resolve(result).then(r);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCallCounts();
  mockGetUser.mockResolvedValue({
    data: { user: { id: USER_ID, email: "p@example.com" } },
    error: null,
  });
  setThen(mockTournamentBuilder, { data: makeTournament(), error: null });
  setThen(mockExistingBuilder, { data: null, error: null });
  setThen(mockPaymentSelectBuilder, {
    data: { id: "pay-1", gross_amount_cents: 3300 },
    error: null,
  });
  setThen(mockPaymentUpdateBuilder, { data: null, error: null });
  mockRpc.mockResolvedValue({ data: { id: "reg-1" }, error: null });
  mockCreateChipPurchase.mockResolvedValue({
    id: "chip-purchase-1",
    checkout_url: "https://pay.example/checkout",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/tournaments/:id/checkout — resume", () => {
  it("resumes a failed_payment registration without erroring (H2) and re-prices to the chosen tier (H1)", async () => {
    setThen(mockExistingBuilder, {
      data: { id: "reg-1", status: "failed_payment" },
      error: null,
    });

    const res = await POST(
      makeRequest(VALID_UUID, { fee_tier: "early_bird" }),
      {
        params: Promise.resolve({ id: VALID_UUID }),
      },
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.checkout_url).toBe("https://pay.example/checkout");

    // H1: reset RPC called with the newly chosen tier + its amount.
    expect(mockRpc).toHaveBeenCalledWith("reset_registration_for_payment", {
      p_registration_id: "reg-1",
      p_fee_tier: "early_bird",
      p_amount_cents: 3000,
    });
  });

  it("resumes a pending_payment registration", async () => {
    setThen(mockExistingBuilder, {
      data: { id: "reg-1", status: "pending_payment" },
      error: null,
    });

    const res = await POST(makeRequest(VALID_UUID, { fee_tier: "standard" }), {
      params: Promise.resolve({ id: VALID_UUID }),
    });

    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith("reset_registration_for_payment", {
      p_registration_id: "reg-1",
      p_fee_tier: "standard",
      p_amount_cents: 5000,
    });
  });

  it("returns 409 when the registration is already confirmed", async () => {
    setThen(mockExistingBuilder, {
      data: { id: "reg-1", status: "confirmed" },
      error: null,
    });

    const res = await POST(makeRequest(VALID_UUID), {
      params: Promise.resolve({ id: VALID_UUID }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("ALREADY_REGISTERED");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("maps a capacity-full reset error to 422 (slot taken while lapsed)", async () => {
    setThen(mockExistingBuilder, {
      data: { id: "reg-1", status: "failed_payment" },
      error: null,
    });
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "Tournament is full (100 / 100 participants)",
      },
    });

    const res = await POST(makeRequest(VALID_UUID), {
      params: Promise.resolve({ id: VALID_UUID }),
    });

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("CAPACITY_FULL");
    expect(mockCreateChipPurchase).not.toHaveBeenCalled();
  });

  it("maps a non-resumable (P0001) reset error to 409", async () => {
    setThen(mockExistingBuilder, {
      data: { id: "reg-1", status: "failed_payment" },
      error: null,
    });
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "registration is not resumable" },
    });

    const res = await POST(makeRequest(VALID_UUID), {
      params: Promise.resolve({ id: VALID_UUID }),
    });

    expect(res.status).toBe(409);
    expect(mockCreateChipPurchase).not.toHaveBeenCalled();
  });

  it("creates a new registration when none exists", async () => {
    setThen(mockExistingBuilder, { data: null, error: null });

    const res = await POST(makeRequest(VALID_UUID, { fee_tier: "standard" }), {
      params: Promise.resolve({ id: VALID_UUID }),
    });

    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith("create_registration_with_payment", {
      p_user_id: USER_ID,
      p_tournament_id: VALID_UUID,
      p_fee_tier: "standard",
      p_amount_cents: 5000,
    });
  });
});
