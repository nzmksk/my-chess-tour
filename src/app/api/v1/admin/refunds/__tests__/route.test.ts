import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetClaims, mockRpc, mockLoad } = vi.hoisted(() => ({
  mockGetClaims: vi.fn(),
  mockRpc: vi.fn(),
  mockLoad: vi.fn(),
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

vi.mock("@/services/refunds/stuck", () => ({ loadStuckRefunds: mockLoad }));
vi.mock("@/services/supabase/admin", () => ({ supabaseAdmin: {} }));

import { GET } from "../route";
import { REFUND_STUCK_AFTER_MINUTES } from "@/lib/refunds/stuck-after";

const STUCK = {
  refund_id: "rf-1",
  registration_id: "reg-1",
  tournament_id: "t-1",
  tournament_name: "KL Open",
  player_name: "Aina Tan",
  player_email: "aina@example.com",
  amount_cents: 5500,
  requested_at: "2026-11-01T00:00:00Z",
  last_fired_at: null,
  failed_at: null,
  original_chip_purchase_id: "purchase-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClaims.mockResolvedValue({
    data: { claims: { sub: "aaaaaaaa-0000-0000-0000-000000000001" } },
    error: null,
  });
  mockRpc.mockResolvedValue({ data: true, error: null });
  mockLoad.mockResolvedValue({ data: [STUCK], error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/v1/admin/refunds", () => {
  it("requires a signed-in user", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: null });
    expect((await GET()).status).toBe(401);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it("requires a platform admin", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    expect((await GET()).status).toBe(403);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it("lists the stuck refunds with the threshold that makes one stuck", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { refunds: [STUCK], stuck_after_minutes: REFUND_STUCK_AFTER_MINUTES },
    });
  });

  it("500s when the list can't be loaded", async () => {
    mockLoad.mockResolvedValue({ data: null, error: { message: "db down" } });
    expect((await GET()).status).toBe(500);
  });
});
