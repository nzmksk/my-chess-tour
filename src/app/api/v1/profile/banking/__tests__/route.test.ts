import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appIdFor } from "@/test/identity";
import { NextRequest } from "next/server";

const { mockRpc, mockGetClaims, mockSendAwaiting } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockGetClaims: vi.fn(),
  mockSendAwaiting: vi.fn(),
}));

vi.mock("@/services/prizes/execute", () => ({
  sendAwardsAwaitingBank: mockSendAwaiting,
}));

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc },
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
import { runAfterCallbacks } from "@/test/after";

const USER = "bbbbbbbb-0000-0000-0000-000000000001";

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/v1/profile/banking", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = {
  bank_code: "MBBEMYKL",
  account_holder: "Ahmad bin Ali",
  account_number: "1234567890",
};

const SAVED = {
  changed: true,
  id: "bank-1",
  bank_name: "Maybank",
  bank_code: "MBBEMYKL",
  account_holder: "Ahmad bin Ali",
  account_number_last4: "7890",
  status: "pending",
  rejection_reason: null,
  verified_at: null,
};

describe("PATCH /api/v1/profile/banking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: USER } },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: SAVED, error: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("401 when unauthenticated", async () => {
    mockGetClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await PATCH(makeReq(VALID));
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("400 on invalid JSON body", async () => {
    const res = await PATCH(makeReq("{not json"));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("400 when the bank is not one CHIP Send knows", async () => {
    const res = await PATCH(makeReq({ ...VALID, bank_code: "NOTABANK" }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("400 when a free-text bank name is sent instead of a code", async () => {
    const res = await PATCH(
      makeReq({
        bank_name: "Maybank",
        account_holder: VALID.account_holder,
        account_number: VALID.account_number,
      }),
    );
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("400 when account holder is empty", async () => {
    const res = await PATCH(makeReq({ ...VALID, account_holder: " " }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("400 when account number is non-numeric", async () => {
    const res = await PATCH(makeReq({ ...VALID, account_number: "12ab56" }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("400 when account number is too short", async () => {
    const res = await PATCH(makeReq({ ...VALID, account_number: "123" }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("saves through set_player_bank_account with the derived bank name", async () => {
    const res = await PATCH(makeReq(VALID));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("set_player_bank_account", {
      p_user_id: appIdFor(USER),
      p_bank_code: "MBBEMYKL",
      p_bank_name: "Maybank",
      p_account_holder: "Ahmad bin Ali",
      p_account_number: "1234567890",
    });
  });

  it("returns the masked row and never the full account number", async () => {
    const res = await PATCH(makeReq(VALID));
    const json = await res.json();
    expect(json.data).toEqual(SAVED);
    expect(JSON.stringify(json)).not.toContain("1234567890");
  });

  it("strips spaces and dashes from the account number before storing", async () => {
    const res = await PATCH(makeReq({ ...VALID, account_number: "1234-5678 90" }));
    expect(res.status).toBe(200);
    expect(mockRpc.mock.calls[0][1].p_account_number).toBe("1234567890");
  });

  it("clears the account when every field is null", async () => {
    mockRpc.mockResolvedValue({ data: { changed: true, id: null }, error: null });
    const res = await PATCH(
      makeReq({ bank_code: null, account_holder: null, account_number: null }),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("set_player_bank_account", {
      p_user_id: appIdFor(USER),
      p_bank_code: null,
      p_bank_name: null,
      p_account_holder: null,
      p_account_number: null,
    });
    expect((await res.json()).data).toBeNull();
  });

  it("404 when the user row is gone", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "user not found" } });
    const res = await PATCH(makeReq(VALID));
    expect(res.status).toBe(404);
  });

  it("500 when the RPC fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await PATCH(makeReq(VALID));
    expect(res.status).toBe(500);
  });

  it("sends any prize waiting on the winner after the response (#523)", async () => {
    await PATCH(makeReq(VALID));
    expect(mockSendAwaiting).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(mockSendAwaiting).toHaveBeenCalledWith(appIdFor(USER));
  });

  it("doesn't try to send prizes to a cleared or rejected account", async () => {
    mockRpc.mockResolvedValue({ data: { changed: true, id: null }, error: null });
    await PATCH(makeReq({ bank_code: null, account_holder: null, account_number: null }));
    mockRpc.mockResolvedValue({ data: { ...SAVED, changed: false, status: "rejected" }, error: null });
    await PATCH(makeReq(VALID));
    await runAfterCallbacks();
    expect(mockSendAwaiting).not.toHaveBeenCalled();
  });
});
