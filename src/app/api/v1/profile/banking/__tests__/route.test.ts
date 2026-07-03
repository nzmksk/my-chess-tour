import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockUpsert, mockFrom, mockGetClaims } = vi.hoisted(() => {
  const mockUpsert = vi.fn();
  return {
    mockUpsert,
    mockFrom: vi.fn(() => ({ upsert: mockUpsert })),
    mockGetClaims: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));
vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getClaims: mockGetClaims },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: vi.fn() }),
}));

import { PATCH } from "../route";

const USER = "bbbbbbbb-0000-0000-0000-000000000001";

function makeReq(body: object) {
  return new NextRequest("http://localhost/api/v1/profile/banking", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = {
  bank_name: "Maybank",
  bank_account_holder: "Ahmad bin Ali",
  bank_account_number: "1234567890",
};

describe("PATCH /api/v1/profile/banking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: USER } },
      error: null,
    });
    mockUpsert.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("401 when unauthenticated", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await PATCH(makeReq(VALID));
    expect(res.status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("400 on invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/v1/profile/banking", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("400 when bank_name is empty", async () => {
    const res = await PATCH(makeReq({ ...VALID, bank_name: "  " }));
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("400 when account holder is empty", async () => {
    const res = await PATCH(makeReq({ ...VALID, bank_account_holder: "" }));
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("400 when account number is non-numeric", async () => {
    const res = await PATCH(
      makeReq({ ...VALID, bank_account_number: "12ab56" }),
    );
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("400 when account number is too short", async () => {
    const res = await PATCH(makeReq({ ...VALID, bank_account_number: "123" }));
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("200 and upserts the full trio on a valid payload", async () => {
    const res = await PATCH(makeReq(VALID));
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [payload, opts] = mockUpsert.mock.calls[0];
    expect(payload.user_id).toBe(USER);
    expect(payload.bank_name).toBe("Maybank");
    expect(payload.bank_account_holder).toBe("Ahmad bin Ali");
    expect(payload.bank_account_number).toBe("1234567890");
    expect(opts).toEqual({ onConflict: "user_id" });
  });

  it("strips spaces and dashes from the account number before storing", async () => {
    const res = await PATCH(
      makeReq({ ...VALID, bank_account_number: "1234-5678 90" }),
    );
    expect(res.status).toBe(200);
    expect(mockUpsert.mock.calls[0][0].bank_account_number).toBe("1234567890");
  });

  it("clears all three fields when every field is null", async () => {
    const res = await PATCH(
      makeReq({
        bank_name: null,
        bank_account_holder: null,
        bank_account_number: null,
      }),
    );
    expect(res.status).toBe(200);
    const payload = mockUpsert.mock.calls[0][0];
    expect(payload.bank_name).toBeNull();
    expect(payload.bank_account_holder).toBeNull();
    expect(payload.bank_account_number).toBeNull();
  });

  it("500 when the upsert fails", async () => {
    mockUpsert.mockResolvedValue({ error: { message: "db down" } });
    const res = await PATCH(makeReq(VALID));
    expect(res.status).toBe(500);
  });
});
