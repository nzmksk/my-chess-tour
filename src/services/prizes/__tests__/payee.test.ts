import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockFrom, builder } = vi.hoisted(() => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) builder[m] = vi.fn(() => builder);
  return { mockRpc: vi.fn(), mockFrom: vi.fn(() => builder), builder };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc, from: mockFrom },
}));

import { loadPrizePayees, minorDependentIds } from "../payee";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadPrizePayees", () => {
  it("asks prize_payees once per distinct winner and keys the answer by winner", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          winner_user_id: "child-1",
          payee_user_id: "mum",
          reason: "guardian_of_minor",
        },
        {
          winner_user_id: "adult-1",
          payee_user_id: "adult-1",
          reason: "winner",
        },
      ],
      error: null,
    });

    const result = await loadPrizePayees(["child-1", "adult-1", "child-1"]);

    expect(mockRpc).toHaveBeenCalledWith("prize_payees", {
      p_winners: ["child-1", "adult-1"],
    });
    expect(result.ok && result.payees.get("child-1")).toEqual({
      winnerId: "child-1",
      payeeId: "mum",
      reason: "guardian_of_minor",
    });
    expect(result.ok && result.payees.get("adult-1")?.reason).toBe("winner");
  });

  it("skips the call with no winners", async () => {
    const result = await loadPrizePayees([]);
    expect(result.ok && result.payees.size).toBe(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("reports a failed call", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "down" },
    });
    expect(await loadPrizePayees(["u1"])).toEqual({
      ok: false,
      error: { code: "XX000", message: "down" },
    });
  });
});

describe("minorDependentIds", () => {
  it("lists the guardian's active minor dependents", async () => {
    (builder as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: [{ dependent_user_id: "child-1" }],
        error: null,
      }).then(resolve);

    expect(await minorDependentIds("mum")).toEqual({
      ok: true,
      ids: ["child-1"],
    });
    expect(mockFrom).toHaveBeenCalledWith("guardianships");
    expect(builder.eq).toHaveBeenCalledWith("guardian_user_id", "mum");
    expect(builder.eq).toHaveBeenCalledWith("status", "active");
    expect(builder.eq).toHaveBeenCalledWith("basis", "minor");
  });
});
