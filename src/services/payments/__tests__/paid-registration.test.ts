import { beforeEach, describe, expect, it, vi } from "vitest";

const { builder, mockFrom } = vi.hoisted(() => {
  const builder: Record<string, unknown> & {
    result: { count: number | null; error: unknown };
  } = { result: { count: 0, error: null } };
  for (const m of ["select", "eq", "limit"]) {
    builder[m] = vi.fn(() => builder);
  }
  builder.then = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (r: unknown) => unknown,
  ) => Promise.resolve(builder.result).then(onfulfilled, onrejected);
  return { builder, mockFrom: vi.fn(() => builder) };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

import { hasPaidRegistration } from "../paid-registration";

const TOUR_ID = "cccccccc-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  builder.result = { count: 0, error: null };
});

describe("hasPaidRegistration", () => {
  it("asks for a paid registration payment, the trigger's test", async () => {
    await hasPaidRegistration(TOUR_ID);
    expect(mockFrom).toHaveBeenCalledWith("payments");
    const eqs = (builder.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqs).toEqual([
      ["tournament_id", TOUR_ID],
      ["type", "registration"],
      ["status", "paid"],
    ]);
  });

  it("is true when one exists", async () => {
    builder.result = { count: 1, error: null };
    expect(await hasPaidRegistration(TOUR_ID)).toEqual({ ok: true, paid: true });
  });

  it("is false when none exists", async () => {
    builder.result = { count: 0, error: null };
    expect(await hasPaidRegistration(TOUR_ID)).toEqual({ ok: true, paid: false });
  });

  it("reports a failed query instead of guessing", async () => {
    const error = { message: "db down" };
    builder.result = { count: null, error };
    expect(await hasPaidRegistration(TOUR_ID)).toEqual({ ok: false, error });
  });
});
