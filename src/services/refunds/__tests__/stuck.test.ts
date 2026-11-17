import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc },
}));

import { loadStuckRefunds } from "../stuck";
import { REFUND_STUCK_AFTER_INTERVAL } from "@/lib/refunds/stuck-after";

beforeEach(() => vi.clearAllMocks());

describe("loadStuckRefunds", () => {
  it("asks for refunds stuck past the shared threshold", async () => {
    mockRpc.mockResolvedValue({ data: [{ refund_id: "rf-1" }], error: null });

    await expect(loadStuckRefunds()).resolves.toEqual({
      data: [{ refund_id: "rf-1" }],
      error: null,
    });
    expect(mockRpc).toHaveBeenCalledWith("list_stuck_refunds", {
      p_min_age: REFUND_STUCK_AFTER_INTERVAL,
    });
  });

  it("reads no rows as an empty list", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(loadStuckRefunds()).resolves.toEqual({ data: [], error: null });
  });

  it("passes an error through", async () => {
    const error = { message: "db down" };
    mockRpc.mockResolvedValue({ data: null, error });
    await expect(loadStuckRefunds()).resolves.toEqual({ data: null, error });
  });
});
